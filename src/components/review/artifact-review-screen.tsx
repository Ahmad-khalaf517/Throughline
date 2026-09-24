'use client';

import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import type {
  ArtifactVersionDTO,
  ArtifactVersionStatus,
  ItemVersionDTO,
  QualityIssueDTO,
} from '@/lib/serialize';
import { FlaggedGlyph, StatusBadge } from '@/components/status/status-badge';
import { ApprovalDialog } from './approval-dialog';

interface ArtifactReviewScreenProps {
  /** Human-readable artifact name for the header (e.g. "Requirements"). */
  artifactTypeName: string;
  /**
   * `null` means "not yet available for this artifact type" - today that's
   * every type except `requirements` (fixtures.ts), surfaced by the page as
   * a graceful section rather than a 404. Defended here too, independently
   * of the page-level check, per this story's spec.
   */
  version: ArtifactVersionDTO | null;
  qualityIssues: QualityIssueDTO[];
}

// `ItemVersionDTO.payload` is deliberately `unknown` in the shared DTO (API
// Contracts 1.8: each artifact-type module owns its own payload shape) - this
// screen is generic across artifact types (Jira Plan 1.6 option 2), so it
// never assumes a payload shape. It only renders whichever of these known
// requirement-item fields (TR FR-010/FR-011, section 22) happen to be
// present, which is also what keeps this component honest about being
// type-parameterized rather than secretly Requirements-only.
interface KnownItemFields {
  type?: string | undefined;
  dimension?: string | undefined;
  actor?: string | undefined;
  behavior?: string | undefined;
  acceptanceCriteria?: string[] | undefined;
}

function readKnownFields(payload: unknown): KnownItemFields {
  if (typeof payload !== 'object' || payload === null) return {};
  const record = payload as Record<string, unknown>;
  return {
    type: typeof record.type === 'string' ? record.type : undefined,
    dimension: typeof record.dimension === 'string' ? record.dimension : undefined,
    actor: typeof record.actor === 'string' ? record.actor : undefined,
    behavior: typeof record.behavior === 'string' ? record.behavior : undefined,
    acceptanceCriteria: Array.isArray(record.acceptanceCriteria)
      ? record.acceptanceCriteria.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  };
}

const REVISION_DISABLED_TITLE =
  "Wired up once E3-S10's generation/revision routes exist - visually complete, honestly inert until then (FR-013).";

export function ArtifactReviewScreen({
  artifactTypeName,
  version,
  qualityIssues,
}: ArtifactReviewScreenProps) {
  // Local-only state for this fixture-backed demo path (see fixtures.ts) -
  // no network call happens anywhere in this component. Approve mutates
  // `status`/`items` directly rather than refetching, which is exactly what
  // E3-S10's routes will replace once they exist.
  const [status, setStatus] = useState<ArtifactVersionStatus>(version?.status ?? 'draft');
  const [items, setItems] = useState<ItemVersionDTO[]>(version?.items ?? []);
  const [pending, setPending] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState<string | null>(null);

  const blockingItems = useMemo(
    () => items.filter((item) => item.impact !== null && !item.impact.acknowledged),
    [items],
  );
  const flaggedItems = useMemo(() => items.filter((item) => item.impact !== null), [items]);

  // Component-level defense for "not yet available" (page.tsx already checks
  // this via fixtures.ts before rendering, but this screen doesn't trust its
  // caller to always do that correctly).
  if (!version) {
    return (
      <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-8 text-center">
        <p className="text-on-surface text-sm font-medium">
          {artifactTypeName} review isn&apos;t available yet.
        </p>
        <p className="text-on-surface-variant mt-1 text-sm">
          This artifact type&apos;s review screen lands in a later story - it&apos;s coming soon,
          not broken.
        </p>
      </div>
    );
  }

  function handleApproveClick() {
    if (status !== 'draft' || pending) return;

    // FR-083: blocked while any of the version's own items are flagged and
    // unacknowledged - the dialog is the only path to approval from here,
    // never a silent approve.
    if (blockingItems.length > 0) {
      setDialogOpen(true);
      return;
    }

    // No network call to await in this fixture-backed path - the delay
    // below exists purely to demonstrate the loading affordance a real
    // `POST .../approve` round trip would have.
    setPending(true);
    window.setTimeout(() => {
      setStatus('approved');
      setPending(false);
    }, 500);
  }

  function handleDialogConfirm(note: string) {
    // FR-084: the override doesn't bypass the gate, it satisfies it - every
    // currently-blocking item gets acknowledged, then approval proceeds.
    setItems((current) =>
      current.map((item) =>
        item.impact && !item.impact.acknowledged
          ? { ...item, impact: { ...item.impact, acknowledged: true } }
          : item,
      ),
    );
    setStatus('approved');
    setOverrideNote(note);
    setDialogOpen(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-on-surface text-display-sm font-semibold">{artifactTypeName}</h1>
            <p className="text-on-surface-variant mt-1 text-sm">Version {version.versionNumber}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            {flaggedItems.length > 0 && (
              <FlaggedGlyph
                title={`${flaggedItems.length} item${flaggedItems.length === 1 ? '' : 's'} flagged`}
              />
            )}
          </div>
        </div>
        {overrideNote && (
          <p className="text-on-surface-variant mt-3 text-xs leading-relaxed">
            Approved with override note:{' '}
            <span className="text-on-surface">&ldquo;{overrideNote}&rdquo;</span>
          </p>
        )}
      </header>

      {/* Quality gate (FR-012) - deterministic checks, informational: they
          are shown before approval but do not block it (only flagged/
          unacknowledged impact does, per FR-083). */}
      <section
        aria-labelledby="quality-gate-heading"
        className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6"
      >
        <h2
          id="quality-gate-heading"
          className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
        >
          Quality gate
        </h2>
        {qualityIssues.length === 0 ? (
          <p className="text-on-surface-variant mt-3 text-sm">
            No deterministic quality issues found.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {qualityIssues.map((issue, index) => {
              const relatedItem = items.find((item) => item.logicalItemId === issue.logicalItemId);
              return (
                <li
                  key={`${issue.code}-${index}`}
                  className="border-surface-dim bg-surface-container-low flex items-start gap-2 rounded-lg border p-3"
                >
                  <CircleAlert
                    className="text-tertiary mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-on-surface text-sm leading-relaxed">{issue.message}</p>
                    <p className="font-mono-code text-on-surface-variant mt-0.5 text-[11px]">
                      {issue.code}
                      {relatedItem && ` · ${relatedItem.displayKey}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Aggregate impact state - the screen-kit's 4th state ("no impact
          found" is a success state, must not read as empty/error). */}
      <section
        aria-labelledby="impact-heading"
        className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6"
      >
        <h2
          id="impact-heading"
          className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
        >
          Impact
        </h2>
        {flaggedItems.length === 0 ? (
          <div className="bg-surface-container-low mt-3 flex items-start gap-2 rounded-lg p-3">
            <CircleCheck
              className="text-status-approved-bg mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p className="text-on-surface text-sm">
              No impact issues found. Every item in this version is current with its dependencies.
            </p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {flaggedItems.map((item) => {
              const impact = item.impact;
              if (!impact) return null;
              return (
                <li
                  key={item.itemVersionId}
                  className="border-surface-dim bg-surface-container-low flex items-start gap-2 rounded-lg border p-3"
                >
                  {impact.acknowledged ? (
                    <CircleCheck
                      className="text-status-approved-bg mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                  ) : (
                    <FlaggedGlyph title={`${item.displayKey} is flagged`} className="mt-0.5" />
                  )}
                  <p className="text-on-surface text-sm leading-relaxed">
                    <span className="font-mono-code font-semibold">{item.displayKey}</span> would be
                    flagged: it depends on{' '}
                    <span className="font-mono-code font-semibold">{impact.rootDisplayKey}</span>{' '}
                    (see path: {impact.path.join(' → ')}).
                    {impact.acknowledged && (
                      <span className="text-on-surface-variant"> Acknowledged.</span>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="items-heading"
        className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6"
      >
        <h2
          id="items-heading"
          className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
        >
          Items ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="text-on-surface-variant mt-3 text-sm">This version has no items yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {items.map((item) => {
              const fields = readKnownFields(item.payload);
              return (
                <li key={item.itemVersionId} className="border-surface-dim rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-code border-surface-dim bg-surface-container-low text-on-surface rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                      {item.displayKey}
                    </span>
                    <span className="text-on-surface-variant text-[11px] tracking-wide uppercase">
                      {fields.type ?? item.itemType}
                      {fields.dimension && ` · ${fields.dimension}`}
                    </span>
                    {item.impact ? (
                      item.impact.acknowledged ? (
                        <span className="text-on-surface-variant text-[11px]">Acknowledged</span>
                      ) : (
                        <FlaggedGlyph title={`${item.displayKey} is flagged`} />
                      )
                    ) : (
                      <span className="text-on-surface-variant/70 text-[11px]">No impact</span>
                    )}
                  </div>
                  {fields.actor && (
                    <p className="text-on-surface-variant mt-2 text-xs">
                      <span className="font-medium">Actor:</span> {fields.actor}
                    </p>
                  )}
                  {fields.behavior && (
                    <p className="text-on-surface mt-2 text-sm leading-relaxed">
                      {fields.behavior}
                    </p>
                  )}
                  {fields.acceptanceCriteria && fields.acceptanceCriteria.length > 0 && (
                    <ul className="text-on-surface-variant mt-2 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
                      {fields.acceptanceCriteria.map((criterion, index) => (
                        <li key={index}>{criterion}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="border-surface-dim bg-surface-container-lowest flex flex-wrap items-center gap-3 rounded-xl border p-6">
        <button
          type="button"
          onClick={handleApproveClick}
          disabled={status !== 'draft' || pending}
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {status === 'approved' ? 'Approved' : pending ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          disabled
          title={REVISION_DISABLED_TITLE}
          className="border-surface-dim text-outline focus-visible:ring-primary flex h-11 items-center rounded-lg border px-5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
        >
          Request AI revision
        </button>
        <button
          type="button"
          disabled
          title={REVISION_DISABLED_TITLE}
          className="border-surface-dim text-outline focus-visible:ring-primary flex h-11 items-center rounded-lg border px-5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
        >
          Revise manually
        </button>
      </div>

      {dialogOpen && (
        <ApprovalDialog
          blockingItems={blockingItems}
          onCancel={() => setDialogOpen(false)}
          onConfirm={handleDialogConfirm}
        />
      )}
    </div>
  );
}
