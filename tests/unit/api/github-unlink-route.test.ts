import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for DELETE /api/projects/:projectId/github
// (API Contracts section 8, UC-S10, TR FR-091).
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  unlinkGithubRepository: vi.fn(),
  UnlinkBlockedError: class UnlinkBlockedError extends Error {},
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { unlinkGithubRepository, UnlinkBlockedError } from '@/external/operations';
import { DELETE } from '@/app/api/projects/[projectId]/github/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedUnlink = vi.mocked(unlinkGithubRepository);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function request() {
  return new Request('http://localhost/api/projects/project-1/github', { method: 'DELETE' });
}

describe('DELETE /api/projects/:projectId/github', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(user);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedUnlink.mockReset();
  });

  it('returns 401 UNAUTHENTICATED with no verified user, and unlinks nothing', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await DELETE(request(), paramsFor('project-1'));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND (never 403) for a project the caller does not own, and unlinks nothing', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await DELETE(request(), paramsFor('project-1'));

    expect(response.status).toBe(404);
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('returns 200 { removed, note } saying the repository still exists on GitHub', async () => {
    mockedUnlink.mockResolvedValue({
      name: 'octo/my-repo',
      url: 'https://github.com/octo/my-repo',
    });

    const response = await DELETE(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      removed: { name: 'octo/my-repo', url: 'https://github.com/octo/my-repo' },
      note: 'The repository still exists on GitHub. Delete it there if you no longer need it.',
    });
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockedUnlink).toHaveBeenCalledWith('project-1');
  });

  it('returns 404 NOT_FOUND when nothing is linked', async () => {
    mockedUnlink.mockResolvedValue(null);

    const response = await DELETE(request(), paramsFor('project-1'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 409 UNLINK_BLOCKED while a GitHub operation is in flight', async () => {
    mockedUnlink.mockRejectedValue(new UnlinkBlockedError());

    const response = await DELETE(request(), paramsFor('project-1'));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('UNLINK_BLOCKED');
  });

  it('returns a generic 500 for an unexpected failure', async () => {
    mockedUnlink.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await DELETE(request(), paramsFor('project-1'));

    expect(response.status).toBe(500);
  });
});
