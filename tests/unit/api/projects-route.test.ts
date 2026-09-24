import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test: mocks `@/auth` and `@/artifact-lifecycle`
// entirely, so no DB/env is ever touched - this exercises only the route's
// own logic (auth gate, zod validation, status codes, DTO serialization),
// per API Contracts section 3.
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  createProject: vi.fn(),
  getProjectById: vi.fn(),
  listProjectsForOwner: vi.fn(),
}));

import { getVerifiedUser } from '@/auth';
import { createProject, getProjectById, listProjectsForOwner } from '@/artifact-lifecycle';
import { GET, POST } from '@/app/api/projects/route';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedCreateProject = vi.mocked(createProject);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedListProjectsForOwner = vi.mocked(listProjectsForOwner);

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const now = new Date('2024-01-01T00:00:00.000Z');
const baseProjectRow = {
  id: 'p1',
  ownerUserId: 'user-1',
  name: 'x',
  brief: 'y',
  inputContext: null,
  createdAt: now,
  updatedAt: now,
};

describe('POST /api/projects', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedCreateProject.mockReset();
    mockedGetProjectById.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(postRequest({ name: 'x', brief: 'y' }));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedCreateProject).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when brief is missing', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com', displayName: null });

    const response = await POST(postRequest({ name: 'x' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedCreateProject).not.toHaveBeenCalled();
  });

  it('creates the project and returns 201 with a ProjectDTO', async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com', displayName: null });
    mockedCreateProject.mockResolvedValue(baseProjectRow);
    mockedGetProjectById.mockResolvedValue({
      ...baseProjectRow,
      artifacts: emptyArtifactSummaries(),
    });

    const response = await POST(postRequest({ name: 'x', brief: 'y' }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ id: 'p1', name: 'x', brief: 'y', createdAt: now.toISOString() });
    expect(body.artifacts.requirements).toEqual({ approvedVersionId: null, draftVersionId: null });
    expect(mockedCreateProject).toHaveBeenCalledWith('user-1', 'x', 'y', undefined);
  });
});

describe('GET /api/projects', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedListProjectsForOwner.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/projects'));

    expect(response.status).toBe(401);
  });

  it("lists only the caller's own projects", async () => {
    mockedGetVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'a@b.com', displayName: null });
    mockedListProjectsForOwner.mockResolvedValue([
      { ...baseProjectRow, artifacts: emptyArtifactSummaries() },
    ]);

    const response = await GET(new Request('http://localhost/api/projects'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].id).toBe('p1');
    expect(mockedListProjectsForOwner).toHaveBeenCalledWith('user-1');
  });
});
