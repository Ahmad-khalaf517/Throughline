'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { FieldShell } from '@/components/auth/field-shell';
import { FormMessage } from '@/components/auth/form-message';
import type { ExternalRefDTO, ImpactRowDTO } from '@/lib/serialize';
import {
  describeExternalError,
  describeRepoNameAvailability,
  isExternalWriteBlocked,
  isRepoNameBlocked,
  readImpactFromError,
  type RepoNameAvailability,
} from '@/lib/external-preview';
import { PreviewShell, type PreviewState } from './preview-shell';
import { ImpactGate } from './impact-gate';
import { OperationStatus } from './operation-status';

interface GithubInitPanelProps {
  projectId: string;
}

interface GithubPreviewData {
  mode: 'scaffold' | 'docs-only';
  repoName: string;
  impact: ImpactRowDTO[];
}

type GithubWriteResult =
  { kind: 'completed'; ref: ExternalRefDTO } | { kind: 'pending'; operationId: string };

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { impact?: ImpactRowDTO[] } };
}

// How long the field must sit unchanged before it is checked against GitHub -
// one request per pause in typing, not one per keystroke.
const AVAILABILITY_DEBOUNCE_MS = 500;

// Color is never the only cue: success and error also carry an icon.
const AVAILABILITY_TONE = {
  neutral: { className: 'text-secondary', Icon: null },
  success: { className: 'text-success', Icon: CircleCheck },
  error: { className: 'text-error', Icon: CircleAlert },
} as const;

const INPUT_CLASSNAME =
  'border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus:border-primary focus:bg-surface-container-low focus:ring-primary h-11 w-full rounded-lg border px-3.5 text-sm transition-colors focus:ring-1 focus:outline-none';

const SUBMIT_CLASSNAME =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

/**
 * `POST /api/projects/:projectId/github/preview` + `.../github/init`
 * (API Contracts section 8; E5-S9), plus `.../github/check-name` so the user
 * can see whether a name is free before submitting. Client-`fetch` mutation pattern copied
 * from `new-project-form.tsx`: `pending`/`error` state, `401 -> /sign-in`,
 * `body?.error?.message`, a `catch` -> "Could not reach the server" branch.
 *
 * `github/preview` **ignores the request's `repoName`** and always returns
 * its own suggestion (the project's name, normalized - that route's own
 * header comment) - a
 * placeholder is sent on first load purely to satisfy the schema's
 * `min(1)`, then the field is populated from the response's `repoName`, not
 * the other way around. This is surprising, hence spelled out here.
 */
export function GithubInitPanel({ projectId }: GithubInitPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [preview, setPreview] = useState<GithubPreviewData | null>(null);
  const [repoName, setRepoName] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<GithubWriteResult | null>(null);
  const [availability, setAvailability] = useState<RepoNameAvailability | null>(null);
  const typedName = repoName.trim();

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(`/api/projects/${projectId}/github/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Placeholder value - see this component's own header comment:
          // the route never echoes this back, it always suggests its own.
          body: JSON.stringify({ repoName: 'repository' }),
        });

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
              message: errorBody.error.message ?? 'Architecture has no approved version.',
              reviewHref: `/projects/${projectId}/artifacts/architecture`,
            });
            return;
          }
          setState({
            status: 'error',
            message: describeExternalError(
              errorBody.error?.code,
              errorBody.error?.message ?? 'Could not load the GitHub preview.',
            ),
          });
          return;
        }

        const data = body as GithubPreviewData;
        setPreview(data);
        setRepoName(data.repoName);
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

  // `POST .../github/check-name` (API Contracts section 8), advisory only:
  // `github/init` still decides for real. Waits for the preview (which
  // supplies the first name to check), then re-checks a moment after every
  // edit. No state is set synchronously here - "checking" is derived from
  // `availability` being for different text than the field holds now.
  useEffect(() => {
    if (state.status !== 'ready' || result || typedName === '') return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/github/check-name`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repoName: typedName }),
          signal: controller.signal,
        });

        if (response.status === 401) {
          router.push('/sign-in');
          return;
        }

        const body = await response.json();
        if (controller.signal.aborted) return;

        if (!response.ok) {
          setAvailability({
            kind: 'error',
            typed: typedName,
            message: (body as ErrorBody).error?.message ?? 'Something went wrong.',
          });
          return;
        }

        const check = body as { repoName: string; status: 'available' | 'taken' | 'invalid' };
        setAvailability({ kind: check.status, typed: typedName, repoName: check.repoName });
      } catch {
        if (controller.signal.aborted) return;
        setAvailability({
          kind: 'error',
          typed: typedName,
          message: 'Could not reach the server.',
        });
      }
    }, AVAILABILITY_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectId, router, state.status, result, typedName]);

  const availabilityCopy = describeRepoNameAvailability(availability, typedName);
  const availabilityTone = availabilityCopy ? AVAILABILITY_TONE[availabilityCopy.tone] : null;
  const AvailabilityIcon = availabilityTone?.Icon;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/github/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoName, impactAcknowledged: acknowledged }),
      });

      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }

      const body = await response.json();

      if (response.status === 202) {
        setResult({ kind: 'pending', operationId: body.operationId });
        return;
      }

      if (!response.ok) {
        const errorBody = body as ErrorBody;

        // Impact is evaluated fresh on every read (INV-025), so the server
        // can find new impact at write time that this panel's own preview
        // fetch never saw. `IMPACT_NOT_ACKNOWLEDGED` carries that fresh
        // `details.impact` precisely so this doesn't dead-end on a message
        // pointing at impact the user was never shown - re-render it (with
        // the confirmation checkbox `ImpactGate` renders alongside non-empty
        // impact) instead of just reporting the rejection.
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

        // NAME_TAKEN_BY_OTHER (and every other error here) leaves `repoName`
        // untouched and the field editable - the user can immediately try a
        // different name (API Contracts section 8).
        setSubmitError(
          describeExternalError(
            errorBody.error?.code,
            errorBody.error?.message ?? 'Something went wrong. Please try again.',
          ),
        );
        return;
      }

      setResult({ kind: 'completed', ref: body.ref as ExternalRefDTO });
    } catch {
      setSubmitError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PreviewShell state={state}>
      {preview &&
        (result ? (
          <GithubResultView result={result} />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
              <p className="text-on-surface text-sm font-medium">
                Mode: <span className="font-mono-code">{preview.mode}</span>
              </p>
              <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">
                {preview.mode === 'scaffold'
                  ? 'This stack matches the supported starter, but starter files are not generated yet - the repository is created with documentation only: a README with the stack and trade-offs, and one ADR per approved decision.'
                  : 'Creates a repository with documentation only - a README with the stack and trade-offs, and one ADR per approved decision. This stack has no generated scaffold.'}
              </p>
            </div>

            <FieldShell id="github-repo-name" label="Repository name">
              <input
                id="github-repo-name"
                value={repoName}
                onChange={(event) => setRepoName(event.target.value)}
                aria-describedby="github-repo-name-availability"
                aria-invalid={isRepoNameBlocked(availability, typedName) || undefined}
                autoComplete="off"
                spellCheck={false}
                className={INPUT_CLASSNAME}
              />
              <p
                id="github-repo-name-availability"
                role="status"
                aria-live="polite"
                className={`flex min-h-4 items-start gap-1.5 text-xs ${availabilityTone?.className ?? ''}`}
              >
                {AvailabilityIcon && (
                  <AvailabilityIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span>{availabilityCopy?.text}</span>
              </p>
            </FieldShell>

            <ImpactGate
              impact={preview.impact}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              idPrefix="github-init"
            />

            {submitError && <FormMessage variant="error">{submitError}</FormMessage>}

            <button
              type="submit"
              disabled={
                submitting ||
                typedName.length === 0 ||
                isRepoNameBlocked(availability, typedName) ||
                isExternalWriteBlocked(preview.impact, acknowledged)
              }
              className={SUBMIT_CLASSNAME}
            >
              {submitting ? 'Creating repository…' : 'Create repository'}
            </button>
          </form>
        ))}
    </PreviewShell>
  );
}

function GithubResultView({ result }: { result: GithubWriteResult }) {
  if (result.kind === 'pending') {
    return <OperationStatus operationId={result.operationId} />;
  }

  return (
    <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
      <p className="text-on-surface text-sm font-medium">Repository created.</p>
      {result.ref.externalUrl && (
        <a
          href={result.ref.externalUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary-container hover:text-primary-container-hover mt-2 inline-block text-sm font-medium"
        >
          {result.ref.externalUrl} →
        </a>
      )}
    </div>
  );
}
