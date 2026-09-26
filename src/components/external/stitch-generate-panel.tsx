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
} from '@/lib/external-preview';
import { PreviewShell, type PreviewState } from './preview-shell';
import { ImpactGate } from './impact-gate';
import { OperationStatus } from './operation-status';

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
 * Does NOT render an iframe for the generated HTML - the sandboxed,
 * separate-origin (no `allow-same-origin`) embedded viewer is E5-S10's scope
 * (screen-kit skill, FR-053). This screen only links out to the signed URLs.
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

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(`/api/projects/${projectId}/stitch/preview`);

        if (response.status === 401) {
          router.push('/sign-in');
          return;
        }

        const body = await response.json();
        if (cancelled) return;

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
          <StitchResultView result={result} onCopy={handleCopy} copied={copied} />
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
              {submitting ? 'Generating…' : 'Generate UI prototype'}
            </button>

            {/* The sandboxed HTML/screenshot viewer is E5-S10's scope, not
                this story's (screen-kit skill). */}
            <p className="text-on-surface-variant text-xs">
              A generated prototype opens in its own tab for now - an embedded, sandboxed preview on
              this screen is a separate, later story.
            </p>
          </div>
        ))}
    </PreviewShell>
  );
}

function StitchResultView({
  result,
  onCopy,
  copied,
}: {
  result: StitchResult;
  onCopy: (text: string) => void;
  copied: boolean;
}) {
  if (result.mode === 'pending') {
    return <OperationStatus operationId={result.operationId} />;
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
      </div>
    );
  }

  return (
    <div className="border-surface-dim bg-surface-container-lowest flex flex-col gap-3 rounded-xl border p-6">
      <div className="flex items-start gap-2">
        <CircleCheck
          className="text-status-approved-bg mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />
        <p className="text-on-surface text-sm font-medium">UI prototype generated.</p>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <a
          href={result.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary-container hover:text-primary-container-hover font-medium"
        >
          Open generated HTML →
        </a>
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
