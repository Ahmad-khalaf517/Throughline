import { beforeEach, describe, expect, it, vi } from 'vitest';

// artifact-lifecycle.createProject/getProjectById/listProjectsForOwner/
// updateProject (Module Boundaries 4.3, API Contracts section 3) against a
// mocked drizzle client - no live Postgres (E1-S5's testcontainers harness
// isn't built yet). `@/db/schema` is imported for real (pure table
// definitions, no connection needed - same approach as
// tests/unit/auth/require-project-owner.test.ts) so `eq`/`and`/`alias` build
// well-formed SQL fragments even though nothing ever executes them.
//
// What this suite does NOT attempt: asserting the *content* of the SQL
// fragments passed to `.where()`/`.leftJoin()` (e.g. that `listProjectsForOwner`
// truly filters by `owner_user_id` rather than something else). Our mock
// query builder accepts and ignores those arguments, so that part of the
// join is only verified by matching drizzle's own tested behaviour + a real
// Postgres run once E1-S5 lands. What IS asserted here is `artifact-lifecycle`'s
// own logic: which tables/values are written, the INV-007 frozen-check
// branch, and the row -> `ProjectWithArtifacts` reduction (the "always a real
// join, never a hardcoded null" requirement, E1-S8).
const { withTxMock, dbSelectMock } = vi.hoisted(() => ({
  withTxMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  return {
    schema,
    db: { select: dbSelectMock },
    withTx: withTxMock,
  };
});

import { schema } from '@/db';
import {
  BriefFrozenError,
  createProject,
  getProjectById,
  listProjectsForOwner,
  updateProject,
} from '@/artifact-lifecycle';

const now = new Date('2024-01-01T00:00:00.000Z');

function projectRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    ownerUserId: 'user-1',
    name: 'x',
    brief: 'y',
    inputContext: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// A fluent stand-in for drizzle's query builder: every chained method
// returns the same object; the terminal call in each chain resolves the
// configured rows/value (matching whichever method `artifact-lifecycle`
// actually awaits - `.returning()` for inserts, `.orderBy()`/`.limit()` for
// selects, and awaiting the builder itself for a plain `.update().set().where()`).
function makeSelectBuilder(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.from = vi.fn(() => builder);
  builder.innerJoin = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => Promise.resolve(rows));
  builder.limit = vi.fn(() => Promise.resolve(rows));
  return builder;
}

describe('createProject', () => {
  beforeEach(() => {
    withTxMock.mockReset();
  });

  function makeTx(row: ReturnType<typeof projectRow>) {
    const artifactValues = vi.fn().mockResolvedValue(undefined);
    const projectReturning = vi.fn().mockResolvedValue([row]);
    const projectValues = vi.fn(() => ({ returning: projectReturning }));
    const insert = vi.fn((table: unknown) => {
      if (table === schema.project) return { values: projectValues };
      if (table === schema.artifact) return { values: artifactValues };
      throw new Error('createProject inserted into an unexpected table');
    });
    return { insert, projectValues, artifactValues };
  }

  it('inserts the project then its 4 artifact rows inside one transaction (ERD 4.2)', async () => {
    const row = projectRow({ inputContext: { teamSize: 3 } });
    const tx = makeTx(row);
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    const result = await createProject('user-1', 'x', 'y', { teamSize: 3 });

    expect(result).toEqual(row);
    expect(tx.projectValues).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      name: 'x',
      brief: 'y',
      inputContext: { teamSize: 3 },
    });
    expect(tx.artifactValues).toHaveBeenCalledWith([
      { projectId: 'p1', type: 'requirements' },
      { projectId: 'p1', type: 'architecture' },
      { projectId: 'p1', type: 'ui_requirements' },
      { projectId: 'p1', type: 'backlog' },
    ]);
    expect(withTxMock).toHaveBeenCalledTimes(1);
  });

  it('defaults a missing inputContext to null rather than undefined', async () => {
    const tx = makeTx(projectRow());
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await createProject('user-1', 'x', 'y');

    expect(tx.projectValues).toHaveBeenCalledWith(expect.objectContaining({ inputContext: null }));
  });
});

describe('updateProject', () => {
  beforeEach(() => {
    withTxMock.mockReset();
    dbSelectMock.mockReset();
  });

  function makeUpdateTx(requirementsVersionRows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(requirementsVersionRows);
    const selectWhere = vi.fn(() => ({ limit }));
    const innerJoin = vi.fn(() => ({ where: selectWhere }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));

    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set }));

    return { select, update, set, updateWhere };
  }

  it('throws BriefFrozenError without writing when a Requirements version already exists (INV-007/T33)', async () => {
    const tx = makeUpdateTx([{ id: 'av-1' }]);
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(updateProject('project-1', { brief: 'new brief' })).rejects.toBeInstanceOf(
      BriefFrozenError,
    );
    expect(tx.update).not.toHaveBeenCalled();
  });

  it('proceeds with the update when brief changes and no Requirements version exists yet', async () => {
    const tx = makeUpdateTx([]);
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
    dbSelectMock.mockReturnValue(
      makeSelectBuilder([
        {
          project: projectRow({ brief: 'new brief' }),
          artifactType: null,
          approvedVersionId: null,
          draftVersionId: null,
        },
      ]),
    );

    const result = await updateProject('project-1', { brief: 'new brief' });

    expect(tx.update).toHaveBeenCalledWith(schema.project);
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ brief: 'new brief' }));
    expect(result.brief).toBe('new brief');
  });

  it('skips the frozen-check entirely for a name-only update', async () => {
    const tx = makeUpdateTx([{ id: 'would-freeze-if-checked' }]);
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));
    dbSelectMock.mockReturnValue(
      makeSelectBuilder([
        {
          project: projectRow({ name: 'Renamed' }),
          artifactType: null,
          approvedVersionId: null,
          draftVersionId: null,
        },
      ]),
    );

    const result = await updateProject('project-1', { name: 'Renamed' });

    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.update).toHaveBeenCalled();
    expect(result.name).toBe('Renamed');
  });
});

describe('getProjectById', () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
  });

  it('maps one left-joined row per artifact type into the artifacts record, defaulting absent types to null/null', async () => {
    dbSelectMock.mockReturnValue(
      makeSelectBuilder([
        {
          project: projectRow(),
          artifactType: 'requirements',
          approvedVersionId: 'av-req',
          draftVersionId: null,
        },
        {
          project: projectRow(),
          artifactType: 'architecture',
          approvedVersionId: null,
          draftVersionId: 'dv-arch',
        },
        // ui_requirements and backlog rows deliberately omitted: createProject
        // always creates all 4 artifact rows, but this reduction must not
        // assume that - a still-missing type must default, never come back
        // `undefined` (E1-S8: "don't hardcode null, use the real join").
      ]),
    );

    const result = await getProjectById('p1');

    expect(result?.artifacts).toEqual({
      requirements: { approvedVersionId: 'av-req', draftVersionId: null },
      architecture: { approvedVersionId: null, draftVersionId: 'dv-arch' },
      ui_requirements: { approvedVersionId: null, draftVersionId: null },
      backlog: { approvedVersionId: null, draftVersionId: null },
    });
  });

  it('returns null when no project row matches', async () => {
    dbSelectMock.mockReturnValue(makeSelectBuilder([]));

    const result = await getProjectById('missing');

    expect(result).toBeNull();
  });
});

describe('listProjectsForOwner', () => {
  beforeEach(() => {
    dbSelectMock.mockReset();
  });

  it('keeps distinct projects separate when reducing joined rows', async () => {
    dbSelectMock.mockReturnValue(
      makeSelectBuilder([
        {
          project: projectRow({ id: 'p1' }),
          artifactType: 'requirements',
          approvedVersionId: null,
          draftVersionId: null,
        },
        {
          project: projectRow({ id: 'p2', name: 'other' }),
          artifactType: 'requirements',
          approvedVersionId: null,
          draftVersionId: null,
        },
      ]),
    );

    const result = await listProjectsForOwner('user-1');

    expect(result.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});
