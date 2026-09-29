import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { env } from '@/lib/env';
import { CURRENT_KEY_VERSION, decryptSecret, encryptSecret, parseKey } from './crypto';
import { Credential } from './credential';
import {
  ConnectionConfigError,
  ConnectionInputError,
  ConnectionRequiredError,
  ConnectionStoreError,
  InvalidGrantError,
  ReconnectRequiredError,
  type ConnectionProvider,
} from './errors';
import { getRefresher, getRevoker } from './hooks';
import { validateProviderMeta } from './meta';

// Every read and write of provider_connection lives here (Module Boundaries
// 4.9: sole writer). The only other table touched is external_operation, and
// only by the documented narrow READS (rule 3).

const { providerConnection, externalOperation } = schema;
type Row = typeof providerConnection.$inferSelect;

export type Provider = ConnectionProvider;
export const PROVIDERS: readonly Provider[] = ['github', 'jira', 'stitch'];

export type ConnectionStatus = {
  provider: Provider;
  status: 'active' | 'needs_reauth' | 'revoked' | 'none';
  displayName: string | null;
  scopes: string[];
  connectedAt: Date | null;
};

export type OperationConnectionStatus =
  'active' | 'needs_reauth' | 'revoked' | 'legacy' | 'account_mismatch';

// Refresh when the access token is within this window of expiring (ERD 7.6).
const REFRESH_SKEW_MS = 60_000;
// Hard timeout for the single token-endpoint call made under the row lock.
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * Runs a write whose statement parameters include ciphertext. Any failure is
 * replaced by a `ConnectionStoreError`: the driver error (whose message carries
 * the SQL parameters) is neither attached as `cause` nor logged.
 */
async function guardWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw new ConnectionStoreError();
  }
}

function key(): Buffer {
  return parseKey(env.CONNECTION_ENCRYPTION_KEY);
}

function needsRefresh(row: Row): boolean {
  return (
    row.provider === 'jira' &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() - Date.now() <= REFRESH_SKEW_MS
  );
}

function toStatus(row: Row): ConnectionStatus {
  return {
    provider: row.provider as Provider,
    status: row.status as ConnectionStatus['status'],
    displayName: row.displayName,
    scopes: row.scopes === '' ? [] : row.scopes.split(' '),
    connectedAt: row.createdAt,
  };
}

function toCredential(row: Row): Credential {
  const userId = row.userId;
  return new Credential({
    connectionId: row.id,
    provider: row.provider as Provider,
    accountId: row.externalAccountId,
    accessToken: decryptSecret({
      stored: row.accessTokenEnc,
      userId,
      provider: row.provider,
      key: key(),
    }),
    meta: row.providerMeta as Record<string, string>,
  });
}

// Throws when the row is not usable; returns the row when it is 'active'.
function requireActive(row: Row): Row {
  if (row.status !== 'active') {
    throw new ReconnectRequiredError(
      row.provider as Provider,
      row.status === 'revoked' ? 'revoked' : 'needs_reauth',
      row.id,
    );
  }
  return row;
}

// ERD 7.6 refresh-with-rotation. The row lock is held across the one
// token-endpoint call and nothing else; the connection lock is never held while
// taking any other lock, and this module never touches the project lock.
async function refreshLocked(connectionId: string): Promise<Row> {
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(providerConnection)
      .where(eq(providerConnection.id, connectionId))
      .for('update');
    if (!row) {
      throw new Error('provider_connection row vanished during refresh.');
    }
    requireActive(row);
    // A concurrent caller may already have refreshed while we waited for the lock (T52).
    if (!needsRefresh(row)) return { kind: 'ok' as const, row };

    const provider = row.provider as Provider;
    const refresher = getRefresher(provider);
    if (!refresher) {
      throw new ConnectionConfigError(`No token refresher is registered for ${provider}.`);
    }
    if (!row.refreshTokenEnc) {
      await tx
        .update(providerConnection)
        .set({ status: 'needs_reauth' })
        .where(eq(providerConnection.id, row.id));
      return { kind: 'reconnect' as const, row };
    }

    const k = key();
    const refreshToken = decryptSecret({
      stored: row.refreshTokenEnc,
      userId: row.userId,
      provider,
      key: k,
    });
    let result;
    try {
      result = await refresher({
        refreshToken,
        accountId: row.externalAccountId,
        meta: row.providerMeta as Record<string, string>,
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        await tx
          .update(providerConnection)
          .set({ status: 'needs_reauth' })
          .where(eq(providerConnection.id, row.id));
        return { kind: 'reconnect' as const, row };
      }
      throw error;
    }

    const rotated = result.refreshToken ?? refreshToken;
    const rotatedValues = {
      accessTokenEnc: encryptSecret({
        plaintext: result.accessToken,
        userId: row.userId,
        provider,
        key: k,
      }),
      refreshTokenEnc: encryptSecret({
        plaintext: rotated,
        userId: row.userId,
        provider,
        key: k,
      }),
      expiresAt: result.expiresAt ?? null,
      keyVersion: CURRENT_KEY_VERSION,
    };
    const [updated] = await guardWrite(() =>
      tx
        .update(providerConnection)
        .set(rotatedValues)
        .where(eq(providerConnection.id, row.id))
        .returning(),
    );
    return { kind: 'ok' as const, row: updated! };
  });

  if (outcome.kind === 'reconnect') {
    // Thrown after COMMIT so the needs_reauth write persists.
    throw new ReconnectRequiredError(
      outcome.row.provider as Provider,
      'refresh_rejected',
      outcome.row.id,
    );
  }
  return outcome.row;
}

async function credentialFor(row: Row): Promise<Credential> {
  requireActive(row);
  const fresh = needsRefresh(row) ? await refreshLocked(row.id) : row;
  return toCredential(fresh);
}

export async function getCredential(userId: string, provider: Provider): Promise<Credential> {
  const [row] = await db
    .select()
    .from(providerConnection)
    .where(and(eq(providerConnection.userId, userId), eq(providerConnection.provider, provider)));
  if (!row) throw new ConnectionRequiredError(provider);
  return credentialFor(row);
}

// The documented narrow read of external_operation (Module Boundaries 4.9 rule 3).
async function readOperation(operationId: string) {
  const [op] = await db
    .select({
      connectionId: externalOperation.connectionId,
      provider: externalOperation.provider,
      accountId: sql<string | null>`${externalOperation.targetDescriptor}->>'account_id'`,
    })
    .from(externalOperation)
    .where(eq(externalOperation.id, operationId));
  if (!op) throw new Error('external_operation not found.');
  return op;
}

async function readConnection(id: string): Promise<Row> {
  const [row] = await db.select().from(providerConnection).where(eq(providerConnection.id, id));
  if (!row) throw new Error('provider_connection row not found.');
  return row;
}

function accountMismatch(row: Row, descriptorAccountId: string | null): boolean {
  return descriptorAccountId !== null && descriptorAccountId !== row.externalAccountId;
}

export async function getCredentialForOperation(
  operationId: string,
): Promise<Credential | { kind: 'legacy' }> {
  const op = await readOperation(operationId);
  if (op.connectionId === null) return { kind: 'legacy' };
  const row = requireActive(await readConnection(op.connectionId));
  if (accountMismatch(row, op.accountId)) {
    throw new ReconnectRequiredError(row.provider as Provider, 'account_mismatch', row.id);
  }
  return credentialFor(row);
}

export async function getConnectionStatusForOperation(
  operationId: string,
): Promise<OperationConnectionStatus> {
  const op = await readOperation(operationId);
  if (op.connectionId === null) return 'legacy';
  const row = await readConnection(op.connectionId);
  if (row.status !== 'active') return row.status as 'needs_reauth' | 'revoked';
  return accountMismatch(row, op.accountId) ? 'account_mismatch' : 'active';
}

export type SaveConnectionInput = {
  userId: string;
  provider: Provider;
  externalAccountId: string;
  displayName: string;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes: string[];
  providerMeta: Record<string, string>;
};

export async function saveConnection(input: SaveConnectionInput): Promise<ConnectionStatus> {
  if (!PROVIDERS.includes(input.provider)) {
    throw new ConnectionInputError('Unknown provider.');
  }
  const meta = validateProviderMeta(input.provider, input.providerMeta);
  const k = key();
  const accessTokenEnc = encryptSecret({
    plaintext: input.accessToken,
    userId: input.userId,
    provider: input.provider,
    key: k,
  });
  const refreshTokenEnc = input.refreshToken
    ? encryptSecret({
        plaintext: input.refreshToken,
        userId: input.userId,
        provider: input.provider,
        key: k,
      })
    : null;

  const values = {
    externalAccountId: input.externalAccountId,
    displayName: input.displayName,
    accessTokenEnc,
    refreshTokenEnc,
    expiresAt: input.expiresAt ?? null,
    scopes: input.scopes.join(' '),
    providerMeta: meta,
    status: 'active',
    keyVersion: CURRENT_KEY_VERSION,
  };
  // Same row, same id on a reconnect (revives needs_reauth and the revoked tombstone).
  const [row] = await guardWrite(() =>
    db
      .insert(providerConnection)
      .values({ userId: input.userId, provider: input.provider, ...values })
      .onConflictDoUpdate({
        target: [providerConnection.userId, providerConnection.provider],
        set: values,
      })
      .returning(),
  );
  return toStatus(row!);
}

function isForeignKeyViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && typeof e === 'object' && depth < 4; depth++) {
    if ((e as { code?: unknown }).code === '23503') return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function disconnect(
  userId: string,
  provider: Provider,
): Promise<{ providerRevoked: boolean | null }> {
  const [row] = await db
    .select()
    .from(providerConnection)
    .where(and(eq(providerConnection.userId, userId), eq(providerConnection.provider, provider)));
  if (!row) return { providerRevoked: null };

  // Provider-side revocation first, outside any transaction. A failure to
  // revoke never blocks removing the local credential.
  let providerRevoked: boolean | null = null;
  const revoker = getRevoker(provider);
  if (revoker && row.status !== 'revoked') {
    try {
      const k = key();
      providerRevoked = await revoker({
        accessToken: decryptSecret({
          stored: row.accessTokenEnc,
          userId,
          provider,
          key: k,
        }),
        refreshToken: row.refreshTokenEnc
          ? decryptSecret({ stored: row.refreshTokenEnc, userId, provider, key: k })
          : null,
        accountId: row.externalAccountId,
        meta: row.providerMeta as Record<string, string>,
      });
    } catch {
      providerRevoked = false;
    }
  }

  // DELETE only when nothing references the row; otherwise the tombstone.
  let deleted = false;
  try {
    const gone = await db
      .delete(providerConnection)
      .where(
        and(
          eq(providerConnection.id, row.id),
          sql`NOT EXISTS (SELECT 1 FROM external_operation WHERE connection_id = ${row.id})`,
        ),
      )
      .returning({ id: providerConnection.id });
    deleted = gone.length > 0;
  } catch (error) {
    // An operation referenced the row between the EXISTS and the DELETE: RESTRICT refused it.
    if (!isForeignKeyViolation(error)) throw error;
  }
  if (!deleted) {
    await guardWrite(() =>
      db
        .update(providerConnection)
        .set({
          status: 'revoked',
          accessTokenEnc: 'revoked',
          refreshTokenEnc: null,
          expiresAt: null,
        })
        .where(eq(providerConnection.id, row.id)),
    );
  }
  return { providerRevoked };
}

export async function listConnections(userId: string): Promise<ConnectionStatus[]> {
  const rows = await db
    .select()
    .from(providerConnection)
    .where(eq(providerConnection.userId, userId));
  return PROVIDERS.map((provider) => {
    const row = rows.find((r) => r.provider === provider);
    return row
      ? toStatus(row)
      : { provider, status: 'none' as const, displayName: null, scopes: [], connectedAt: null };
  });
}

export async function reportAuthFailure(connectionId: string): Promise<void> {
  // Only from 'active': a revoked tombstone must stay a valid tombstone (DB CHECK).
  await db
    .update(providerConnection)
    .set({ status: 'needs_reauth' })
    .where(and(eq(providerConnection.id, connectionId), eq(providerConnection.status, 'active')));
}
