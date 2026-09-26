import { beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests for src/app/api/_shared/artifacts.ts's own logic (E3-S10): the
// `:type`/`:logicalItemId` parsers, the FR-080 prerequisite table, the `:type` ->
// artifact-type-module dispatch table, the lifecycle-error mapper and
// `resolveOwnedVersion`/`loadVersionDTO`. The route tests exercise these through
// the handlers; this file pins each helper's contract directly. Every module the
// file imports is mocked (nothing here touches a DB or env).
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

import { requireProjectOwner } from '@/auth';
import { getVersionRef, getArtifactVersionDetail } from '@/artifact-lifecycle';
import {
  generate as generateArchitecture,
  getOptionsForVersion,
} from '@/artifact-types/architecture';
import {
  generate as generateRequirements,
  qualityGate as qualityGateRequirements,
} from '@/artifact-types/requirements';
import { generate as generateUiRequirements } from '@/artifact-types/ui-requirements';
import {
  generate as generateBacklog,
  qualityGate as qualityGateBacklog,
} from '@/artifact-types/backlog';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import {
  ARTIFACT_PREREQUISITES,
  ARTIFACT_TYPE_DISPATCH,
  loadVersionDTO,
  missingPrerequisites,
  parseArtifactType,
  parseLogicalItemId,
  prerequisiteVersionIds,
  resolveOwnedVersion,
  translateLifecycleError,
} from '@/app/api/_shared/artifacts';
import { ApiError } from '@/lib/errors';
import { ARTIFACT_TYPES } from '@/lib/serialize';
import {
  LOGICAL_ITEM_ID,
  makeDetail,
  makeImpactRow,
  makeItem,
  makeProject,
  makeRef,
} from './artifact-fixtures';

const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetVersionRef = vi.mocked(getVersionRef);
const mockedGetDetail = vi.mocked(getArtifactVersionDetail);
const mockedGetOptions = vi.mocked(getOptionsForVersion);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the function to throw');
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('parseArtifactType', () => {
  it.each(ARTIFACT_TYPES)('accepts %s', (type) => {
    expect(parseArtifactType(type)).toBe(type);
  });

  it.each([
    '',
    'roadmap',
    'Requirements',
    'REQUIREMENTS',
    ' requirements',
    'ui-requirements',
    'uiRequirements',
  ])('rejects %j with 404 NOT_FOUND', (raw) => {
    const error = thrownBy(() => parseArtifactType(raw));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('parseLogicalItemId', () => {
  it('returns a well-formed uuid unchanged', () => {
    expect(parseLogicalItemId(LOGICAL_ITEM_ID)).toBe(LOGICAL_ITEM_ID);
    expect(parseLogicalItemId(LOGICAL_ITEM_ID.toUpperCase())).toBe(LOGICAL_ITEM_ID.toUpperCase());
  });

  it.each([
    '',
    'abc',
    '12345',
    `${LOGICAL_ITEM_ID}x`,
    `x${LOGICAL_ITEM_ID}`,
    "1'; DROP TABLE item;--",
  ])('rejects %j with 404 NOT_FOUND', (raw) => {
    const error = thrownBy(() => parseLogicalItemId(raw));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('ARTIFACT_PREREQUISITES (TR FR-080)', () => {
  it('is exactly the documented table, in canonical order', () => {
    expect(ARTIFACT_PREREQUISITES).toEqual({
      requirements: [],
      architecture: ['requirements'],
      ui_requirements: ['requirements', 'architecture'],
      backlog: ['requirements', 'architecture', 'ui_requirements'],
    });
  });
});

describe('missingPrerequisites', () => {
  it.each([
    ['requirements', {}, []],
    ['architecture', {}, ['requirements']],
    ['architecture', { requirements: 'r' }, []],
    ['ui_requirements', {}, ['requirements', 'architecture']],
    ['ui_requirements', { architecture: 'a' }, ['requirements']],
    ['ui_requirements', { requirements: 'r' }, ['architecture']],
    ['ui_requirements', { requirements: 'r', architecture: 'a' }, []],
    ['backlog', {}, ['requirements', 'architecture', 'ui_requirements']],
    ['backlog', { ui_requirements: 'u' }, ['requirements', 'architecture']],
    ['backlog', { requirements: 'r', architecture: 'a' }, ['ui_requirements']],
    ['backlog', { requirements: 'r', architecture: 'a', ui_requirements: 'u' }, []],
  ] as const)('%s with approved %j is missing %j', (type, approved, missing) => {
    expect(missingPrerequisites(makeProject(approved), type)).toEqual(missing);
  });

  it("never counts the type's OWN approved version as a prerequisite", () => {
    expect(missingPrerequisites(makeProject({ backlog: 'b' }), 'backlog')).toEqual([
      'requirements',
      'architecture',
      'ui_requirements',
    ]);
  });

  it('counts a draft-only prerequisite as missing (only an approved version satisfies FR-080)', () => {
    const project = makeProject();
    project.artifacts.requirements.draftVersionId = 'draft-1';

    expect(missingPrerequisites(project, 'architecture')).toEqual(['requirements']);
  });
});

describe('prerequisiteVersionIds', () => {
  it("returns the prerequisites' approved version ids in canonical order, never the type's own", () => {
    const project = makeProject({
      backlog: 'backlog-v9',
      ui_requirements: 'ui-v3',
      architecture: 'arch-v2',
      requirements: 'req-v1',
    });

    expect(prerequisiteVersionIds(project, 'requirements')).toEqual([]);
    expect(prerequisiteVersionIds(project, 'architecture')).toEqual(['req-v1']);
    expect(prerequisiteVersionIds(project, 'ui_requirements')).toEqual(['req-v1', 'arch-v2']);
    expect(prerequisiteVersionIds(project, 'backlog')).toEqual(['req-v1', 'arch-v2', 'ui-v3']);
  });

  it('skips a prerequisite with no approved version rather than fabricating an id', () => {
    expect(prerequisiteVersionIds(makeProject({ architecture: 'arch-v2' }), 'backlog')).toEqual([
      'arch-v2',
    ]);
  });
});

describe('ARTIFACT_TYPE_DISPATCH', () => {
  it('covers exactly the four artifact types', () => {
    expect(Object.keys(ARTIFACT_TYPE_DISPATCH).sort()).toEqual([...ARTIFACT_TYPES].sort());
  });

  it("dispatches each type to its own module's generate", () => {
    expect(ARTIFACT_TYPE_DISPATCH.requirements.generate).toBe(generateRequirements);
    expect(ARTIFACT_TYPE_DISPATCH.architecture.generate).toBe(generateArchitecture);
    expect(ARTIFACT_TYPE_DISPATCH.ui_requirements.generate).toBe(generateUiRequirements);
    expect(ARTIFACT_TYPE_DISPATCH.backlog.generate).toBe(generateBacklog);
  });

  it('has a quality gate only for requirements (FR-012) and backlog (FR-063)', () => {
    expect(ARTIFACT_TYPE_DISPATCH.requirements.qualityGate).toBe(qualityGateRequirements);
    expect(ARTIFACT_TYPE_DISPATCH.backlog.qualityGate).toBe(qualityGateBacklog);
    expect(ARTIFACT_TYPE_DISPATCH.architecture.qualityGate).toBeNull();
    expect(ARTIFACT_TYPE_DISPATCH.ui_requirements.qualityGate).toBeNull();
  });

  it('gives a default item type only to requirements and ui_requirements', () => {
    expect(ARTIFACT_TYPE_DISPATCH.requirements.defaultItemType).toBe('requirement');
    expect(ARTIFACT_TYPE_DISPATCH.ui_requirements.defaultItemType).toBe('ui_requirement');
    expect(ARTIFACT_TYPE_DISPATCH.architecture.defaultItemType).toBeUndefined();
    expect(ARTIFACT_TYPE_DISPATCH.backlog.defaultItemType).toBeUndefined();
  });
});

describe('translateLifecycleError', () => {
  it('maps VersionNotDraftError to 409 VERSION_NOT_DRAFT', () => {
    const mapped = translateLifecycleError(new FakeVersionNotDraftError('v'));

    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped).toMatchObject({ code: 'VERSION_NOT_DRAFT', status: 409 });
  });

  it.each([
    ['VERSION_NOT_DRAFT', undefined],
    ['ITEM_NOT_IN_VERSION', undefined],
    ['UPSTREAM_REMOVED', { logicalItemId: 'l-1', displayKey: 'R-07' }],
    [
      'CONFIRMATION_REQUIRED',
      { changedRefs: [{ logicalItemId: 'l-1', displayKey: 'R-07', from: 'a', to: 'b' }] },
    ],
  ])(
    'maps ItemEditError %s to the same-named 409 ApiError, carrying its details',
    (code, details) => {
      const mapped = translateLifecycleError(new FakeItemEditError(code, 'message', details));

      expect(mapped).toBeInstanceOf(ApiError);
      expect(mapped).toMatchObject({ code, status: 409 });
      expect((mapped as ApiError).details).toEqual(details);
    },
  );

  it('returns anything else unchanged (same reference) for the caller to rethrow', () => {
    const plain = new Error('boom');
    const gateBlocked = new FakeApprovalGateBlockedError('blocked');
    const unknownItemEdit = new FakeItemEditError('SOMETHING_NEW', 'x');

    expect(translateLifecycleError(plain)).toBe(plain);
    // ApprovalGateBlockedError is the approve route's own to translate (its 409 body is built from the
    // display keys the error itself carries).
    expect(translateLifecycleError(gateBlocked)).toBe(gateBlocked);
    expect(translateLifecycleError(unknownItemEdit)).toBe(unknownItemEdit);
    expect(translateLifecycleError('a string')).toBe('a string');
  });
});

describe('resolveOwnedVersion', () => {
  beforeEach(() => {
    mockedRequireProjectOwner.mockReset().mockResolvedValue(undefined);
    mockedGetVersionRef.mockReset().mockResolvedValue(makeRef({ projectId: 'project-9' }));
  });

  it("returns the version's ref after checking ownership of ITS project", async () => {
    const ref = await resolveOwnedVersion('user-1', 'version-1');

    expect(ref).toEqual(makeRef({ projectId: 'project-9' }));
    expect(mockedGetVersionRef).toHaveBeenCalledWith('version-1');
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-9');
  });

  it('answers a version that does not exist with 404 NOT_FOUND, without any ownership check', async () => {
    mockedGetVersionRef.mockResolvedValue(null);

    const error = await rejectionOf(resolveOwnedVersion('user-1', 'nope'));

    expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it("answers another owner's version with a 404 indistinguishable from a nonexistent one (same message too)", async () => {
    mockedGetVersionRef.mockResolvedValueOnce(null);
    const missing = (await rejectionOf(resolveOwnedVersion('user-1', 'nope'))) as ApiError;

    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));
    const foreign = (await rejectionOf(resolveOwnedVersion('user-1', 'version-1'))) as ApiError;

    expect(foreign).toBeInstanceOf(ApiError);
    expect(foreign.code).toBe(missing.code);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.message).toBe(missing.message);
    expect(foreign.message).not.toMatch(/project/i);
  });

  it('rethrows any other failure from the ownership check untouched', async () => {
    const outage = new Error('database unavailable');
    mockedRequireProjectOwner.mockRejectedValue(outage);

    expect(await rejectionOf(resolveOwnedVersion('user-1', 'version-1'))).toBe(outage);
  });
});

describe('loadVersionDTO', () => {
  beforeEach(() => {
    mockedGetDetail.mockReset().mockResolvedValue(makeDetail());
    mockedGetOptions.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
  });

  it('throws 404 NOT_FOUND when the version no longer exists', async () => {
    mockedGetDetail.mockResolvedValue(null);

    expect(await rejectionOf(loadVersionDTO('version-1'))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('makes no display-key lookup at all when no item carries an impact row', async () => {
    mockedGetDetail.mockResolvedValue(
      makeDetail({}, [makeItem(), makeItem({ itemVersionId: 'iv-2' })]),
    );

    const dto = await loadVersionDTO('version-1');

    expect(dto.items).toHaveLength(2);
    expect(mockedGetDisplayKeys).not.toHaveBeenCalled();
  });

  it('only reads options for an architecture version', async () => {
    await loadVersionDTO('version-1');
    expect(mockedGetOptions).not.toHaveBeenCalled();

    mockedGetDetail.mockResolvedValue(makeDetail({ artifactType: 'architecture' }));
    const dto = await loadVersionDTO('version-1');
    expect(mockedGetOptions).toHaveBeenCalledWith('version-1');
    expect(dto.options).toEqual([]);
  });

  it('resolves a shared root and path in one lookup for several impacted items', async () => {
    mockedGetDetail.mockResolvedValue(
      makeDetail({}, [
        makeItem({
          itemVersionId: 'iv-1',
          impact: makeImpactRow({ subjectId: 'iv-1', path: ['iv-root', 'iv-1'] }),
        }),
        makeItem({
          itemVersionId: 'iv-2',
          impact: makeImpactRow({ subjectId: 'iv-2', path: ['iv-root', 'iv-2'] }),
        }),
      ]),
    );
    mockedGetDisplayKeys.mockResolvedValue(
      new Map([
        ['iv-root', 'R-01'],
        ['iv-1', 'S-01'],
        ['iv-2', 'S-02'],
      ]),
    );

    const dto = await loadVersionDTO('version-1');

    expect(mockedGetDisplayKeys).toHaveBeenCalledTimes(1);
    expect(dto.items.map((item) => item.impact?.path)).toEqual([
      ['R-01', 'S-01'],
      ['R-01', 'S-02'],
    ]);
  });
});
