import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/artifacts/:type/
// versions and GET /api/projects/:projectId/artifacts/:type/current (API
// Contracts section 4). Mocks and the deliberately-real `_shared/*` glue follow
// tests/unit/api/artifact-version-route.test.ts.
const { FakeVersionNotDraftError, FakeApprovalGateBlockedError, FakeItemEditError } = vi.hoisted(
  () => {
    class FakeVersionNotDraftError extends Error {}
    class FakeApprovalGateBlockedError extends Error {}
    class FakeItemEditError extends Error {}
    return { FakeVersionNotDraftError, FakeApprovalGateBlockedError, FakeItemEditError };
  },
);

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
  listArtifactVersions: vi.fn(),
  getVersionRef: vi.fn(),
  getArtifactVersionDetail: vi.fn(),
  VersionNotDraftError: FakeVersionNotDraftError,
  ApprovalGateBlockedError: FakeApprovalGateBlockedError,
  ItemEditError: FakeItemEditError,
}));

vi.mock('@/artifact-types/requirements', () => ({ generate: vi.fn(), qualityGate: vi.fn() }));
vi.mock('@/artifact-types/architecture', () => ({
  generate: vi.fn(),
  getOptionsForVersion: vi.fn(),
}));
vi.mock('@/artifact-types/ui-requirements', () => ({ generate: vi.fn() }));
vi.mock('@/artifact-types/backlog', () => ({ generate: vi.fn(), qualityGate: vi.fn() }));

vi.mock('@/external/operations', () => ({ getDisplayKeysForItemVersions: vi.fn() }));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import {
  getProjectById,
  listArtifactVersions,
  getArtifactVersionDetail,
} from '@/artifact-lifecycle';
import { getOptionsForVersion } from '@/artifact-types/architecture';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { GET as GET_VERSIONS } from '@/app/api/projects/[projectId]/artifacts/[type]/versions/route';
import { GET as GET_CURRENT } from '@/app/api/projects/[projectId]/artifacts/[type]/current/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';
import {
  LATER,
  NOW,
  USER,
  makeDetail,
  makeItem,
  makeOption,
  makeProject,
  makeVersion,
} from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedListVersions = vi.mocked(listArtifactVersions);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedGetOptions = vi.mocked(getOptionsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

function paramsFor(type: string) {
  return { params: Promise.resolve({ projectId: 'project-1', type }) };
}

function resetMocks() {
  mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
  mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
  mockedGetProjectById.mockReset().mockResolvedValue(makeProject());
  mockedListVersions.mockReset().mockResolvedValue([]);
  mockedGetDetail.mockReset().mockResolvedValue(makeDetail());
  mockedGetOptions.mockReset().mockResolvedValue([]);
  mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
}

describe('GET /api/projects/:projectId/artifacts/:type/versions', () => {
  const url = 'http://localhost/api/projects/project-1/artifacts/requirements/versions';

  beforeEach(resetMocks);

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET_VERSIONS(new Request(url), paramsFor('requirements'));

    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) when the caller doesn't own the project", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET_VERSIONS(new Request(url), paramsFor('requirements'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedListVersions).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown :type, only AFTER the ownership check', async () => {
    const response = await GET_VERSIONS(new Request(url), paramsFor('roadmap'));

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockedListVersions).not.toHaveBeenCalled();
  });

  it("answers an unknown :type on someone else's project exactly like a valid one", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const validType = await GET_VERSIONS(new Request(url), paramsFor('requirements'));
    const unknownType = await GET_VERSIONS(new Request(url), paramsFor('roadmap'));

    expect(unknownType.status).toBe(validType.status);
    expect(await unknownType.json()).toEqual(await validType.json());
  });

  it('returns { versions: [] } for an artifact with no versions', async () => {
    const response = await GET_VERSIONS(new Request(url), paramsFor('backlog'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ versions: [] });
    expect(mockedListVersions).toHaveBeenCalledWith('project-1', 'backlog');
  });

  it('returns summaries (no items, no options, no projectId) in the order given, with ISO dates', async () => {
    mockedListVersions.mockResolvedValue([
      makeVersion({ id: 'v3', versionNumber: 3, status: 'draft', baseApprovedVersionId: 'v2' }),
      makeVersion({
        id: 'v2',
        versionNumber: 2,
        status: 'approved',
        baseApprovedVersionId: 'v1',
        selectedArchitectureOptionId: 'option-A',
      }),
      makeVersion({
        id: 'v1',
        versionNumber: 1,
        status: 'rejected',
        statusReason: 'stale_generation_context',
        rawOutput: { payload: {}, candidates: [] },
        payload: {},
      }),
    ]);

    const response = await GET_VERSIONS(new Request(url), paramsFor('requirements'));

    expect(response.status).toBe(200);
    const { versions } = await response.json();
    expect(versions.map((version: { id: string }) => version.id)).toEqual(['v3', 'v2', 'v1']);
    for (const version of versions) {
      expect(version).not.toHaveProperty('items');
      expect(version).not.toHaveProperty('options');
      expect(version).not.toHaveProperty('projectId');
      expect(version.createdAt).toBe(NOW.toISOString());
      expect(version.updatedAt).toBe(LATER.toISOString());
    }
    expect(versions[0]).toEqual({
      id: 'v3',
      artifactId: 'artifact-1',
      artifactType: 'requirements',
      versionNumber: 3,
      status: 'draft',
      statusReason: null,
      schemaVersion: 1,
      baseApprovedVersionId: 'v2',
      payload: { businessProblem: 'p' },
      rawOutput: null,
      selectedArchitectureOptionId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    expect(versions[1].selectedArchitectureOptionId).toBe('option-A');
    expect(versions[2].rawOutput).toEqual({ payload: {}, candidates: [] });
    // The summary list never loads a single item or option.
    expect(mockedGetDetail).not.toHaveBeenCalled();
    expect(mockedGetOptions).not.toHaveBeenCalled();
  });
});

describe('GET /api/projects/:projectId/artifacts/:type/current', () => {
  const url = 'http://localhost/api/projects/project-1/artifacts/requirements/current';

  beforeEach(resetMocks);

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET_CURRENT(new Request(url), paramsFor('requirements'));

    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) when the caller doesn't own the project", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET_CURRENT(new Request(url), paramsFor('requirements'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedGetProjectById).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown :type, only AFTER the ownership check', async () => {
    const response = await GET_CURRENT(new Request(url), paramsFor('roadmap'));

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockedGetProjectById).not.toHaveBeenCalled();
  });

  it('returns 404 when the project row is gone', async () => {
    mockedGetProjectById.mockResolvedValue(null);

    expect((await GET_CURRENT(new Request(url), paramsFor('requirements'))).status).toBe(404);
  });

  it('returns { version: null } when nothing of that type is approved yet', async () => {
    const response = await GET_CURRENT(new Request(url), paramsFor('requirements'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: null });
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });

  it('returns { version: null } when there is only a draft, not an approved version', async () => {
    const artifacts = emptyArtifactSummaries();
    artifacts.requirements.draftVersionId = 'draft-v1';
    mockedGetProjectById.mockResolvedValue({ ...makeProject(), artifacts });

    const response = await GET_CURRENT(new Request(url), paramsFor('requirements'));

    expect(await response.json()).toEqual({ version: null });
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });

  it("returns the approved version in full - resolved from THAT type's approvedVersionId", async () => {
    mockedGetProjectById.mockResolvedValue(
      makeProject({ requirements: 'req-v1', backlog: 'backlog-v4' }),
    );
    mockedGetDetail.mockResolvedValue(
      makeDetail({ id: 'backlog-v4', artifactType: 'backlog', status: 'approved' }, [
        makeItem({ itemType: 'epic', displayKey: 'E-01' }),
      ]),
    );

    const response = await GET_CURRENT(new Request(url), paramsFor('backlog'));

    expect(response.status).toBe(200);
    const { version } = await response.json();
    expect(mockedGetDetail).toHaveBeenCalledWith('backlog-v4');
    expect(version).toMatchObject({
      id: 'backlog-v4',
      artifactType: 'backlog',
      status: 'approved',
      options: null,
    });
    expect(version.items).toHaveLength(1);
    expect(version.items[0]).toMatchObject({ itemType: 'epic', displayKey: 'E-01', impact: null });
  });

  it('includes the options and the selected option id for the approved architecture version', async () => {
    mockedGetProjectById.mockResolvedValue(makeProject({ architecture: 'arch-v1' }));
    mockedGetDetail.mockResolvedValue(
      makeDetail({
        id: 'arch-v1',
        artifactType: 'architecture',
        status: 'approved',
        selectedArchitectureOptionId: 'option-B',
      }),
    );
    mockedGetOptions.mockResolvedValue([makeOption('A'), makeOption('B')]);

    const response = await GET_CURRENT(new Request(url), paramsFor('architecture'));

    const { version } = await response.json();
    expect(mockedGetOptions).toHaveBeenCalledWith('arch-v1');
    expect(version.selectedArchitectureOptionId).toBe('option-B');
    expect(version.options.map((option: { optionKey: string }) => option.optionKey)).toEqual([
      'A',
      'B',
    ]);
  });
});
