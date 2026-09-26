import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/github/ref
// (API Contracts section 8). The route no longer calls
// `artifact-lifecycle.getProjectById` (E4-T3, SCRUM-56 - `requireProjectOwner`
// alone proves the project exists and is owned), so that module isn't mocked
// here at all.
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getRefsForProject: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
}));

vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getRefsForProject, getDisplayKeysForItemVersions } from '@/external/operations';
import { checkDrift as checkGithubDrift } from '@/external/github';
import { GET } from '@/app/api/projects/[projectId]/github/ref/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetRefsForProject = vi.mocked(getRefsForProject);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedCheckGithubDrift = vi.mocked(checkGithubDrift);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function request() {
  return new Request('http://localhost/api/projects/project-1/github/ref');
}

describe('GET /api/projects/:projectId/github/ref', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetRefsForProject.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedCheckGithubDrift.mockReset();

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(404);
  });

  it('returns { ref: null } when there is no GitHub ref yet', async () => {
    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ref: null });
  });

  it('returns { ref } when a GitHub ref exists', async () => {
    mockedGetRefsForProject.mockResolvedValue([
      {
        id: 'ref-1',
        projectId: 'project-1',
        provider: 'github',
        externalId: 'ext-1',
        externalKey: 'org/repo',
        externalUrl: 'https://github.com/org/repo',
        sourceArtifactVersionId: 'arch-v1',
        sourceItemVersionId: null,
        metadata: {},
        createdAt: now,
      } as never,
    ]);
    mockedCheckGithubDrift.mockResolvedValue(null);

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ref).toMatchObject({ id: 'ref-1', provider: 'github', impact: null });
  });
});
