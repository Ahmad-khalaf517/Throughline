'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { FormMessage } from '@/components/auth/form-message';
import { FlaggedGlyph } from '@/components/status/status-badge';
import type { ExternalRefDTO, ImpactRowDTO } from '@/lib/serialize';
import {
  describeExternalError,
  describeSkipReason,
  isExternalWriteBlocked,
  missingJiraDecisions,
  readImpactFromError,
} from '@/lib/external-preview';
import { PreviewShell, type PreviewState } from './preview-shell';
import { ImpactGate } from './impact-gate';
import { OperationStatus } from './operation-status';

interface JiraExportPanelProps {
  projectId: string;
}

type JiraDecision = 'skip' | 'create_new';

interface JiraSkippedItem {
  logicalItemId: string;
  displayKey: string;
  reason: 'epic_has_no_jira_ref';
}

interface JiraNeedsDecisionItem {
  logicalItemId: string;
  displayKey: string;
  existingRef: ExternalRefDTO;
}

interface JiraPreviewData {
  epics: number;
  stories: number;
  skipped: JiraSkippedItem[];
  needsDecision: JiraNeedsDecisionItem[];
  impact: ImpactRowDTO[];
}

interface JiraExportResult {
  created: ExternalRefDTO[];
  skipped: { logicalItemId: string }[];
  failures: { logicalItemId: string; operationId: string; status: string }[];
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: { impact?: ImpactRowDTO[] } };
}

const SUBMIT_CLASSNAME =
  'bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center justify-center rounded-lg px-4 text-sm font-medium shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60';

/**
 * `GET /api/projects/:projectId/jira/preview` + `POST .../jira/export`
 * (API Contracts section 9; E5-S9). Same client-`fetch` mutation pattern as
 * `github-init-panel.tsx`/`new-project-form.tsx`.
 */
export function JiraExportPanel({ projectId }: JiraExportPanelProps) {
  const router = useRouter();
  const [state, setState] = useState<PreviewState>({ status: 'loading' });
  const [preview, setPreview] = useState<JiraPreviewData | null>(null);
  const [decisions, setDecisions] = useState<Record<string, JiraDecision>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<JiraExportResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      try {
        const response = await fetch(`/api/projects/${projectId}/jira/preview`);

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
              message: errorBody.error.message ?? 'Backlog has no approved version.',
              reviewHref: `/projects/${projectId}/artifacts/backlog`,
            });
            return;
          }
          setState({
            status: 'error',
            message: describeExternalError(
              errorBody.error?.code,
              errorBody.error?.message ?? 'Could not load the Jira preview.',
            ),
          });
          return;
        }

        setPreview(body as JiraPreviewData);
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

  const displayKeyByLogicalItemId = useMemo(() => {
    const map = new Map<string, string>();
    if (!preview) return map;
    for (const item of preview.skipped) map.set(item.logicalItemId, item.displayKey);
    for (const item of preview.needsDecision) map.set(item.logicalItemId, item.displayKey);
    return map;
  }, [preview]);

  const missing = useMemo(
    () =>
      preview
        ? missingJiraDecisions(preview.needsDecision, new Map(Object.entries(decisions)))
        : [],
    [preview, decisions],
  );

  function handleDecisionChange(logicalItemId: string, decision: JiraDecision) {
    setDecisions((current) => ({ ...current, [logicalItemId]: decision }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/jira/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decisions: preview.needsDecision.map((item) => ({
            logicalItemId: item.logicalItemId,
            decision: decisions[item.logicalItemId] ?? 'skip',
          })),
          impactAcknowledged: acknowledged,
        }),
      });

      if (response.status === 401) {
        router.push('/sign-in');
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        const errorBody = body as ErrorBody;

        // Impact is evaluated fresh on every read (INV-025) - the server can
        // find new impact at export time that this panel's own preview
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
              'New impact was found while preparing this export. Review it below and confirm to continue.',
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

      setResult(body as JiraExportResult);
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
          <JiraResultView result={result} displayKeyByLogicalItemId={displayKeyByLogicalItemId} />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
              <p className="text-on-surface text-sm font-medium">
                {preview.epics} Epic{preview.epics === 1 ? '' : 's'} · {preview.stories} Stor
                {preview.stories === 1 ? 'y' : 'ies'}
              </p>
            </div>

            {preview.skipped.length > 0 && (
              <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-4">
                <h3 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
                  Not exportable ({preview.skipped.length})
                </h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {preview.skipped.map((item) => (
                    <li key={item.logicalItemId} className="text-on-surface-variant text-sm">
                      <span className="font-mono-code text-on-surface font-semibold">
                        {item.displayKey}
                      </span>
                      : {describeSkipReason(item.reason)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.needsDecision.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
                  Needs a decision ({preview.needsDecision.length})
                </h3>
                {preview.needsDecision.map((item) => (
                  <JiraDecisionItem
                    key={item.logicalItemId}
                    item={item}
                    decision={decisions[item.logicalItemId]}
                    onChange={handleDecisionChange}
                  />
                ))}
              </div>
            )}

            <ImpactGate
              impact={preview.impact}
              acknowledged={acknowledged}
              onAcknowledgedChange={setAcknowledged}
              idPrefix="jira-export"
            />

            {missing.length > 0 && (
              <p className="text-on-surface-variant text-xs">
                Still needs a decision:{' '}
                {missing.map((id) => displayKeyByLogicalItemId.get(id) ?? id).join(', ')}
              </p>
            )}

            {submitError && <FormMessage variant="error">{submitError}</FormMessage>}

            <button
              type="submit"
              disabled={
                submitting ||
                missing.length > 0 ||
                isExternalWriteBlocked(preview.impact, acknowledged)
              }
              className={SUBMIT_CLASSNAME}
            >
              {submitting ? 'Exporting…' : 'Export to Jira'}
            </button>
          </form>
        ))}
    </PreviewShell>
  );
}

function JiraDecisionItem({
  item,
  decision,
  onChange,
}: {
  item: JiraNeedsDecisionItem;
  decision: JiraDecision | undefined;
  onChange: (logicalItemId: string, decision: JiraDecision) => void;
}) {
  const groupName = `jira-decision-${item.logicalItemId}`;
  return (
    <fieldset className="border-surface-dim bg-surface-container-lowest rounded-xl border p-4">
      <legend className="text-on-surface text-sm font-medium">
        <span className="font-mono-code">{item.displayKey}</span> changed since{' '}
        <span className="font-mono-code">
          {item.existingRef.externalKey ?? item.existingRef.externalId}
        </span>{' '}
        was created.
      </legend>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        {item.existingRef.externalUrl && (
          <a
            href={item.existingRef.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary-container hover:text-primary-container-hover text-xs font-medium"
          >
            View existing issue →
          </a>
        )}
        {item.existingRef.impact && (
          <span className="text-on-surface-variant flex items-center gap-1 text-xs">
            <FlaggedGlyph
              title={`${item.displayKey}'s existing Jira issue is potentially affected`}
            />
            The existing issue may itself be based on a superseded source.
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-4">
        <label className="text-on-surface flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name={groupName}
            checked={decision === 'skip'}
            onChange={() => onChange(item.logicalItemId, 'skip')}
            className="text-primary-container focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none"
          />
          Skip
        </label>
        <label className="text-on-surface flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name={groupName}
            checked={decision === 'create_new'}
            onChange={() => onChange(item.logicalItemId, 'create_new')}
            className="text-primary-container focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none"
          />
          Create new Jira issue
        </label>
      </div>
    </fieldset>
  );
}

function JiraResultView({
  result,
  displayKeyByLogicalItemId,
}: {
  result: JiraExportResult;
  displayKeyByLogicalItemId: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-4">
      {result.created.length > 0 && (
        <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-4">
          <h3 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
            Created ({result.created.length})
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {result.created.map((ref) => (
              <li key={ref.id} className="text-sm">
                {ref.externalUrl ? (
                  <a
                    href={ref.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary-container hover:text-primary-container-hover font-medium"
                  >
                    {ref.externalKey ?? ref.externalId} →
                  </a>
                ) : (
                  <span className="font-mono-code">{ref.externalKey ?? ref.externalId}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.skipped.length > 0 && (
        <p className="text-on-surface-variant text-sm">
          {result.skipped.length} item{result.skipped.length === 1 ? '' : 's'} skipped, as
          requested.
        </p>
      )}

      {result.failures.length > 0 && (
        <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-4">
          <h3 className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase">
            Needs attention ({result.failures.length})
          </h3>
          {/* API Contracts section 9: a partial failure is the normal case
              this contract designs for, not an error screen. */}
          <p className="text-on-surface-variant mt-1 text-xs leading-relaxed">
            The rest of the export completed - each item below can be retried on its own.
          </p>
          <ul className="mt-2 flex flex-col gap-3">
            {result.failures.map((failure) => (
              <li key={failure.operationId}>
                <p className="text-on-surface text-sm font-medium">
                  {displayKeyByLogicalItemId.get(failure.logicalItemId) ?? failure.logicalItemId}
                </p>
                <OperationStatus operationId={failure.operationId} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
