import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

// withProjectLock/withTx are the write-path serialization primitives (ERD
// section 3.2; Module Boundaries section 4.1's `db` module). No table of its
// own, no real Postgres here - `@/db/client` is mocked so `db.transaction`
// is a controllable stub instead of a live connection (Appendix C has
// nothing to cover for this module; see the story's report).
//
// Imported via `@/db` (the package's index.ts), not `@/db/lock` - the deep
// path is ESLint-restricted to src/artifact-lifecycle only (Module
// Boundaries principle 3; eslint.config.mjs's no-restricted-imports).
const { transactionMock } = vi.hoisted(() => ({
  transactionMock: vi.fn(),
}));

vi.mock('@/db/client', () => ({
  db: { transaction: transactionMock },
}));

import { withProjectLock, withTx } from '@/db';

// A stand-in for drizzle's Tx - both functions under test only ever pass it
// through to the transaction callback / fn, never inspect its shape.
function fakeTx(executeMock: ReturnType<typeof vi.fn>) {
  return { execute: executeMock };
}

// Turns the drizzle `sql` tagged-template value passed to `tx.execute` into
// `{ sql, params }` via drizzle-orm's own dialect, rather than hand-walking
// `queryChunks`. A hand-rolled walker can't tell a bound `Param` chunk from
// a `StringChunk` produced by `sql.raw(...)` - both would render to the same
// literal text, so an exact-string assertion alone can't prove `projectId`
// is safely bound rather than raw-concatenated into the query. `sqlToQuery`
// keeps them separate: the SQL text carries a `$1` placeholder and the value
// itself only ever shows up in `params`.
const pgDialect = new PgDialect();
function toParameterizedQuery(sqlArg: SQL) {
  return pgDialect.sqlToQuery(sqlArg);
}

describe('withProjectLock', () => {
  let calls: string[];
  let executeMock: ReturnType<typeof vi.fn>;
  let tx: ReturnType<typeof fakeTx>;

  beforeEach(() => {
    transactionMock.mockReset();
    calls = [];
    // Resolves on a later microtask before recording 'lock', so this only
    // comes out ahead of 'fn' in the ordering assertion below if
    // withProjectLock actually awaits the lock statement before invoking
    // fn. A synchronous recording (calls.push before returning a resolved
    // promise) can't distinguish an awaited call from a fire-and-forget
    // one - both would push 'lock' before fn runs regardless of the
    // `await` in withProjectLock.
    executeMock = vi.fn().mockImplementation(async () => {
      await Promise.resolve();
      calls.push('lock');
    });
    tx = fakeTx(executeMock);
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx));
  });

  it.each([['project-123'], ['a-different-project']])(
    'takes the project advisory lock for %s before calling fn, in one transaction (ERD 3.2)',
    async (projectId) => {
      const fn = vi.fn().mockImplementation(async (calledWithTx: unknown) => {
        expect(calledWithTx).toBe(tx);
        calls.push('fn');
        return { ok: true, projectId };
      });

      const result = await withProjectLock(projectId, fn);

      expect(transactionMock).toHaveBeenCalledTimes(1);
      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['lock', 'fn']);

      const sqlArg = executeMock.mock.calls[0]?.[0];
      const { sql: renderedSql, params } = toParameterizedQuery(sqlArg);
      expect(renderedSql).toBe('select pg_advisory_xact_lock(hashtextextended($1, 0))');
      expect(params).toEqual([projectId]);

      expect(result).toEqual({ ok: true, projectId });
    },
  );

  // The lock key is the exact text Postgres hashes, and a uuid has more than
  // one spelling (`requireProjectOwner` accepts uppercase; Postgres compares
  // uuids case-insensitively). Every spelling of one project must take the SAME
  // lock, or a route handed an uppercase `:projectId` would not be serialized
  // against approval / acknowledgement, which pass the lowercase id Postgres returns.
  describe('lock key canonicalization', () => {
    const LOWER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const OTHER = 'f0e1d2c3-b4a5-4968-8776-655443322110';

    async function lockKeyFor(projectId: string): Promise<unknown[]> {
      executeMock.mockClear();
      await withProjectLock(projectId, async () => undefined);
      expect(executeMock).toHaveBeenCalledTimes(1);
      const { sql: renderedSql, params } = toParameterizedQuery(executeMock.mock.calls[0]?.[0]);
      expect(renderedSql).toBe('select pg_advisory_xact_lock(hashtextextended($1, 0))');
      return params;
    }

    it('derives the same lock key for the lowercase, UPPERCASE and mixed-case spellings of one uuid', async () => {
      const mixed = 'A1b2C3d4-E5f6-4A7b-8C9d-0E1f2A3b4C5d';

      const lower = await lockKeyFor(LOWER);
      const upper = await lockKeyFor(LOWER.toUpperCase());
      const mixedCase = await lockKeyFor(mixed);

      expect(lower).toEqual([LOWER]);
      expect(upper).toEqual(lower);
      expect(mixedCase).toEqual(lower);
    });

    it('leaves an already-lowercase id exactly as it was, so nothing else changes', async () => {
      await expect(lockKeyFor(LOWER)).resolves.toEqual([LOWER]);
      await expect(lockKeyFor('project-123')).resolves.toEqual(['project-123']);
    });

    it('still derives different lock keys for two different uuids, whatever their case', async () => {
      const first = await lockKeyFor(LOWER);
      const second = await lockKeyFor(OTHER);
      const secondUpper = await lockKeyFor(OTHER.toUpperCase());

      expect(second).not.toEqual(first);
      expect(secondUpper).toEqual(second);
      expect(secondUpper).not.toEqual(first);
    });
  });

  it('rejects with the lock error and never calls fn when the advisory lock statement fails', async () => {
    // Guards ERD section 9 R1/R2: if a future refactor wrapped the lock
    // statement in a try/catch (or otherwise swallowed its rejection), the
    // write path would run unserialized - exactly the race this module
    // exists to prevent.
    const boom = new Error('lock failed');
    executeMock.mockImplementation(async () => {
      await Promise.resolve();
      throw boom;
    });
    const fn = vi.fn();

    await expect(withProjectLock('project-123', fn)).rejects.toThrow('lock failed');

    expect(fn).not.toHaveBeenCalled();
  });

  it('propagates a rejection from fn without swallowing it', async () => {
    const boom = new Error('persist failed');
    await expect(withProjectLock('project-123', vi.fn().mockRejectedValue(boom))).rejects.toThrow(
      'persist failed',
    );
  });
});

describe('withTx', () => {
  beforeEach(() => {
    transactionMock.mockReset();
  });

  it('runs fn inside a transaction without issuing any advisory lock call', async () => {
    const executeMock = vi.fn();
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb(fakeTx(executeMock)),
    );
    const fn = vi.fn().mockResolvedValue('plain-result');

    const result = await withTx(fn);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    // withTx passes fn straight through to db.transaction - no wrapper, no
    // pg_advisory_xact_lock call, unlike withProjectLock above.
    expect(transactionMock).toHaveBeenCalledWith(fn);
    expect(executeMock).not.toHaveBeenCalled();
    expect(result).toBe('plain-result');
  });

  it('propagates a rejection from fn without swallowing it', async () => {
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(fakeTx(vi.fn())));

    const boom = new Error('read failed');
    await expect(withTx(vi.fn().mockRejectedValue(boom))).rejects.toThrow('read failed');
  });
});
