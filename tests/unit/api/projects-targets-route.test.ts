import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for PATCH /api/projects/:projectId/targets (API
// Contracts 10A, Module Boundaries 4.7): the route ORCHESTRATES - validate with
// the caller's connection, then hasOperationsFor, then updateProjectTargets -
// so the tests pin the order and the "nothing is written on a refusal" rule.
// All collaborators are mocked; no DB, env or network is touched.
const { FakeConnectionRequiredError, FakeReconnectRequiredError, FakeInvalidTargetsError } =
  vi.hoisted(() => {
    class FakeConnectionRequiredError extends Error {
      constructor(readonly provider: string) {
        super('connect first');
      }
    }
    class FakeReconnectRequiredError extends Error {
      constructor(
        readonly provider: string,
        readonly reason: string,
      ) {
        super('reconnect');
      }
    }
    class FakeInvalidTargetsError extends Error {}
    return { FakeConnectionRequiredError, FakeReconnectRequiredError, FakeInvalidTargetsError };
  });

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
  updateProjectTargets: vi.fn(),
  InvalidProjectTargetsError: FakeInvalidTargetsError,
}));

vi.mock('@/external/github', () => ({
  checkOwnerAccessible: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  hasOperationsFor: vi.fn(),
}));

vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById, updateProjectTargets } from '@/artifact-lifecycle';
import { checkOwnerAccessible } from '@/external/github';
import { hasOperationsFor } from '@/external/operations';
import { PATCH } from '@/app/api/projects/[projectId]/targets/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedUpdateProjectTargets = vi.mocked(updateProjectTargets);
const mockedCheckOwnerAccessible = vi.mocked(checkOwnerAccessible);
const mockedHasOperationsFor = vi.mocked(hasOperationsFor);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function project(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    ownerUserId: 'user-1',
    name: 'x',
    brief: 'y',
    inputContext: null,
    githubOwner: null,
    jiraCloudId: null,
    jiraProjectKey: null,
    createdAt: now,
    updatedAt: now,
    artifacts: emptyArtifactSummaries(),
    ...overrides,
  };
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function patch(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1/targets', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/projects/:projectId/targets', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(user);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetProjectById.mockReset().mockResolvedValue(project());
    mockedUpdateProjectTargets.mockReset().mockResolvedValue(project({ githubOwner: 'acme' }));
    mockedCheckOwnerAccessible.mockReset().mockResolvedValue(true);
    mockedHasOperationsFor.mockReset().mockResolvedValue(false);
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);
    const response = await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it('returns 404 (never 403) when the caller does not own the project, before anything else runs', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));
    const response = await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
    expect(response.status).toBe(404);
    expect(mockedCheckOwnerAccessible).not.toHaveBeenCalled();
    expect(mockedUpdateProjectTargets).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank owner', { githubOwner: '   ' }],
    ['half a Jira pair', { jira: { cloudId: 'cloud-1' } }],
    ['a blank Jira key', { jira: { cloudId: 'cloud-1', projectKey: ' ' } }],
    ['a non-string owner', { githubOwner: 7 }],
  ])('returns 400 VALIDATION_ERROR for %s and writes nothing', async (_label, body) => {
    const response = await PATCH(patch(body), paramsFor('project-1'));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockedCheckOwnerAccessible).not.toHaveBeenCalled();
    expect(mockedUpdateProjectTargets).not.toHaveBeenCalled();
  });

  it('validates the owner with the caller, checks the lock, then writes - in that order - and returns ProjectDTO.targets', async () => {
    const order: string[] = [];
    mockedCheckOwnerAccessible.mockImplementation(async () => {
      order.push('checkOwnerAccessible');
      return true;
    });
    mockedHasOperationsFor.mockImplementation(async () => {
      order.push('hasOperationsFor');
      return false;
    });
    mockedUpdateProjectTargets.mockImplementation(async () => {
      order.push('updateProjectTargets');
      return project({ githubOwner: 'acme' });
    });

    const response = await PATCH(patch({ githubOwner: ' acme ' }), paramsFor('project-1'));

    expect(response.status).toBe(200);
    expect(order).toEqual(['checkOwnerAccessible', 'hasOperationsFor', 'updateProjectTargets']);
    expect(mockedCheckOwnerAccessible).toHaveBeenCalledWith({ userId: 'user-1' }, 'acme');
    expect(mockedHasOperationsFor).toHaveBeenCalledWith('project-1', 'github');
    expect(mockedUpdateProjectTargets).toHaveBeenCalledWith('project-1', { githubOwner: 'acme' });
    const body = await response.json();
    expect(body.targets).toEqual({ githubOwner: 'acme', jira: null });
  });

  it('returns 422 TARGET_NOT_ACCESSIBLE when the owner is not visible to the caller, without locking or writing', async () => {
    mockedCheckOwnerAccessible.mockResolvedValue(false);
    const response = await PATCH(patch({ githubOwner: 'not-mine' }), paramsFor('project-1'));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('TARGET_NOT_ACCESSIBLE');
    expect(mockedHasOperationsFor).not.toHaveBeenCalled();
    expect(mockedUpdateProjectTargets).not.toHaveBeenCalled();
  });

  it('returns 409 TARGET_LOCKED when the owner changes while a non-failed GitHub operation exists', async () => {
    mockedGetProjectById.mockResolvedValue(project({ githubOwner: 'old-owner' }));
    mockedHasOperationsFor.mockResolvedValue(true);
    const response = await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('TARGET_LOCKED');
    expect(mockedUpdateProjectTargets).not.toHaveBeenCalled();
  });

  it('does not lock an owner that is unchanged', async () => {
    mockedGetProjectById.mockResolvedValue(project({ githubOwner: 'acme' }));
    mockedHasOperationsFor.mockResolvedValue(true);
    const response = await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
    expect(response.status).toBe(200);
    expect(mockedHasOperationsFor).not.toHaveBeenCalled();
  });

  it('clearing the owner (null) needs no provider check but is still locked once operations exist', async () => {
    mockedGetProjectById.mockResolvedValue(project({ githubOwner: 'acme' }));
    mockedHasOperationsFor.mockResolvedValue(true);
    const response = await PATCH(patch({ githubOwner: null }), paramsFor('project-1'));
    expect(response.status).toBe(409);
    expect(mockedCheckOwnerAccessible).not.toHaveBeenCalled();
  });

  it('passes the project current owner into the provider ctx', async () => {
    mockedGetProjectById.mockResolvedValue(project({ githubOwner: 'old-owner' }));
    await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
    expect(mockedCheckOwnerAccessible).toHaveBeenCalledWith(
      { userId: 'user-1', githubOwner: 'old-owner' },
      'acme',
    );
  });

  it.each([
    ['ConnectionRequiredError', new FakeConnectionRequiredError('github'), 'CONNECTION_REQUIRED'],
    [
      'ReconnectRequiredError',
      new FakeReconnectRequiredError('github', 'revoked'),
      'RECONNECT_REQUIRED',
    ],
  ])(
    'translates %s from the owner check into 409 %s and writes nothing',
    async (_n, error, code) => {
      mockedCheckOwnerAccessible.mockRejectedValue(error);
      const response = await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe(code);
      expect(mockedUpdateProjectTargets).not.toHaveBeenCalled();
    },
  );

  it('refuses to store a Jira target until UC-S5 can validate it (422 TARGET_NOT_ACCESSIBLE)', async () => {
    const response = await PATCH(
      patch({ jira: { cloudId: 'cloud-1', projectKey: 'PROJ' } }),
      paramsFor('project-1'),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('TARGET_NOT_ACCESSIBLE');
    expect(body.error.message).toContain('SCRUM-97');
    expect(mockedUpdateProjectTargets).not.toHaveBeenCalled();
  });

  it('clears the Jira pair together (jira: null) with no provider call', async () => {
    const response = await PATCH(patch({ jira: null }), paramsFor('project-1'));
    expect(response.status).toBe(200);
    expect(mockedCheckOwnerAccessible).not.toHaveBeenCalled();
    expect(mockedHasOperationsFor).not.toHaveBeenCalled();
    expect(mockedUpdateProjectTargets).toHaveBeenCalledWith('project-1', { jira: null });
  });

  it('maps a module-level InvalidProjectTargetsError to 400 VALIDATION_ERROR', async () => {
    mockedUpdateProjectTargets.mockRejectedValue(new FakeInvalidTargetsError('blank'));
    const response = await PATCH(patch({ githubOwner: 'acme' }), paramsFor('project-1'));
    expect(response.status).toBe(400);
  });
});
