import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// external-operations.unlinkGithubRepository (UC-S10, TR FR-091, ERD 7.7,
// T53's unit half) against a mocked transaction - no live Postgres. The real
// deletes, FKs and the "fresh init afterwards" flow run against PostgreSQL in
// tests/integration/appendix-c.test.ts (T53). This suite pins: the lock (same
// key and salt as insertOperationRow), the in-flight refusal, the delete
// order (ref before operation, RESTRICT FK), what is and is not deleted, and
// that nothing here can reach a provider.
const { withTxMock, dbMock } = vi.hoisted(() => ({
  withTxMock: vi.fn(),
  dbMock: { insert: vi.fn(), update: vi.fn(), select: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  return { schema, db: dbMock, withTx: withTxMock };
});
vi.mock('@/connections', () => ({
  ReconnectRequiredError: class extends Error {},
  getConnectionStatusForOperation: vi.fn(),
}));
vi.mock('@/lib/legacy-credentials', () => ({ legacyCredentialAvailable: vi.fn() }));

import { schema } from '@/db';
import { UnlinkBlockedError, unlinkGithubRepository } from '@/external/operations';

const dialect = new PgDialect();

type Step = {
  kind: 'lock' | 'inflight-select' | 'delete-ref' | 'delete-operation';
  query?: { sql: string; params: unknown[] };
};

function mockTx(opts: { inFlight?: boolean; refs?: Record<string, unknown>[] }) {
  const steps: Step[] = [];
  const render = (cond: unknown) => dialect.sqlToQuery(cond as never);
  const tx = {
    execute: (query: unknown) => {
      steps.push({ kind: 'lock', query: render(query) });
      return Promise.resolve();
    },
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: () => {
            steps.push({ kind: 'inflight-select', query: render(cond) });
            return Promise.resolve(opts.inFlight ? [{ id: 'op-active' }] : []);
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (cond: unknown) => {
        const kind = table === schema.externalRef ? 'delete-ref' : 'delete-operation';
        steps.push({ kind, query: render(cond) });
        return {
          returning: () => Promise.resolve(opts.refs ?? []),
          then: (resolve: (value: unknown) => unknown) => resolve(undefined),
        };
      },
    }),
    insert: vi.fn(),
    update: vi.fn(),
  };
  withTxMock.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  return { steps, tx };
}

const ref = (overrides: Record<string, unknown> = {}) => ({
  externalKey: 'octo/my-repo',
  externalUrl: 'https://github.com/octo/my-repo',
  externalOperationId: 'op-done',
  ...overrides,
});

beforeEach(() => {
  withTxMock.mockReset();
  for (const fn of Object.values(dbMock)) fn.mockReset();
});

describe('unlinkGithubRepository', () => {
  it('takes the same per-project GitHub advisory lock runOperation takes (project id || ":external:github", salt 1) first', async () => {
    const { steps } = mockTx({ refs: [ref()] });

    await unlinkGithubRepository('proj-1');

    expect(steps[0]!.kind).toBe('lock');
    expect(steps[0]!.query!.sql).toContain('pg_advisory_xact_lock(hashtextextended(');
    // Literal suffix and salt, exactly as insertOperationRow writes them.
    expect(steps[0]!.query!.sql).toContain("|| ':external:github', 1)");
    expect(steps[0]!.query!.params).toEqual(['proj-1']);
  });

  it('returns null and deletes no operation when the project has no GitHub ref', async () => {
    const { steps } = mockTx({ refs: [] });

    await expect(unlinkGithubRepository('proj-1')).resolves.toBeNull();

    expect(steps.map((s) => s.kind)).toEqual(['lock', 'inflight-select', 'delete-ref']);
  });

  it('throws UnlinkBlockedError while a pending / reconciliation_required GitHub operation exists, deleting nothing', async () => {
    const { steps } = mockTx({ inFlight: true, refs: [ref()] });

    await expect(unlinkGithubRepository('proj-1')).rejects.toBeInstanceOf(UnlinkBlockedError);

    expect(steps.map((s) => s.kind)).toEqual(['lock', 'inflight-select']);
    const params = steps[1]!.query!.params;
    expect(params).toEqual(
      expect.arrayContaining(['proj-1', 'github', 'pending', 'reconciliation_required']),
    );
    expect(params).not.toContain('completed');
    expect(params).not.toContain('failed');
  });

  it("deletes the ref BEFORE the completed operation that produced it, scoped to the project's github rows, and returns name/url", async () => {
    const { steps } = mockTx({ refs: [ref()] });

    const removed = await unlinkGithubRepository('proj-1');

    expect(removed).toEqual({ name: 'octo/my-repo', url: 'https://github.com/octo/my-repo' });
    expect(steps.map((s) => s.kind)).toEqual([
      'lock',
      'inflight-select',
      'delete-ref',
      'delete-operation',
    ]);
    const refDelete = steps[2]!.query!;
    expect(refDelete.sql).toContain('"external_ref"."project_id"');
    expect(refDelete.sql).toContain('"external_ref"."provider"');
    expect(refDelete.params).toEqual(['proj-1', 'github']);

    // Only the operation that produced the ref, only if completed - `failed` rows are kept.
    const opDelete = steps[3]!.query!;
    expect(opDelete.sql).toContain('"external_operation"."status"');
    expect(opDelete.params).toEqual(['proj-1', 'github', 'completed', 'op-done']);
  });

  it('returns null name/url for a ref adopted through reconciliation that stored neither', async () => {
    mockTx({ refs: [ref({ externalKey: null, externalUrl: null })] });

    await expect(unlinkGithubRepository('proj-1')).resolves.toEqual({ name: null, url: null });
  });

  it('never touches the top-level db client (everything happens in the one transaction)', async () => {
    mockTx({ refs: [ref()] });

    await unlinkGithubRepository('proj-1');

    expect(withTxMock).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(dbMock)) expect(fn).not.toHaveBeenCalled();
  });
});
