'use client';

import { useState } from 'react';
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

/**
 * The embedded, sandboxed preview of a Stitch-generated UI prototype
 * (E5-S10; TR FR-053; ERD 4.16). `htmlUrl`/`screenshotUrl` are short-lived
 * Supabase Storage signed URLs (`getSignedAssetUrls`, `src/external/stitch`)
 * already served from a genuinely separate origin (`*.supabase.co`) - that
 * origin separation is what satisfies FR-053, so this component renders the
 * HTML directly via `iframe src`, not `srcdoc` after a server-side fetch
 * (ERD 4.16's fallback path, only needed if the bucket ever stopped serving
 * `text/html`, which it does not - `uploadAsset` sets the content type
 * explicitly).
 *
 * The `sandbox` attribute below must never include `allow-same-origin` -
 * that is the one invariant standing between this, the single place in the
 * app that renders model-generated HTML at all, and an XSS surface
 * (NFR-005's UI-side twin, screen-kit skill). `allow-scripts` alone lets the
 * generated prototype run its own script without ever sharing this app's
 * origin, storage, or cookies.
 */
export function SandboxedHtmlPreview({ htmlUrl, screenshotUrl }: SandboxedHtmlPreviewProps) {
  const [tab, setTab] = useState<PreviewTab>('html');
  const [iframeFailed, setIframeFailed] = useState(false);

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
          {iframeFailed ? (
            <div className="flex items-start gap-2 p-3">
              <CircleAlert
                className="text-on-surface-variant mt-0.5 size-5 shrink-0"
                aria-hidden="true"
              />
              <p className="text-on-surface-variant text-sm">
                The embedded preview couldn&apos;t load - the signed URL may have expired. Use
                &quot;Open generated HTML&quot; below to view it in a new tab.
              </p>
            </div>
          ) : (
            // FR-053 / ERD 4.16: no `allow-same-origin`, ever. `allow-scripts`
            // is the only other sandbox token - enough for a generated
            // prototype to run its own script without sharing this app's
            // origin.
            <iframe
              key={htmlUrl}
              src={htmlUrl}
              title="Generated UI prototype preview (sandboxed)"
              sandbox="allow-scripts"
              onError={() => setIframeFailed(true)}
              className="h-[480px] w-full rounded-lg border-0 bg-white"
            />
          )}
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
