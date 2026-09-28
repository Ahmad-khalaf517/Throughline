'use client';

import { useEffect, useState } from 'react';
import { CircleAlert } from 'lucide-react';

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

type HtmlLoad = { status: 'loading' } | { status: 'ready'; html: string } | { status: 'failed' };

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
 * "Download HTML" saves the fetched text via a Blob object URL and
 * `a[download]`. It must never become a new-tab/blob: navigation - that would
 * run generated scripts in the app's origin.
 */
export function SandboxedHtmlPreview({ htmlUrl, screenshotUrl }: SandboxedHtmlPreviewProps) {
  const [tab, setTab] = useState<PreviewTab>('html');
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
            // FR-053 / ERD 4.16: no `allow-same-origin`, ever (srcdoc + no
            // same-origin => opaque origin). `allow-scripts` is the only
            // sandbox token.
            <iframe
              key={htmlUrl}
              srcDoc={html.html}
              title="Generated UI prototype preview (sandboxed)"
              sandbox="allow-scripts"
              className="h-[480px] w-full rounded-lg border-0 bg-white"
            />
          )}
          {html.status === 'ready' ? (
            <button
              type="button"
              onClick={downloadHtml}
              className="text-primary-container hover:text-primary-container-hover focus-visible:ring-primary self-start rounded-md text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
            >
              Download HTML
            </button>
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
