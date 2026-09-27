import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/impact (API
// Contracts section 6). Mocks and the deliberately-real `_shared/external.ts`
// glue (`toImpactRowDTOs`) follow tests/unit/api/artifact-version-approve-route.test.ts:
// `@/auth`, `@/artifact-lifecycle` and the `@/external/*` modules that glue file
// statically imports are mocked, so no DB or env is ever touched.
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({ getImpactWarnings: vi.fn() }));

vi.mock('@/external/operations', () => ({ getDisplayKeysForItemVersions: vi.fn() }));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getImpactWarnings } from '@/artifact-lifecycle';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { GET } from '@/app/api/projects/[projectId]/impact/route';
import { ApiError } from '@/lib/errors';
import { USER, makeImpactRow } from './artifact-fixtures';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetImpactWarnings = vi.mocked(getImpactWarnings);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

function get(projectId = 'project-1') {
  return GET(new Request(`http://localhost/api/projects/${projectId}/impact`), {
    params: Promise.resolve({ projectId }),
  });
}

// One direct warning (R-01 -> S-01), one transitive (R-01 -> ADR-01 -> S-02) and
// one external ref (drift: created from a superseded R-01 - its path ends at the
// source item; the ref id is not in it, ERD 6.2).
const directRow = makeImpactRow({
  subjectId: 'iv-s1',
  rootItemVersionId: 'iv-r1',
  depth: 0,
  path: ['iv-r1', 'iv-s1'],
});
const transitiveRow = makeImpactRow({
  subjectId: 'iv-s2',
  rootItemVersionId: 'iv-r1',
  depth: 1,
  path: ['iv-r1', 'iv-adr1', 'iv-s2'],
  acknowledged: true,
});
const refRow = makeImpactRow({
  subjectKind: 'external_ref',
  subjectId: 'ref-1',
  rootItemVersionId: 'iv-r1',
  depth: 1,
  path: ['iv-r1'],
});
const displayKeys = new Map([
  ['iv-r1', 'R-01'],
  ['iv-adr1', 'ADR-01'],
  ['iv-s1', 'S-01'],
  ['iv-s2', 'S-02'],
]);

describe('GET /api/projects/:projectId/impact', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset().mockResolvedValue(USER);
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetImpactWarnings.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(displayKeys);
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
    expect(mockedGetImpactWarnings).not.toHaveBeenCalled();
  });

  it("returns 404 NOT_FOUND (never 403) for a project the caller doesn't own", async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await get();

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(mockedGetImpactWarnings).not.toHaveBeenCalled();
    expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
  });

  it("checks ownership of the path's project for the verified user, then reads that project's warnings", async () => {
    await get('project-7');

    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-7');
    expect(mockedGetImpactWarnings).toHaveBeenCalledWith('project-7');
  });

  it('returns 200 { warnings: [] } for a project with nothing flagged, without any display-key lookup', async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ warnings: [] });
    expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
  });

  it('serializes every row to an ImpactRowDTO: display keys for the root and every path entry (INV-023)', async () => {
    mockedGetImpactWarnings.mockResolvedValue([directRow, transitiveRow]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      warnings: [
        {
          subjectKind: 'item_version',
          subjectId: 'iv-s1',
          rootItemVersionId: 'iv-r1',
          rootDisplayKey: 'R-01',
          depth: 0,
          path: ['R-01', 'S-01'],
          acknowledged: false,
        },
        {
          subjectKind: 'item_version',
          subjectId: 'iv-s2',
          rootItemVersionId: 'iv-r1',
          rootDisplayKey: 'R-01',
          depth: 1,
          path: ['R-01', 'ADR-01', 'S-02'],
          acknowledged: true,
        },
      ],
    });
  });

  it('resolves display keys for the whole list in ONE batched lookup, never one per row', async () => {
    mockedGetImpactWarnings.mockResolvedValue([directRow, transitiveRow, refRow]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(mockedGetDisplayKeys).toHaveBeenCalledTimes(1);
    const [ids] = mockedGetDisplayKeys.mock.calls[0]!;
    expect([...ids].sort()).toEqual(['iv-adr1', 'iv-r1', 'iv-s1', 'iv-s2']);
  });

  it('serializes an external_ref row too, with its subject id and item-only path', async () => {
    mockedGetImpactWarnings.mockResolvedValue([refRow]);

    const response = await get();

    expect((await response.json()).warnings).toEqual([
      {
        subjectKind: 'external_ref',
        subjectId: 'ref-1',
        rootItemVersionId: 'iv-r1',
        rootDisplayKey: 'R-01',
        depth: 1,
        path: ['R-01'],
        acknowledged: false,
      },
    ]);
  });

  it('returns the rows in exactly the order artifact-lifecycle gave them (the route never reorders)', async () => {
    // getImpactWarnings owns the deterministic order (depth, root, kind, id);
    // whatever it hands back is what goes on the wire, in that order.
    mockedGetImpactWarnings.mockResolvedValue([transitiveRow, refRow, directRow]);

    const response = await get();

    expect((await response.json()).warnings.map((w: { subjectId: string }) => w.subjectId)).toEqual(
      ['iv-s2', 'ref-1', 'iv-s1'],
    );
  });

  it('never leaks anything beyond the ImpactRowDTO fields', async () => {
    mockedGetImpactWarnings.mockResolvedValue([directRow]);

    const response = await get();

    expect(Object.keys((await response.json()).warnings[0]).sort()).toEqual([
      'acknowledged',
      'depth',
      'path',
      'rootDisplayKey',
      'rootItemVersionId',
      'subjectId',
      'subjectKind',
    ]);
  });

  it('lets an unrecognized failure fall through to the generic 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetImpactWarnings.mockRejectedValue(new Error('boom'));

    const response = await get();

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleSpy.mockRestore();
  });
});
