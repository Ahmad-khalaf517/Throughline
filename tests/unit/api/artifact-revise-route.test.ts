import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/artifacts/:type/
// revise (API Contracts section 4). Mocks and the deliberately-real `_shared/*`
// glue follow tests/unit/api/artifact-version-route.test.ts.
const { FakeVersionNotDraftError, FakeApprovalGateBlockedError, FakeItemEditError } = vi.hoisted(
  () => {
    class FakeVersionNotDraftError extends Error {}
    class FakeApprovalGateBlockedError extends Error {}
    class FakeItemEditError extends Error {}
    return { FakeVersionNotDraftError, FakeApprovalGateBlockedError, FakeItemEditError };
  },
);

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
  createManualRevisionDraft: vi.fn(),
  getVersionRef: vi.fn(),
  getArtifactVersionDetail: vi.fn(),
  VersionNotDraftError: FakeVersionNotDraftError,
  ApprovalGateBlockedError: FakeApprovalGateBlockedError,
  ItemEditError: FakeItemEditError,
}));

vi.mock('@/artifact-types/requirements', () => ({ generate: vi.fn(), qualityGate: vi.fn() }));
vi.mock('@/artifact-types/architecture', () => ({
  generate: vi.fn(),
  getOptionsForVersion: vi.fn(),
}));
vi.mock('@/artifact-types/ui-requirements', () => ({ generate: vi.fn() }));
vi.mock('@/artifact-types/backlog', () => ({ generate: vi.fn(), qualityGate: vi.fn() }));

vi.mock('@/external/operations', () => ({ getDisplayKeysForItemVersions: vi.fn() }));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import {
  getProjectById,
  createManualRevisionDraft,
  getArtifactVersionDetail,
} from '@/artifact-lifecycle';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { POST } from '@/app/api/projects/[projectId]/artifacts/[type]/revise/route';
import { ApiError } from '@/lib/errors';
import { USER, makeDetail, makeProject } from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedCreateRevision = vi.mocked(createManualRevisionDraft);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

function post(type: string) {
  return POST(
    new Request(`http://localhost/api/projects/project-1/artifacts/${type}/revise`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ projectId: 'project-1', type }) },
  );
}

const ALL_APPROVED = makeProject({
  requirements: 'req-v1',
  architecture: 'arch-v1',
  ui_requirements: 'ui-v1',
  backlog: 'backlog-v1',
});

describe('POST /api/projects/:projectId/artifacts/:type/revise', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetProjectById.mockReset().mockResolvedValue(ALL_APPROVED);
    mockedCreateRevision.mockReset().mockResolvedValue({ id: 'version-2' } as never);
    mockedGetDetail
      .mockReset()
      .mockResolvedValue(
        makeDetail({ id: 'version-2', versionNumber: 2, baseApprovedVersionId: 'req-v1' }),
      );
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await post('requirements');

    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expect(mockedCreateRevision).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) when the caller doesn't own the project", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await post('requirements');

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedCreateRevision).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown :type, only AFTER the ownership check', async () => {
    const response = await post('roadmap');

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockedCreateRevision).not.toHaveBeenCalled();
  });

  it("answers an unknown :type on someone else's project exactly like a valid one", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const validType = await post('requirements');
    const unknownType = await post('roadmap');

    expect(unknownType.status).toBe(validType.status);
    expect(await unknownType.json()).toEqual(await validType.json());
  });

  it('returns 404 when the project row is gone', async () => {
    mockedGetProjectById.mockResolvedValue(null);

    expect((await post('requirements')).status).toBe(404);
    expect(mockedCreateRevision).not.toHaveBeenCalled();
  });

  describe('errors, in their documented order', () => {
    it('1. architecture -> 422 MANUAL_REVISION_UNSUPPORTED, decided before any project read', async () => {
      // Whatever else is true of the project, Architecture has no manual revision (ERD 3.6).
      mockedGetProjectById.mockResolvedValue(makeProject());

      const response = await post('architecture');

      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe('MANUAL_REVISION_UNSUPPORTED');
      expect(mockedGetProjectById).not.toHaveBeenCalled();
      expect(mockedCreateRevision).not.toHaveBeenCalled();
    });

    it.each([
      ['ui_requirements', {}, ['requirements', 'architecture']],
      ['ui_requirements', { requirements: 'req-v1' }, ['architecture']],
      ['backlog', { requirements: 'req-v1', architecture: 'arch-v1' }, ['ui_requirements']],
      ['backlog', {}, ['requirements', 'architecture', 'ui_requirements']],
    ] as const)(
      '2. %s with approved %j -> 409 PREREQUISITE_NOT_APPROVED, missing %j (even though nothing of its own is approved either)',
      async (type, approved, missing) => {
        mockedGetProjectById.mockResolvedValue(makeProject(approved));

        const response = await post(type);

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
        expect(body.error.details).toEqual({ missing });
        expect(mockedCreateRevision).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['requirements', {}],
      ['ui_requirements', { requirements: 'req-v1', architecture: 'arch-v1' }],
      ['backlog', { requirements: 'req-v1', architecture: 'arch-v1', ui_requirements: 'ui-v1' }],
    ] as const)(
      '3. %s with prerequisites met but nothing of its own approved -> 409 NO_APPROVED_VERSION',
      async (type, approved) => {
        mockedGetProjectById.mockResolvedValue(makeProject(approved));

        const response = await post(type);

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.error.code).toBe('NO_APPROVED_VERSION');
        expect(body.error).not.toHaveProperty('details');
        expect(mockedCreateRevision).not.toHaveBeenCalled();
      },
    );
  });

  it.each(['requirements', 'ui_requirements', 'backlog'] as const)(
    'creates the manual revision draft for %s and returns { version }',
    async (type) => {
      const response = await post(type);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version).toMatchObject({
        id: 'version-2',
        versionNumber: 2,
        status: 'draft',
        baseApprovedVersionId: 'req-v1',
      });
      expect(mockedCreateRevision).toHaveBeenCalledTimes(1);
      expect(mockedCreateRevision).toHaveBeenCalledWith('project-1', type, 'user-1');
      expect(mockedGetDetail).toHaveBeenCalledWith('version-2');
    },
  );

  it('lets an unrecognized failure fall through to the generic 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedCreateRevision.mockRejectedValue(new Error('boom'));

    const response = await post('requirements');

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleSpy.mockRestore();
  });
});
