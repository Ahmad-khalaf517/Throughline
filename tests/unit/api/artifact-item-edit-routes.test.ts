import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/artifact-versions/:versionId/items/
// :logicalItemId/edit/preview and PUT /api/artifact-versions/:versionId/items/
// :logicalItemId (API Contracts section 5). Mocks and the deliberately-real
// `_shared/*` glue follow tests/unit/api/artifact-version-route.test.ts. The
// error classes the routes `instanceof` live in a mocked barrel, so stand-ins are
// hoisted here; `FakeItemEditError` mirrors identity's real constructor shape
// (`code`, message, optional `details`).
const { FakeVersionNotDraftError, FakeApprovalGateBlockedError, FakeItemEditError } = vi.hoisted(
  () => {
    class FakeVersionNotDraftError extends Error {}
    class FakeApprovalGateBlockedError extends Error {}
    class FakeItemEditError extends Error {
      constructor(
        readonly code: string,
        message: string,
        readonly details?: unknown,
      ) {
        super(message);
      }
    }
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
  proposeItemEdit: vi.fn(),
  commitItemEdit: vi.fn(),
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
  getVersionRef,
  getArtifactVersionDetail,
  proposeItemEdit,
  commitItemEdit,
} from '@/artifact-lifecycle';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { POST as POST_PREVIEW } from '@/app/api/artifact-versions/[versionId]/items/[logicalItemId]/edit/preview/route';
import { PUT } from '@/app/api/artifact-versions/[versionId]/items/[logicalItemId]/route';
import { ApiError } from '@/lib/errors';
import {
  LOGICAL_ITEM_ID,
  USER,
  jsonRequest,
  makeDetail,
  makeImpactRow,
  makeItem,
  makeRef,
  rawRequest,
} from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetVersionRef = vi.mocked(getVersionRef);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedPropose = vi.mocked(proposeItemEdit);
const mockedCommit = vi.mocked(commitItemEdit);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

const PREVIEW_URL = `http://localhost/api/artifact-versions/version-1/items/${LOGICAL_ITEM_ID}/edit/preview`;
const ITEM_URL = `http://localhost/api/artifact-versions/version-1/items/${LOGICAL_ITEM_ID}`;
const PAYLOAD = { actor: 'user', behavior: 'edits an item' };

const changedRefs = [
  { logicalItemId: 'logical-up', displayKey: 'R-07', from: 'iv-old', to: 'iv-new' },
];

function paramsFor(logicalItemId: string = LOGICAL_ITEM_ID) {
  return { params: Promise.resolve({ versionId: 'version-1', logicalItemId }) };
}

function resetMocks() {
  mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
  mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
  mockedGetVersionRef.mockReset().mockResolvedValue(makeRef());
  mockedGetDetail.mockReset().mockResolvedValue(makeDetail({}, [makeItem()]));
  mockedPropose.mockReset().mockResolvedValue({ itemVersionId: 'iv-new', changedRefs: [] });
  mockedCommit.mockReset().mockResolvedValue({ id: 'iv-new', changedRefs: [] } as never);
  mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
}

// The four documented ItemEditError codes plus VersionNotDraftError, each mapped
// to its same-named ApiError code (all 409) by the one shared mapper - so the
// same table drives both routes.
const errorCases = [
  {
    name: 'ItemEditError VERSION_NOT_DRAFT',
    make: () => new FakeItemEditError('VERSION_NOT_DRAFT', 'not a draft'),
    code: 'VERSION_NOT_DRAFT',
    details: undefined,
  },
  {
    name: 'VersionNotDraftError',
    make: () => new FakeVersionNotDraftError('version-1'),
    code: 'VERSION_NOT_DRAFT',
    details: undefined,
  },
  {
    name: 'ItemEditError ITEM_NOT_IN_VERSION',
    make: () => new FakeItemEditError('ITEM_NOT_IN_VERSION', 'not a member'),
    code: 'ITEM_NOT_IN_VERSION',
    details: undefined,
  },
  {
    name: 'ItemEditError UPSTREAM_REMOVED',
    make: () =>
      new FakeItemEditError('UPSTREAM_REMOVED', 'upstream removed', {
        logicalItemId: 'logical-up',
        displayKey: 'R-07',
      }),
    code: 'UPSTREAM_REMOVED',
    details: { logicalItemId: 'logical-up', displayKey: 'R-07' },
  },
  {
    name: 'ItemEditError CONFIRMATION_REQUIRED',
    make: () =>
      new FakeItemEditError('CONFIRMATION_REQUIRED', 'confirm the changed references', {
        changedRefs,
      }),
    code: 'CONFIRMATION_REQUIRED',
    details: { changedRefs },
  },
];

describe('POST /api/artifact-versions/:versionId/items/:logicalItemId/edit/preview', () => {
  function post(body?: unknown, logicalItemId: string = LOGICAL_ITEM_ID) {
    return POST_PREVIEW(jsonRequest('POST', PREVIEW_URL, body), paramsFor(logicalItemId));
  }

  beforeEach(resetMocks);

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await post({ payload: PAYLOAD });

    expect(response.status).toBe(401);
    expect(mockedGetVersionRef).not.toHaveBeenCalled();
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) for a version of a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await post({ payload: PAYLOAD });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown or malformed version id', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const response = await post({ payload: PAYLOAD });

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND (not 400/409) for a malformed logicalItemId, before validating the body', async () => {
    const response = await post({ nonsense: true }, 'not-a-uuid');

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it.each([
    ['no body at all', undefined],
    ['a body without payload', {}],
    ['a string payload', { payload: 'text' }],
    ['a numeric payload', { payload: 5 }],
    ['an array payload', { payload: [1, 2] }],
    ['a null payload', { payload: null }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const response = await POST_PREVIEW(rawRequest('POST', PREVIEW_URL, '{oops'), paramsFor());

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 { changedRefs } and previews exactly what was asked, persisting nothing itself', async () => {
    mockedPropose.mockResolvedValue({ itemVersionId: 'iv-new', changedRefs });

    const response = await post({ payload: PAYLOAD });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changedRefs });
    expect(mockedPropose).toHaveBeenCalledWith('version-1', LOGICAL_ITEM_ID, PAYLOAD);
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it('returns an empty changedRefs array when the edit needs no confirmation', async () => {
    const response = await post({ payload: PAYLOAD });

    expect(await response.json()).toEqual({ changedRefs: [] });
  });

  it.each(errorCases)('returns 409 $code for $name', async ({ make, code, details }) => {
    mockedPropose.mockRejectedValue(make());

    const response = await post({ payload: PAYLOAD });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(code);
    if (details === undefined) expect(body.error).not.toHaveProperty('details');
    else expect(body.error.details).toEqual(details);
  });

  it('lets an unrecognized failure fall through to the generic 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedPropose.mockRejectedValue(new Error('boom'));

    const response = await post({ payload: PAYLOAD });

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleSpy.mockRestore();
  });
});

describe('PUT /api/artifact-versions/:versionId/items/:logicalItemId', () => {
  function put(body?: unknown, logicalItemId: string = LOGICAL_ITEM_ID) {
    return PUT(jsonRequest('PUT', ITEM_URL, body), paramsFor(logicalItemId));
  }

  beforeEach(resetMocks);

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await put({ payload: PAYLOAD, confirmed: true });

    expect(response.status).toBe(401);
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) for a version of a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await put({ payload: PAYLOAD, confirmed: true });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown or malformed version id', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const response = await put({ payload: PAYLOAD, confirmed: true });

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for a malformed logicalItemId', async () => {
    const response = await put({ payload: PAYLOAD, confirmed: true }, '12345');

    expect(response.status).toBe(404);
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it.each([
    ['no body at all', undefined],
    ['a body without confirmed', { payload: PAYLOAD }],
    ['a non-boolean confirmed', { payload: PAYLOAD, confirmed: 'true' }],
    ['a body without payload', { confirmed: true }],
    ['a string payload', { payload: 'text', confirmed: true }],
    ['an array payload', { payload: [], confirmed: true }],
    ['a null payload', { payload: null, confirmed: true }],
  ])('returns 400 VALIDATION_ERROR for %s', async (_label, body) => {
    const response = await put(body);

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(mockedCommit).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const response = await PUT(rawRequest('PUT', ITEM_URL, '{oops'), paramsFor());

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 { item, changedRefs } with the committed item read back from the fresh version', async () => {
    mockedCommit.mockResolvedValue({ id: 'iv-2', changedRefs } as never);
    mockedGetDetail.mockResolvedValue(
      makeDetail({}, [
        makeItem({ itemVersionId: 'iv-other', logicalItemId: 'logical-other', displayKey: 'R-01' }),
        makeItem({
          itemVersionId: 'iv-2',
          logicalItemId: LOGICAL_ITEM_ID,
          displayKey: 'R-02',
          revisionNumber: 2,
          payload: PAYLOAD,
          impact: makeImpactRow({ subjectId: 'iv-2', path: ['iv-root', 'iv-2'] }),
        }),
      ]),
    );
    mockedGetDisplayKeys.mockResolvedValue(
      new Map([
        ['iv-root', 'R-07'],
        ['iv-2', 'R-02'],
      ]),
    );

    const response = await put({ payload: PAYLOAD, confirmed: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      item: {
        itemVersionId: 'iv-2',
        logicalItemId: LOGICAL_ITEM_ID,
        displayKey: 'R-02',
        itemType: 'requirement',
        revisionNumber: 2,
        payload: PAYLOAD,
        parentLogicalItemId: null,
        impact: {
          subjectKind: 'item_version',
          subjectId: 'iv-2',
          rootItemVersionId: 'iv-root',
          rootDisplayKey: 'R-07',
          depth: 1,
          path: ['R-07', 'R-02'],
          acknowledged: false,
        },
      },
      changedRefs,
    });
    expect(mockedCommit).toHaveBeenCalledWith('version-1', LOGICAL_ITEM_ID, PAYLOAD, true);
    expect(mockedPropose).not.toHaveBeenCalled();
  });

  it('forwards confirmed: false untouched', async () => {
    const response = await put({ payload: PAYLOAD, confirmed: false });

    expect(response.status).toBe(200);
    expect(mockedCommit).toHaveBeenCalledWith('version-1', LOGICAL_ITEM_ID, PAYLOAD, false);
  });

  it.each(errorCases)('returns 409 $code for $name', async ({ make, code, details }) => {
    mockedCommit.mockRejectedValue(make());

    const response = await put({ payload: PAYLOAD, confirmed: false });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe(code);
    if (details === undefined) expect(body.error).not.toHaveProperty('details');
    else expect(body.error.details).toEqual(details);
  });

  it('answers a generic 500 (not a fabricated item) if the committed item is missing from the fresh version', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetDetail.mockResolvedValue(makeDetail({}, []));

    const response = await put({ payload: PAYLOAD, confirmed: true });

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleSpy.mockRestore();
  });
});
