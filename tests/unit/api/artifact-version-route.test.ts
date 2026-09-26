import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/artifact-versions/:versionId and
// GET /api/artifact-versions/:versionId/quality-gate (API Contracts section 4),
// same style as tests/unit/api/projects-id-route.test.ts: every module the routes
// import is mocked wholesale, so no DB/env is ever touched. `_shared/artifacts.ts`
// and `_shared/external.ts` are left real - they are the route glue under test -
// but they statically import every artifact-type and provider module, so all of
// those are mocked here even where a given case never calls them.
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
import { getVersionRef, getArtifactVersionDetail } from '@/artifact-lifecycle';
import { getOptionsForVersion } from '@/artifact-types/architecture';
import { qualityGate as qualityGateRequirements } from '@/artifact-types/requirements';
import { qualityGate as qualityGateBacklog } from '@/artifact-types/backlog';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { GET } from '@/app/api/artifact-versions/[versionId]/route';
import { GET as GET_QUALITY_GATE } from '@/app/api/artifact-versions/[versionId]/quality-gate/route';
import { ApiError } from '@/lib/errors';
import {
  USER,
  makeDetail,
  makeImpactRow,
  makeItem,
  makeOption,
  makeRef,
  LOGICAL_ITEM_ID,
} from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetVersionRef = vi.mocked(getVersionRef);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedGetOptions = vi.mocked(getOptionsForVersion);
const mockedRequirementsGate = vi.mocked(qualityGateRequirements);
const mockedBacklogGate = vi.mocked(qualityGateBacklog);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

const URL_BASE = 'http://localhost/api/artifact-versions/version-1';

function paramsFor(versionId: string) {
  return { params: Promise.resolve({ versionId }) };
}

function resetMocks() {
  mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
  mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
  mockedGetVersionRef.mockReset().mockResolvedValue(makeRef());
  mockedGetDetail.mockReset().mockResolvedValue(makeDetail());
  mockedGetOptions.mockReset().mockResolvedValue([]);
  mockedRequirementsGate.mockReset().mockResolvedValue([]);
  mockedBacklogGate.mockReset().mockResolvedValue([]);
  mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
}

describe('GET /api/artifact-versions/:versionId', () => {
  beforeEach(resetMocks);

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(new Request(URL_BASE), paramsFor('version-1'));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mockedGetVersionRef).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) for a version of a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(new Request(URL_BASE), paramsFor('version-1'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown or malformed version id, before any ownership check', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const response = await GET(new Request(URL_BASE), paramsFor('not-a-uuid'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedGetVersionRef).toHaveBeenCalledWith('not-a-uuid');
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it("answers another owner's version and a nonexistent one with the identical body (API Contracts 1.4)", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));
    const foreign = await GET(new Request(URL_BASE), paramsFor('version-1'));

    mockedGetVersionRef.mockResolvedValue(null);
    const missing = await GET(new Request(URL_BASE), paramsFor('version-2'));

    expect(foreign.status).toBe(missing.status);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it('returns 404 when the version disappears between the ownership check and the read', async () => {
    mockedGetDetail.mockResolvedValue(null);

    const response = await GET(new Request(URL_BASE), paramsFor('version-1'));

    expect(response.status).toBe(404);
  });

  it('returns 200 with an ArtifactVersionDTO: ISO dates, options null, rawOutput null, items in order', async () => {
    mockedGetDetail.mockResolvedValue(
      makeDetail({ status: 'approved', versionNumber: 3 }, [makeItem()]),
    );

    const response = await GET(new Request(URL_BASE), paramsFor('version-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'version-1',
      artifactId: 'artifact-1',
      artifactType: 'requirements',
      versionNumber: 3,
      status: 'approved',
      statusReason: null,
      schemaVersion: 1,
      baseApprovedVersionId: null,
      payload: { businessProblem: 'p' },
      rawOutput: null,
      items: [
        {
          itemVersionId: 'iv-1',
          logicalItemId: LOGICAL_ITEM_ID,
          displayKey: 'R-01',
          itemType: 'requirement',
          revisionNumber: 1,
          payload: { behavior: 'b' },
          parentLogicalItemId: null,
          impact: null,
        },
      ],
      options: null,
      selectedArchitectureOptionId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    expect(mockedGetOptions).not.toHaveBeenCalled();
    expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
  });

  it('does not leak the raw id-based impact row and never exposes projectId', async () => {
    mockedGetDetail.mockResolvedValue(makeDetail({}, [makeItem({ impact: makeImpactRow() })]));
    mockedGetDisplayKeys.mockResolvedValue(
      new Map([
        ['iv-root', 'R-01'],
        ['iv-1', 'S-01'],
      ]),
    );

    const body = await (await GET(new Request(URL_BASE), paramsFor('version-1'))).json();

    expect(body).not.toHaveProperty('projectId');
    expect(body.items[0].impact).toEqual({
      subjectKind: 'item_version',
      subjectId: 'iv-1',
      rootItemVersionId: 'iv-root',
      rootDisplayKey: 'R-01',
      depth: 1,
      path: ['R-01', 'S-01'],
      acknowledged: false,
    });
  });

  it("resolves every item's impact display keys in ONE batched lookup, and pairs each row with its own item", async () => {
    mockedGetDetail.mockResolvedValue(
      makeDetail({}, [
        makeItem({
          itemVersionId: 'iv-1',
          displayKey: 'S-01',
          logicalItemId: 'logical-1',
          impact: makeImpactRow({ subjectId: 'iv-1', path: ['iv-root', 'iv-1'] }),
        }),
        makeItem({ itemVersionId: 'iv-clean', displayKey: 'S-02', logicalItemId: 'logical-2' }),
        makeItem({
          itemVersionId: 'iv-3',
          displayKey: 'S-03',
          logicalItemId: 'logical-3',
          impact: makeImpactRow({
            subjectId: 'iv-3',
            depth: 2,
            path: ['iv-root', 'iv-mid', 'iv-3'],
            acknowledged: true,
          }),
        }),
      ]),
    );
    mockedGetDisplayKeys.mockResolvedValue(
      new Map([
        ['iv-root', 'R-01'],
        ['iv-mid', 'ADR-01'],
        ['iv-1', 'S-01'],
        ['iv-3', 'S-03'],
      ]),
    );

    const body = await (await GET(new Request(URL_BASE), paramsFor('version-1'))).json();

    expect(mockedGetDisplayKeys).toHaveBeenCalledTimes(1);
    const requestedIds = mockedGetDisplayKeys.mock.calls[0]?.[0] ?? [];
    expect([...requestedIds].sort()).toEqual(['iv-1', 'iv-3', 'iv-mid', 'iv-root']);
    expect(body.items[0].impact.path).toEqual(['R-01', 'S-01']);
    expect(body.items[1].impact).toBeNull();
    expect(body.items[2].impact).toMatchObject({
      depth: 2,
      path: ['R-01', 'ADR-01', 'S-03'],
      acknowledged: true,
    });
  });

  it('includes the options (A then B) for an architecture version', async () => {
    mockedGetVersionRef.mockResolvedValue(makeRef({ artifactType: 'architecture' }));
    mockedGetDetail.mockResolvedValue(makeDetail({ artifactType: 'architecture' }));
    mockedGetOptions.mockResolvedValue([makeOption('A'), makeOption('B')]);

    const body = await (await GET(new Request(URL_BASE), paramsFor('version-1'))).json();

    expect(mockedGetOptions).toHaveBeenCalledWith('version-1');
    expect(body.options).toEqual([
      {
        id: 'option-A',
        optionKey: 'A',
        title: 'Option A',
        summary: 'Summary A',
        stack: { frontend: 'next' },
        candidateDecisions: [{ title: 'd' }],
        tradeoffs: [{ factor: 'cost', assessment: 'low' }],
      },
      expect.objectContaining({ id: 'option-B', optionKey: 'B' }),
    ]);
  });

  it('returns options: [] (not null) for an architecture version that persisted none', async () => {
    mockedGetVersionRef.mockResolvedValue(makeRef({ artifactType: 'architecture' }));
    mockedGetDetail.mockResolvedValue(makeDetail({ artifactType: 'architecture' }));

    const body = await (await GET(new Request(URL_BASE), paramsFor('version-1'))).json();

    expect(body.options).toEqual([]);
  });

  it('exposes rawOutput only for a stale_generation_context rejection', async () => {
    mockedGetDetail.mockResolvedValue(
      makeDetail({
        status: 'rejected',
        statusReason: 'stale_generation_context',
        rawOutput: { payload: {}, candidates: [] },
        payload: {},
      }),
    );
    const stale = await (await GET(new Request(URL_BASE), paramsFor('version-1'))).json();
    expect(stale.rawOutput).toEqual({ payload: {}, candidates: [] });

    mockedGetDetail.mockResolvedValue(
      makeDetail({ status: 'rejected', statusReason: 'user_rejected', rawOutput: { leak: true } }),
    );
    const rejected = await (await GET(new Request(URL_BASE), paramsFor('version-1'))).json();
    expect(rejected.rawOutput).toBeNull();
  });
});

describe('GET /api/artifact-versions/:versionId/quality-gate', () => {
  const gateUrl = `${URL_BASE}/quality-gate`;

  beforeEach(resetMocks);

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET_QUALITY_GATE(new Request(gateUrl), paramsFor('version-1'));

    expect(response.status).toBe(401);
    expect(mockedGetVersionRef).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) for a version of a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET_QUALITY_GATE(new Request(gateUrl), paramsFor('version-1'));

    expect(response.status).toBe(404);
    expect(mockedRequirementsGate).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown or malformed version id', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const response = await GET_QUALITY_GATE(new Request(gateUrl), paramsFor('nope'));

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it("runs requirements' qualityGate and returns exactly { code, message, logicalItemId } per issue", async () => {
    mockedRequirementsGate.mockResolvedValue([
      {
        code: 'MISSING_ACCEPTANCE_CRITERIA',
        message: 'R-01 has no acceptance criteria.',
        logicalItemId: LOGICAL_ITEM_ID,
        extra: 'dropped',
      } as never,
      { code: 'REQUIRED_FIELD_MISSING', message: 'No business problem.', logicalItemId: null },
    ]);

    const response = await GET_QUALITY_GATE(new Request(gateUrl), paramsFor('version-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      issues: [
        {
          code: 'MISSING_ACCEPTANCE_CRITERIA',
          message: 'R-01 has no acceptance criteria.',
          logicalItemId: LOGICAL_ITEM_ID,
        },
        { code: 'REQUIRED_FIELD_MISSING', message: 'No business problem.', logicalItemId: null },
      ],
    });
    expect(mockedRequirementsGate).toHaveBeenCalledWith('version-1');
    expect(mockedBacklogGate).not.toHaveBeenCalled();
  });

  it("runs backlog's qualityGate for a backlog version", async () => {
    mockedGetVersionRef.mockResolvedValue(makeRef({ artifactType: 'backlog' }));
    mockedBacklogGate.mockResolvedValue([
      { code: 'story_no_source_requirement', message: 'S-01 has no source', logicalItemId: 'l-1' },
    ]);

    const response = await GET_QUALITY_GATE(new Request(gateUrl), paramsFor('version-1'));

    expect(await response.json()).toEqual({
      issues: [
        {
          code: 'story_no_source_requirement',
          message: 'S-01 has no source',
          logicalItemId: 'l-1',
        },
      ],
    });
    expect(mockedBacklogGate).toHaveBeenCalledWith('version-1');
    expect(mockedRequirementsGate).not.toHaveBeenCalled();
  });

  it.each(['architecture', 'ui_requirements'] as const)(
    'returns { issues: [] } for %s (no quality gate in P0) without calling any gate',
    async (artifactType) => {
      mockedGetVersionRef.mockResolvedValue(makeRef({ artifactType }));

      const response = await GET_QUALITY_GATE(new Request(gateUrl), paramsFor('version-1'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ issues: [] });
      expect(mockedRequirementsGate).not.toHaveBeenCalled();
      expect(mockedBacklogGate).not.toHaveBeenCalled();
    },
  );
});
