import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/stitch/preview
// (API Contracts section 10).
const { FakeUiRequirementsVersionNotApprovedError } = vi.hoisted(() => {
  class FakeUiRequirementsVersionNotApprovedError extends Error {}
  return { FakeUiRequirementsVersionNotApprovedError };
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

vi.mock('@/external/stitch', () => ({
  previewPrompt: vi.fn(),
  checkDrift: vi.fn(),
  UiRequirementsVersionNotApprovedError: FakeUiRequirementsVersionNotApprovedError,
}));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { previewPrompt } from '@/external/stitch';
import { GET } from '@/app/api/projects/[projectId]/stitch/preview/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedPreviewPrompt = vi.mocked(previewPrompt);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function baseProject(uiApproved: string | null = 'ui-v1') {
  const artifacts = emptyArtifactSummaries();
  artifacts.ui_requirements.approvedVersionId = uiApproved;
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

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function request() {
  return new Request('http://localhost/api/projects/project-1/stitch/preview');
}

describe('GET /api/projects/:projectId/stitch/preview', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedPreviewPrompt.mockReset();

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

  it('returns 409 PREREQUISITE_NOT_APPROVED when UI Requirements has no approved version', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject(null));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when previewPrompt reports the version is not approved', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewPrompt.mockRejectedValue(
      new FakeUiRequirementsVersionNotApprovedError('not approved'),
    );

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 200 with prompt and impact on success', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewPrompt.mockResolvedValue({ prompt: 'Generate...', impact: [] });

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ prompt: 'Generate...', impact: [] });
    expect(mockedPreviewPrompt).toHaveBeenCalledWith('ui-v1');
  });
});
