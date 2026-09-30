import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

// NFR-005 / Module Boundaries 4.9 rule 1: a database failure on a write that
// carries ciphertext must not carry the statement parameters (the encrypted
// token, the user id) into a message, a cause chain or a serialised error -
// Drizzle's error text includes them and the API layer logs unhandled errors.
const { dbMock, envMock, LEAK } = vi.hoisted(() => {
  // What a driver error looks like: the failing statement plus its parameters.
  const LEAK = 'v1:LEAKED-IV:LEAKED-TAG:LEAKED-CIPHERTEXT-user-4242';
  const failure = () =>
    Object.assign(new Error(`Failed query: insert into "provider_connection" params: ${LEAK}`), {
      code: '57014',
      query: `insert ... ${LEAK}`,
      params: [LEAK],
    });
  const rejecting = () => Promise.reject(failure());
  return {
    LEAK,
    envMock: { env: { CONNECTION_ENCRYPTION_KEY: '' } as Record<string, string | undefined> },
    dbMock: {
      insert: vi.fn(() => ({
        values: () => ({ onConflictDoUpdate: () => ({ returning: rejecting }) }),
      })),
      select: vi.fn(() => ({
        from: () => ({
          where: () =>
            Promise.resolve([
              {
                id: 'conn-1',
                userId: 'u1',
                provider: 'stitch',
                status: 'active',
                accessTokenEnc: 'ignored',
                refreshTokenEnc: null,
                externalAccountId: 'a',
                providerMeta: {},
              },
            ]),
        }),
      })),
      delete: vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([]) }) })),
      update: vi.fn(() => ({ set: () => ({ where: rejecting }) })),
    },
  };
});

vi.mock('@/lib/env', () => envMock);
vi.mock('@/db', async () => ({
  db: dbMock,
  schema: await vi.importActual('@/db/schema'),
}));

import { ConnectionStoreError } from '@/connections/errors';
import { disconnect, saveConnection } from '@/connections/store';

function serialised(error: unknown): string {
  const e = error as Error & { cause?: unknown };
  return JSON.stringify({
    message: e.message,
    stack: e.stack,
    cause: e.cause ?? null,
    own: Object.getOwnPropertyNames(e).map((k) => [k, String((e as never)[k])]),
    error,
  });
}

beforeEach(() => {
  envMock.env.CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});

describe('connection store write failures', () => {
  it('saveConnection: a failing upsert throws a fixed ConnectionStoreError that carries nothing of the driver error', async () => {
    const failure = await saveConnection({
      userId: 'u1',
      provider: 'stitch',
      externalAccountId: 'acct',
      displayName: 'k',
      accessToken: 'plaintext-token-value',
      scopes: [],
      providerMeta: {},
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectionStoreError);
    const e = failure as ConnectionStoreError;
    expect(e.message).toBe('The connection store could not persist the change.');
    expect(e.cause).toBeUndefined();
    const text = serialised(e);
    expect(text).not.toContain(LEAK);
    expect(text).not.toContain('LEAKED');
    expect(text).not.toContain('plaintext-token-value');
    expect(text).not.toContain('provider_connection');
  });

  it('disconnect: a failing tombstone write is the same fixed error', async () => {
    const failure = await disconnect('u1', 'stitch').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(ConnectionStoreError);
    expect((failure as Error).cause).toBeUndefined();
    expect(serialised(failure)).not.toContain('LEAKED');
  });
});
