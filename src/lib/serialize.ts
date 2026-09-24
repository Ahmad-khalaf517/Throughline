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
