// Plain fixture builders shared by the artifact/version/item-edit route tests
// (E3-S10). Deliberately NOT a `*.test.ts` file and never calls `vi.mock`:
// each route test file declares its own hoisted mocks (vitest only hoists
// `vi.mock` inside the file that contains it). Everything here is data shaped
// like what the mocked `@/artifact-lifecycle` / `@/artifact-types/architecture`
// reads return.
import type {
  ArtifactVersionDetail,
  ArtifactVersionRef,
  ImpactRow,
  ProjectWithArtifacts,
  VersionItem,
} from '@/artifact-lifecycle';
import type { ArchitectureOption } from '@/artifact-types/architecture';
import { emptyArtifactSummaries, type ArtifactType } from '@/lib/serialize';

export const NOW = new Date('2024-01-01T00:00:00.000Z');
export const LATER = new Date('2024-01-02T00:00:00.000Z');

export const USER = { id: 'user-1', email: 'a@b.com', displayName: null };

/** A well-formed uuid: `:logicalItemId` is shape-checked by the route before anything is mocked. */
export const LOGICAL_ITEM_ID = '5b0c1f7e-3b1d-4a6e-9a55-0c7f4e2d9a10';

export function makeProject(
  approved: Partial<Record<ArtifactType, string>> = {},
): ProjectWithArtifacts {
  const artifacts = emptyArtifactSummaries();
  for (const [type, versionId] of Object.entries(approved)) {
    artifacts[type as ArtifactType].approvedVersionId = versionId;
  }
  return {
    id: 'project-1',
    ownerUserId: 'user-1',
    name: 'x',
    brief: 'y',
    inputContext: null,
    createdAt: NOW,
    updatedAt: NOW,
    artifacts,
  };
}

export function makeRef(overrides: Partial<ArtifactVersionRef> = {}): ArtifactVersionRef {
  return {
    versionId: 'version-1',
    artifactId: 'artifact-1',
    projectId: 'project-1',
    artifactType: 'requirements',
    ...overrides,
  };
}

export function makeVersion(
  overrides: Partial<ArtifactVersionDetail['version']> = {},
): ArtifactVersionDetail['version'] {
  return {
    id: 'version-1',
    artifactId: 'artifact-1',
    projectId: 'project-1',
    artifactType: 'requirements',
    versionNumber: 1,
    status: 'draft',
    statusReason: null,
    schemaVersion: 1,
    baseApprovedVersionId: null,
    selectedArchitectureOptionId: null,
    payload: { businessProblem: 'p' },
    rawOutput: null,
    createdAt: NOW,
    updatedAt: LATER,
    ...overrides,
  };
}

export function makeItem(overrides: Partial<VersionItem> = {}): VersionItem {
  return {
    itemVersionId: 'iv-1',
    logicalItemId: LOGICAL_ITEM_ID,
    displayKey: 'R-01',
    itemType: 'requirement',
    revisionNumber: 1,
    payload: { behavior: 'b' },
    parentLogicalItemId: null,
    impact: null,
    ...overrides,
  };
}

export function makeDetail(
  version: Partial<ArtifactVersionDetail['version']> = {},
  items: VersionItem[] = [],
): ArtifactVersionDetail {
  return { version: makeVersion(version), items };
}

export function makeImpactRow(overrides: Partial<ImpactRow> = {}): ImpactRow {
  return {
    subjectKind: 'item_version',
    subjectId: 'iv-1',
    rootItemVersionId: 'iv-root',
    depth: 1,
    path: ['iv-root', 'iv-1'],
    acknowledged: false,
    ...overrides,
  };
}

export function makeOption(
  optionKey: 'A' | 'B',
  overrides: Partial<ArchitectureOption> = {},
): ArchitectureOption {
  return {
    id: `option-${optionKey}`,
    artifactVersionId: 'version-1',
    optionKey,
    title: `Option ${optionKey}`,
    summary: `Summary ${optionKey}`,
    stack: { frontend: 'next' },
    candidateDecisions: [{ title: 'd' }],
    tradeoffs: [{ factor: 'cost', assessment: 'low' }],
    createdAt: NOW,
    ...overrides,
  };
}

export function jsonRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function rawRequest(method: string, url: string, body: string): Request {
  return new Request(url, { method, headers: { 'content-type': 'application/json' }, body });
}
