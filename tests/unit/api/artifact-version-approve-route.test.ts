import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/artifact-versions/:versionId/approve
// (API Contracts section 4). Mocks and the deliberately-real `_shared/*` glue
// follow tests/unit/api/artifact-version-route.test.ts. The three error classes
// the route `instanceof`s live in a mocked barrel, so stand-ins are hoisted
// here (see tests/unit/api/github-init-route.test.ts for why `vi.hoisted`).
const { FakeVersionNotDraftError, FakeApprovalGateBlockedError, FakeItemEditError } = vi.hoisted(
  () => {
    class FakeVersionNotDraftError extends Error {}
    class FakeApprovalGateBlockedError extends Error {
      constructor(
        readonly blocking: unknown[],
        readonly displayKeys: Map<string, string> = new Map(),
      ) {
        super('approval gate blocked');
      }
    }
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
  approveVersion: vi.fn(),
  approveWithOverride: vi.fn(),
  VersionNotDraftError: FakeVersionNotDraftError,
  ApprovalGateBlockedError: FakeApprovalGateBlockedError,
  ItemEditError: FakeItemEditError,
}));

vi.mock('@/artifact-types/requirements', () => ({ generate: vi.fn(), qualityGate: vi.fn() }));
vi.mock('@/artifact-types/architecture', () => ({
  generate: vi.fn(),
  getOptionsForVersion: vi.fn(),
  approveVersion: vi.fn(),
  approveWithOverride: vi.fn(),
}));
vi.mock('@/artifact-types/ui-requirements', () => ({ generate: vi.fn() }));
vi.mock('@/artifact-types/backlog', () => ({ generate: vi.fn(), qualityGate: vi.fn() }));

vi.mock('@/external/operations', () => ({ getDisplayKeysForItemVersions: vi.fn() }));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import {
  getVersionRef,
  getArtifactVersionDetail,
  approveVersion,
  approveWithOverride,
} from '@/artifact-lifecycle';
import {
  approveVersion as approveArchitectureVersion,
  approveWithOverride as approveArchitectureWithOverride,
  getOptionsForVersion,
} from '@/artifact-types/architecture';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { POST } from '@/app/api/artifact-versions/[versionId]/approve/route';
import { ApiError } from '@/lib/errors';
import {
  USER,
  jsonRequest,
  makeDetail,
  makeImpactRow,
  makeRef,
  rawRequest,
} from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetVersionRef = vi.mocked(getVersionRef);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedApprove = vi.mocked(approveVersion);
const mockedApproveOverride = vi.mocked(approveWithOverride);
const mockedApproveArchitecture = vi.mocked(approveArchitectureVersion);
const mockedApproveArchitectureOverride = vi.mocked(approveArchitectureWithOverride);
const mockedGetOptions = vi.mocked(getOptionsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

const URL_APPROVE = 'http://localhost/api/artifact-versions/version-1/approve';

function post(body?: unknown) {
  return POST(jsonRequest('POST', URL_APPROVE, body), {
    params: Promise.resolve({ versionId: 'version-1' }),
  });
}

function useArchitectureVersion() {
  mockedGetVersionRef.mockResolvedValue(makeRef({ artifactType: 'architecture' }));
  mockedGetDetail.mockResolvedValue(
    makeDetail({ artifactType: 'architecture', status: 'approved' }),
  );
}

function expectNothingApproved() {
  expect(mockedApprove).not.toHaveBeenCalled();
  expect(mockedApproveOverride).not.toHaveBeenCalled();
  expect(mockedApproveArchitecture).not.toHaveBeenCalled();
  expect(mockedApproveArchitectureOverride).not.toHaveBeenCalled();
}

const blockingRow = makeImpactRow({
  subjectId: 'iv-1',
  rootItemVersionId: 'iv-root',
  path: ['iv-root', 'iv-1'],
});
const blockingDTO = {
  subjectKind: 'item_version',
  subjectId: 'iv-1',
  rootItemVersionId: 'iv-root',
  rootDisplayKey: 'R-01',
  depth: 1,
  path: ['R-01', 'S-01'],
  acknowledged: false,
};
// What artifact-lifecycle captures INSIDE the approval transaction before it
// rolls back (`ApproveVersionResult.displayKeys` / `ApprovalGateBlockedError.
// displayKeys`): every id the blocking rows name, root and path entries.
const capturedKeys = new Map([
  ['iv-root', 'R-01'],
  ['iv-1', 'S-01'],
]);

// A blocked Architecture approval: `materialize` had minted this ADR item_version
// inside the transaction, and the rollback un-minted it while the blocking row
// still names it as its subject and last path element (ERD 3.5, "Why ids never
// cross the API"). Nothing on the pool can resolve it any more.
const rolledBackAdrRow = makeImpactRow({
  subjectId: 'iv-adr-rolled-back',
  rootItemVersionId: 'iv-root',
  depth: 0,
  path: ['iv-root', 'iv-adr-rolled-back'],
});
const rolledBackAdrKeys = new Map([
  ['iv-root', 'R-01'],
  ['iv-adr-rolled-back', 'ADR-01'],
]);
const rolledBackAdrDTO = {
  subjectKind: 'item_version',
  subjectId: 'iv-adr-rolled-back',
  rootItemVersionId: 'iv-root',
  rootDisplayKey: 'R-01',
  depth: 0,
  path: ['R-01', 'ADR-01'],
  acknowledged: false,
};

describe('POST /api/artifact-versions/:versionId/approve', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetVersionRef.mockReset().mockResolvedValue(makeRef());
    mockedGetDetail.mockReset().mockResolvedValue(makeDetail({ status: 'approved' }));
    mockedApprove.mockReset().mockResolvedValue({ ok: true });
    mockedApproveOverride.mockReset().mockResolvedValue({ ok: true });
    mockedApproveArchitecture.mockReset().mockResolvedValue({ ok: true });
    mockedApproveArchitectureOverride.mockReset().mockResolvedValue({ ok: true });
    mockedGetOptions.mockReset().mockResolvedValue([]);
    // The pool lookup must play no part in a blocked approval: by the time the
    // route sees the block, the transaction (and any ADR it minted) has rolled
    // back, so such a lookup would find nothing. It rejects here so a route that
    // still depended on it would answer 500, not the 409 these tests expect.
    mockedGetDisplayKeys
      .mockReset()
      .mockRejectedValue(
        new Error('no display key can be resolved for a rolled-back item_version'),
      );
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await post({});

    expect(response.status).toBe(401);
    expect(mockedGetVersionRef).not.toHaveBeenCalled();
    expectNothingApproved();
  });

  it("returns 404 NOT_FOUND (never 403) for a version of a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await post({});

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expectNothingApproved();
  });

  it('returns 404 NOT_FOUND for an unknown or malformed version id', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const response = await post({});

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expectNothingApproved();
  });

  describe('request validation (400 VALIDATION_ERROR)', () => {
    it('rejects malformed JSON', async () => {
      const response = await POST(rawRequest('POST', URL_APPROVE, '{not json'), {
        params: Promise.resolve({ versionId: 'version-1' }),
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expectNothingApproved();
    });

    it('rejects a body of the wrong shape', async () => {
      const response = await post({ overrideNote: 5 });

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expectNothingApproved();
    });

    it('rejects an architecture version without selectedArchitectureOptionId', async () => {
      useArchitectureVersion();

      const response = await post({});

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expectNothingApproved();
    });

    it('rejects a non-architecture version WITH selectedArchitectureOptionId', async () => {
      const response = await post({ selectedArchitectureOptionId: 'option-A' });

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expectNothingApproved();
    });

    it.each([[''], ['   '], ['\n\t ']])(
      'rejects a blank overrideNote (%j)',
      async (overrideNote) => {
        const response = await post({ overrideNote });

        expect(response.status).toBe(400);
        expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
        expectNothingApproved();
      },
    );

    it('rejects a blank overrideNote on an architecture version too', async () => {
      useArchitectureVersion();

      const response = await post({ selectedArchitectureOptionId: 'option-A', overrideNote: ' ' });

      expect(response.status).toBe(400);
      expectNothingApproved();
    });
  });

  describe('non-architecture versions', () => {
    it('approves with an EMPTY body (treated as {}) and returns { version }', async () => {
      const response = await POST(new Request(URL_APPROVE, { method: 'POST' }), {
        params: Promise.resolve({ versionId: 'version-1' }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version).toMatchObject({ id: 'version-1', status: 'approved', options: null });
      expect(mockedApprove).toHaveBeenCalledWith('version-1', 'user-1');
      expect(mockedApproveOverride).not.toHaveBeenCalled();
      expect(mockedApproveArchitecture).not.toHaveBeenCalled();
    });

    it('calls approveWithOverride iff overrideNote is present', async () => {
      const response = await post({ overrideNote: 'Reviewed the warnings.' });

      expect(response.status).toBe(200);
      expect(mockedApproveOverride).toHaveBeenCalledWith(
        'version-1',
        'user-1',
        'Reviewed the warnings.',
      );
      expect(mockedApprove).not.toHaveBeenCalled();
      expect(mockedApproveArchitectureOverride).not.toHaveBeenCalled();
    });

    it('returns 409 APPROVAL_BLOCKED with details.blocking as display-key rows for { ok: false, blocking, displayKeys }', async () => {
      mockedApprove.mockResolvedValue({
        ok: false,
        blocking: [blockingRow],
        displayKeys: capturedKeys,
      });

      const response = await post({});

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('APPROVAL_BLOCKED');
      expect(body.error.details).toEqual({ blocking: [blockingDTO] });
      expect(mockedApproveOverride).not.toHaveBeenCalled();
      expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
    });

    it('returns the SAME 409 APPROVAL_BLOCKED body when approveWithOverride throws ApprovalGateBlockedError', async () => {
      mockedApproveOverride.mockRejectedValue(
        new FakeApprovalGateBlockedError([blockingRow], capturedKeys),
      );

      const response = await post({ overrideNote: 'go' });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('APPROVAL_BLOCKED');
      expect(body.error.details).toEqual({ blocking: [blockingDTO] });
      expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
    });

    it('serializes every blocking row from the captured keys alone, however many there are', async () => {
      mockedApprove.mockResolvedValue({
        ok: false,
        blocking: [blockingRow, rolledBackAdrRow],
        displayKeys: new Map([...capturedKeys, ...rolledBackAdrKeys]),
      });

      const response = await post({});

      expect(response.status).toBe(409);
      expect((await response.json()).error.details).toEqual({
        blocking: [blockingDTO, rolledBackAdrDTO],
      });
    });

    it('answers a block that carries no captured keys with the generic 500, never a fallback pool lookup', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedApprove.mockResolvedValue({ ok: false, blocking: [blockingRow] });

      const response = await post({});

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('returns 409 VERSION_NOT_DRAFT when the version is no longer a draft', async () => {
      mockedApprove.mockRejectedValue(new FakeVersionNotDraftError('version-1'));

      const response = await post({});

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('VERSION_NOT_DRAFT');
    });

    it('lets an unrecognized failure fall through to the generic 500', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedApprove.mockRejectedValue(new Error('boom'));

      const response = await post({});

      expect(response.status).toBe(500);
      expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
      consoleSpy.mockRestore();
    });
  });

  describe('architecture versions (composed facade, never the plain lifecycle functions)', () => {
    beforeEach(useArchitectureVersion);

    it('approves through architecture.approveVersion with the selected option and returns { version }', async () => {
      const response = await post({ selectedArchitectureOptionId: 'option-A' });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.version).toMatchObject({ artifactType: 'architecture', options: [] });
      expect(mockedApproveArchitecture).toHaveBeenCalledWith('version-1', 'user-1', 'option-A');
      expect(mockedApprove).not.toHaveBeenCalled();
      expect(mockedApproveOverride).not.toHaveBeenCalled();
      expect(mockedApproveArchitectureOverride).not.toHaveBeenCalled();
    });

    it('approves through architecture.approveWithOverride iff overrideNote is present', async () => {
      const response = await post({
        selectedArchitectureOptionId: 'option-B',
        overrideNote: 'Reviewed.',
      });

      expect(response.status).toBe(200);
      expect(mockedApproveArchitectureOverride).toHaveBeenCalledWith(
        'version-1',
        'user-1',
        'Reviewed.',
        'option-B',
      );
      expect(mockedApproveArchitecture).not.toHaveBeenCalled();
      expect(mockedApprove).not.toHaveBeenCalled();
      expect(mockedApproveOverride).not.toHaveBeenCalled();
    });

    it.each([
      ['OPTION_NOT_SELECTED', 422],
      ['OPTION_COUNT_INVALID', 422],
      ['STACK_UNCHANGED_DECISIONS', 409],
    ] as const)('maps { ok: false, code: %s } to %i', async (code, status) => {
      mockedApproveArchitecture.mockResolvedValue({ ok: false, blocking: [], code });

      const response = await post({ selectedArchitectureOptionId: 'option-A' });

      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error.code).toBe(code);
      expect(body.error).not.toHaveProperty('details');
    });

    it('maps an option code returned through approveWithOverride the same way', async () => {
      mockedApproveArchitectureOverride.mockResolvedValue({
        ok: false,
        blocking: [],
        code: 'STACK_UNCHANGED_DECISIONS',
      });

      const response = await post({ selectedArchitectureOptionId: 'option-A', overrideNote: 'x' });

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('STACK_UNCHANGED_DECISIONS');
    });

    it('returns 409 APPROVAL_BLOCKED for a gate block with no code', async () => {
      mockedApproveArchitecture.mockResolvedValue({
        ok: false,
        blocking: [blockingRow],
        displayKeys: capturedKeys,
      });

      const response = await post({ selectedArchitectureOptionId: 'option-A' });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('APPROVAL_BLOCKED');
      expect(body.error.details).toEqual({ blocking: [blockingDTO] });
    });

    it('returns 409 (not 500) when the block names an ADR the rolled-back transaction minted, from { ok: false }', async () => {
      mockedApproveArchitecture.mockResolvedValue({
        ok: false,
        blocking: [rolledBackAdrRow],
        displayKeys: rolledBackAdrKeys,
      });

      const response = await post({ selectedArchitectureOptionId: 'option-A' });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('APPROVAL_BLOCKED');
      expect(body.error.details).toEqual({ blocking: [rolledBackAdrDTO] });
      // The pool lookup would have rejected (and produced a 500): it is never called.
      expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
    });

    it('returns 409 APPROVAL_BLOCKED when architecture.approveWithOverride throws ApprovalGateBlockedError', async () => {
      mockedApproveArchitectureOverride.mockRejectedValue(
        new FakeApprovalGateBlockedError([blockingRow], capturedKeys),
      );

      const response = await post({ selectedArchitectureOptionId: 'option-A', overrideNote: 'x' });

      expect(response.status).toBe(409);
      expect((await response.json()).error.details).toEqual({ blocking: [blockingDTO] });
    });

    it('returns 409 (not 500) when the thrown ApprovalGateBlockedError names a rolled-back ADR', async () => {
      mockedApproveArchitectureOverride.mockRejectedValue(
        new FakeApprovalGateBlockedError([rolledBackAdrRow], rolledBackAdrKeys),
      );

      const response = await post({ selectedArchitectureOptionId: 'option-A', overrideNote: 'x' });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('APPROVAL_BLOCKED');
      expect(body.error.details).toEqual({ blocking: [rolledBackAdrDTO] });
      expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
    });

    it('returns 409 VERSION_NOT_DRAFT when the architecture version is no longer a draft', async () => {
      mockedApproveArchitecture.mockRejectedValue(new FakeVersionNotDraftError('version-1'));

      const response = await post({ selectedArchitectureOptionId: 'option-A' });

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('VERSION_NOT_DRAFT');
    });
  });
});
