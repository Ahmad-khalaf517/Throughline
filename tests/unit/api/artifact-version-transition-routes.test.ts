import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/artifact-versions/:versionId/
// request-revision and POST /api/artifact-versions/:versionId/reject (API
// Contracts section 4). The two routes have the same contract and differ only in
// which artifact-lifecycle transition they call, so one suite runs against both.
// Mocks and the deliberately-real `_shared/*` glue follow
// tests/unit/api/artifact-version-route.test.ts.
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
  requestRevision: vi.fn(),
  rejectVersion: vi.fn(),
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
  requestRevision,
  rejectVersion,
} from '@/artifact-lifecycle';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { POST as POST_REQUEST_REVISION } from '@/app/api/artifact-versions/[versionId]/request-revision/route';
import { POST as POST_REJECT } from '@/app/api/artifact-versions/[versionId]/reject/route';
import { ApiError } from '@/lib/errors';
import { USER, jsonRequest, makeDetail, makeRef, rawRequest } from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetVersionRef = vi.mocked(getVersionRef);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedRequestRevision = vi.mocked(requestRevision);
const mockedRejectVersion = vi.mocked(rejectVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

const suites = [
  {
    name: 'POST /api/artifact-versions/:versionId/request-revision',
    handler: POST_REQUEST_REVISION,
    path: 'request-revision',
    transition: mockedRequestRevision,
    other: mockedRejectVersion,
    statusReason: 'revision_requested',
  },
  {
    name: 'POST /api/artifact-versions/:versionId/reject',
    handler: POST_REJECT,
    path: 'reject',
    transition: mockedRejectVersion,
    other: mockedRequestRevision,
    statusReason: 'user_rejected',
  },
];

describe.each(suites)('$name', ({ handler, path, transition, other, statusReason }) => {
  const url = `http://localhost/api/artifact-versions/version-1/${path}`;

  function post(body?: unknown) {
    return handler(jsonRequest('POST', url, body), {
      params: Promise.resolve({ versionId: 'version-1' }),
    });
  }

  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetVersionRef.mockReset().mockResolvedValue(makeRef());
    mockedGetDetail.mockReset().mockResolvedValue(makeDetail({ status: 'rejected', statusReason }));
    mockedRequestRevision.mockReset().mockResolvedValue(undefined);
    mockedRejectVersion.mockReset().mockResolvedValue(undefined);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await post({});

    expect(response.status).toBe(401);
    expect(mockedGetVersionRef).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) for a version of a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await post({});

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(transition).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND for an unknown or malformed version id', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const response = await post({});

    expect(response.status).toBe(404);
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR for malformed JSON', async () => {
    const response = await handler(rawRequest('POST', url, '{oops'), {
      params: Promise.resolve({ versionId: 'version-1' }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(transition).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_ERROR when feedback is not a string', async () => {
    const response = await post({ feedback: 42 });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(transition).not.toHaveBeenCalled();
  });

  it('passes feedback to the transition and returns the now-rejected draft as { version }', async () => {
    const response = await post({ feedback: 'Tighten the acceptance criteria.' });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toMatchObject({ id: 'version-1', status: 'rejected', statusReason });
    expect(transition).toHaveBeenCalledWith(
      'version-1',
      'user-1',
      'Tighten the acceptance criteria.',
    );
    expect(other).not.toHaveBeenCalled();
  });

  it('treats an EMPTY body as {} (feedback omitted)', async () => {
    const response = await handler(new Request(url, { method: 'POST' }), {
      params: Promise.resolve({ versionId: 'version-1' }),
    });

    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledWith('version-1', 'user-1', undefined);
  });

  it('returns 409 VERSION_NOT_DRAFT when the version is no longer a draft', async () => {
    transition.mockRejectedValue(new FakeVersionNotDraftError('version-1'));

    const response = await post({});

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('VERSION_NOT_DRAFT');
  });

  it('lets an unrecognized failure fall through to the generic 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    transition.mockRejectedValue(new Error('boom'));

    const response = await post({});

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleSpy.mockRestore();
  });
});
