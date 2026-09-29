import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

// external-operations' round-14 behaviour (SCRUM-96 part A) against a mocked
// drizzle client and a mocked `connections` module - no live Postgres. The real
// insert-first protocol against PostgreSQL is covered by
// tests/integration/external/operations.test.ts and tests/integration/appendix-c.test.ts
// (T49/T50 app halves); this suite pins the pieces that are unit-testable:
//   - connection_id / target_descriptor.account_id are written in the SAME
//     insert-first row, and the closures receive { operationId };
//   - a ReconnectRequiredError never turns into failed/reconciliation_required
//     and never reaches send()/reconcile() when the recorded connection is unusable;
//   - hasOperationsFor counts every status except 'failed'.
const { ReconnectRequiredErrorFake, dbMock, withTxMock, statusMock, legacyAvailableMock } =
  vi.hoisted(() => {
    class ReconnectRequiredErrorFake extends Error {
      constructor(
        readonly provider: string,
        readonly reason: string,
        readonly connectionId: string,
      ) {
        super(`reconnect ${provider} (${reason})`);
      }
    }
    return {
      ReconnectRequiredErrorFake,
      dbMock: { insert: vi.fn(), update: vi.fn(), select: vi.fn() },
      withTxMock: vi.fn(),
      statusMock: vi.fn(),
      legacyAvailableMock: vi.fn(),
    };
  });

vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  return { schema, db: dbMock, withTx: withTxMock };
});

vi.mock('@/connections', () => ({
  ReconnectRequiredError: ReconnectRequiredErrorFake,
  getConnectionStatusForOperation: statusMock,
}));

vi.mock('@/lib/legacy-credentials', () => ({ legacyCredentialAvailable: legacyAvailableMock }));

import {
  DefinitiveProviderError,
  getOperationDTOState,
  hasOperationsFor,
  runOperation,
} from '@/external/operations';
import { toExternalOperationDTO } from '@/lib/serialize';

const base = {
  projectId: 'project-1',
  provider: 'stitch' as const,
  operationType: 'generate',
  operationKey: 'stitch:generate:v1',
  requestHash: 'hash-1',
  targetDescriptor: { uiRequirementsVersionId: 'v1' },
  sourceArtifactVersionId: 'v1',
};

/** `db.insert(...).values(v).onConflictDoNothing(...).returning(...)` resolving `rows`; captures `v`. */
function mockInsert(rows: Array<{ id: string }>) {
  const captured: { values?: Record<string, unknown> } = {};
  dbMock.insert.mockReturnValue({
    values: (v: Record<string, unknown>) => {
      captured.values = v;
      return { onConflictDoNothing: () => ({ returning: () => Promise.resolve(rows) }) };
    },
  });
  return captured;
}

/** A tx whose `select ... for('update')` returns `existing` and whose writes are recorded. */
function mockDecideTx(existing: Record<string, unknown>) {
  const updates: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ for: () => Promise.resolve([existing]) }) }),
    }),
    update: () => ({
      set: (v: unknown) => {
        updates.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  withTxMock.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
  return updates;
}

const existingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'op-1',
  projectId: 'project-1',
  provider: 'stitch',
  operationKey: base.operationKey,
  requestHash: base.requestHash,
  status: 'reconciliation_required',
  connectionId: 'conn-1',
  errorMessage: null,
  updatedAt: new Date(0),
  ...overrides,
});

beforeEach(() => {
  dbMock.insert.mockReset();
  dbMock.update.mockReset();
  dbMock.select.mockReset();
  withTxMock.mockReset();
  statusMock.mockReset();
  legacyAvailableMock.mockReset().mockReturnValue(true);
});

describe('runOperation - connection recording (ERD 7.2 step 0, 4.14)', () => {
  it('writes connection_id and target_descriptor.account_id in the insert-first row and hands the closures { operationId }', async () => {
    const captured = mockInsert([{ id: 'op-1' }]);
    const send = vi.fn().mockResolvedValue({ externalId: 'ext-1' });
    const ref = { id: 'ref-1' };
    withTxMock.mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        insert: () => ({ values: () => ({ returning: () => Promise.resolve([ref]) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      }),
    );

    const result = await runOperation({
      ...base,
      connectionId: 'conn-1',
      accountId: 'acct-42',
      send,
      reconcile: vi.fn(),
    });

    expect(result).toEqual({ status: 'completed', ref });
    expect(captured.values).toMatchObject({
      connectionId: 'conn-1',
      status: 'pending',
      targetDescriptor: { uiRequirementsVersionId: 'v1', account_id: 'acct-42' },
    });
    expect(send).toHaveBeenCalledWith({ operationId: 'op-1' });
  });

  it('records a legacy operation with connection_id NULL and no account_id (T50 app half)', async () => {
    const captured = mockInsert([{ id: 'op-2' }]);
    withTxMock.mockImplementation((fn: (t: unknown) => unknown) =>
      fn({
        insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'r' }]) }) }),
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      }),
    );

    await runOperation({
      ...base,
      connectionId: null,
      send: vi.fn().mockResolvedValue({ externalId: 'ext-2' }),
      reconcile: vi.fn(),
    });

    expect(captured.values?.connectionId).toBeNull();
    expect(captured.values?.targetDescriptor).toEqual(base.targetDescriptor);
  });

  it('refuses a connection-backed operation without an account snapshot before touching the database', async () => {
    await expect(
      runOperation({
        ...base,
        connectionId: 'conn-1',
        send: vi.fn(),
        reconcile: vi.fn(),
      }),
    ).rejects.toThrow(/accountId is required/);
    expect(dbMock.insert).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it('rethrows a ReconnectRequiredError from send() and never marks the operation failed', async () => {
    mockInsert([{ id: 'op-1' }]);
    const send = vi
      .fn()
      .mockRejectedValue(new ReconnectRequiredErrorFake('stitch', 'revoked', 'c'));

    await expect(
      runOperation({ ...base, connectionId: 'conn-1', accountId: 'a', send, reconcile: vi.fn() }),
    ).rejects.toBeInstanceOf(ReconnectRequiredErrorFake);
    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('still finalizes a DefinitiveProviderError as failed (unchanged by round 14)', async () => {
    mockInsert([{ id: 'op-1' }]);
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    dbMock.update.mockReturnValue({ set });

    const result = await runOperation({
      ...base,
      connectionId: null,
      send: vi.fn().mockRejectedValue(new DefinitiveProviderError('nope')),
      reconcile: vi.fn(),
    });

    expect(result).toEqual({ status: 'failed', errorMessage: 'nope' });
    expect(set).toHaveBeenCalledWith({ status: 'failed', errorMessage: 'nope' });
  });
});

describe('runOperation - existing row whose recorded connection is unusable (T49 app half)', () => {
  it.each(['needs_reauth', 'revoked', 'account_mismatch'] as const)(
    'reconcile of a %s connection throws ReconnectRequiredError, writes nothing and calls neither closure',
    async (status) => {
      mockInsert([]); // lost ON CONFLICT: the row exists
      const updates = mockDecideTx(existingRow({ status: 'reconciliation_required' }));
      statusMock.mockResolvedValue(status);
      const send = vi.fn();
      const reconcile = vi.fn();

      await expect(
        runOperation({ ...base, connectionId: 'conn-1', accountId: 'a', send, reconcile }),
      ).rejects.toMatchObject({ provider: 'stitch', reason: status, connectionId: 'conn-1' });

      expect(updates).toEqual([]);
      expect(send).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
      expect(dbMock.update).not.toHaveBeenCalled();
    },
  );

  it('does not move a stale pending row to reconciliation_required when the connection is unusable', async () => {
    mockInsert([]);
    const updates = mockDecideTx(existingRow({ status: 'pending', updatedAt: new Date(0) }));
    statusMock.mockResolvedValue('revoked');

    await expect(
      runOperation({
        ...base,
        connectionId: 'conn-1',
        accountId: 'a',
        send: vi.fn(),
        reconcile: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ReconnectRequiredErrorFake);
    expect(updates).toEqual([]);
  });

  it('does not reset a failed row to pending on retry when the connection is unusable', async () => {
    mockInsert([]);
    const updates = mockDecideTx(existingRow({ status: 'failed', errorMessage: 'old' }));
    statusMock.mockResolvedValue('needs_reauth');

    await expect(
      runOperation({
        ...base,
        connectionId: 'conn-1',
        accountId: 'a',
        send: vi.fn(),
        reconcile: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(ReconnectRequiredErrorFake);
    expect(updates).toEqual([]);
  });

  it('restores the prior status when the closure itself raises ReconnectRequiredError after the transition (refresh rejected)', async () => {
    mockInsert([]);
    const updates = mockDecideTx(existingRow({ status: 'failed', errorMessage: 'old' }));
    statusMock.mockResolvedValue('active');
    const restoreSet = vi.fn(() => ({ where: () => Promise.resolve() }));
    dbMock.update.mockReturnValue({ set: restoreSet });
    const send = vi
      .fn()
      .mockRejectedValue(new ReconnectRequiredErrorFake('stitch', 'refresh_rejected', 'c'));

    await expect(
      runOperation({ ...base, connectionId: 'conn-1', accountId: 'a', send, reconcile: vi.fn() }),
    ).rejects.toBeInstanceOf(ReconnectRequiredErrorFake);

    expect(updates).toEqual([{ status: 'pending', errorMessage: null }]);
    expect(send).toHaveBeenCalledWith({ operationId: 'op-1' });
    expect(restoreSet).toHaveBeenCalledWith({ status: 'failed', errorMessage: 'old' });
  });

  it('reconciles a legacy row (connection_id NULL) without any connection lookup', async () => {
    mockInsert([]);
    mockDecideTx(existingRow({ status: 'reconciliation_required', connectionId: null }));
    const reconcile = vi.fn().mockResolvedValue({ found: false });

    const result = await runOperation({ ...base, connectionId: null, send: vi.fn(), reconcile });

    expect(result).toEqual({ status: 'reconciliation_required' });
    expect(statusMock).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledWith({ operationId: 'op-1' });
  });
});

describe('getOperationDTOState - legacy_credential_missing (FR-090, UC-S8)', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    id: 'op-1',
    provider: 'stitch',
    operationType: 'generate',
    status: 'reconciliation_required',
    externalId: null,
    errorMessage: null,
    connectionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  });
  function mockGetById(row: Record<string, unknown> | undefined) {
    dbMock.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }) }),
    });
  }

  it('reports legacy_credential_missing for a legacy operation whose env credential is gone, and needsReconnect carries it without touching the status', async () => {
    mockGetById(stored());
    statusMock.mockResolvedValue('legacy');
    legacyAvailableMock.mockReturnValue(false);

    const state = await getOperationDTOState('op-1');

    expect(legacyAvailableMock).toHaveBeenCalledWith('stitch');
    expect(state?.connection).toBe('legacy_credential_missing');
    const dto = toExternalOperationDTO(state!);
    expect(dto.needsReconnect).toEqual({
      provider: 'stitch',
      reason: 'legacy_credential_missing',
    });
    expect(dto.status).toBe('reconciliation_required');
  });

  it('a legacy operation whose env credential is present reads as no reconnect needed', async () => {
    mockGetById(stored());
    statusMock.mockResolvedValue('legacy');

    const state = await getOperationDTOState('op-1');

    expect(state?.connection).toBe('legacy');
    expect(toExternalOperationDTO(state!).needsReconnect).toBeNull();
  });

  it('never consults the environment for a connection-backed operation', async () => {
    mockGetById(stored({ connectionId: 'conn-1' }));
    statusMock.mockResolvedValue('revoked');
    legacyAvailableMock.mockReturnValue(false);

    const state = await getOperationDTOState('op-1');

    expect(state?.connection).toBe('revoked');
    expect(toExternalOperationDTO(state!).needsReconnect).toEqual({
      provider: 'stitch',
      reason: 'revoked',
    });
  });

  it('is null for an unknown operation', async () => {
    mockGetById(undefined);
    await expect(getOperationDTOState('missing')).resolves.toBeNull();
  });
});

describe('hasOperationsFor (Module Boundaries 4.5, D2)', () => {
  function mockSelect(rows: unknown[]) {
    const where = vi.fn((_condition: unknown) => ({ limit: () => Promise.resolve(rows) }));
    dbMock.select.mockReturnValue({ from: () => ({ where }) });
    return where;
  }

  it('is true when any non-failed operation of that provider exists for the project', async () => {
    const where = mockSelect([{ id: 'op-1' }]);
    await expect(hasOperationsFor('project-1', 'github')).resolves.toBe(true);
    expect(where).toHaveBeenCalledOnce();
  });

  it('filters by project and provider and excludes only the failed status', async () => {
    const where = mockSelect([]);
    await hasOperationsFor('project-1', 'github');

    const query = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as never);
    expect(query.sql).toContain('"project_id" = $');
    expect(query.sql).toContain('"provider" = $');
    expect(query.sql).toContain('"status" <> $');
    expect(query.params).toEqual(['project-1', 'github', 'failed']);
  });

  it('is false when the project has none (or only failed ones - the query excludes them)', async () => {
    mockSelect([]);
    await expect(hasOperationsFor('project-1', 'github')).resolves.toBe(false);
  });
});
