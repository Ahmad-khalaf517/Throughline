import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/external-operations/:operationId/retry
// (API Contracts section 7). Fake Error subclasses via `vi.hoisted` (same
// technique as tests/unit/api/projects-id-route.test.ts's `FakeBriefFrozenError`)
// since the real provider modules can't be imported here (they're built on
// top of `@/db`/`@/lib/env`). The shared `_shared/external` helper is real,
// so `@/external/github`/`jira`/`stitch` must each export a `checkDrift` too.
const {
  FakeGithubReconciliationRequiredError,
  FakeGithubOperationInFlightError,
  FakeGithubOperationConflictError,
  FakeStitchReconciliationRequiredError,
  FakeStitchOperationInFlightError,
  FakeStitchOperationConflictError,
} = vi.hoisted(() => {
  class FakeGithubReconciliationRequiredError extends Error {}
  class FakeGithubOperationInFlightError extends Error {}
  class FakeGithubOperationConflictError extends Error {}
  class FakeStitchReconciliationRequiredError extends Error {}
  class FakeStitchOperationInFlightError extends Error {}
  class FakeStitchOperationConflictError extends Error {}
  return {
    FakeGithubReconciliationRequiredError,
    FakeGithubOperationInFlightError,
    FakeGithubOperationConflictError,
    FakeStitchReconciliationRequiredError,
    FakeStitchOperationInFlightError,
    FakeStitchOperationConflictError,
  };
});

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getOperationById: vi.fn(),
  getRefForItem: vi.fn(),
  getRefsForVersion: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
}));

vi.mock('@/external/github', () => ({
  initRepo: vi.fn(),
  checkDrift: vi.fn(),
  GithubReconciliationRequiredError: FakeGithubReconciliationRequiredError,
  GithubOperationInFlightError: FakeGithubOperationInFlightError,
  GithubOperationConflictError: FakeGithubOperationConflictError,
}));

vi.mock('@/external/jira', () => ({
  exportBacklog: vi.fn(),
  checkDrift: vi.fn(),
}));

vi.mock('@/external/stitch', () => ({
  generate: vi.fn(),
  checkDrift: vi.fn(),
  StitchReconciliationRequiredError: FakeStitchReconciliationRequiredError,
  StitchOperationInFlightError: FakeStitchOperationInFlightError,
  StitchOperationConflictError: FakeStitchOperationConflictError,
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import {
  getOperationById,
  getRefForItem,
  getRefsForVersion,
  getDisplayKeysForItemVersions,
} from '@/external/operations';
import { initRepo, checkDrift as checkGithubDrift } from '@/external/github';
import { exportBacklog, checkDrift as checkJiraDrift } from '@/external/jira';
import { generate, checkDrift as checkStitchDrift } from '@/external/stitch';
import { POST } from '@/app/api/external-operations/[operationId]/retry/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetOperationById = vi.mocked(getOperationById);
const mockedGetRefForItem = vi.mocked(getRefForItem);
const mockedGetRefsForVersion = vi.mocked(getRefsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedInitRepo = vi.mocked(initRepo);
const mockedExportBacklog = vi.mocked(exportBacklog);
const mockedGenerate = vi.mocked(generate);
const mockedCheckGithubDrift = vi.mocked(checkGithubDrift);
const mockedCheckJiraDrift = vi.mocked(checkJiraDrift);
const mockedCheckStitchDrift = vi.mocked(checkStitchDrift);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function makeOperation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'op-1',
    projectId: 'project-1',
    provider: 'github',
    operationType: 'create_repo',
    operationKey: 'github:create_repo:project-1:repo',
    status: 'failed',
    requestHash: 'hash',
    sourceArtifactVersionId: 'arch-v1',
    sourceItemVersionId: null,
    targetDescriptor: { repoName: 'my-repo' },
    externalId: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
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

function paramsFor(operationId: string) {
  return { params: Promise.resolve({ operationId }) };
}

function request() {
  return new Request('http://localhost/api/external-operations/op-1/retry', { method: 'POST' });
}

describe('POST /api/external-operations/:operationId/retry', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetOperationById.mockReset();
    mockedGetRefForItem.mockReset();
    mockedGetRefsForVersion.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedInitRepo.mockReset();
    mockedExportBacklog.mockReset();
    mockedGenerate.mockReset();
    mockedCheckGithubDrift.mockReset().mockResolvedValue(null);
    mockedCheckJiraDrift.mockReset().mockResolvedValue(null);
    mockedCheckStitchDrift.mockReset().mockResolvedValue(null);

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(request(), paramsFor('op-1'));

    expect(response.status).toBe(401);
    expect(mockedGetOperationById).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the operation does not exist', async () => {
    mockedGetOperationById.mockResolvedValue(null);

    const response = await POST(request(), paramsFor('op-1'));

    expect(response.status).toBe(404);
  });

  it("returns 404 NOT_FOUND (never 403) when the caller does not own the operation's project", async () => {
    mockedGetOperationById.mockResolvedValue(makeOperation());
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await POST(request(), paramsFor('op-1'));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  describe('github', () => {
    it('returns 200 { status: completed, ref } on success', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedInitRepo.mockResolvedValue(makeRef());

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: 'completed', ref: { id: 'ref-1', provider: 'github' } });
      expect(mockedInitRepo).toHaveBeenCalledWith('arch-v1', 'my-repo');
    });

    it('returns 200 { status: reconciliation_required } (not 202) per section 7', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedInitRepo.mockRejectedValue(new FakeGithubReconciliationRequiredError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'reconciliation_required' });
    });

    it('returns 200 { status: pending } for an in-flight operation', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedInitRepo.mockRejectedValue(new FakeGithubOperationInFlightError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'pending' });
    });

    it('returns 409 REQUEST_CONFLICT when the retry no longer matches the stored request hash', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedInitRepo.mockRejectedValue(new FakeGithubOperationConflictError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('REQUEST_CONFLICT');
    });

    it('KNOWN GAP: falls through to 500 INTERNAL_ERROR for a definitive provider failure', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedInitRepo.mockRejectedValue(new Error('name_taken_by_other'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('stitch', () => {
    function stitchOperation(overrides: Partial<Record<string, unknown>> = {}) {
      return makeOperation({
        provider: 'stitch',
        sourceArtifactVersionId: 'ui-v1',
        targetDescriptor: { uiRequirementsVersionId: 'ui-v1' },
        ...overrides,
      });
    }

    it('returns 200 { status: completed, ref } when generate completes', async () => {
      mockedGetOperationById.mockResolvedValue(stitchOperation());
      mockedGenerate.mockResolvedValue({ id: 'stitch-1', mode: 'api' } as never);
      mockedGetRefsForVersion.mockResolvedValue([
        makeRef({ id: 'ref-stitch', provider: 'stitch' }),
      ]);

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        status: 'completed',
        ref: { id: 'ref-stitch', provider: 'stitch' },
      });
    });

    it('KNOWN GAP: falls through to 500 when the retry ends in mode=manual_fallback (definitive failure)', async () => {
      mockedGetOperationById.mockResolvedValue(stitchOperation());
      mockedGenerate.mockResolvedValue({
        id: 'stitch-1',
        mode: 'manual_fallback',
        promptText: 'x',
      } as never);

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(500);
    });

    it('returns 200 { status: reconciliation_required }', async () => {
      mockedGetOperationById.mockResolvedValue(stitchOperation());
      mockedGenerate.mockRejectedValue(new FakeStitchReconciliationRequiredError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'reconciliation_required' });
    });

    it('returns 200 { status: pending }', async () => {
      mockedGetOperationById.mockResolvedValue(stitchOperation());
      mockedGenerate.mockRejectedValue(new FakeStitchOperationInFlightError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'pending' });
    });

    it('returns 409 REQUEST_CONFLICT', async () => {
      mockedGetOperationById.mockResolvedValue(stitchOperation());
      mockedGenerate.mockRejectedValue(new FakeStitchOperationConflictError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('REQUEST_CONFLICT');
    });
  });

  describe('jira', () => {
    function jiraOperation(overrides: Partial<Record<string, unknown>> = {}) {
      return makeOperation({
        provider: 'jira',
        sourceArtifactVersionId: 'backlog-v1',
        sourceItemVersionId: 'iv-1',
        targetDescriptor: {},
        ...overrides,
      });
    }

    it('returns 200 { status: completed, ref } when the ref now exists', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedExportBacklog.mockResolvedValue([]);
      mockedGetRefForItem.mockResolvedValue(
        makeRef({ id: 'ref-jira', provider: 'jira', sourceItemVersionId: 'iv-1' }),
      );

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        status: 'completed',
        ref: { id: 'ref-jira', provider: 'jira' },
      });
      expect(mockedExportBacklog).toHaveBeenCalledWith('backlog-v1', new Map());
    });

    it('returns 200 { status: pending } when the row is still pending', async () => {
      const op = jiraOperation();
      mockedGetOperationById
        .mockResolvedValueOnce(op)
        .mockResolvedValueOnce({ ...op, status: 'pending' });
      mockedExportBacklog.mockResolvedValue([]);
      mockedGetRefForItem.mockResolvedValue(null);

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'pending' });
    });

    it('returns 200 { status: reconciliation_required } when the row is reconciliation_required', async () => {
      const op = jiraOperation();
      mockedGetOperationById
        .mockResolvedValueOnce(op)
        .mockResolvedValueOnce({ ...op, status: 'reconciliation_required' });
      mockedExportBacklog.mockResolvedValue([]);
      mockedGetRefForItem.mockResolvedValue(null);

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'reconciliation_required' });
    });

    it('KNOWN GAP: falls through to 500 when the row is definitively failed', async () => {
      const op = jiraOperation();
      mockedGetOperationById
        .mockResolvedValueOnce(op)
        .mockResolvedValueOnce({ ...op, status: 'failed' });
      mockedExportBacklog.mockResolvedValue([]);
      mockedGetRefForItem.mockResolvedValue(null);

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(500);
    });
  });
});
