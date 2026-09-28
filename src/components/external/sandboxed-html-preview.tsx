'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { computePreviewScale } from '@/lib/preview-scale';

interface SandboxedHtmlPreviewProps {
  htmlUrl: string;
  screenshotUrl: string;
}

type PreviewTab = 'html' | 'screenshot';

const TAB_BUTTON_BASE =
  'focus-visible:ring-primary rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none';

const TAB_BUTTON_ACTIVE = 'bg-primary-container text-on-primary-container';

const TAB_BUTTON_INACTIVE =
  'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface';

const DOWNLOAD_FILENAME = 'stitch-prototype.html';

// Generated prototypes are ~60KB; anything far beyond that is not something
// to hand to an iframe.
const MAX_HTML_BYTES = 5 * 1024 * 1024;

// Stitch is asked for a DESKTOP screen, so the iframe is laid out at a real
// desktop viewport and scaled down to fit, rather than squeezed into the panel
// (which would make the generated page's own media queries collapse it).
const DESKTOP_DESIGN_WIDTH = 1280;
// A 4:3-ish desktop viewport: at the typical ~0.5 scale in the panel this is
// ~500px on screen, a bit taller than the old fixed 480px; Expand shows more.
const DESKTOP_DESIGN_HEIGHT = 960;

type PreviewSize = 'fit' | 'actual';

type HtmlLoad = { status: 'loading' } | { status: 'ready'; html: string } | { status: 'failed' };

/**
 * The sandboxed iframe at its true design size, scaled to the wrapper width.
 * Only mounted after the HTML has been fetched (never server-rendered), so the
 * synchronous first measurement in a layout effect cannot flash or mismatch.
 */
function ScaledFrame({ html, size }: { html: string; size: PreviewSize }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = size === 'actual' ? 1 : computePreviewScale(containerWidth, DESKTOP_DESIGN_WIDTH);

  return (
    <div
      ref={wrapperRef}
      className={size === 'actual' ? 'max-h-[70vh] w-full overflow-auto' : 'w-full overflow-hidden'}
    >
      <div
        style={{ width: DESKTOP_DESIGN_WIDTH * scale, height: DESKTOP_DESIGN_HEIGHT * scale }}
        className="overflow-hidden"
      >
        {/* FR-053 / ERD 4.16: no `allow-same-origin`, ever (srcdoc + no
            same-origin => opaque origin). `allow-scripts` is the only sandbox
            token; the CSS transform does not affect the sandbox. */}
        <iframe
          srcDoc={html}
          title="Generated UI prototype preview (sandboxed)"
          sandbox="allow-scripts"
          style={{
            width: DESKTOP_DESIGN_WIDTH,
            height: DESKTOP_DESIGN_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="max-w-none rounded-lg border-0 bg-white"
        />
      </div>
    </div>
  );
}

/**
 * Full-viewport modal (native `<dialog>`: focus trap, Escape and backdrop come
 * with `showModal()`). Its iframe is mounted only while open so two copies of
 * the generated script never run at once.
 */
function ExpandedPreviewDialog({
  html,
  open,
  onClose,
}: {
  html: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="stitch-preview-expanded-title"
      // Fires for Escape, the Close button and programmatic close() alike.
      onClose={onClose}
      onClick={(event) => {
        // Only a click on the backdrop targets the <dialog> itself.
        if (event.target === event.currentTarget) onClose();
      }}
      className="bg-surface-container-lowest m-0 h-dvh max-h-none w-dvw max-w-none p-0 backdrop:bg-black/50"
    >
      {open ? (
        <div className="flex h-full flex-col gap-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <h2
              id="stitch-preview-expanded-title"
              className="text-on-surface text-sm font-semibold"
            >
              Generated UI prototype
            </h2>
            <button
              type="button"
              autoFocus
              aria-label="Close expanded preview"
              onClick={onClose}
              className={`${TAB_BUTTON_BASE} ${TAB_BUTTON_INACTIVE} border-outline-variant border`}
            >
              Close
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <ScaledFrame html={html} size="fit" />
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * The embedded, sandboxed preview of a Stitch-generated UI prototype
 * (E5-S10; TR FR-053; ERD 4.16). `htmlUrl`/`screenshotUrl` are short-lived
 * Supabase Storage signed URLs (`getSignedAssetUrls`, `src/external/stitch`).
 *
 * Supabase Storage serves stored `.html` as `text/plain` (with `nosniff` and
 * `CSP: sandbox`) regardless of the uploaded mimetype, so `iframe src={url}`
 * and a new-tab link both show source, not a page. This is ERD 4.16's
 * documented fallback: fetch the HTML as text in the browser (signed URLs
 * send `access-control-allow-origin: *`) and render it via `srcDoc`.
 *
 * The `sandbox` attribute below must never include `allow-same-origin`. A
 * `srcdoc` iframe sandboxed without it gets an opaque origin, so the
 * generated script can never touch this app's origin, storage, or cookies -
 * that is what preserves FR-053 / NFR-005's UI-side twin. `allow-scripts`
 * alone lets the prototype run its own script.
 *
 * The prototype is a desktop screen, so the iframe is laid out at its true
 * 1280px design width and shrunk with a CSS `transform: scale()` to the panel
 * width (`computePreviewScale`, measured by ResizeObserver) instead of being
 * squeezed into a narrow viewport. "Fit" (default) / "Actual size" toggles
 * that; "Expand" shows the same already-fetched HTML in a native modal
 * `<dialog>`, mounted only while open. The transform and the dialog do not
 * change the sandbox.
 *
 * "Download HTML" saves the fetched text via a Blob object URL and
 * `a[download]`. It must never become a new-tab/blob: navigation - that would
 * run generated scripts in the app's origin.
 */
export function SandboxedHtmlPreview({ htmlUrl, screenshotUrl }: SandboxedHtmlPreviewProps) {
  const [tab, setTab] = useState<PreviewTab>('html');
  const [size, setSize] = useState<PreviewSize>('fit');
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [load, setLoad] = useState<{ url: string; result: HtmlLoad } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(htmlUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();
        if (html.length > MAX_HTML_BYTES) throw new Error('too large');
        setLoad({ url: htmlUrl, result: { status: 'ready', html } });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError'))
          return;
        setLoad({ url: htmlUrl, result: { status: 'failed' } });
      });
    return () => controller.abort();
  }, [htmlUrl]);

  // A result for a previous URL counts as still loading.
  const html: HtmlLoad = load && load.url === htmlUrl ? load.result : { status: 'loading' };

  function downloadHtml() {
    if (html.status !== 'ready') return;
    const objectUrl = URL.createObjectURL(new Blob([html.html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = DOWNLOAD_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Prototype preview mode"
        className="border-outline-variant bg-surface-container-low inline-flex w-fit gap-1 rounded-lg border p-1"
      >
        <button
          type="button"
          role="tab"
          id="stitch-preview-tab-html"
          aria-selected={tab === 'html'}
          aria-controls="stitch-preview-panel-html"
          onClick={() => setTab('html')}
          className={`${TAB_BUTTON_BASE} ${tab === 'html' ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}`}
        >
          HTML preview
        </button>
        <button
          type="button"
          role="tab"
          id="stitch-preview-tab-screenshot"
          aria-selected={tab === 'screenshot'}
          aria-controls="stitch-preview-panel-screenshot"
          onClick={() => setTab('screenshot')}
          className={`${TAB_BUTTON_BASE} ${tab === 'screenshot' ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}`}
        >
          Screenshot
        </button>
      </div>

      {tab === 'html' ? (
        <div
          id="stitch-preview-panel-html"
          role="tabpanel"
          aria-labelledby="stitch-preview-tab-html"
          className="border-surface-dim bg-surface-container-lowest flex flex-col gap-2 rounded-xl border p-3"
        >
          {html.status === 'failed' ? (
            <div className="flex items-start gap-2 p-3">
              <CircleAlert
                className="text-on-surface-variant mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-on-surface-variant text-sm">
                The embedded preview couldn&apos;t load - the signed URL may have expired.
                Regenerate to get a fresh one, or use the Screenshot tab.
              </p>
            </div>
          ) : html.status === 'loading' ? (
            <p role="status" className="text-on-surface-variant p-3 text-sm">
              Loading preview...
            </p>
          ) : (
            <ScaledFrame key={htmlUrl} html={html.html} size={size} />
          )}
          {html.status === 'ready' ? (
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Preview size"
                className="border-outline-variant bg-surface-container-low inline-flex gap-1 rounded-lg border p-1"
              >
                {(['fit', 'actual'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={size === option}
                    onClick={() => setSize(option)}
                    className={`${TAB_BUTTON_BASE} ${size === option ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}`}
                  >
                    {option === 'fit' ? 'Fit' : 'Actual size'}
                  </button>
                ))}
              </div>
              <button
                ref={expandButtonRef}
                type="button"
                aria-label="Expand preview to full screen"
                onClick={() => setExpanded(true)}
                className={`${TAB_BUTTON_BASE} ${TAB_BUTTON_INACTIVE} border-outline-variant border`}
              >
                Expand
              </button>
              <button
                type="button"
                onClick={downloadHtml}
                className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                Download HTML
              </button>
              <ExpandedPreviewDialog
                key={htmlUrl}
                html={html.html}
                open={expanded}
                onClose={() => {
                  setExpanded(false);
                  expandButtonRef.current?.focus();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div
          id="stitch-preview-panel-screenshot"
          role="tabpanel"
          aria-labelledby="stitch-preview-tab-screenshot"
          className="border-surface-dim bg-surface-container-lowest overflow-auto rounded-xl border p-3"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived
              cross-origin signed URL, not something next/image should cache/optimize. */}
          <img
            src={screenshotUrl}
            alt="Screenshot of the generated UI prototype"
            className="w-full rounded-lg"
          />
        </div>
      )}
    </div>
  );
}
