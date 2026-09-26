// Shared route-handler glue for the artifact/version/item-edit routes (E3-S10,
// SCRUM-45; API Contracts sections 4-5). A Next.js "private folder" file, same
// idea as `_shared/external.ts`: no URL of its own, and still classified as
// `layer6-api` by `eslint.config.mjs`, so it is bound by the exact same import
// allow-list as every route handler (`@/auth`, `@/artifact-lifecycle`,
// `@/artifact-types/*`, `@/external/*`, `@/lib` - never `@/db`, `identity`,
// `impact` or `dependency-binding`).
//
// What lives here is only what more than one of those eleven routes must do
// identically and that is not domain logic: resolving `:type` / `:versionId` /
// `:logicalItemId` to an owned object (404 otherwise, never 403 - API Contracts
// 1.4), the FR-080 prerequisite table (a lookup, not a decision - the same rule
// each artifact-type module's own `generate` re-checks), the `:type` -> module
// dispatch table, mapping artifact-lifecycle's typed errors to `ApiError`s, and
// building `ArtifactVersionDTO` so every route that returns `{ version }` puts
// the identical wire shape on the wire. No lineage, matching, hashing,
// transaction or lock logic belongs in this file (Module Boundaries 4.7).
import {
  getArtifactVersionDetail,
  getVersionRef,
  ItemEditError,
  VersionNotDraftError,
  type ArtifactVersionRef,
  type CreateDraftFromGenerationOptions,
  type ImpactRow,
  type VersionItem,
} from '@/artifact-lifecycle';
import {
  generate as generateArchitecture,
  getOptionsForVersion,
} from '@/artifact-types/architecture';
import {
  generate as generateBacklog,
  qualityGate as qualityGateBacklog,
} from '@/artifact-types/backlog';
import {
  generate as generateRequirements,
  qualityGate as qualityGateRequirements,
} from '@/artifact-types/requirements';
import { generate as generateUiRequirements } from '@/artifact-types/ui-requirements';
import { requireProjectOwner } from '@/auth';
import { toImpactRowDTOs } from '@/app/api/_shared/external';
import { ApiError } from '@/lib/errors';
import {
  ARTIFACT_TYPES,
  toArchitectureOptionDTO,
  toArtifactVersionDTO,
  toItemVersionDTO,
  type ArtifactSummaryDTO,
  type ArtifactType,
  type ArtifactVersionDTO,
  type ImpactRowDTO,
  type QualityIssueDTO,
} from '@/lib/serialize';

// Same shape check `auth.requireProjectOwner` and artifact-lifecycle's
// `getVersionRef` apply to their ids: a logical item id never has any other
// legal shape (uuid primary key), so a malformed one is answered as "not
// found" here instead of reaching Postgres and surfacing its raw 22P02
// "invalid input syntax for type uuid" as a 500. Copied rather than imported
// for the reason `getVersionRef`'s own comment gives: it is a private constant
// in both other places.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the `:type` path segment against exactly the `artifact.type` CHECK
 * values (API Contracts 1.7). Anything else is `404 NOT_FOUND` - a route calls
 * this only AFTER `requireProjectOwner`, so an unknown segment on somebody
 * else's project answers the same 404 that project would give for a valid one
 * and confirms nothing.
 */
export function parseArtifactType(raw: string): ArtifactType {
  const type = ARTIFACT_TYPES.find((candidate) => candidate === raw);
  if (!type) throw new ApiError('NOT_FOUND', 'Unknown artifact type.');
  return type;
}

/** `:logicalItemId` must at least be a uuid; anything else is `404 NOT_FOUND`, never a database error. */
export function parseLogicalItemId(raw: string): string {
  if (!UUID_RE.test(raw)) throw new ApiError('NOT_FOUND', 'Item not found.');
  return raw;
}

function versionNotFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Artifact version not found.');
}

/**
 * API Contracts 1.4 for a `:versionId` route: resolve the id to its project
 * FIRST, then run the ownership check, so a version of a project the caller
 * does not own and a version that does not exist (or is not even a uuid) are
 * indistinguishable - same status, same code, same message. The message is
 * normalized on purpose: `requireProjectOwner`'s own 404 says "Project not
 * found.", and letting that through for one case but not the other would
 * confirm a version exists in someone else's project.
 */
export async function resolveOwnedVersion(
  userId: string,
  versionId: string,
): Promise<ArtifactVersionRef> {
  const ref = await getVersionRef(versionId);
  if (!ref) throw versionNotFound();
  try {
    await requireProjectOwner(userId, ref.projectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') throw versionNotFound();
    throw error;
  }
  return ref;
}

// --- FR-080 prerequisites ---------------------------------------------------

/**
 * TR FR-080 / API Contracts 4: which artifact types must already have an
 * approved version before another can be generated (or manually revised).
 * Listed in canonical `ARTIFACT_TYPES` order.
 */
export const ARTIFACT_PREREQUISITES: Record<ArtifactType, readonly ArtifactType[]> = {
  requirements: [],
  architecture: ['requirements'],
  ui_requirements: ['requirements', 'architecture'],
  backlog: ['requirements', 'architecture', 'ui_requirements'],
};

interface ProjectApprovals {
  artifacts: Record<ArtifactType, ArtifactSummaryDTO>;
}

/**
 * The prerequisites of `type` that have no approved version yet, in canonical
 * `ARTIFACT_TYPES` order (`409 PREREQUISITE_NOT_APPROVED`'s `details.missing`).
 */
export function missingPrerequisites(
  project: ProjectApprovals,
  type: ArtifactType,
): ArtifactType[] {
  const required = ARTIFACT_PREREQUISITES[type];
  return ARTIFACT_TYPES.filter(
    (candidate) => required.includes(candidate) && !project.artifacts[candidate].approvedVersionId,
  );
}

/**
 * The approved version ids of `type`'s prerequisites, in canonical order - the
 * `contextSourceVersionIds` a generation is captured against
 * (`createDraftFromGeneration`). Only meaningful once `missingPrerequisites` is
 * empty; a prerequisite with no approved version is skipped, never
 * fabricated.
 */
export function prerequisiteVersionIds(project: ProjectApprovals, type: ArtifactType): string[] {
  const required = ARTIFACT_PREREQUISITES[type];
  return ARTIFACT_TYPES.flatMap((candidate) => {
    const versionId = project.artifacts[candidate].approvedVersionId;
    return required.includes(candidate) && versionId ? [versionId] : [];
  });
}

// --- :type -> artifact-type module dispatch ---------------------------------

type ArchitectureGenerateOutput = Awaited<ReturnType<typeof generateArchitecture>>;

/**
 * What `<type>.generate` returns - the exact shape `createDraftFromGeneration`'s
 * own `generate` callback takes - with the one extra field only Architecture's
 * carries: the two `options` its route persists after a non-stale draft.
 * (Derived from the modules' own signatures: `Candidate` is an `identity` type
 * this layer may not import.)
 */
export type GenerateOutput = Awaited<ReturnType<typeof generateRequirements>> & {
  options?: ArchitectureGenerateOutput['options'];
};

// What `<type>.generate` takes: the project, the reviewer's feedback, and the two
// values `createDraftFromGeneration` captured for this very generation and hands
// its callback - `contextSourceVersionIds` (canonical order: the artifact order
// requirements -> architecture -> ui_requirements, filtered to this type's
// `ARTIFACT_PREREQUISITES`) and `baseVersionId`. The route threads them through
// so each module builds its prompt from exactly the versions the draft will be
// recorded against (INV-006), not a third re-read of the project.
interface GenerateContext {
  projectId: string;
  feedback?: string | undefined;
  contextSourceVersionIds?: string[] | undefined;
  baseVersionId?: string | null | undefined;
}

interface ArtifactTypeDispatch {
  generate: (ctx: GenerateContext) => Promise<GenerateOutput>;
  /** `null` where Module Boundaries 4.4 specifies no gate for P0 (Architecture, UI Requirements). */
  qualityGate: ((versionId: string) => Promise<QualityIssueDTO[]>) | null;
  /**
   * `createDraftFromGeneration`'s default `itemType`. Omitted for Backlog (every
   * candidate carries its own `epic`/`story`) and Architecture (its
   * `toCandidates` is always `[]` - decisions are minted at approval, ERD 5.5).
   */
  defaultItemType?: NonNullable<CreateDraftFromGenerationOptions['itemType']>;
}

export const ARTIFACT_TYPE_DISPATCH: Record<ArtifactType, ArtifactTypeDispatch> = {
  requirements: {
    generate: generateRequirements,
    qualityGate: qualityGateRequirements,
    defaultItemType: 'requirement',
  },
  architecture: { generate: generateArchitecture, qualityGate: null },
  ui_requirements: {
    generate: generateUiRequirements,
    qualityGate: null,
    defaultItemType: 'ui_requirement',
  },
  backlog: { generate: generateBacklog, qualityGate: qualityGateBacklog },
};

// --- Errors ----------------------------------------------------------------

/**
 * Maps the typed errors artifact-lifecycle's transitions and item edits throw
 * onto their API Contracts 11 codes. Returns the `ApiError` to throw, or the
 * error unchanged when it is not one of these (the caller rethrows it, and
 * `errorResponse` turns it into the generic 500). Lives here rather than in
 * `lib/errors.ts` for the reason `projects/[projectId]/route.ts` gives for
 * `BriefFrozenError`: `lib` may not import artifact-lifecycle, so only layer 6
 * can make this mapping.
 *
 * `ApprovalGateBlockedError` is deliberately NOT handled here: its 409 carries
 * `details.blocking` display-key rows built from the display keys the error
 * itself carries (captured inside the rolled-back approval transaction) - the
 * approve route builds that one itself.
 */
export function translateLifecycleError(error: unknown): unknown {
  if (error instanceof VersionNotDraftError) {
    return new ApiError('VERSION_NOT_DRAFT', 'This version is not a draft.');
  }
  if (error instanceof ItemEditError) {
    switch (error.code) {
      case 'VERSION_NOT_DRAFT':
        return new ApiError('VERSION_NOT_DRAFT', 'This version is not a draft.');
      case 'ITEM_NOT_IN_VERSION':
        return new ApiError('ITEM_NOT_IN_VERSION', 'That item is not part of this version.');
      case 'UPSTREAM_REMOVED':
        // details: { logicalItemId, displayKey } - straight from identity.
        return new ApiError('UPSTREAM_REMOVED', error.message, error.details);
      case 'CONFIRMATION_REQUIRED':
        // details: { changedRefs } - the diff the server just recomputed.
        return new ApiError('CONFIRMATION_REQUIRED', error.message, error.details);
    }
  }
  return error;
}

// --- ArtifactVersionDTO -----------------------------------------------------

/**
 * `GET /api/artifact-versions/:versionId`'s body, and the `version` every other
 * route that returns one embeds: the version row and its items
 * (`artifact-lifecycle.getArtifactVersionDetail`, each with its raw id-based
 * impact row), the Architecture options
 * (`architecture.getOptionsForVersion`, Architecture versions only), and ONE
 * batched display-key resolution over every item's impact row
 * (`toImpactRowDTOs`) - never a round trip per item.
 *
 * `404 NOT_FOUND` if the version is gone: routes resolve ownership first, so
 * this only fires on a race, never as an ownership signal.
 */
export async function loadVersionDTO(versionId: string): Promise<ArtifactVersionDTO> {
  const detail = await getArtifactVersionDetail(versionId);
  if (!detail) throw versionNotFound();
  const { version, items } = detail;

  const withImpact = items.filter(
    (item): item is VersionItem & { impact: ImpactRow } => item.impact !== null,
  );
  const impactDTOs = await toImpactRowDTOs(withImpact.map((item) => item.impact));
  const impactByItemVersionId = new Map<string, ImpactRowDTO>();
  withImpact.forEach((item, index) => {
    const dto = impactDTOs[index];
    if (dto) impactByItemVersionId.set(item.itemVersionId, dto);
  });

  const options =
    version.artifactType === 'architecture'
      ? (await getOptionsForVersion(versionId)).map(toArchitectureOptionDTO)
      : null;

  return toArtifactVersionDTO(
    version,
    items.map((item) =>
      toItemVersionDTO(item, impactByItemVersionId.get(item.itemVersionId) ?? null),
    ),
    options,
  );
}
