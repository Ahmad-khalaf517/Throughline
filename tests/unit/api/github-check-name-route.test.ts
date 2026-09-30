import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/github/check-name
// (API Contracts section 8).
const {
  FakeGithubLookupRejectedError,
  FakeGithubTargetRequiredError,
  FakeConnectionRequiredError,
  FakeReconnectRequiredError,
} = vi.hoisted(() => {
  class FakeGithubLookupRejectedError extends Error {}
  class FakeGithubTargetRequiredError extends Error {
    readonly target = 'githubOwner';
  }
  class FakeConnectionRequiredError extends Error {
    provider = 'github';
  }
  class FakeReconnectRequiredError extends Error {
    provider = 'github';
    reason = 'needs_reauth';
  }
  return {
    FakeGithubLookupRejectedError,
    FakeGithubTargetRequiredError,
    FakeConnectionRequiredError,
    FakeReconnectRequiredError,
  };
});

// The route's error translation imports `@/connections` (layer 3b), which is
// built on `@/db`/`@/lib/env`; stand-in error classes are enough for `instanceof`.
vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
}));

vi.mock('@/artifact-lifecycle', () => ({ getProjectById: vi.fn() }));

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/github', () => ({
  checkRepoName: vi.fn(),
  GithubLookupRejectedError: FakeGithubLookupRejectedError,
  GithubTargetRequiredError: FakeGithubTargetRequiredError,
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { checkRepoName } from '@/external/github';
import { POST } from '@/app/api/projects/[projectId]/github/check-name/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedCheckRepoName = vi.mocked(checkRepoName);
const mockedGetProjectById = vi.mocked(getProjectById);

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
    mockedGetProjectById.mockReset().mockResolvedValue({ githubOwner: 'acme' } as never);
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
      expect(mockedCheckRepoName).toHaveBeenCalledWith('My Repo', {
        userId: 'user-1',
        githubOwner: 'acme',
      });
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

  it('returns 409 TARGET_REQUIRED when the project has no GitHub owner', async () => {
    mockedCheckRepoName.mockRejectedValue(new FakeGithubTargetRequiredError('no owner'));

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('TARGET_REQUIRED');
    expect(body.error.details).toEqual({ target: 'githubOwner' });
  });

  it('returns 409 CONNECTION_REQUIRED / RECONNECT_REQUIRED from the caller connection', async () => {
    mockedCheckRepoName.mockRejectedValueOnce(new FakeConnectionRequiredError('none'));
    const missing = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));
    expect(missing.status).toBe(409);
    expect((await missing.json()).error.code).toBe('CONNECTION_REQUIRED');

    mockedCheckRepoName.mockRejectedValueOnce(new FakeReconnectRequiredError('lapsed'));
    const lapsed = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));
    expect(lapsed.status).toBe(409);
    expect((await lapsed.json()).error.code).toBe('RECONNECT_REQUIRED');
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
