import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/artifacts/:type/
// generate (API Contracts section 4). Mocks and the deliberately-real `_shared/*`
// glue follow tests/unit/api/artifact-version-route.test.ts. `createDraftFromGeneration`
// is mocked with an implementation that, like the real one, invokes the `generate`
// callback it is handed - so the route's dispatch to the right artifact-type
// module, and its capture of Architecture's `options`, are exercised for real.
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
  getArtifactId: vi.fn(),
  createDraftFromGeneration: vi.fn(),
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
  createOptions: vi.fn(),
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
  getArtifactId,
  createDraftFromGeneration,
  getArtifactVersionDetail,
} from '@/artifact-lifecycle';
import { generate as generateRequirements } from '@/artifact-types/requirements';
import {
  generate as generateArchitecture,
  getOptionsForVersion,
  createOptions,
} from '@/artifact-types/architecture';
import { generate as generateUiRequirements } from '@/artifact-types/ui-requirements';
import { generate as generateBacklog } from '@/artifact-types/backlog';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { POST } from '@/app/api/projects/[projectId]/artifacts/[type]/generate/route';
import { ApiError } from '@/lib/errors';
import {
  USER,
  jsonRequest,
  makeDetail,
  makeOption,
  makeProject,
  rawRequest,
} from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetArtifactId = vi.mocked(getArtifactId);
const mockedCreateDraft = vi.mocked(createDraftFromGeneration);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedGenerate = {
  requirements: vi.mocked(generateRequirements),
  architecture: vi.mocked(generateArchitecture),
  ui_requirements: vi.mocked(generateUiRequirements),
  backlog: vi.mocked(generateBacklog),
};
const mockedCreateOptions = vi.mocked(createOptions);
const mockedGetOptions = vi.mocked(getOptionsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

const OPTION_INPUTS: Awaited<ReturnType<typeof generateArchitecture>>['options'] = [
  { title: 'A', summary: 'a', stack: {}, candidateDecisions: [], tradeoffs: [] },
  { title: 'B', summary: 'b', stack: {}, candidateDecisions: [], tradeoffs: [] },
];

const ALL_APPROVED = makeProject({
  requirements: 'req-v1',
  architecture: 'arch-v1',
  ui_requirements: 'ui-v1',
});

function urlFor(type: string) {
  return `http://localhost/api/projects/project-1/artifacts/${type}/generate`;
}

function post(type: string, body?: unknown) {
  return POST(jsonRequest('POST', urlFor(type), body), {
    params: Promise.resolve({ projectId: 'project-1', type }),
  });
}

/** Mimics the real createDraftFromGeneration: runs `generate` first, then reports the outcome. */
function draftCreatedAs(
  outcome: { stale: false } | { stale: true; reason: 'base_changed' | 'dependency_superseded' } = {
    stale: false,
  },
) {
  mockedCreateDraft.mockImplementation(async (opts) => {
    await opts.generate({
      baseVersionId: null,
      contextSourceVersionIds: opts.contextSourceVersionIds,
    });
    return { version: { id: 'version-1' } as never, ...outcome };
  });
}

describe('POST /api/projects/:projectId/artifacts/:type/generate', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetProjectById.mockReset().mockResolvedValue(ALL_APPROVED);
    mockedGetArtifactId.mockReset().mockResolvedValue('artifact-1');
    mockedGetDetail.mockReset().mockResolvedValue(makeDetail());
    mockedCreateOptions.mockReset().mockResolvedValue([]);
    mockedGetOptions.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedGenerate.requirements.mockReset().mockResolvedValue({
      payload: { businessProblem: 'p' },
      candidates: [],
      runId: 'run-1',
    });
    mockedGenerate.architecture.mockReset().mockResolvedValue({
      payload: { summary: 's' },
      candidates: [],
      options: OPTION_INPUTS,
      runId: 'run-1',
    });
    mockedGenerate.ui_requirements.mockReset().mockResolvedValue({
      payload: {},
      candidates: [],
      runId: 'run-1',
    });
    mockedGenerate.backlog.mockReset().mockResolvedValue({
      payload: {},
      candidates: [],
      runId: 'run-1',
    });
    mockedCreateDraft.mockReset();
    draftCreatedAs();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await post('requirements', {});

    expect(response.status).toBe(401);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) when the caller doesn't own the project", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await post('requirements', {});

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedGetProjectById).not.toHaveBeenCalled();
    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown :type, only AFTER the ownership check', async () => {
    const response = await post('roadmap', {});

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it("answers an unknown :type on someone else's project exactly like a valid one (nothing leaks)", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const validType = await post('requirements', {});
    const unknownType = await post('roadmap', {});

    expect(unknownType.status).toBe(validType.status);
    expect(await unknownType.json()).toEqual(await validType.json());
  });

  describe('request validation (400 VALIDATION_ERROR)', () => {
    it('rejects malformed JSON', async () => {
      const response = await POST(rawRequest('POST', urlFor('requirements'), '{oops'), {
        params: Promise.resolve({ projectId: 'project-1', type: 'requirements' }),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expect(mockedCreateDraft).not.toHaveBeenCalled();
    });

    it.each([
      ['a non-string feedback', { feedback: 7 }],
      ['a JSON array', []],
      ['JSON null', null],
    ])('rejects %s', async (_label, body) => {
      const response = await post('requirements', body);

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expect(mockedCreateDraft).not.toHaveBeenCalled();
    });

    it('accepts an EMPTY body (treated as {}) and generates without feedback', async () => {
      const response = await POST(new Request(urlFor('requirements'), { method: 'POST' }), {
        params: Promise.resolve({ projectId: 'project-1', type: 'requirements' }),
      });

      expect(response.status).toBe(200);
      expect(mockedGenerate.requirements).toHaveBeenCalledWith({
        projectId: 'project-1',
        feedback: undefined,
        contextSourceVersionIds: [],
        baseVersionId: null,
      });
    });
  });

  describe('409 PREREQUISITE_NOT_APPROVED (TR FR-080) with details.missing', () => {
    it.each([
      ['architecture', {}, ['requirements']],
      ['ui_requirements', { requirements: 'req-v1' }, ['architecture']],
      ['ui_requirements', {}, ['requirements', 'architecture']],
      ['backlog', { requirements: 'req-v1' }, ['architecture', 'ui_requirements']],
      ['backlog', { requirements: 'req-v1', architecture: 'arch-v1' }, ['ui_requirements']],
      ['backlog', {}, ['requirements', 'architecture', 'ui_requirements']],
    ] as const)('%s with approved %j is refused, missing %j', async (type, approved, missing) => {
      mockedGetProjectById.mockResolvedValue(makeProject(approved));

      const response = await post(type, {});

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
      expect(body.error.details).toEqual({ missing });
      expect(mockedCreateDraft).not.toHaveBeenCalled();
      expect(mockedGenerate[type]).not.toHaveBeenCalled();
    });

    it('never refuses requirements, the root artifact, even with nothing approved', async () => {
      mockedGetProjectById.mockResolvedValue(makeProject());

      const response = await post('requirements', {});

      expect(response.status).toBe(200);
      expect(mockedCreateDraft).toHaveBeenCalledTimes(1);
    });
  });

  it('returns 404 when the project row is gone', async () => {
    mockedGetProjectById.mockResolvedValue(null);

    expect((await post('requirements', {})).status).toBe(404);
    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  it('returns 404 when the project has no artifact row of that type', async () => {
    mockedGetArtifactId.mockResolvedValue(null);

    expect((await post('requirements', {})).status).toBe(404);
    expect(mockedCreateDraft).not.toHaveBeenCalled();
  });

  describe('composition with createDraftFromGeneration', () => {
    it.each([
      ['requirements', 'requirement', []],
      ['architecture', undefined, ['req-v1']],
      ['ui_requirements', 'ui_requirement', ['req-v1', 'arch-v1']],
      ['backlog', undefined, ['req-v1', 'arch-v1', 'ui-v1']],
    ] as const)(
      '%s: default itemType %s, context sources %j (canonical order)',
      async (type, itemType, contextSourceVersionIds) => {
        const response = await post(type, {});

        expect(response.status).toBe(200);
        expect(mockedCreateDraft).toHaveBeenCalledTimes(1);
        const options = mockedCreateDraft.mock.calls[0]?.[0];
        expect(options).toMatchObject({
          projectId: 'project-1',
          artifactId: 'artifact-1',
          contextSourceVersionIds,
          actorUserId: 'user-1',
        });
        if (itemType === undefined) expect(options).not.toHaveProperty('itemType');
        else expect(options?.itemType).toBe(itemType);
      },
    );

    it.each(['requirements', 'architecture', 'ui_requirements', 'backlog'] as const)(
      "%s: the callback runs that type's own module's generate, threading the exact ids createDraftFromGeneration hands it (INV-006)",
      async (type) => {
        // Values deliberately different from anything the route could have read
        // itself (the project's approved ids are req-v1/arch-v1/ui-v1): they can
        // only reach the module through the callback's own argument.
        mockedCreateDraft.mockImplementation(async (opts) => {
          await opts.generate({
            baseVersionId: 'captured-base',
            contextSourceVersionIds: ['captured-1', 'captured-2'],
          });
          return { version: { id: 'version-1' } as never, stale: false };
        });

        const response = await post(type, { feedback: 'Be more specific.' });

        expect(response.status).toBe(200);
        for (const [otherType, mock] of Object.entries(mockedGenerate)) {
          if (otherType === type) {
            expect(mock).toHaveBeenCalledTimes(1);
            expect(mock).toHaveBeenCalledWith({
              projectId: 'project-1',
              feedback: 'Be more specific.',
              contextSourceVersionIds: ['captured-1', 'captured-2'],
              baseVersionId: 'captured-base',
            });
          } else {
            expect(mock).not.toHaveBeenCalled();
          }
        }
      },
    );

    it('threads an explicit null base (a first generation) as null, not as "absent"', async () => {
      const response = await post('architecture', {});

      expect(response.status).toBe(200);
      const ctx = mockedGenerate.architecture.mock.calls[0]?.[0];
      expect(ctx).toHaveProperty('baseVersionId', null);
      expect(ctx?.contextSourceVersionIds).toEqual(['req-v1']);
    });

    it("returns the callback's own output to createDraftFromGeneration unchanged", async () => {
      let returned: unknown;
      mockedCreateDraft.mockImplementation(async (opts) => {
        returned = await opts.generate({ baseVersionId: null, contextSourceVersionIds: [] });
        return { version: { id: 'version-1' } as never, stale: false };
      });

      await post('requirements', {});

      expect(returned).toEqual({
        payload: { businessProblem: 'p' },
        candidates: [],
        runId: 'run-1',
      });
    });
  });

  describe('200 { status: "ok" }', () => {
    it('returns the new draft as an ArtifactVersionDTO and creates no options for a non-architecture type', async () => {
      mockedGetDetail.mockResolvedValue(makeDetail({ versionNumber: 2 }));

      const response = await post('requirements', {});

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body).not.toHaveProperty('reason');
      expect(body.version).toMatchObject({
        id: 'version-1',
        status: 'draft',
        versionNumber: 2,
        options: null,
      });
      expect(mockedGetDetail).toHaveBeenCalledWith('version-1');
      expect(mockedCreateOptions).not.toHaveBeenCalled();
    });

    it("persists Architecture's two options against the new draft AFTER the draft exists", async () => {
      mockedGetDetail.mockResolvedValue(makeDetail({ artifactType: 'architecture' }));
      mockedGetOptions.mockResolvedValue([makeOption('A'), makeOption('B')]);
      const order: string[] = [];
      mockedCreateDraft.mockImplementation(async (opts) => {
        await opts.generate({ baseVersionId: null, contextSourceVersionIds: [] });
        order.push('draft');
        return { version: { id: 'version-1' } as never, stale: false };
      });
      mockedCreateOptions.mockImplementation(async () => {
        order.push('options');
        return [];
      });

      const response = await post('architecture', {});

      expect(response.status).toBe(200);
      expect(mockedCreateOptions).toHaveBeenCalledTimes(1);
      expect(mockedCreateOptions).toHaveBeenCalledWith('version-1', OPTION_INPUTS);
      expect(order).toEqual(['draft', 'options']);
      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body.version.options).toHaveLength(2);
    });
  });

  describe('200 { status: "stale" } (a stale result is not an error)', () => {
    it.each(['base_changed', 'dependency_superseded'] as const)(
      'returns the rejected audit version and reason %s',
      async (reason) => {
        draftCreatedAs({ stale: true, reason });
        mockedGetDetail.mockResolvedValue(
          makeDetail({
            status: 'rejected',
            statusReason: 'stale_generation_context',
            rawOutput: { payload: {}, candidates: [] },
            payload: {},
          }),
        );

        const response = await post('requirements', {});

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe('stale');
        expect(body.reason).toBe(reason);
        expect(body.version).toMatchObject({
          status: 'rejected',
          statusReason: 'stale_generation_context',
          rawOutput: { payload: {}, candidates: [] },
          items: [],
        });
      },
    );

    it('does NOT create Architecture options for a stale result', async () => {
      draftCreatedAs({ stale: true, reason: 'base_changed' });
      mockedGetDetail.mockResolvedValue(
        makeDetail({
          artifactType: 'architecture',
          status: 'rejected',
          statusReason: 'stale_generation_context',
          rawOutput: {},
        }),
      );

      const response = await post('architecture', {});

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('stale');
      expect(body.version.options).toEqual([]);
      expect(mockedCreateOptions).not.toHaveBeenCalled();
    });
  });

  describe('failures with no documented code fall through to the generic 500', () => {
    it('a model failure inside generate (nothing is persisted, no options are created)', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedGenerate.architecture.mockRejectedValue(new Error('model refused'));
      mockedCreateDraft.mockImplementation(async (opts) => {
        await opts.generate({ baseVersionId: null, contextSourceVersionIds: [] });
        return { version: { id: 'version-1' } as never, stale: false };
      });

      const response = await post('architecture', {});

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).not.toContain('refused');
      expect(mockedCreateOptions).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('a failure creating the options', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedCreateOptions.mockRejectedValue(new Error('db down'));

      const response = await post('architecture', {});

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      consoleSpy.mockRestore();
    });
  });
});
