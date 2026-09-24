'use client';

import { Fragment, useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import type {
  ArtifactVersionDTO,
  ArtifactVersionStatus,
  ItemVersionDTO,
  QualityIssueDTO,
} from '@/lib/serialize';
import { FlaggedGlyph, StatusBadge } from '@/components/status/status-badge';
import { cn } from '@/lib/utils';
import { ApprovalDialog } from './approval-dialog';

interface ArtifactReviewScreenProps {
  /** Human-readable artifact name for the header (e.g. "Requirements"). */
  artifactTypeName: string;
  /**
   * `null` means "not yet available for this artifact type" - as of E5-S4
   * every real artifact type has fixture data (fixtures.ts), so this is now
   * purely defensive: surfaced by the page as a graceful section rather than
   * a 404 if it ever happens. Checked here too, independently of the
   * page-level check, per this story's spec.
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
  // Backlog item fields (TR FR-061: title, description, priority when
  // needed, source/dependency references) - read the same defensive way as
  // the Requirement-shaped fields above, generically for any artifact type
  // whose payload happens to carry them, not just backlog's.
  title?: string | undefined;
  description?: string | undefined;
  priority?: string | undefined;
  sourceRefs?: string[] | undefined;
  // UI Requirement item fields (TR FR-040: target users, screens, navigation
  // expectations, responsive/accessibility constraints, UX priorities) -
  // same defensive, generic-across-types reading as the fields above.
  targetUsers?: string[] | undefined;
  screens?: string[] | undefined;
  navigationExpectations?: string | undefined;
  responsiveConstraints?: string | undefined;
  accessibilityConstraints?: string | undefined;
  uxPriorities?: string[] | undefined;
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
    title: typeof record.title === 'string' ? record.title : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    priority: typeof record.priority === 'string' ? record.priority : undefined,
    sourceRefs: Array.isArray(record.sourceRefs)
      ? record.sourceRefs.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    targetUsers: Array.isArray(record.targetUsers)
      ? record.targetUsers.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    screens: Array.isArray(record.screens)
      ? record.screens.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    navigationExpectations:
      typeof record.navigationExpectations === 'string' ? record.navigationExpectations : undefined,
    responsiveConstraints:
      typeof record.responsiveConstraints === 'string' ? record.responsiveConstraints : undefined,
    accessibilityConstraints:
      typeof record.accessibilityConstraints === 'string'
        ? record.accessibilityConstraints
        : undefined,
    uxPriorities: Array.isArray(record.uxPriorities)
      ? record.uxPriorities.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  };
}

// `ArchitectureOptionDTO.stack`/`candidateDecisions`/`tradeoffs` are
// similarly `unknown`/`unknown[]` in the shared DTO (fixtures.ts's local
// `ArchitectureStack`/`ArchitectureCandidateDecision` types are fixture-side
// only) - read defensively here too, same pattern as `readKnownFields` above.
interface KnownStackFields {
  frontend?: string | undefined;
  backend?: string | undefined;
  database?: string | undefined;
  hosting?: string | undefined;
  repositoryLayout?: string | undefined;
}

function readKnownStack(stack: unknown): KnownStackFields {
  if (typeof stack !== 'object' || stack === null) return {};
  const record = stack as Record<string, unknown>;
  const pick = (key: string) =>
    typeof record[key] === 'string' ? (record[key] as string) : undefined;
  return {
    frontend: pick('frontend'),
    backend: pick('backend'),
    database: pick('database'),
    hosting: pick('hosting'),
    repositoryLayout: pick('repositoryLayout'),
  };
}

interface KnownCandidateDecisionFields {
  decision?: string | undefined;
  drivenBy?: string[] | undefined;
  rationale?: string | undefined;
}

function readKnownCandidateDecision(entry: unknown): KnownCandidateDecisionFields {
  if (typeof entry !== 'object' || entry === null) return {};
  const record = entry as Record<string, unknown>;
  return {
    decision: typeof record.decision === 'string' ? record.decision : undefined,
    drivenBy: Array.isArray(record.drivenBy)
      ? record.drivenBy.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    rationale: typeof record.rationale === 'string' ? record.rationale : undefined,
  };
}

function readTradeoffStrings(tradeoffs: unknown[]): string[] {
  return tradeoffs.filter((entry): entry is string => typeof entry === 'string');
}

// Generic label for an item's `itemType` (e.g. `epic` -> "Epic",
// `architecture_decision` -> "Architecture decision") - used only to label a
// resolved parent item below, not tied to any one artifact type.
function formatItemType(itemType: string): string {
  return itemType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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
  // Architecture-only (FR-022): `selectedOptionId` is the in-progress radio
  // choice; `selectedArchitectureOptionId` only gets set once approval
  // actually happens, mirroring the real DTO field of the same name (set
  // only at approval, never before). Both stay `null` forever for every
  // other artifact type, since `version.options` is `null` there.
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [selectedArchitectureOptionId, setSelectedArchitectureOptionId] = useState<string | null>(
    version?.selectedArchitectureOptionId ?? null,
  );

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

  // FR-022: an Architecture version cannot become authoritative unless
  // exactly one option is selected. `version.options` is `null` for every
  // other artifact type (requirements/ui_requirements/backlog), so this is
  // always `false` there and the rest of this gate is a no-op.
  const requiresOptionSelection = version.options !== null;

  function handleApproveClick() {
    if (status !== 'draft' || pending) return;
    // Same gate as the disabled Approve button below, defended here too -
    // this component doesn't trust its own button state, same as the
    // `!version` check above doesn't trust the caller.
    if (requiresOptionSelection && !selectedOptionId) return;

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
      if (requiresOptionSelection && selectedOptionId) {
        setSelectedArchitectureOptionId(selectedOptionId);
      }
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
    if (requiresOptionSelection && selectedOptionId) {
      setSelectedArchitectureOptionId(selectedOptionId);
    }
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
        {selectedArchitectureOptionId && (
          <p className="text-on-surface-variant mt-3 text-xs leading-relaxed">
            Selected option:{' '}
            <span className="font-mono-code text-on-surface font-semibold">
              {version.options?.find((option) => option.id === selectedArchitectureOptionId)
                ?.optionKey ?? selectedArchitectureOptionId}
            </span>{' '}
            (FR-022 - recorded at approval).
          </p>
        )}
      </header>

      {/* Architecture-only options section (FR-020/FR-021/FR-022) - rendered
          only when `version.options` is non-null, so this is invisible for
          every other artifact type and there is zero regression risk to the
          rest of this generic screen. */}
      {version.options && (
        <section
          aria-labelledby="architecture-options-heading"
          className="border-surface-dim bg-surface-container-lowest rounded-xl border p-6"
        >
          <h2
            id="architecture-options-heading"
            className="text-on-surface-variant text-xs font-semibold tracking-wide uppercase"
          >
            Architecture options
          </h2>
          <p className="text-on-surface-variant mt-1 text-sm">
            Select exactly one option before approving - an Architecture version cannot become
            authoritative otherwise (FR-022).
          </p>

          <div
            role="radiogroup"
            aria-labelledby="architecture-options-heading"
            className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"
          >
            {version.options.map((option) => {
              const stack = readKnownStack(option.stack);
              const stackRows: Array<[string, string | undefined]> = [
                ['Frontend', stack.frontend],
                ['Backend', stack.backend],
                ['Database', stack.database],
                ['Hosting', stack.hosting],
                ['Repository layout', stack.repositoryLayout],
              ];
              const decisions = option.candidateDecisions.map(readKnownCandidateDecision);
              const tradeoffs = readTradeoffStrings(option.tradeoffs);
              const inputId = `architecture-option-${option.id}`;
              const isSelected = selectedOptionId === option.id;

              return (
                <label
                  key={option.id}
                  htmlFor={inputId}
                  className={cn(
                    'border-surface-dim bg-surface-container-low flex cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-colors',
                    isSelected && 'border-primary ring-primary ring-1',
                    status !== 'draft' && 'cursor-not-allowed opacity-80',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      id={inputId}
                      name="architecture-option"
                      value={option.id}
                      checked={isSelected}
                      onChange={() => setSelectedOptionId(option.id)}
                      disabled={status !== 'draft'}
                      className="border-outline-variant text-primary focus-visible:ring-primary mt-1 size-4 shrink-0 focus-visible:ring-2 focus-visible:outline-none"
                    />
                    <div>
                      <span className="font-mono-code border-surface-dim bg-surface-container-lowest text-on-surface inline-block rounded border px-1.5 py-0.5 text-[11px] font-semibold">
                        Option {option.optionKey}
                      </span>
                      <h3 className="text-on-surface mt-1 text-sm font-semibold">{option.title}</h3>
                    </div>
                  </div>

                  <p className="text-on-surface text-sm leading-relaxed">{option.summary}</p>

                  {stackRows.some(([, value]) => value) && (
                    <dl className="border-surface-dim grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-xs">
                      {stackRows.map(([label, value]) =>
                        value ? (
                          <Fragment key={label}>
                            <dt className="text-on-surface-variant font-medium">{label}</dt>
                            <dd className="text-on-surface">{value}</dd>
                          </Fragment>
                        ) : null,
                      )}
                    </dl>
                  )}

                  {decisions.length > 0 && (
                    <div>
                      <h4 className="text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
                        Candidate decisions
                      </h4>
                      <ul className="mt-1.5 flex flex-col gap-1.5 text-xs leading-relaxed">
                        {decisions.map((decision, index) =>
                          decision.decision ? (
                            <li key={index} className="text-on-surface">
                              {decision.decision}
                              {decision.rationale && (
                                <span className="text-on-surface-variant">
                                  {' '}
                                  — {decision.rationale}
                                </span>
                              )}
                              {decision.drivenBy && decision.drivenBy.length > 0 && (
                                <span className="font-mono-code text-on-surface-variant">
                                  {' '}
                                  ({decision.drivenBy.join(', ')})
                                </span>
                              )}
                            </li>
                          ) : null,
                        )}
                      </ul>
                    </div>
                  )}

                  {tradeoffs.length > 0 && (
                    <div>
                      <h4 className="text-on-surface-variant text-[11px] font-semibold tracking-wide uppercase">
                        Trade-offs
                      </h4>
                      <ul className="text-on-surface-variant mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
                        {tradeoffs.map((tradeoff, index) => (
                          <li key={index}>{tradeoff}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </label>
              );
            })}
          </div>
        </section>
      )}

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
              // Generic parent lookup (e.g. Story -> Epic, API Contracts
              // 1.8) - works for any item type whose `parentLogicalItemId`
              // resolves to another item in this same version, not just
              // backlog's Story/Epic pairing.
              const parent = item.parentLogicalItemId
                ? items.find((candidate) => candidate.logicalItemId === item.parentLogicalItemId)
                : undefined;
              // Short metadata line at the bottom of the card - every field
              // here is optional and artifact-type-generic (not just
              // backlog's or UI Requirements'), joined with a middot only
              // for whichever of them are actually present.
              const metaParts: string[] = [];
              if (fields.priority) metaParts.push(`Priority: ${fields.priority}`);
              if (fields.sourceRefs && fields.sourceRefs.length > 0) {
                metaParts.push(`Depends on: ${fields.sourceRefs.join(', ')}`);
              }
              if (fields.targetUsers && fields.targetUsers.length > 0) {
                metaParts.push(`Target users: ${fields.targetUsers.join(', ')}`);
              }
              if (fields.screens && fields.screens.length > 0) {
                metaParts.push(`Screens: ${fields.screens.join(', ')}`);
              }
              if (fields.uxPriorities && fields.uxPriorities.length > 0) {
                metaParts.push(`UX priorities: ${fields.uxPriorities.join(', ')}`);
              }
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
                    {parent && (
                      <span className="text-on-surface-variant text-[11px]">
                        {formatItemType(parent.itemType)}: {parent.displayKey}
                      </span>
                    )}
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
                  {fields.behavior ? (
                    <p className="text-on-surface mt-2 text-sm leading-relaxed">
                      {fields.behavior}
                    </p>
                  ) : (
                    <>
                      {fields.title && (
                        <p className="text-on-surface mt-2 text-sm leading-relaxed font-medium">
                          {fields.title}
                        </p>
                      )}
                      {fields.description && (
                        <p className="text-on-surface-variant mt-1 text-sm leading-relaxed">
                          {fields.description}
                        </p>
                      )}
                    </>
                  )}
                  {fields.acceptanceCriteria && fields.acceptanceCriteria.length > 0 && (
                    <ul className="text-on-surface-variant mt-2 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
                      {fields.acceptanceCriteria.map((criterion, index) => (
                        <li key={index}>{criterion}</li>
                      ))}
                    </ul>
                  )}
                  {fields.navigationExpectations && (
                    <p className="text-on-surface-variant mt-2 text-xs">
                      <span className="font-medium">Navigation:</span>{' '}
                      {fields.navigationExpectations}
                    </p>
                  )}
                  {fields.responsiveConstraints && (
                    <p className="text-on-surface-variant mt-2 text-xs">
                      <span className="font-medium">Responsive:</span>{' '}
                      {fields.responsiveConstraints}
                    </p>
                  )}
                  {fields.accessibilityConstraints && (
                    <p className="text-on-surface-variant mt-2 text-xs">
                      <span className="font-medium">Accessibility:</span>{' '}
                      {fields.accessibilityConstraints}
                    </p>
                  )}
                  {metaParts.length > 0 && (
                    <p className="text-on-surface-variant mt-2 text-xs">{metaParts.join(' · ')}</p>
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
          disabled={status !== 'draft' || pending || (requiresOptionSelection && !selectedOptionId)}
          title={
            requiresOptionSelection && !selectedOptionId && status === 'draft'
              ? 'Select an architecture option above before approving (FR-022).'
              : undefined
          }
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
