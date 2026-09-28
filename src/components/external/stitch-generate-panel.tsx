'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck } from 'lucide-react';
import { FormMessage } from '@/components/auth/form-message';
import type { ExternalRefDTO, ImpactRowDTO } from '@/lib/serialize';
import {
  describeExternalError,
  isExternalWriteBlocked,
  readImpactFromError,
  stitchProjectUrl,
} from '@/lib/external-preview';
import { PreviewShell, type PreviewState } from './preview-shell';
import { ImpactGate } from './impact-gate';
import { OperationStatus } from './operation-status';
import { SandboxedHtmlPreview } from './sandboxed-html-preview';

interface StitchGeneratePanelProps {
  projectId: string;
}

interface StitchPreviewData {
  prompt: string;
  impact: ImpactRowDTO[];
}

type StitchResult =
  | { mode: 'api'; ref: ExternalRefDTO; htmlUrl: string; screenshotUrl: string }
  | { mode: 'manual_fallback'; promptText: string }
  | { mode: 'pending'; operationId: string };

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { impact?: ImpactRowDTO[] } };
}

const SUBMIT_CLASSNAME =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

const SECONDARY_BUTTON_CLASSNAME =
  'border-outline-variant text-on-surface hover:bg-surface-container-low focus-visible:ring-primary self-start rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none';

/**
 * `GET /api/projects/:projectId/stitch/preview` + `POST .../stitch/generate`
 * (API Contracts section 10; E5-S9). Same client-`fetch` mutation pattern as
 * the other two panels.
 *
 * On success, the generated HTML/screenshot are rendered by
 * `SandboxedHtmlPreview` - the HTML is fetched as text and rendered in an
 * iframe via `srcDoc` with `sandbox="allow-scripts"` (no `allow-same-origin`),
 * which gives it an opaque origin (E5-S10, TR FR-053, ERD 4.16 fallback), with the screenshot
 * and Stitch available as "open in a new tab" links (the HTML is download-only:
 * a new tab would show source, see `SandboxedHtmlPreview`).
 */
export function StitchGeneratePanel({ projectId }: StitchGeneratePanelProps) {
  const router = useRouter();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [preview, setPreview] = useState<StitchPreviewData | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<StitchResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      try {
        // The persisted output is fetched alongside the preview so returning to
        // (or refreshing) the page shows what already exists instead of the
        // form (SCRUM-91). A failed output read is non-fatal: fall back to the
        // form - the server still guards with ALREADY_GENERATED, handled below.
        const [response, existing] = await Promise.all([
          fetch(`/api/projects/${projectId}/stitch/preview`),
          fetchOutput(projectId),
        ]);

        if (response.status === 401) {
          router.push('/sign-in');
          return;
        }

        const body = await response.json();
        if (cancelled) return;
        if (existing) setResult(existing);

        if (!response.ok) {
          const errorBody = body as ErrorBody;
          if (errorBody.error?.code === 'PREREQUISITE_NOT_APPROVED') {
            setState({
              status: 'prerequisite-not-met',
              message: errorBody.error.message ?? 'UI Requirements has no approved version.',
              reviewHref: `/projects/${projectId}/artifacts/ui_requirements`,
            });
            return;
          }
          setState({
            status: 'error',
            message: describeExternalError(
              errorBody.error?.code,
              errorBody.error?.message ?? 'Could not load the Stitch preview.',
            ),
          });
          return;
        }

        setPreview(body as StitchPreviewData);
        setState({ status: 'ready' });
      } catch {
        if (!cancelled) {
          setState({
            status: 'error',
            message: 'Could not reach the server. Check your connection and try again.',
          });
        }
      }
    }

    loadPreview();
    return () => {
      cancelled = true;
    };
  }, [projectId, router]);

  async function refreshOutput() {
    const existing = await fetchOutput(projectId);
    setResult(existing);
  }

  async function handleSubmit() {
    if (!preview) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/stitch/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ impactAcknowledged: acknowledged }),
      });

      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }

      const body = await response.json();

      if (response.status === 202) {
        setResult({ mode: 'pending', operationId: body.operationId });
        return;
      }

      if (!response.ok) {
        const errorBody = body as ErrorBody;

        // Impact is evaluated fresh on every read (INV-025) - the server can
        // find new impact at generate time that this panel's own preview
        // fetch never saw. Re-render the fresh `details.impact`
        // `IMPACT_NOT_ACKNOWLEDGED` carries (with the confirmation checkbox
        // `ImpactGate` renders alongside it) instead of dead-ending on a
        // message pointing at impact the user was never shown.
        if (errorBody.error?.code === 'IMPACT_NOT_ACKNOWLEDGED') {
          const freshImpact = readImpactFromError(body);
          if (freshImpact) {
            setPreview((current) => (current ? { ...current, impact: freshImpact } : current));
            setAcknowledged(false);
            setSubmitError(
              'New impact was found while preparing this write. Review it below and confirm to continue.',
            );
            return;
          }
          // Malformed/missing payload - fall through to the generic path
          // below rather than clearing impact to `[]` and silently
          // re-enabling submit.
        }

        // A result already exists (e.g. generated in another tab): show it
        // rather than the raw error.
        if (errorBody.error?.code === 'ALREADY_GENERATED') {
          await refreshOutput();
          return;
        }

        setSubmitError(
          describeExternalError(
            errorBody.error?.code,
            errorBody.error?.message ?? 'Something went wrong. Please try again.',
          ),
        );
        return;
      }

      setResult(body as StitchResult);
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission can be denied by the browser - not fatal, the
      // prompt is already shown selectable on screen either way.
    }
  }

  return (
    <PreviewShell state={state}>
      {preview &&
        (result ? (
          <StitchResultView
            result={result}
            onCopy={handleCopy}
            copied={copied}
            onRetry={() => {
              // Re-runs the normal generate flow, impact gate included.
              setSubmitError(null);
              setRetrying(true);
              setResult(null);
            }}
            onSettled={refreshOutput}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
              <h3 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
                Prompt
              </h3>
              {/* NFR-005: model-derived text is rendered as escaped text,
                  never raw HTML - a `<pre>`/`whitespace-pre-wrap` block, no
                  `dangerouslySetInnerHTML`. */}
              <pre className="text-on-surface bg-surface-container mt-2 max-h-96 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">
                {preview.prompt}
              </pre>
            </div>

            <ImpactGate
              impact={preview.impact}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              idPrefix="stitch-generate"
            />

            {submitError && <FormMessage variant="error">{submitError}</FormMessage>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || isExternalWriteBlocked(preview.impact, acknowledged)}
              className={SUBMIT_CLASSNAME}
            >
              {submitting
                ? 'Generating…'
                : retrying
                  ? 'Retry with Stitch'
                  : 'Generate UI prototype'}
            </button>
          </div>
        ))}
    </PreviewShell>
  );
}

/**
 * `GET .../stitch/output` (SCRUM-91) -> the panel's own `StitchResult`, or
 * `null` for "nothing yet" (and for any read failure - see the caller).
 */
async function fetchOutput(projectId: string): Promise<StitchResult | null> {
  try {
    const response = await fetch(`/api/projects/${projectId}/stitch/output`);
    if (!response.ok) return null;
    const body = await response.json();
    switch (body?.state) {
      case 'generated':
        return {
          mode: 'api',
          ref: body.ref,
          htmlUrl: body.htmlUrl,
          screenshotUrl: body.screenshotUrl,
        };
      case 'manual_fallback':
        return { mode: 'manual_fallback', promptText: body.promptText };
      case 'in_progress':
        return { mode: 'pending', operationId: body.operationId };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function StitchResultView({
  result,
  onCopy,
  copied,
  onRetry,
  onSettled,
}: {
  result: StitchResult;
  onCopy: (text: string) => void;
  copied: boolean;
  onRetry: () => void;
  onSettled: () => void;
}) {
  if (result.mode === 'pending') {
    // Polls (and offers Retry for reconciliation_required); once the operation
    // settles, the panel re-reads the persisted output to show its result.
    return <OperationStatus operationId={result.operationId} onSettled={onSettled} />;
  }

  if (result.mode === 'manual_fallback') {
    return (
      <div className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-6">
        {/* FR-054: a manual fallback is a SUCCESS state, not an error - the
            workflow continues, just without an automated Stitch call. */}
        <div className="flex items-start gap-2">
          <CircleCheck
            className="text-status-approved-bg mt-0.5 size-5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-on-surface text-sm font-medium">
            Prepared a prompt for you to paste into Stitch by hand - the automated call didn&apos;t
            go through, but the workflow continues.
          </p>
        </div>
        <pre className="text-on-surface bg-surface-container max-h-96 overflow-auto rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap">
          {result.promptText}
        </pre>
        <button
          type="button"
          onClick={() => onCopy(result.promptText)}
          className={SECONDARY_BUTTON_CLASSNAME}
        >
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
        <button type="button" onClick={onRetry} className={SECONDARY_BUTTON_CLASSNAME}>
          Retry with Stitch
        </button>
      </div>
    );
  }

  const stitchUrl = stitchProjectUrl(result.ref.externalId);

  return (
    <div className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-6">
      <div className="flex items-start gap-2">
        <CircleCheck
          className="text-status-approved-bg mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <p className="text-on-surface text-sm font-medium">UI prototype generated.</p>
      </div>

      <SandboxedHtmlPreview htmlUrl={result.htmlUrl} screenshotUrl={result.screenshotUrl} />

      <div className="flex flex-col gap-1 text-sm">
        {stitchUrl ? (
          <a
            href={stitchUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary-container hover:text-primary-container-hover font-medium"
          >
            Open in Stitch →
          </a>
        ) : null}
        <a
          href={result.screenshotUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary-container hover:text-primary-container-hover font-medium"
        >
          Open screenshot →
        </a>
      </div>
      <p className="text-on-surface-variant text-xs leading-relaxed">
        These are short-lived signed URLs, regenerated on every request (ERD 4.16) - don&apos;t
        bookmark them.
      </p>
    </div>
  );
}
