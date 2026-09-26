// Response serialization helpers for route handlers (module 17). Framework
// glue only: these functions convert a module's return shape into the exact
// wire format API Contracts documents - no domain logic lives here.

// Common DTO types (API Contracts 1.7/1.8). `ArtifactType` mirrors the
// `artifact.type` CHECK constraint exactly - defined here (not in
// artifact-lifecycle) because `lib` is the one place every layer, including
// layer 2, is allowed to import from; artifact-lifecycle imports this same
// union instead of redefining it, so the two can never drift.
export type ArtifactType = 'requirements' | 'architecture' | 'ui_requirements' | 'backlog';

export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  'requirements',
  'architecture',
  'ui_requirements',
  'backlog',
];

export interface ArtifactSummaryDTO {
  approvedVersionId: string | null;
  draftVersionId: string | null;
}

export interface ProjectDTO {
  id: string;
  name: string;
  brief: string;
  inputContext: unknown | null;
  createdAt: string;
  artifacts: Record<ArtifactType, ArtifactSummaryDTO>;
}

// Structural input shape - deliberately not imported from artifact-lifecycle
// (lib may not import layer 2). artifact-lifecycle's read exports return
// objects that satisfy this shape.
export interface ProjectWithArtifactsInput {
  id: string;
  name: string;
  brief: string;
  inputContext: unknown;
  createdAt: Date;
  artifacts: Record<ArtifactType, ArtifactSummaryDTO>;
}

// Every artifact type with no version of either kind yet - the only possible
// state for a project right this instant after `createProject` (E1-S8; no
// generation exists until a later epic).
export function emptyArtifactSummaries(): Record<ArtifactType, ArtifactSummaryDTO> {
  return Object.fromEntries(
    ARTIFACT_TYPES.map((type) => [type, { approvedVersionId: null, draftVersionId: null }]),
  ) as Record<ArtifactType, ArtifactSummaryDTO>;
}

export function toProjectDTO(project: ProjectWithArtifactsInput): ProjectDTO {
  return {
    id: project.id,
    name: project.name,
    brief: project.brief,
    inputContext: project.inputContext ?? null,
    createdAt: project.createdAt.toISOString(),
    artifacts: project.artifacts,
  };
}

// --- Artifact version / item DTOs (API Contracts 1.8, E5-S2) --------------
//
// Mirrored here (not in artifact-lifecycle or an artifact-type module) for
// the same reason ArtifactType is: `lib` is the one place every layer may
// import from, and E3-S10's route handlers will build these same shapes
// once they exist. Until then, `components/review/fixtures.ts` is the only
// producer (E3-S10/E3-S11 is this story's declared, sanctioned dependency
// gap - see that file's header comment).

/** The four real `artifact_version.status` values (ERD CHECK) - never a fifth. */
export type ArtifactVersionStatus = 'draft' | 'approved' | 'superseded' | 'rejected';

export interface ImpactRowDTO {
  subjectKind: 'item_version' | 'external_ref';
  subjectId: string;
  rootItemVersionId: string;
  rootDisplayKey: string; // display key resolved server-side for readability
  depth: number;
  path: string[]; // display keys, root to subject, in traversal order
  acknowledged: boolean;
}

export interface ItemVersionDTO {
  itemVersionId: string;
  logicalItemId: string;
  displayKey: string; // e.g. "R-07"
  itemType: 'requirement' | 'architecture_decision' | 'ui_requirement' | 'epic' | 'story';
  revisionNumber: number;
  payload: unknown;
  parentLogicalItemId: string | null; // Story -> Epic, this version's membership only
  impact: ImpactRowDTO | null; // populated whenever fetched via an endpoint that embeds impact
}

export interface ArchitectureOptionDTO {
  id: string;
  optionKey: 'A' | 'B';
  title: string;
  summary: string;
  stack: unknown;
  candidateDecisions: unknown[];
  tradeoffs: unknown[];
}

export interface ArtifactVersionDTO {
  id: string;
  artifactId: string;
  artifactType: ArtifactType;
  versionNumber: number;
  status: ArtifactVersionStatus;
  statusReason: string | null;
  schemaVersion: number;
  baseApprovedVersionId: string | null;
  payload: unknown;
  rawOutput: unknown | null; // only present when statusReason='stale_generation_context'
  items: ItemVersionDTO[];
  options: ArchitectureOptionDTO[] | null; // architecture only, else null
  selectedArchitectureOptionId: string | null; // architecture only, set once approved
  createdAt: string;
  updatedAt: string;
}

export interface QualityIssueDTO {
  code: string;
  message: string;
  logicalItemId: string | null;
}

// --- External reference / operation DTOs (API Contracts 1.8, sections 7-10,
// E4-S6) ------------------------------------------------------------------
//
// Structural input types, same convention as `ProjectWithArtifactsInput`
// above: `lib` may only import `layer0-db` (eslint.config.mjs), so these
// mirror `external-operations.ExternalRef`/`ExternalOperation` and
// `lineage/impact.ImpactRow`'s shapes by hand rather than importing them.
// `provider`/`status` are typed as plain `string` here (Drizzle's
// `$inferSelect` widens a `text()` column with a CHECK constraint to
// `string`, not the literal union) and narrowed with an `as` cast inside the
// `to...DTO` functions below - the same pattern
// `artifact-lifecycle/index.ts`'s `row.artifactType as ArtifactType` already
// uses for the identical reason.

export interface ExternalRefInput {
  id: string;
  provider: string;
  externalId: string;
  externalKey: string | null;
  externalUrl: string | null;
  sourceArtifactVersionId: string;
  sourceItemVersionId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface ExternalOperationInput {
  id: string;
  provider: string;
  operationType: string;
  status: string;
  externalId: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Mirrors `lineage/impact.ImpactRow` exactly (that module's own comment:
// "the module's own internal shape... deliberately a different type" from
// this file's `ImpactRowDTO`) - `subjectKind` is already a real literal
// union there (hand-built from a raw SQL row, not a Drizzle-inferred
// column), so no `as` cast is needed for it the way `provider`/`status`
// above need one.
export interface ImpactRowInput {
  subjectKind: 'item_version' | 'external_ref';
  subjectId: string;
  rootItemVersionId: string;
  depth: number;
  path: string[]; // item_version ids, root to subject (lineage/impact's own shape)
  acknowledged: boolean;
}

export interface ExternalRefDTO {
  id: string;
  provider: 'github' | 'jira' | 'stitch';
  externalId: string;
  externalKey: string | null;
  externalUrl: string | null;
  sourceArtifactVersionId: string;
  sourceItemVersionId: string | null;
  metadata: unknown;
  createdAt: string;
  impact: ImpactRowDTO | null; // drift warning, if any (TR FR-036, ERD 6.2)
}

export interface ExternalOperationDTO {
  id: string;
  provider: 'github' | 'jira' | 'stitch';
  operationType: string;
  status: 'pending' | 'completed' | 'failed' | 'reconciliation_required';
  externalId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toExternalOperationDTO(op: ExternalOperationInput): ExternalOperationDTO {
  return {
    id: op.id,
    provider: op.provider as ExternalOperationDTO['provider'],
    operationType: op.operationType,
    status: op.status as ExternalOperationDTO['status'],
    externalId: op.externalId,
    errorMessage: op.errorMessage,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
  };
}

/**
 * Pure conversion from `lineage/impact`'s id-based shape to the
 * display-key-based `ImpactRowDTO` (API Contracts 1.8:
 * "`rootDisplayKey`/`path` ... display key resolved server-side for
 * readability" vs. `ImpactRow.rootItemVersionId`/`.path`, which are
 * `item_version` ids - see `src/lineage/impact/index.ts`'s own `path`
 * comment). No DB access here (this file's header rule) - the caller
 * resolves every id this row could reference into `displayKeyByItemVersionId`
 * first (batched, one round trip - `external-operations.
 * getDisplayKeysForItemVersions`), and this function only ever looks it up.
 * Throws if the map is missing an id: a caller that didn't include every
 * `rootItemVersionId`/`path` entry in its batch is a caller bug, not a
 * value this function should silently paper over (INV-023: "every warning
 * must be inspectable").
 */
export function toImpactRowDTO(
  row: ImpactRowInput,
  displayKeyByItemVersionId: Map<string, string>,
): ImpactRowDTO {
  const displayKeyFor = (itemVersionId: string): string => {
    const displayKey = displayKeyByItemVersionId.get(itemVersionId);
    if (displayKey === undefined) {
      throw new Error(
        `toImpactRowDTO: no display key resolved for item_version ${itemVersionId} - the caller's ` +
          'batch map must cover every rootItemVersionId/path entry before serializing.',
      );
    }
    return displayKey;
  };

  return {
    subjectKind: row.subjectKind,
    subjectId: row.subjectId,
    rootItemVersionId: row.rootItemVersionId,
    rootDisplayKey: displayKeyFor(row.rootItemVersionId),
    depth: row.depth,
    path: row.path.map(displayKeyFor),
    acknowledged: row.acknowledged,
  };
}

export function toExternalRefDTO(
  ref: ExternalRefInput,
  impact: ImpactRowDTO | null,
): ExternalRefDTO {
  return {
    id: ref.id,
    provider: ref.provider as ExternalRefDTO['provider'],
    externalId: ref.externalId,
    externalKey: ref.externalKey,
    externalUrl: ref.externalUrl,
    sourceArtifactVersionId: ref.sourceArtifactVersionId,
    sourceItemVersionId: ref.sourceItemVersionId,
    metadata: ref.metadata,
    createdAt: ref.createdAt.toISOString(),
    impact,
  };
}
