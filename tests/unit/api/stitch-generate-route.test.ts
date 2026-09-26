import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/stitch/generate
// (API Contracts section 10).
const {
  FakeUiRequirementsVersionNotApprovedError,
  FakeAlreadyGeneratedError,
  FakeStitchReconciliationRequiredError,
  FakeStitchOperationInFlightError,
  FakeStitchOperationConflictError,
} = vi.hoisted(() => {
  class FakeUiRequirementsVersionNotApprovedError extends Error {}
  class FakeAlreadyGeneratedError extends Error {}
  class FakeStitchReconciliationRequiredError extends Error {}
  class FakeStitchOperationInFlightError extends Error {}
  class FakeStitchOperationConflictError extends Error {}
  return {
    FakeUiRequirementsVersionNotApprovedError,
    FakeAlreadyGeneratedError,
    FakeStitchReconciliationRequiredError,
    FakeStitchOperationInFlightError,
    FakeStitchOperationConflictError,
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

vi.mock('@/external/stitch', () => ({
  previewPrompt: vi.fn(),
  generate: vi.fn(),
  getSignedAssetUrls: vi.fn(),
  checkDrift: vi.fn(),
  UiRequirementsVersionNotApprovedError: FakeUiRequirementsVersionNotApprovedError,
  AlreadyGeneratedError: FakeAlreadyGeneratedError,
  StitchReconciliationRequiredError: FakeStitchReconciliationRequiredError,
  StitchOperationInFlightError: FakeStitchOperationInFlightError,
  StitchOperationConflictError: FakeStitchOperationConflictError,
}));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  getRefsForVersion,
  getDisplayKeysForItemVersions,
  getOperationsForVersion,
} from '@/external/operations';
import {
  previewPrompt,
  generate,
  getSignedAssetUrls,
  checkDrift as checkStitchDrift,
} from '@/external/stitch';
import { POST } from '@/app/api/projects/[projectId]/stitch/generate/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetRefsForVersion = vi.mocked(getRefsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedGetOperationsForVersion = vi.mocked(getOperationsForVersion);
const mockedPreviewPrompt = vi.mocked(previewPrompt);
const mockedGenerate = vi.mocked(generate);
const mockedGetSignedAssetUrls = vi.mocked(getSignedAssetUrls);
const mockedCheckStitchDrift = vi.mocked(checkStitchDrift);

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

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1/stitch/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe('POST /api/projects/:projectId/stitch/generate', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetRefsForVersion.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedGetOperationsForVersion.mockReset().mockResolvedValue([]);
    mockedPreviewPrompt.mockReset();
    mockedGenerate.mockReset();
    mockedGetSignedAssetUrls.mockReset();
    mockedCheckStitchDrift.mockReset().mockResolvedValue(null);

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewPrompt.mockResolvedValue({ prompt: 'Generate...', impact: [] });
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(404);
  });

  it('returns 400 VALIDATION_ERROR when impactAcknowledged is missing', async () => {
    const response = await POST(postRequest({}), paramsFor('project-1'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when UI Requirements has no approved version', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject(null));

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 IMPACT_NOT_ACKNOWLEDGED with details.impact when impact is unacknowledged', async () => {
    mockedPreviewPrompt.mockResolvedValue({
      prompt: 'Generate...',
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
    mockedGetDisplayKeys.mockResolvedValue(new Map([['iv-1', 'UI-01']]));

    const response = await POST(postRequest({ impactAcknowledged: false }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('IMPACT_NOT_ACKNOWLEDGED');
    expect(body.error.details.impact[0]).toMatchObject({ rootDisplayKey: 'UI-01' });
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it('returns 200 { mode: api, ref, htmlUrl, screenshotUrl } on success', async () => {
    mockedGenerate.mockResolvedValue({ id: 'stitch-1', mode: 'api' } as never);
    mockedGetRefsForVersion.mockResolvedValue([
      {
        id: 'ref-1',
        projectId: 'project-1',
        provider: 'stitch',
        externalId: 'ext-1',
        externalKey: null,
        externalUrl: null,
        sourceArtifactVersionId: 'ui-v1',
        sourceItemVersionId: null,
        metadata: {},
        createdAt: now,
      } as never,
    ]);
    mockedGetSignedAssetUrls.mockResolvedValue({
      htmlUrl: 'https://signed/html',
      screenshotUrl: 'https://signed/screenshot',
    });

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      mode: 'api',
      ref: { id: 'ref-1', provider: 'stitch' },
      htmlUrl: 'https://signed/html',
      screenshotUrl: 'https://signed/screenshot',
    });
  });

  it('returns 200 { mode: manual_fallback, promptText } - never an error (FR-054)', async () => {
    mockedGenerate.mockResolvedValue({
      id: 'stitch-1',
      mode: 'manual_fallback',
      promptText: 'Generate...',
    } as never);

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ mode: 'manual_fallback', promptText: 'Generate...' });
  });

  it('returns 409 ALREADY_GENERATED when a Stitch output already exists', async () => {
    mockedGenerate.mockRejectedValue(new FakeAlreadyGeneratedError('already generated'));

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('ALREADY_GENERATED');
  });

  it('returns 409 REQUEST_CONFLICT when the request hash no longer matches', async () => {
    mockedGenerate.mockRejectedValue(new FakeStitchOperationConflictError('key'));

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('REQUEST_CONFLICT');
  });

  it('returns 202 { status: reconciliation_required, operationId }', async () => {
    mockedGenerate.mockRejectedValue(new FakeStitchReconciliationRequiredError('key'));
    mockedGetOperationsForVersion.mockResolvedValue([
      { id: 'op-active', status: 'reconciliation_required' } as never,
    ]);

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ status: 'reconciliation_required', operationId: 'op-active' });
  });

  it('returns 202 { status: pending, operationId }', async () => {
    mockedGenerate.mockRejectedValue(new FakeStitchOperationInFlightError('key'));
    mockedGetOperationsForVersion.mockResolvedValue([
      { id: 'op-active', status: 'pending' } as never,
    ]);

    const response = await POST(postRequest({ impactAcknowledged: true }), paramsFor('project-1'));

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ status: 'pending', operationId: 'op-active' });
  });
});
