import { beforeEach, describe, expect, it, vi } from 'vitest';

// artifact-lifecycle.updateProjectTargets (Module Boundaries 4.3, ERD 4.2,
// FR-088) against a mocked drizzle client - same approach as project.test.ts.
// Pinned here: it takes the project lock, writes ONLY the three target
// columns, treats absent as unchanged / null as clear, validates before taking
// the lock, and never reads external_operation or calls a provider (the route
// does that beforehand).
const { withProjectLockMock, dbSelectMock } = vi.hoisted(() => ({
  withProjectLockMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  return {
    schema,
    db: { select: dbSelectMock },
    withTx: vi.fn(),
    withProjectLock: withProjectLockMock,
  };
});

// See project.test.ts: the barrel transitively imports env-validated modules.
vi.mock('@/ai-client', () => ({
  linkGenerationRun: vi.fn(),
  generateStructured: vi.fn(),
}));

import { schema } from '@/db';
import { InvalidProjectTargetsError, updateProjectTargets } from '@/artifact-lifecycle';

const now = new Date('2024-01-01T00:00:00.000Z');

function projectRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p1',
    ownerUserId: 'user-1',
    name: 'x',
    brief: 'y',
    inputContext: null,
    githubOwner: null,
    jiraCloudId: null,
    jiraProjectKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockProjectRead(row: ReturnType<typeof projectRow> | null) {
  const builder: Record<string, unknown> = {};
  builder.from = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.orderBy = vi.fn(() =>
    Promise.resolve(
      row
        ? [{ project: row, artifactType: null, approvedVersionId: null, draftVersionId: null }]
        : [],
    ),
  );
  dbSelectMock.mockReturnValue(builder);
}

/** Runs the lock callback against a tx that records `update(table).set(values)`. */
function mockLock() {
  const writes: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const tx = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        writes.push({ table, values });
        return { where: () => Promise.resolve() };
      },
    }),
    select: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
  };
  withProjectLockMock.mockImplementation((_id: string, fn: (t: typeof tx) => unknown) => fn(tx));
  return { writes, tx };
}

describe('updateProjectTargets', () => {
  beforeEach(() => {
    withProjectLockMock.mockReset();
    dbSelectMock.mockReset();
  });

  it('writes only github_owner under the project lock and returns the re-read project', async () => {
    const { writes, tx } = mockLock();
    mockProjectRead(projectRow({ githubOwner: 'acme' }));

    const project = await updateProjectTargets('p1', { githubOwner: 'acme' });

    expect(withProjectLockMock).toHaveBeenCalledWith('p1', expect.any(Function));
    expect(writes).toEqual([{ table: schema.project, values: { githubOwner: 'acme' } }]);
    expect(project.githubOwner).toBe('acme');
    // No other table is read or written inside the lock.
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('sets the Jira pair together', async () => {
    const { writes } = mockLock();
    mockProjectRead(projectRow({ jiraCloudId: 'cloud-1', jiraProjectKey: 'PROJ' }));

    await updateProjectTargets('p1', { jira: { cloudId: ' cloud-1 ', projectKey: 'PROJ' } });

    expect(writes[0]?.values).toEqual({ jiraCloudId: 'cloud-1', jiraProjectKey: 'PROJ' });
  });

  it('clears with null - the Jira pair together, the owner on its own', async () => {
    const { writes } = mockLock();
    mockProjectRead(projectRow());

    await updateProjectTargets('p1', { githubOwner: null, jira: null });

    expect(writes[0]?.values).toEqual({
      githubOwner: null,
      jiraCloudId: null,
      jiraProjectKey: null,
    });
  });

  it('leaves absent fields unchanged and does not even take the lock when nothing is given', async () => {
    mockLock();
    mockProjectRead(projectRow());

    await updateProjectTargets('p1', {});

    expect(withProjectLockMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a blank owner', { githubOwner: '  ' }],
    ['a blank cloudId', { jira: { cloudId: ' ', projectKey: 'PROJ' } }],
    ['a blank projectKey', { jira: { cloudId: 'cloud-1', projectKey: '' } }],
    [
      'half a pair',
      { jira: { cloudId: 'cloud-1' } as unknown as { cloudId: string; projectKey: string } },
    ],
  ])('rejects %s before taking the lock', async (_label, targets) => {
    await expect(updateProjectTargets('p1', targets)).rejects.toBeInstanceOf(
      InvalidProjectTargetsError,
    );
    expect(withProjectLockMock).not.toHaveBeenCalled();
  });

  it('throws when the project vanished (the route already proved ownership)', async () => {
    mockLock();
    mockProjectRead(null);
    await expect(updateProjectTargets('p1', { githubOwner: 'acme' })).rejects.toThrow(
      /not found after updating targets/,
    );
  });
});
