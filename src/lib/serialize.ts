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
