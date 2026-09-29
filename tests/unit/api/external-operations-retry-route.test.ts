import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/external-operations/:operationId/retry
// (API Contracts section 7). Fake Error subclasses via `vi.hoisted` (same
// technique as tests/unit/api/projects-id-route.test.ts's `FakeBriefFrozenError`)
// since the real provider modules can't be imported here (they're built on
// top of `@/db`/`@/lib/env`). The shared `_shared/external` helper is real,
// so `@/external/github`/`jira`/`stitch` must each export a `checkDrift` too.
const {
  FakeGithubOperationConflictError,
  FakeGithubTargetRequiredError,
  FakeStitchReconciliationRequiredError,
  FakeStitchOperationInFlightError,
  FakeStitchOperationConflictError,
  FakeConnectionRequiredError,
  FakeReconnectRequiredError,
  FakeJiraOperationConflictError,
  FakeJiraTargetRequiredError,
  FakeJiraSiteError,
} = vi.hoisted(() => {
  class FakeGithubOperationConflictError extends Error {}
  class FakeGithubTargetRequiredError extends Error {
    readonly target = 'githubOwner';
  }
  class FakeJiraOperationConflictError extends Error {}
  class FakeJiraTargetRequiredError extends Error {
    readonly target = 'jira' as const;
  }
  class FakeJiraSiteError extends Error {}
  class FakeStitchReconciliationRequiredError extends Error {}
  class FakeStitchOperationInFlightError extends Error {}
  class FakeStitchOperationConflictError extends Error {}
  class FakeConnectionRequiredError extends Error {
    provider = 'github';
  }
  class FakeReconnectRequiredError extends Error {
    provider = 'github';
    reason = 'revoked';
  }
  return {
    FakeGithubOperationConflictError,
    FakeGithubTargetRequiredError,
    FakeStitchReconciliationRequiredError,
    FakeStitchOperationInFlightError,
    FakeStitchOperationConflictError,
    FakeConnectionRequiredError,
    FakeReconnectRequiredError,
    FakeJiraOperationConflictError,
    FakeJiraTargetRequiredError,
    FakeJiraSiteError,
  };
});

// The route's error translation imports `@/connections` (layer 3b), which is
// built on `@/db`/`@/lib/env`; stand-in error classes are enough for `instanceof`.
vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
}));

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getOperationById: vi.fn(),
  getRefsForVersion: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({ getProjectById: vi.fn() }));

vi.mock('@/external/github', () => ({
  retryOperation: vi.fn(),
  checkDrift: vi.fn(),
  GithubOperationConflictError: FakeGithubOperationConflictError,
  GithubTargetRequiredError: FakeGithubTargetRequiredError,
}));

vi.mock('@/external/jira', () => ({
  retryOperation: vi.fn(),
  checkDrift: vi.fn(),
  JiraOperationConflictError: FakeJiraOperationConflictError,
  JiraTargetRequiredError: FakeJiraTargetRequiredError,
  JiraSiteNotAccessibleError: FakeJiraSiteError,
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
  getRefsForVersion,
  getDisplayKeysForItemVersions,
} from '@/external/operations';
import { getProjectById } from '@/artifact-lifecycle';
import { retryOperation, checkDrift as checkGithubDrift } from '@/external/github';
import { retryOperation as retryJira, checkDrift as checkJiraDrift } from '@/external/jira';
import { generate, checkDrift as checkStitchDrift } from '@/external/stitch';
import { POST } from '@/app/api/external-operations/[operationId]/retry/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetOperationById = vi.mocked(getOperationById);
const mockedGetRefsForVersion = vi.mocked(getRefsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedRetryGithub = vi.mocked(retryOperation);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedRetryJira = vi.mocked(retryJira);
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
    connectionId: null,
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
    mockedGetRefsForVersion.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedRetryGithub.mockReset();
    mockedGetProjectById.mockReset().mockResolvedValue({ githubOwner: 'acme' } as never);
    mockedRetryJira.mockReset();
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

  it('answers 409 RECONNECT_REQUIRED when the recorded connection cannot be used (T49 route half)', async () => {
    mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
    mockedRetryGithub.mockRejectedValue(new FakeReconnectRequiredError('reconnect github'));

    const response = await POST(request(), paramsFor('op-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('RECONNECT_REQUIRED');
    expect(body.error.details).toEqual({ provider: 'github', reason: 'revoked' });
  });

  describe('github', () => {
    it('returns 200 { status: completed, ref } on success', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedRetryGithub.mockResolvedValue({ status: 'completed', ref: makeRef() } as never);

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: 'completed', ref: { id: 'ref-1', provider: 'github' } });
      // The route builds the ctx (D1); the credential is the provider module's job.
      expect(mockedRetryGithub).toHaveBeenCalledWith('op-1', {
        userId: 'user-1',
        githubOwner: 'acme',
      });
    });

    it('returns 200 { status: reconciliation_required } (not 202) per section 7', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedRetryGithub.mockResolvedValue({ status: 'reconciliation_required' });

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'reconciliation_required' });
    });

    it('returns 200 { status: pending } for an in-flight operation', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedRetryGithub.mockResolvedValue({ status: 'pending' });

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ status: 'pending' });
    });

    it('returns 409 REQUEST_CONFLICT when the retry no longer matches the stored request hash', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedRetryGithub.mockRejectedValue(new FakeGithubOperationConflictError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('REQUEST_CONFLICT');
    });

    it('returns 409 TARGET_REQUIRED when a connection-backed retry has no GitHub owner', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedRetryGithub.mockRejectedValue(new FakeGithubTargetRequiredError('no owner'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('TARGET_REQUIRED');
    });

    it('KNOWN GAP: falls through to 500 INTERNAL_ERROR for a definitive provider failure', async () => {
      mockedGetOperationById.mockResolvedValue(makeOperation({ provider: 'github' }));
      mockedRetryGithub.mockRejectedValue(new Error('name_taken_by_other'));

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

    beforeEach(() => {
      mockedGetProjectById.mockResolvedValue({
        jiraCloudId: 'cloud-1',
        jiraProjectKey: 'PROJ',
      } as never);
    });

    it('returns 200 { status: completed, ref } and retries only that operation with the project JiraCtx', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockResolvedValue({
        status: 'completed',
        ref: makeRef({ id: 'ref-jira', provider: 'jira', sourceItemVersionId: 'iv-1' }) as never,
      });

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        status: 'completed',
        ref: { id: 'ref-jira', provider: 'jira' },
      });
      expect(mockedRetryJira).toHaveBeenCalledWith('op-1', {
        userId: 'user-1',
        jiraCloudId: 'cloud-1',
        jiraProjectKey: 'PROJ',
      });
    });

    it('returns 200 { status: pending }', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockResolvedValue({ status: 'pending' });

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'pending' });
    });

    it('returns 200 { status: reconciliation_required }', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockResolvedValue({ status: 'reconciliation_required' });

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'reconciliation_required' });
    });

    it('returns 409 REQUEST_CONFLICT when the rebuilt request no longer matches', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockRejectedValue(new FakeJiraOperationConflictError('key'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('REQUEST_CONFLICT');
    });

    it('returns 409 TARGET_REQUIRED { target: jira } when the project has no Jira target', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockRejectedValue(new FakeJiraTargetRequiredError('no target'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('TARGET_REQUIRED');
      expect(body.error.details).toEqual({ target: 'jira' });
    });

    it('returns 409 RECONNECT_REQUIRED when the recorded connection is unusable', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockRejectedValue(new FakeReconnectRequiredError('lapsed'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('RECONNECT_REQUIRED');
    });

    it('KNOWN GAP: falls through to 500 for any other outcome (e.g. a definitively failed row)', async () => {
      mockedGetOperationById.mockResolvedValue(jiraOperation());
      mockedRetryJira.mockRejectedValue(new Error('Jira operation failed: rejected'));

      const response = await POST(request(), paramsFor('op-1'));

      expect(response.status).toBe(500);
    });
  });
});
