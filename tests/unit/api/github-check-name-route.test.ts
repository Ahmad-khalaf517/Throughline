import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/github/check-name
// (API Contracts section 8).
const { FakeGithubLookupRejectedError } = vi.hoisted(() => {
  class FakeGithubLookupRejectedError extends Error {}
  return { FakeGithubLookupRejectedError };
});

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/github', () => ({
  checkRepoName: vi.fn(),
  GithubLookupRejectedError: FakeGithubLookupRejectedError,
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { checkRepoName } from '@/external/github';
import { POST } from '@/app/api/projects/[projectId]/github/check-name/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedCheckRepoName = vi.mocked(checkRepoName);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1/github/check-name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe('POST /api/projects/:projectId/github/check-name', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(user);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedCheckRepoName.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user, without touching GitHub', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(401);
    expect(mockedCheckRepoName).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project, without touching GitHub', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(404);
    expect(mockedCheckRepoName).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for an empty repoName', async () => {
    const response = await POST(postRequest({ repoName: '' }), paramsFor('project-1'));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockedCheckRepoName).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for a body that is not JSON', async () => {
    const response = await POST(postRequest('not json'), paramsFor('project-1'));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['available', 'taken', 'invalid'] as const)(
    'returns 200 with the normalized name and status %s',
    async (status) => {
      mockedCheckRepoName.mockResolvedValue({ repoName: 'my-repo', status });

      const response = await POST(postRequest({ repoName: 'My Repo' }), paramsFor('project-1'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ repoName: 'my-repo', status });
      expect(mockedCheckRepoName).toHaveBeenCalledWith('My Repo');
    },
  );

  it("returns 502 GITHUB_REQUEST_REJECTED with GitHub's reason when the lookup is refused (e.g. bad token)", async () => {
    const reason = 'GitHub rejected the configured GITHUB_TOKEN (401: Bad credentials)';
    mockedCheckRepoName.mockRejectedValue(new FakeGithubLookupRejectedError(reason));

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toEqual({ code: 'GITHUB_REQUEST_REJECTED', message: reason });
  });

  it('returns the generic 500 INTERNAL_ERROR for anything unexpected, never leaking the cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedCheckRepoName.mockRejectedValue(new Error('socket hang up'));

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('socket hang up');
    consoleError.mockRestore();
  });
});
