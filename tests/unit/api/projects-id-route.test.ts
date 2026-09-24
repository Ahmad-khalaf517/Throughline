import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET/PATCH /api/projects/:projectId, in the
// same style as projects-route.test.ts: `@/auth` and `@/artifact-lifecycle`
// are mocked wholesale, so no DB/env is ever touched - this exercises only
// the route's own logic (auth gate, ownership gate, zod validation, the
// BriefFrozenError -> 409 BRIEF_FROZEN translation) per API Contracts
// section 3.
//
// A stand-in for artifact-lifecycle's real BriefFrozenError - the route only
// needs `instanceof` to work against whatever `@/artifact-lifecycle` exports
// under that name, and the real module can't be imported here without a live
// DB connection (it's built on top of `@/db`). Declared via `vi.hoisted` so
// it's initialized before the hoisted `vi.mock` factories below run (`vi.mock`
// calls are hoisted above all other top-level statements, including plain
// `class`/`const` declarations, which would otherwise throw a TDZ error).
const { FakeBriefFrozenError } = vi.hoisted(() => {
  class FakeBriefFrozenError extends Error {}
  return { FakeBriefFrozenError };
});

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
  updateProject: vi.fn(),
  BriefFrozenError: FakeBriefFrozenError,
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById, updateProject } from '@/artifact-lifecycle';
import { GET, PATCH } from '@/app/api/projects/[projectId]/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedUpdateProject = vi.mocked(updateProject);

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function patchRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const now = new Date('2024-01-01T00:00:00.000Z');
const baseProject = {
  id: 'project-1',
  ownerUserId: 'user-1',
  name: 'x',
  brief: 'y',
  inputContext: null,
  createdAt: now,
  updatedAt: now,
  artifacts: emptyArtifactSummaries(),
};

describe('GET /api/projects/:projectId', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/projects/project-1'),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND when the project does not exist or is not the caller's (API Contracts 1.4 - never 403)", async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(
      new Request('http://localhost/api/projects/project-1'),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockedGetProjectById).not.toHaveBeenCalled();
  });

  it('returns 200 with a ProjectDTO when the caller owns the project', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedGetProjectById.mockResolvedValue(baseProject);

    const response = await GET(
      new Request('http://localhost/api/projects/project-1'),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'project-1', name: 'x', brief: 'y' });
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
  });
});

describe('PATCH /api/projects/:projectId', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedUpdateProject.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await PATCH(patchRequest({ name: 'Renamed' }), paramsFor('project-1'));

    expect(response.status).toBe(401);
    expect(mockedUpdateProject).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the caller does not own the project', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await PATCH(patchRequest({ name: 'Renamed' }), paramsFor('project-1'));

    expect(response.status).toBe(404);
    expect(mockedUpdateProject).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for an empty-string name', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedRequireProjectOwner.mockResolvedValue(undefined);

    const response = await PATCH(patchRequest({ name: '' }), paramsFor('project-1'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedUpdateProject).not.toHaveBeenCalled();
  });

  it('returns 409 BRIEF_FROZEN when artifact-lifecycle signals the brief is frozen (INV-007/T33)', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedUpdateProject.mockRejectedValue(new FakeBriefFrozenError('frozen'));

    const response = await PATCH(patchRequest({ brief: 'new brief' }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('BRIEF_FROZEN');
  });

  it('returns 200 with the updated ProjectDTO on success', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedUpdateProject.mockResolvedValue({ ...baseProject, name: 'Renamed' });

    const response = await PATCH(patchRequest({ name: 'Renamed' }), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe('Renamed');
    expect(mockedUpdateProject).toHaveBeenCalledWith('project-1', { name: 'Renamed' });
  });
});
