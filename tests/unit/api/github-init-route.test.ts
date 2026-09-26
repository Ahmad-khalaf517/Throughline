import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/github/init
// (API Contracts section 8).
const {
  FakeArchitectureOptionNotSelectedError,
  FakeArchitectureVersionNotApprovedError,
  FakeGithubOperationRefusedError,
  FakeGithubOperationFailedError,
  FakeGithubOperationConflictError,
  FakeGithubReconciliationRequiredError,
  FakeGithubOperationInFlightError,
} = vi.hoisted(() => {
  class FakeArchitectureOptionNotSelectedError extends Error {}
  class FakeArchitectureVersionNotApprovedError extends Error {}
  class FakeGithubOperationRefusedError extends Error {}
  class FakeGithubOperationFailedError extends Error {}
  class FakeGithubOperationConflictError extends Error {}
  class FakeGithubReconciliationRequiredError extends Error {}
  class FakeGithubOperationInFlightError extends Error {}
  return {
    FakeArchitectureOptionNotSelectedError,
    FakeArchitectureVersionNotApprovedError,
    FakeGithubOperationRefusedError,
    FakeGithubOperationFailedError,
    FakeGithubOperationConflictError,
    FakeGithubReconciliationRequiredError,
    FakeGithubOperationInFlightError,
  };
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
  getOperationsForVersion: vi.fn(),
}));

vi.mock('@/external/github', () => ({
  previewInit: vi.fn(),
  initRepo: vi.fn(),
  checkDrift: vi.fn(),
  ArchitectureOptionNotSelectedError: FakeArchitectureOptionNotSelectedError,
  ArchitectureVersionNotApprovedError: FakeArchitectureVersionNotApprovedError,
  GithubOperationRefusedError: FakeGithubOperationRefusedError,
  GithubOperationFailedError: FakeGithubOperationFailedError,
  GithubOperationConflictError: FakeGithubOperationConflictError,
  GithubReconciliationRequiredError: FakeGithubReconciliationRequiredError,
  GithubOperationInFlightError: FakeGithubOperationInFlightError,
}));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  getRefsForVersion,
  getDisplayKeysForItemVersions,
  getOperationsForVersion,
} from '@/external/operations';
import { previewInit, initRepo, checkDrift as checkGithubDrift } from '@/external/github';
import { POST } from '@/app/api/projects/[projectId]/github/init/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetRefsForVersion = vi.mocked(getRefsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedGetOperationsForVersion = vi.mocked(getOperationsForVersion);
const mockedPreviewInit = vi.mocked(previewInit);
const mockedInitRepo = vi.mocked(initRepo);
const mockedCheckGithubDrift = vi.mocked(checkGithubDrift);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function baseProject() {
  const artifacts = emptyArtifactSummaries();
  artifacts.architecture.approvedVersionId = 'arch-v1';
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

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1/github/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe('POST /api/projects/:projectId/github/init', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetRefsForVersion.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedGetOperationsForVersion.mockReset().mockResolvedValue([]);
    mockedPreviewInit.mockReset();
    mockedInitRepo.mockReset();
    mockedCheckGithubDrift.mockReset().mockResolvedValue(null);

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewInit.mockResolvedValue({ mode: 'docs-only', repoName: 'suggested', impact: [] });
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 VALIDATION_ERROR when impactAcknowledged is missing', async () => {
    const response = await POST(postRequest({ repoName: 'x' }), paramsFor('project-1'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when Architecture has no approved version', async () => {
    const project = baseProject();
    project.artifacts.architecture.approvedVersionId = null;
    mockedGetProjectById.mockResolvedValue(project);

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when previewInit reports the version is not approved', async () => {
    mockedPreviewInit.mockRejectedValue(
      new FakeArchitectureVersionNotApprovedError('not approved'),
    );

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 IMPACT_NOT_ACKNOWLEDGED with details.impact when impact exists and is unacknowledged', async () => {
    mockedPreviewInit.mockResolvedValue({
      mode: 'docs-only',
      repoName: 'suggested',
      impact: [
        {
          subjectKind: 'item_version',
          subjectId: 'iv-1',
          rootItemVersionId: 'iv-1',
          depth: 0,
          path: ['iv-1'],
          acknowledged: false,
        },
      ],
    });
    mockedGetDisplayKeys.mockResolvedValue(new Map([['iv-1', 'ADR-01']]));

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: false }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('IMPACT_NOT_ACKNOWLEDGED');
    expect(body.error.details.impact[0]).toMatchObject({ rootDisplayKey: 'ADR-01' });
    expect(mockedInitRepo).not.toHaveBeenCalled();
  });

  it('returns 200 { status: completed, ref } on success', async () => {
    mockedInitRepo.mockResolvedValue(makeRef());

    const response = await POST(
      postRequest({ repoName: 'my-repo', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'completed', ref: { id: 'ref-1', provider: 'github' } });
    expect(mockedInitRepo).toHaveBeenCalledWith('arch-v1', 'my-repo');
  });

  it('returns 409 GITHUB_ALREADY_INITIALIZED when the operation was refused', async () => {
    mockedInitRepo.mockRejectedValue(
      new FakeGithubOperationRefusedError('github_operation_already_active'),
    );

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('GITHUB_ALREADY_INITIALIZED');
  });

  it('returns 409 NAME_TAKEN_BY_OTHER when the operation failed definitively', async () => {
    mockedInitRepo.mockRejectedValue(new FakeGithubOperationFailedError('name_taken_by_other'));

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('NAME_TAKEN_BY_OTHER');
  });

  it('returns 409 REQUEST_CONFLICT when the request hash no longer matches', async () => {
    mockedInitRepo.mockRejectedValue(new FakeGithubOperationConflictError('key'));

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('REQUEST_CONFLICT');
  });

  it('returns 202 { status: reconciliation_required, operationId }', async () => {
    mockedInitRepo.mockRejectedValue(new FakeGithubReconciliationRequiredError('key'));
    mockedGetOperationsForVersion.mockResolvedValue([
      { id: 'op-active', status: 'reconciliation_required' } as never,
    ]);

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ status: 'reconciliation_required', operationId: 'op-active' });
  });

  it('returns 202 { status: pending, operationId }', async () => {
    mockedInitRepo.mockRejectedValue(new FakeGithubOperationInFlightError('key'));
    mockedGetOperationsForVersion.mockResolvedValue([
      { id: 'op-active', status: 'pending' } as never,
    ]);

    const response = await POST(
      postRequest({ repoName: 'x', impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ status: 'pending', operationId: 'op-active' });
  });
});
