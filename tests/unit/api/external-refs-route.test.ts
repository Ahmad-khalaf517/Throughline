import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/external-refs
// (API Contracts section 7), same style as tests/unit/api/projects-route.test.ts:
// `@/auth`/`@/artifact-lifecycle`/`@/external/*` are mocked wholesale, so no
// DB/env is ever touched. The shared `_shared/external.ts` helper is left
// real (not mocked) - it's pure route-serving glue, this exercises it too -
// but every module IT imports (`@/external/operations`/`github`/`jira`/
// `stitch`) must still be mocked here, since it statically imports all of
// them regardless of which provider a given ref actually uses.
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getRefsForVersion: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
}));

vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getRefsForVersion, getDisplayKeysForItemVersions } from '@/external/operations';
import { checkDrift as checkGithubDrift } from '@/external/github';
import { checkDrift as checkJiraDrift } from '@/external/jira';
import { checkDrift as checkStitchDrift } from '@/external/stitch';
import { GET } from '@/app/api/projects/[projectId]/external-refs/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetRefsForVersion = vi.mocked(getRefsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedCheckGithubDrift = vi.mocked(checkGithubDrift);
const mockedCheckJiraDrift = vi.mocked(checkJiraDrift);
const mockedCheckStitchDrift = vi.mocked(checkStitchDrift);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function baseProject() {
  const artifacts = emptyArtifactSummaries();
  artifacts.architecture.approvedVersionId = 'arch-v1';
  artifacts.backlog.approvedVersionId = 'backlog-v1';
  return {
    id: 'project-1',
    ownerUserId: 'user-1',
    name: 'x',
    brief: 'y',
    inputContext: null,
    createdAt: now,
    updatedAt: now,
    artifacts,
  };
}

function makeRef(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ref-1',
    projectId: 'project-1',
    provider: 'github',
    externalId: 'ext-1',
    externalKey: 'org/repo',
    externalUrl: 'https://github.com/org/repo',
    sourceArtifactVersionId: 'arch-v1',
    sourceItemVersionId: null,
    externalOperationId: 'op-1',
    metadata: {},
    createdAt: now,
    ...overrides,
  };
}

function request() {
  return new Request('http://localhost/api/projects/project-1/external-refs');
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe('GET /api/projects/:projectId/external-refs', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetRefsForVersion.mockReset();
    mockedGetDisplayKeys.mockReset();
    mockedCheckGithubDrift.mockReset();
    mockedCheckJiraDrift.mockReset();
    mockedCheckStitchDrift.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the caller does not own the project (never 403)', async () => {
    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockedGetProjectById).not.toHaveBeenCalled();
  });

  it('returns {refs: []} when the project has no approved versions', async () => {
    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    const project = { ...baseProject(), artifacts: emptyArtifactSummaries() };
    mockedGetProjectById.mockResolvedValue(project);

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ refs: [] });
    expect(mockedGetRefsForVersion).not.toHaveBeenCalled();
  });

  it('merges refs across every non-null approved version and resolves drift + display keys', async () => {
    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedGetProjectById.mockResolvedValue(baseProject());

    const githubRef = makeRef({
      id: 'ref-github',
      provider: 'github',
      sourceArtifactVersionId: 'arch-v1',
    });
    mockedGetRefsForVersion.mockImplementation(async (versionId: string) => {
      if (versionId === 'arch-v1') return [githubRef];
      if (versionId === 'backlog-v1') return [];
      return [];
    });
    mockedCheckGithubDrift.mockResolvedValue({
      subjectKind: 'external_ref',
      subjectId: 'ref-github',
      rootItemVersionId: 'iv-req-1',
      depth: 1,
      path: ['iv-req-1', 'iv-req-1'],
      acknowledged: false,
    });
    mockedGetDisplayKeys.mockResolvedValue(new Map([['iv-req-1', 'R-01']]));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mockedGetRefsForVersion).toHaveBeenCalledWith('arch-v1');
    expect(mockedGetRefsForVersion).toHaveBeenCalledWith('backlog-v1');
    expect(body.refs).toHaveLength(1);
    expect(body.refs[0]).toMatchObject({
      id: 'ref-github',
      provider: 'github',
      impact: {
        subjectKind: 'external_ref',
        subjectId: 'ref-github',
        rootItemVersionId: 'iv-req-1',
        rootDisplayKey: 'R-01',
        path: ['R-01', 'R-01'],
        acknowledged: false,
      },
    });
    expect(mockedCheckStitchDrift).not.toHaveBeenCalled();
  });
});
