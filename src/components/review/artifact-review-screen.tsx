'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert, CircleCheck, Loader2, SquarePen } from 'lucide-react';
import type {
  ArtifactType,
  ArtifactVersionDTO,
  ArtifactVersionStatus,
  ImpactRowDTO,
  ItemVersionDTO,
  QualityIssueDTO,
} from '@/lib/serialize';
import { FlaggedGlyph, StatusBadge } from '@/components/status/status-badge';
import { cn } from '@/lib/utils';
import { ApprovalDialog } from './approval-dialog';
import { ArchitectureOptions } from './architecture-options';
import { ItemEditDialog } from './item-edit-dialog';
import { ItemEditConfirmationRequired } from './item-edit-model';
import { BacklogReviewLayout } from './backlog-review-layout';
import { UiRequirementsReviewLayout } from './ui-requirements-review-layout';
import { GenerationSkeleton } from './generation-skeleton';
import { readGenerationResponse } from './read-generation-stream';

interface ArtifactReviewScreenProps {
  /** The project this version belongs to - needed for the manual-revise call (`POST /api/projects/:projectId/artifacts/:type/revise`). */
  projectId: string;
  /**
   * The `:type` path segment, already validated by the page (SCRUM-86 follow-
   * up). Needed independently of `version.artifactType` because `version` can
   * be `null` (nothing generated yet) - the one case where this screen still
   * needs to know which artifact type to generate.
   */
  artifactType: ArtifactType;
  /** Human-readable artifact name for the header (e.g. "Requirements"). */
  artifactTypeName: string;
  /**
   * `null` means "no version has been generated into this artifact yet" -
   * surfaced by the page as a graceful section rather than a 404. Checked
   * here too, independently of the page-level check, per this story's spec.
   */
  version: ArtifactVersionDTO | null;
  qualityIssues: QualityIssueDTO[];
  upstreamDisplayKeysByItemVersionId?: Record<string, string[]>;
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

// Generic label for an item's `itemType` (e.g. `epic` -> "Epic",
// `architecture_decision` -> "Architecture decision") - used only to label a
// resolved parent item below, not tied to any one artifact type.
function formatItemType(itemType: string): string {
  return itemType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// "Request AI revision" is now wired to the real generate contract
// (`POST /api/projects/:projectId/artifacts/:type/generate`, `feedback`
// present): "an AI revision of an existing approved version" per that route's
// own doc comment. Gated the same way Approve is (`status !== 'draft'`) -
// there is nothing to request a revision of once nothing is under review.
const AI_REVISION_STATUS_TITLE =
  'Request an AI revision only while a draft is under review (ERD 3.6).';
const AI_REVISION_TITLE =
  'Ask the model to regenerate this artifact, optionally guided by feedback (ERD 3.6).';

// Manual edit is legal only while a version is `draft` (ERD 5.3) - the Edit
// button stays visible but disabled otherwise, same convention as the
// revision buttons above.
const EDIT_DISABLED_TITLE = 'Editing is only available while this version is a draft (ERD 5.3).';

const MANUAL_REVISION_ARCHITECTURE_TITLE =
  'Architecture has no manual revision - it is revised only by regenerating (ERD 3.6).';
const MANUAL_REVISION_TITLE =
  'Create a new draft from the current approved version, with every item unchanged, to edit by hand (FR-081).';

/**
 * Merges the display-key-resolved impact rows a 409 `APPROVAL_BLOCKED`
 * response carries (`error.details.blocking`, `ImpactRowDTO[]`) into the
 * local item list by `itemVersionId`. This is the "the client's own gate
 * check was stale" path this story's spec calls for: the server recomputed
 * warnings inside the approval transaction (INV-025, one engine, evaluated
 * fresh), and that recomputed state - not whatever this screen last
 * rendered - is what `ApprovalDialog` must show.
 */
function withUpdatedImpact(items: ItemVersionDTO[], blocking: ImpactRowDTO[]): ItemVersionDTO[] {
  const byItemVersionId = new Map(
    blocking
      .filter((row) => row.subjectKind === 'item_version')
      .map((row) => [row.subjectId, row] as const),
  );
  return items.map((item) => {
    const fresh = byItemVersionId.get(item.itemVersionId);
    return fresh ? { ...item, impact: fresh } : item;
  });
}

export function ArtifactReviewScreen({
  projectId,
  artifactType,
  artifactTypeName,
  version,
  qualityIssues,
  upstreamDisplayKeysByItemVersionId = {},
}: ArtifactReviewScreenProps) {
  const router = useRouter();
  // Local state, seeded from `version` on mount. The page keys this
  // component by `version.id` (`artifacts/[type]/page.tsx`) so a genuinely
  // new version (e.g. a fresh manual-revision draft) remounts this component
  // with fresh initial state instead of leaving it stuck on stale props -
  // React does not re-run `useState`'s initializer on a prop change alone.
  // Approve/override-approve instead replace this state directly from the
  // mutation's own response body, since they never change `version.id`.
  const [status, setStatus] = useState<ArtifactVersionStatus>(version?.status ?? 'draft');
  const [items, setItems] = useState<ItemVersionDTO[]>(version?.items ?? []);
  const [pending, setPending] = useState(false);
  const [revisePending, setRevisePending] = useState(false);
  // "Request AI revision" (feedback-driven `generate` call) - separate
  // pending/expand state from Approve's `pending` and manual revise's
  // `revisePending`, same pattern as those two staying independent of each
  // other.
  const [aiRevisePending, setAiRevisePending] = useState(false);
  const [aiRevisionOpen, setAiRevisionOpen] = useState(false);
  const [aiRevisionFeedback, setAiRevisionFeedback] = useState('');
  const [generationPreview, setGenerationPreview] = useState('');
  const [generationFinalizing, setGenerationFinalizing] = useState(false);
  const [refreshTimedOut, setRefreshTimedOut] = useState(false);
  const refreshTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staleReason, setStaleReason] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [overrideNote, setOverrideNote] = useState<string | null>(null);
  // E5-S8: which item (if any) the manual-edit dialog is currently open for
  // - `null` means closed. Separate from `dialogOpen` above (the approval
  // dialog), since both can exist independently.
  const [editingItem, setEditingItem] = useState<ItemVersionDTO | null>(null);
  // A save mints a new item_version id, which the server-rendered
  // `upstreamDisplayKeysByItemVersionId` prop has no entry for until the
  // post-save `router.refresh()` lands. These local entries carry the old
  // item's refs over to the new id in the meantime (an edit keeps the same
  // upstream logical items), so the "Sourced from" / "Depends on" cells do not
  // flash "None recorded"; the refreshed prop then supersedes them.
  const [upstreamOverrides, setUpstreamOverrides] = useState<Record<string, string[]>>({});
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
  const effectiveUpstream = useMemo(
    () => ({ ...upstreamDisplayKeysByItemVersionId, ...upstreamOverrides }),
    [upstreamDisplayKeysByItemVersionId, upstreamOverrides],
  );

  // The page keys this component by version id. A successful refresh remounts
  // it with the saved version; only a delayed refresh needs local recovery.
  useEffect(
    () => () => {
      if (refreshTimeout.current) clearTimeout(refreshTimeout.current);
    },
    [],
  );

  function waitForSavedVersion(releasePending: () => void) {
    setGenerationFinalizing(true);
    router.refresh();
    refreshTimeout.current = setTimeout(() => {
      setGenerationFinalizing(false);
      setRefreshTimedOut(true);
      setErrorMessage('The draft was saved, but this page did not update. Reload to see it.');
      releasePending();
    }, 15_000);
  }

  /**
   * `POST /api/projects/:projectId/artifacts/:type/generate` with no body -
   * the first-generation path (SCRUM-86 follow-up: a brand-new project's
   * version-less artifacts had no UI trigger anywhere). `status: 'stale'` is
   * a recorded rejected version, so keep the current review on screen and
   * invite a retry with the new context.
   */
  async function handleGenerate() {
    if (pending) return;
    setPending(true);
    setErrorMessage(null);
    setStaleReason(null);
    setGenerationPreview('');
    setRefreshTimedOut(false);
    let saved = false;
    try {
      const response = await fetch(
        `/api/projects/${projectId}/artifacts/${artifactType}/generate`,
        {
          method: 'POST',
          headers: { Accept: 'text/event-stream' },
        },
      );
      const body = await readGenerationResponse(response, (delta) =>
        setGenerationPreview((current) => current + delta),
      );
      if (body?.status === 'stale') {
        setStaleReason(body.reason ?? 'base_changed');
        return;
      }
      waitForSavedVersion(() => setPending(false));
      saved = true;
    } catch (error) {
      setGenerationFinalizing(false);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      if (!saved) setPending(false);
    }
  }

  if (pending || aiRevisePending) {
    return (
      <GenerationSkeleton
        artifactType={artifactType}
        artifactTypeName={artifactTypeName}
        preview={generationPreview}
        finalizing={generationFinalizing}
      />
    );
  }

  // A version-less artifact still needs a first-generation action.
  if (!version) {
    return (
      <div className="border-surface-dim bg-surface-container-lowest rounded-xl border p-8 text-center">
        <p className="text-on-surface text-sm font-medium">
          {artifactTypeName} hasn&apos;t been generated yet.
        </p>
        <p className="text-on-surface-variant mt-1 text-sm">
          Generate a first draft to start the review.
        </p>
        {errorMessage && (
          <p
            role="alert"
            className="bg-error-container text-on-error-container mt-4 flex items-start gap-2 rounded-lg p-3 text-left text-sm leading-relaxed"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
            {refreshTimedOut && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="ml-1 underline focus-visible:outline-2"
              >
                Reload page
              </button>
            )}
          </p>
        )}
        {staleReason && (
          <p role="status" className="text-status-draft-text mt-4 text-sm">
            {staleReason === 'dependency_superseded'
              ? 'A prerequisite changed during generation.'
              : 'The current draft changed during generation.'}{' '}
            Generate again to use the latest state.
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={pending}
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary mt-4 inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {pending ? 'Generating…' : `Generate ${artifactTypeName}`}
        </button>
      </div>
    );
  }

  // Narrowed copy of the one field the async handlers below need from
  // `version` itself: a function declared after this point still closes over
  // the (unnarrowed) `version` parameter as far as TypeScript's control-flow
  // analysis is concerned, since a parameter is a mutable binding - this
  // `const` carries the null check's result into
  // `submitApprove`/`handleReviseManually` instead. `artifactType` itself
  // comes from the prop, not `version.artifactType` - the page guarantees
  // they're the same value (`loadReviewVersion` reads by `type`), and the
  // prop is also what the `!version` branch above needs before this point is
  // ever reached.
  const versionId = version.id;

  // FR-022: an Architecture version cannot become authoritative unless
  // exactly one option is selected. `version.options` is `null` for every
  // other artifact type (requirements/ui_requirements/backlog), so this is
  // always `false` there and the rest of this gate is a no-op.
  const requiresOptionSelection = version.options !== null;
  const isRequirements = version.artifactType === 'requirements';
  const isUiRequirements = version.artifactType === 'ui_requirements';
  const uiSourceRefs = new Set(
    isUiRequirements ? items.flatMap((item) => effectiveUpstream[item.itemVersionId] ?? []) : [],
  );

  // `POST /api/artifact-versions/:versionId/approve` - shared by the plain
  // Approve click and the override-approve dialog confirm (`note` present
  // only for the latter). FR-084: the override doesn't bypass the gate, it
  // satisfies it - the server acknowledges every currently-blocking item
  // itself, inside the approval transaction; this call never does that
  // locally.
  async function submitApprove(note?: string) {
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/artifact-versions/${versionId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(requiresOptionSelection && selectedOptionId
            ? { selectedArchitectureOptionId: selectedOptionId }
            : {}),
          ...(note !== undefined ? { overrideNote: note } : {}),
        }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        // The client's own `blockingItems` check can be stale (someone else
        // changed impact state concurrently) - a real `APPROVAL_BLOCKED`
        // from the call itself opens the same dialog the client-side check
        // would have, with the server's freshly-recomputed rows, rather than
        // just showing a generic error.
        if (body?.error?.code === 'APPROVAL_BLOCKED') {
          const blocking: ImpactRowDTO[] = Array.isArray(body?.error?.details?.blocking)
            ? body.error.details.blocking
            : [];
          setItems((current) => withUpdatedImpact(current, blocking));
          setDialogOpen(true);
          return;
        }
        // Close the override dialog on any other failure too - it's a fixed
        // overlay, so leaving it open would hide the error banner below
        // behind it.
        setDialogOpen(false);
        setErrorMessage(body?.error?.message ?? 'Something went wrong. Please try again.');
        return;
      }

      const updated: ArtifactVersionDTO = body.version;
      setStatus(updated.status);
      setItems(updated.items);
      setSelectedArchitectureOptionId(updated.selectedArchitectureOptionId);
      if (note !== undefined) setOverrideNote(note);
      setDialogOpen(false);
      // Same version id, so no remount happens on its own (see the `key`
      // comment above) - refresh anyway so the Server Component parent's own
      // read is fresh too (e.g. a subsequent full navigation, or a sibling
      // page reading the same project).
      router.refresh();
    } catch {
      setErrorMessage('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  function handleApproveClick() {
    if (status !== 'draft' || pending || revisePending || aiRevisePending) return;
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

    void submitApprove();
  }

  function handleDialogConfirm(note: string) {
    void submitApprove(note);
  }

  /**
   * `POST /api/projects/:projectId/artifacts/:type/revise` (TR FR-081): a new
   * draft with every item unchanged and zero model calls, from the current
   * approved version. Unlike Approve, this mints a brand-new
   * `artifact_version` (a new id) - `router.refresh()` on success lets the
   * page re-read the newest version and remount this component with it (see
   * the `key` comment above), rather than trying to patch local state onto a
   * version this instance was never initialized from.
   */
  async function handleReviseManually() {
    if (pending || revisePending || aiRevisePending || artifactType === 'architecture') return;
    setRevisePending(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/artifacts/${artifactType}/revise`, {
        method: 'POST',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setErrorMessage(body?.error?.message ?? 'Something went wrong. Please try again.');
        return;
      }
      router.refresh();
    } catch {
      setErrorMessage('Could not reach the server. Check your connection and try again.');
    } finally {
      setRevisePending(false);
    }
  }

  // "Request AI revision" click opens the inline feedback prompt (same
  // interaction shape as `WarningRow`'s inline acknowledge-note textarea in
  // `warning-panel.tsx`) rather than submitting immediately - feedback is
  // optional-but-encouraged, so the reviewer always gets a chance to add it
  // before the call fires.
  function handleRequestAiRevisionClick() {
    if (status !== 'draft' || pending || revisePending || aiRevisePending) return;
    setAiRevisionOpen(true);
  }

  function handleCancelAiRevision() {
    setAiRevisionOpen(false);
    setAiRevisionFeedback('');
  }

  /**
   * Same endpoint as `handleGenerate` above, this time with `feedback` -
   * exactly "an AI revision of an existing approved version" per the
   * `generate` route's own doc comment. An empty/whitespace-only feedback
   * omits the key entirely rather than sending `feedback: ''`, since a blank
   * textarea means "no feedback," not "empty feedback."
   */
  async function handleConfirmAiRevision() {
    if (aiRevisePending) return;
    setAiRevisePending(true);
    setErrorMessage(null);
    setStaleReason(null);
    setGenerationPreview('');
    setRefreshTimedOut(false);
    let saved = false;
    try {
      const trimmedFeedback = aiRevisionFeedback.trim();
      const response = await fetch(
        `/api/projects/${projectId}/artifacts/${artifactType}/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify(trimmedFeedback ? { feedback: trimmedFeedback } : {}),
        },
      );
      const body = await readGenerationResponse(response, (delta) =>
        setGenerationPreview((current) => current + delta),
      );
      if (body?.status === 'stale') {
        setStaleReason(body.reason ?? 'base_changed');
        setAiRevisionOpen(false);
        return;
      }
      setAiRevisionOpen(false);
      setAiRevisionFeedback('');
      waitForSavedVersion(() => setAiRevisePending(false));
      saved = true;
    } catch (error) {
      setGenerationFinalizing(false);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      if (!saved) setAiRevisePending(false);
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-6',
        isRequirements && 'lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] lg:items-start',
      )}
    >
      {staleReason && (
        <p role="status" className="text-status-draft-text text-sm lg:col-span-2">
          {staleReason === 'dependency_superseded'
            ? 'A prerequisite changed during generation.'
            : 'The current draft changed during generation.'}{' '}
          Generate again to use the latest state.
        </p>
      )}
      <header
        className={cn(
          'app-card p-6 sm:p-8',
          isRequirements && 'px-5 py-4 sm:px-6 lg:col-span-2',
          version.options && 'border-l-primary border-l-4',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {version.options && (
              <p className="font-mono-code text-primary mb-1 text-[11px] font-semibold tracking-wide uppercase">
                Review · Version {version.versionNumber}
              </p>
            )}
            {isRequirements && (
              <p className="text-tertiary mb-1 text-[11px] font-semibold tracking-wider uppercase">
                Specifications audit
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="app-display text-on-surface text-[clamp(2rem,4vw,3rem)] leading-tight">
                {version.artifactType === 'backlog'
                  ? 'Backlog Review'
                  : version.options
                    ? 'Architecture review'
                    : isUiRequirements
                      ? 'UI Requirements Review'
                      : artifactTypeName}
                {isRequirements && ` v${version.versionNumber}`}
              </h1>
              {isUiRequirements && (
                <span className="font-mono-code bg-surface-container-low text-on-surface-variant rounded px-2 py-1 text-xs">
                  Version {version.versionNumber}
                </span>
              )}
            </div>
            {version.options && (
              <p className="text-on-surface-variant mt-1 text-sm">
                Compare the proposed stacks, decisions, and trade-offs before choosing one
                architecture.
              </p>
            )}
            {isUiRequirements && (
              <p className="text-on-surface-variant mt-2 text-sm">
                Review {items.length} structured UI specification{items.length === 1 ? '' : 's'} and
                their recorded source references.
              </p>
            )}
            {!isRequirements && !version.options && !isUiRequirements && (
              <p className="text-on-surface-variant mt-1 text-sm">
                Version {version.versionNumber}
              </p>
            )}
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

      {version.options && (
        <ArchitectureOptions
          options={version.options}
          status={status}
          selectedOptionId={selectedOptionId}
          approvedOptionId={selectedArchitectureOptionId}
          onSelect={setSelectedOptionId}
        />
      )}

      {isUiRequirements && (
        <UiRequirementsReviewLayout
          items={items}
          artifactPayload={version.payload}
          upstreamDisplayKeysByItemVersionId={effectiveUpstream}
          status={status}
          onEdit={setEditingItem}
        />
      )}

      {version.artifactType === 'backlog' ? (
        <BacklogReviewLayout
          items={items}
          upstreamDisplayKeysByItemVersionId={effectiveUpstream}
          qualityIssues={qualityIssues}
          status={status}
          onEdit={setEditingItem}
        />
      ) : (
        <>
          {/* Quality gate (FR-012) - deterministic checks, informational: they
          are shown before approval but do not block it (only flagged/
          unacknowledged impact does, per FR-083). */}
          <section
            aria-labelledby="quality-gate-heading"
            className={cn(
              'border-surface-dim bg-surface-container-lowest rounded-xl border p-6',
              isRequirements &&
                'lg:border-t-primary-container order-2 lg:order-none lg:col-start-2 lg:row-start-2 lg:border-t-2',
            )}
          >
            {isRequirements && (
              <p className="text-tertiary mb-1 text-[11px] font-semibold tracking-wider uppercase">
                Automated verification
              </p>
            )}
            <h2
              id="quality-gate-heading"
              className={cn(
                'text-on-surface-variant text-xs font-semibold tracking-wide uppercase',
                isRequirements && 'text-on-surface text-base tracking-normal normal-case',
              )}
            >
              Quality gate
            </h2>
            {isRequirements && (
              <p className="text-on-surface-variant mt-1 text-xs leading-relaxed">
                {qualityIssues.length} deterministic finding{qualityIssues.length === 1 ? '' : 's'}.
                Review them before approval.
              </p>
            )}
            {qualityIssues.length === 0 ? (
              <p className="text-on-surface-variant mt-3 text-sm">
                No deterministic quality issues found.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2">
                {qualityIssues.map((issue, index) => {
                  const relatedItem = items.find(
                    (item) => item.logicalItemId === issue.logicalItemId,
                  );
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
            className={cn(
              'border-surface-dim bg-surface-container-lowest rounded-xl border p-6',
              isRequirements && 'order-3 lg:order-none lg:col-start-2 lg:row-start-3',
            )}
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
                  No impact issues found. Every item in this version is current with its
                  dependencies.
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
                        <span className="font-mono-code font-semibold">{item.displayKey}</span>{' '}
                        would be flagged: it depends on{' '}
                        <span className="font-mono-code font-semibold">
                          {impact.rootDisplayKey}
                        </span>{' '}
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

          {!isUiRequirements && (
            <section
              aria-labelledby="items-heading"
              className={cn(
                'border-surface-dim bg-surface-container-lowest rounded-xl border p-6',
                isRequirements &&
                  'order-1 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-2',
              )}
            >
              <h2
                id="items-heading"
                className={cn(
                  'text-on-surface-variant text-xs font-semibold tracking-wide uppercase',
                  isRequirements && 'text-tertiary',
                )}
              >
                {isRequirements ? 'Specifications register' : 'Items'} ({items.length})
              </h2>
              {items.length === 0 ? (
                <p className="text-on-surface-variant mt-3 text-sm">
                  This version has no items yet.
                </p>
              ) : (
                <ul className={cn('mt-3 flex flex-col gap-3', isRequirements && 'gap-4')}>
                  {items.map((item) => {
                    const fields = readKnownFields(item.payload);
                    // Generic parent lookup (e.g. Story -> Epic, API Contracts
                    // 1.8) - works for any item type whose `parentLogicalItemId`
                    // resolves to another item in this same version, not just
                    // backlog's Story/Epic pairing.
                    const parent = item.parentLogicalItemId
                      ? items.find(
                          (candidate) => candidate.logicalItemId === item.parentLogicalItemId,
                        )
                      : undefined;
                    // Short metadata line at the bottom of the card - every field
                    // here is optional and artifact-type-generic (not just
                    // backlog's or UI Requirements'), joined with a middot only
                    // for whichever of them are actually present.
                    const metaParts: string[] = [];
                    const itemQualityIssues = isRequirements
                      ? qualityIssues.filter((issue) => issue.logicalItemId === item.logicalItemId)
                      : [];
                    if (fields.priority) metaParts.push(`Priority: ${fields.priority}`);
                    const upstreamRefs = effectiveUpstream[item.itemVersionId] ?? [];
                    if (upstreamRefs.length > 0) {
                      metaParts.push(`Depends on: ${upstreamRefs.join(', ')}`);
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
                      <li
                        key={item.itemVersionId}
                        className={cn(
                          'border-surface-dim hover:border-outline-variant rounded-lg border p-4 transition-colors',
                          isRequirements && 'bg-surface-container-lowest p-5',
                          isRequirements &&
                            itemQualityIssues.length > 0 &&
                            'border-l-primary-container border-l-4',
                        )}
                      >
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
                              <span className="text-on-surface-variant text-[11px]">
                                Acknowledged
                              </span>
                            ) : (
                              <FlaggedGlyph title={`${item.displayKey} is flagged`} />
                            )
                          ) : (
                            <span className="text-on-surface-variant/70 text-[11px]">
                              No impact
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditingItem(item)}
                            disabled={status !== 'draft'}
                            title={
                              status === 'draft' ? `Edit ${item.displayKey}` : EDIT_DISABLED_TITLE
                            }
                            className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary ml-auto inline-flex items-center gap-1 rounded p-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <SquarePen className="size-3.5" aria-hidden="true" />
                            <span className="sr-only">Edit {item.displayKey}</span>
                          </button>
                        </div>
                        {fields.actor && (
                          <p className="text-on-surface-variant mt-2 text-xs">
                            <span className="font-medium">Actor:</span> {fields.actor}
                          </p>
                        )}
                        {fields.behavior ? (
                          <p
                            className={cn(
                              'text-on-surface mt-2 text-sm leading-relaxed',
                              isRequirements && 'mt-3 text-base font-medium',
                            )}
                          >
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
                          <ul
                            className={cn(
                              'text-on-surface-variant mt-2 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed',
                              isRequirements && 'border-surface-dim mt-3 border-t pt-3',
                            )}
                          >
                            {fields.acceptanceCriteria.map((criterion, index) => (
                              <li key={index}>{criterion}</li>
                            ))}
                          </ul>
                        )}
                        {itemQualityIssues.length > 0 && (
                          <div className="bg-surface-container-low mt-3 rounded-lg p-3">
                            <p className="text-tertiary flex items-center gap-1.5 text-xs font-semibold">
                              <CircleAlert className="size-4" aria-hidden="true" />
                              Quality findings
                            </p>
                            <ul className="text-on-surface-variant mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed">
                              {itemQualityIssues.map((issue, index) => (
                                <li key={`${issue.code}-${index}`}>{issue.message}</li>
                              ))}
                            </ul>
                          </div>
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
                          <p className="text-on-surface-variant mt-2 text-xs">
                            {metaParts.join(' · ')}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <div
        className={cn(
          'border-surface-dim bg-surface-container-lowest sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-xl border p-6',
          isRequirements && 'order-4 lg:order-none lg:col-span-2 lg:row-start-4 lg:justify-between',
        )}
      >
        {isRequirements && (
          <p className="text-on-surface-variant w-full text-xs leading-relaxed lg:w-auto lg:max-w-xs">
            {blockingItems.length > 0
              ? `${blockingItems.length} flagged, unacknowledged item${blockingItems.length === 1 ? '' : 's'} require${blockingItems.length === 1 ? 's' : ''} review before approval.`
              : 'Review the specification and quality findings before approval.'}
          </p>
        )}
        {version.options && (
          <div className="min-w-0 flex-1 basis-full sm:basis-60">
            <p className="text-on-surface text-sm font-semibold">
              {status === 'draft'
                ? selectedOptionId
                  ? `Option ${version.options.find((option) => option.id === selectedOptionId)?.optionKey ?? ''} selected for review`
                  : 'Choose one option to approve'
                : status === 'approved'
                  ? 'Option approved in this preview'
                  : 'Review closed'}
            </p>
            <p className="text-on-surface-variant mt-1 text-xs leading-relaxed">
              Only the selected option’s candidate decisions become canonical Architecture
              Decisions, materialized when you approve (FR-022).
            </p>
          </div>
        )}
        {isUiRequirements && (
          <p className="text-on-surface-variant w-full text-xs leading-relaxed">
            <span className="font-semibold">Recorded provenance:</span>{' '}
            {uiSourceRefs.size > 0
              ? Array.from(uiSourceRefs).join(', ')
              : 'No source references recorded in these item payloads.'}
          </p>
        )}
        {errorMessage && (
          <p
            role="alert"
            className="bg-error-container text-on-error-container flex w-full items-start gap-2 rounded-lg p-3 text-sm leading-relaxed"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
            {refreshTimedOut && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="ml-1 underline focus-visible:outline-2"
              >
                Reload page
              </button>
            )}
          </p>
        )}
        <button
          type="button"
          onClick={handleApproveClick}
          disabled={
            status !== 'draft' ||
            pending ||
            revisePending ||
            aiRevisePending ||
            (requiresOptionSelection && !selectedOptionId)
          }
          title={
            requiresOptionSelection && !selectedOptionId && status === 'draft'
              ? 'Select an architecture option above before approving (FR-022).'
              : undefined
          }
          className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {status === 'approved'
            ? 'Approved'
            : pending
              ? 'Approving…'
              : version.options
                ? 'Approve selected option'
                : 'Approve'}
        </button>
        {!aiRevisionOpen && (
          <button
            type="button"
            onClick={handleRequestAiRevisionClick}
            disabled={status !== 'draft' || pending || revisePending || aiRevisePending}
            title={status !== 'draft' ? AI_REVISION_STATUS_TITLE : AI_REVISION_TITLE}
            className="border-surface-dim text-on-surface hover:bg-surface-container-low focus-visible:ring-primary disabled:text-outline flex h-11 items-center gap-2 rounded-lg border px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
          >
            {aiRevisePending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {aiRevisePending ? 'Requesting…' : 'Request AI revision'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleReviseManually()}
          disabled={
            pending || revisePending || aiRevisePending || version.artifactType === 'architecture'
          }
          title={
            version.artifactType === 'architecture'
              ? MANUAL_REVISION_ARCHITECTURE_TITLE
              : MANUAL_REVISION_TITLE
          }
          className="border-surface-dim text-on-surface hover:bg-surface-container-low focus-visible:ring-primary disabled:text-outline flex h-11 items-center gap-2 rounded-lg border px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
        >
          {revisePending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {revisePending ? 'Revising…' : 'Revise manually'}
        </button>
        {aiRevisionOpen && (
          <div className="border-surface-dim bg-surface-container-low w-full basis-full rounded-lg border p-3">
            <label
              htmlFor="ai-revision-feedback"
              className="font-mono-code text-on-surface-variant text-[10px] font-medium tracking-wide uppercase"
            >
              Feedback for the AI revision (optional)
            </label>
            <textarea
              autoFocus
              id="ai-revision-feedback"
              value={aiRevisionFeedback}
              onChange={(event) => setAiRevisionFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleCancelAiRevision();
                }
              }}
              rows={2}
              placeholder="What should the AI change or focus on? (leave blank to just regenerate)"
              className="border-outline-variant bg-surface-container-lowest text-on-surface placeholder:text-outline focus-visible:ring-primary mt-2 min-h-28 w-full resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleConfirmAiRevision()}
                disabled={aiRevisePending}
                className="bg-primary-container text-on-primary-container hover:bg-primary-container-hover focus-visible:ring-primary flex h-9 items-center gap-2 rounded-md px-3.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {aiRevisePending && (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                )}
                {aiRevisePending ? 'Requesting…' : 'Confirm revision'}
              </button>
              <button
                type="button"
                onClick={handleCancelAiRevision}
                disabled={aiRevisePending}
                className="text-on-surface-variant hover:text-on-surface focus-visible:ring-primary rounded-md px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:outline-none disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {dialogOpen && (
        <ApprovalDialog
          blockingItems={blockingItems}
          onCancel={() => setDialogOpen(false)}
          onConfirm={handleDialogConfirm}
        />
      )}

      {editingItem && (
        <ItemEditDialog
          versionId={versionId}
          item={editingItem}
          onCancel={() => setEditingItem(null)}
          onSave={async (payload, confirmed) => {
            const response = await fetch(
              `/api/artifact-versions/${versionId}/items/${editingItem.logicalItemId}`,
              {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ payload, confirmed }),
              },
            );
            const body = await response.json().catch(() => null);
            if (!response.ok) {
              const message = body?.error?.message ?? 'Could not save this edit.';
              // 409: the server's own rebind changed references the client had
              // not confirmed - hand the diff back so the dialog can show it.
              if (body?.error?.code === 'CONFIRMATION_REQUIRED') {
                throw new ItemEditConfirmationRequired(
                  message,
                  body.error.details?.changedRefs ?? [],
                );
              }
              throw new Error(message);
            }
            const updatedItem = body.item as ItemVersionDTO;
            // The edit keeps the same upstream logical items (the server
            // rebinds to their current versions, same display keys), so the
            // old item's keys are correct for the new id until the refresh
            // below brings the server-truth map.
            setUpstreamOverrides((current) => ({
              ...current,
              [updatedItem.itemVersionId]: effectiveUpstream[editingItem.itemVersionId] ?? [],
            }));
            setItems((current) =>
              current.map((existing) =>
                existing.logicalItemId === updatedItem.logicalItemId ? updatedItem : existing,
              ),
            );
            setEditingItem(null);
            // A save mints a new item_version id; the server-rendered
            // "Depends on / Sourced from" data is keyed by item_version id, so
            // refetch it for the new id.
            router.refresh();
            return updatedItem;
          }}
        />
      )}
    </div>
  );
}
