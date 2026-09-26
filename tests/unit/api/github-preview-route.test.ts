import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/github/preview
// (API Contracts section 8).
const { FakeArchitectureOptionNotSelectedError, FakeArchitectureVersionNotApprovedError } =
  vi.hoisted(() => {
    class FakeArchitectureOptionNotSelectedError extends Error {}
    class FakeArchitectureVersionNotApprovedError extends Error {}
    return { FakeArchitectureOptionNotSelectedError, FakeArchitectureVersionNotApprovedError };
  });

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

vi.mock('@/external/github', () => ({
  previewInit: vi.fn(),
  checkDrift: vi.fn(),
  ArchitectureOptionNotSelectedError: FakeArchitectureOptionNotSelectedError,
  ArchitectureVersionNotApprovedError: FakeArchitectureVersionNotApprovedError,
}));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getRefsForVersion, getDisplayKeysForItemVersions } from '@/external/operations';
import { previewInit } from '@/external/github';
import { POST } from '@/app/api/projects/[projectId]/github/preview/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetRefsForVersion = vi.mocked(getRefsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedPreviewInit = vi.mocked(previewInit);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function baseProject(architectureApproved: string | null = 'arch-v1') {
  const artifacts = emptyArtifactSummaries();
  artifacts.architecture.approvedVersionId = architectureApproved;
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

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1/github/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe('POST /api/projects/:projectId/github/preview', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetRefsForVersion.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedPreviewInit.mockReset();

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 VALIDATION_ERROR when repoName is missing', async () => {
    const response = await POST(postRequest({}), paramsFor('project-1'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when Architecture has no approved version', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject(null));

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 GITHUB_ALREADY_INITIALIZED when the project already has a GitHub ref', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedGetRefsForVersion.mockResolvedValue([
      { id: 'ref-1', provider: 'github', sourceArtifactVersionId: 'arch-v1' },
    ] as never);

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('GITHUB_ALREADY_INITIALIZED');
    expect(mockedPreviewInit).not.toHaveBeenCalled();
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when previewInit reports no selected option', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewInit.mockRejectedValue(
      new FakeArchitectureOptionNotSelectedError('none selected'),
    );

    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 200 with mode/repoName/impact on success, ignoring the request repoName', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewInit.mockResolvedValue({
      mode: 'docs-only',
      repoName: 'throughline-project-project-1',
      impact: [],
    });

    const response = await POST(
      postRequest({ repoName: 'my-custom-name' }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      mode: 'docs-only',
      repoName: 'throughline-project-project-1',
      impact: [],
    });
    expect(mockedPreviewInit).toHaveBeenCalledWith('arch-v1');
  });
});
