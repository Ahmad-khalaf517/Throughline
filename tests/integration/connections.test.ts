import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// The connections module (Module Boundaries 4.9, ERD 4.17 / 7.6) against real
// Testcontainers Postgres: real CHECKs, the real FK RESTRICT and real row
// locks. Covers the application halves of T45, T51 and T52, and the
// connections-side half of T49 (the reconcile/retry half needs
// external-operations and stays it.todo in appendix-c.test.ts).
//
// Same dynamic-import-after-env pattern as the other integration files:
// @/db reads DATABASE_URL from @/lib/env at import time.
//
// NOT EXECUTED when written - Docker/Testcontainers was unavailable on the
// authoring machine.

let sql: postgres.Sql;
let conn: typeof import('@/connections');
let crypto: typeof import('@/connections/crypto');
const KEY_B64 = randomBytes(32).toString('base64');

const SENTINEL_ACCESS = 'SENTINEL-ACCESS-TOKEN-0123456789abcdef';
const SENTINEL_REFRESH = 'SENTINEL-REFRESH-TOKEN-0123456789abcdef';

beforeAll(async () => {
  sql = connect();
  const uri = inject('pgConnectionUri');
  process.env.DATABASE_URL = uri;
  process.env.DIRECT_DATABASE_URL = uri;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.CONNECTION_ENCRYPTION_KEY = KEY_B64;
  conn = await import('@/connections');
  crypto = await import('@/connections/crypto');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

type Provider = 'github' | 'jira' | 'stitch';

async function save(
  userId: string,
  provider: Provider,
  overrides: Partial<Parameters<typeof conn.saveConnection>[0]> = {},
) {
  return conn.saveConnection({
    userId,
    provider,
    externalAccountId: `acct-${randomUUID()}`,
    displayName: `name-${provider}`,
    accessToken: SENTINEL_ACCESS,
    scopes: ['repo'],
    providerMeta: {},
    ...overrides,
  });
}

async function connectionRow(userId: string, provider: Provider) {
  const rows = await sql<
    {
      id: string;
      status: string;
      access_token_enc: string;
      refresh_token_enc: string | null;
      expires_at: Date | null;
      external_account_id: string;
    }[]
  >`SELECT id, status, access_token_enc, refresh_token_enc, expires_at, external_account_id
      FROM provider_connection WHERE user_id = ${userId} AND provider = ${provider}`;
  return rows[0];
}

// A pending operation recorded against a connection (the same insert shape T47 uses).
async function operationOn(
  provider: 'github' | 'stitch',
  connectionId: string | null,
  accountId?: string,
): Promise<string> {
  const { projectId } = await fx.createProjectWithOwner(sql, {
    name: `connections ${randomUUID()}`,
  });
  const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
  const descriptor = accountId ? { account_id: accountId } : {};
  const rows = await sql<{ id: string }[]>`
    INSERT INTO external_operation
      (project_id, provider, operation_type, operation_key, status, request_hash,
       source_artifact_version_id, connection_id, target_descriptor)
    VALUES (${projectId}, ${provider}, 'create_repo',
            ${`op-${randomUUID()}`}, 'pending', 'h', ${versionId}, ${connectionId},
            ${sql.json(descriptor)})
    RETURNING id
  `;
  return rows[0]!.id;
}

describe('connections: storage and secrecy (T45 application half)', () => {
  it('T45: a saved token is ciphertext at rest, decrypts for getCredential, and no sentinel appears in any column, listing or error', async () => {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'github', {
      externalAccountId: '4242',
      refreshToken: SENTINEL_REFRESH,
      providerMeta: { login: 'octo' },
    });

    const row = await connectionRow(userId, 'github');
    expect(row!.access_token_enc).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);

    const cred = await conn.getCredential(userId, 'github');
    expect(cred.accessToken).toBe(SENTINEL_ACCESS);
    expect(cred.accountId).toBe('4242');
    expect(cred.meta).toEqual({ login: 'octo' });
    expect(() => JSON.stringify(cred)).toThrow();

    const listing = JSON.stringify(await conn.listConnections(userId));
    expect(listing).not.toContain('SENTINEL');
    expect(listing).not.toMatch(/v1:/);
    expect(
      JSON.parse(listing).map((c: { provider: string; status: string }) => [c.provider, c.status]),
    ).toEqual([
      ['github', 'active'],
      ['jira', 'none'],
      ['stitch', 'none'],
    ]);

    // a wrong-user read of the same ciphertext fails authentication (AAD)
    const other = await fx.createAppUser(sql);
    expect(() =>
      crypto.decryptSecret({
        stored: row!.access_token_enc,
        userId: other,
        provider: 'github',
        key: Buffer.from(KEY_B64, 'base64'),
      }),
    ).toThrow();

    // no SENTINEL in any text/jsonb column of any table
    const columns = await sql<{ table_name: string; column_name: string }[]>`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND c.data_type IN ('text', 'jsonb', 'json', 'character varying', 'ARRAY')`;
    let hits = 0;
    for (const { table_name, column_name } of columns) {
      const r = await sql.unsafe<{ n: string }[]>(
        `SELECT count(*)::text AS n FROM public."${table_name}" WHERE "${column_name}"::text LIKE '%SENTINEL%'`,
      );
      hits += Number(r[0]!.n);
    }
    expect(hits).toBe(0);
  });

  it('T45: a token-like providerMeta key is refused before any row is written', async () => {
    const userId = await fx.createAppUser(sql);
    await expect(
      save(userId, 'github', { providerMeta: { access_token: SENTINEL_ACCESS } }),
    ).rejects.toThrow();
    expect(await connectionRow(userId, 'github')).toBeUndefined();
  });

  it('no connection -> ConnectionRequiredError; a reconnect revives the same row and id', async () => {
    const userId = await fx.createAppUser(sql);
    await expect(conn.getCredential(userId, 'stitch')).rejects.toBeInstanceOf(
      conn.ConnectionRequiredError,
    );
    await save(userId, 'stitch');
    const first = await connectionRow(userId, 'stitch');
    await conn.reportAuthFailure(first!.id);
    await expect(conn.getCredential(userId, 'stitch')).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );
    await save(userId, 'stitch', { accessToken: 'second-key' });
    const second = await connectionRow(userId, 'stitch');
    expect(second!.id).toBe(first!.id);
    expect(second!.status).toBe('active');
    expect((await conn.getCredential(userId, 'stitch')).accessToken).toBe('second-key');
  });
});

describe('connections: disconnect', () => {
  it('deletes an unreferenced row; providerRevoked is null without a registered revoker', async () => {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'stitch');
    expect(await conn.disconnect(userId, 'stitch')).toEqual({ providerRevoked: null });
    expect(await connectionRow(userId, 'stitch')).toBeUndefined();
    expect((await conn.listConnections(userId)).find((c) => c.provider === 'stitch')!.status).toBe(
      'none',
    );
  });

  it('tombstones a row an operation references, then a reconnect revives it', async () => {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'github', { refreshToken: SENTINEL_REFRESH });
    const row = await connectionRow(userId, 'github');
    await operationOn('github', row!.id);

    conn.registerRevoker('github', async () => true);
    expect(await conn.disconnect(userId, 'github')).toEqual({ providerRevoked: true });

    const tomb = await connectionRow(userId, 'github');
    expect(tomb).toMatchObject({
      id: row!.id,
      status: 'revoked',
      access_token_enc: 'revoked',
      refresh_token_enc: null,
      expires_at: null,
    });
    await expect(conn.getCredential(userId, 'github')).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );

    await save(userId, 'github');
    expect((await connectionRow(userId, 'github'))!.id).toBe(row!.id);
    expect((await conn.getCredential(userId, 'github')).accessToken).toBe(SENTINEL_ACCESS);
  });
});

describe('connections: T49 connections half - a lapsed connection changes nothing else', () => {
  it('T49: reportAuthFailure leaves the operation row byte-identical and reports needs_reauth', async () => {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'github', { externalAccountId: 'acct-49' });
    const row = await connectionRow(userId, 'github');
    const opId = await operationOn('github', row!.id, 'acct-49');
    expect(await conn.getConnectionStatusForOperation(opId)).toBe('active');

    const snapshot = () =>
      sql`SELECT md5(o::text) AS h FROM external_operation o WHERE id = ${opId}`.then(
        (r) => r[0]!.h,
      );
    const before = await snapshot();
    await conn.reportAuthFailure(row!.id);
    expect(await snapshot()).toBe(before);

    expect(await conn.getConnectionStatusForOperation(opId)).toBe('needs_reauth');
    await expect(conn.getCredentialForOperation(opId)).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );
    // reportAuthFailure never disturbs a tombstone
    await conn.disconnect(userId, 'github');
    await conn.reportAuthFailure(row!.id);
    expect((await connectionRow(userId, 'github'))!.status).toBe('revoked');
  });
});

describe('connections: getCredentialForOperation', () => {
  it('connection_id NULL -> legacy, status legacy', async () => {
    const opId = await operationOn('github', null);
    expect(await conn.getCredentialForOperation(opId)).toEqual({ kind: 'legacy' });
    expect(await conn.getConnectionStatusForOperation(opId)).toBe('legacy');
  });

  it('T51: a different connected account is ReconnectRequired before any provider call; the original account resumes', async () => {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'github', { externalAccountId: 'account-A' });
    const row = await connectionRow(userId, 'github');
    const opId = await operationOn('github', row!.id, 'account-A');

    expect((await conn.getCredentialForOperation(opId)) as object).toHaveProperty(
      'accountId',
      'account-A',
    );

    // reconnect as a different GitHub account: same row, new external_account_id
    await save(userId, 'github', { externalAccountId: 'account-B' });
    expect(await conn.getConnectionStatusForOperation(opId)).toBe('account_mismatch');
    await expect(conn.getCredentialForOperation(opId)).rejects.toMatchObject({
      name: 'ReconnectRequiredError',
      reason: 'account_mismatch',
    });

    // reconnecting the original account resumes the operation
    await save(userId, 'github', { externalAccountId: 'account-A' });
    expect(await conn.getConnectionStatusForOperation(opId)).toBe('active');
    expect((await conn.getCredentialForOperation(opId)) as object).toHaveProperty(
      'accountId',
      'account-A',
    );
  });
});

describe('connections: Jira refresh with rotation (T52, R14)', () => {
  const FRESH_ACCESS = 'SENTINEL-NEW-ACCESS-TOKEN-abcdef';
  const ROTATED_REFRESH = 'SENTINEL-ROTATED-REFRESH-abcdef';

  async function expiredJiraUser(): Promise<string> {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'jira', {
      externalAccountId: 'atl-1',
      accessToken: 'SENTINEL-OLD-ACCESS',
      refreshToken: SENTINEL_REFRESH,
      expiresAt: new Date(Date.now() - 5_000),
      providerMeta: { cloudId: 'cloud-1' },
    });
    return userId;
  }

  it('T52: two concurrent callers on an expired token cause exactly one refresher call; both get the new token; the rotated refresh token is stored; no needs_reauth', async () => {
    const userId = await expiredJiraUser();
    let calls = 0;
    const seenRefreshTokens: string[] = [];
    conn.registerRefresher('jira', async ({ refreshToken }) => {
      calls += 1;
      seenRefreshTokens.push(refreshToken);
      await new Promise((r) => setTimeout(r, 200)); // hold the row lock long enough for the race
      return {
        accessToken: FRESH_ACCESS,
        refreshToken: ROTATED_REFRESH,
        expiresAt: new Date(Date.now() + 3_600_000),
      };
    });

    const [a, b] = await Promise.all([
      conn.getCredential(userId, 'jira'),
      conn.getCredential(userId, 'jira'),
    ]);
    expect(calls).toBe(1);
    expect(seenRefreshTokens).toEqual([SENTINEL_REFRESH]);
    expect(a.accessToken).toBe(FRESH_ACCESS);
    expect(b.accessToken).toBe(FRESH_ACCESS);

    const row = await connectionRow(userId, 'jira');
    expect(row!.status).toBe('active');
    const key = Buffer.from(KEY_B64, 'base64');
    expect(
      crypto.decryptSecret({ stored: row!.refresh_token_enc!, userId, provider: 'jira', key }),
    ).toBe(ROTATED_REFRESH);
    expect(row!.expires_at!.getTime()).toBeGreaterThan(Date.now());

    // a third call finds a valid token and does not refresh
    await conn.getCredential(userId, 'jira');
    expect(calls).toBe(1);
  });

  it('T52: invalid_grant sets needs_reauth and throws ReconnectRequiredError', async () => {
    const userId = await expiredJiraUser();
    conn.registerRefresher('jira', async () => {
      throw new conn.InvalidGrantError();
    });
    await expect(conn.getCredential(userId, 'jira')).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );
    expect((await connectionRow(userId, 'jira'))!.status).toBe('needs_reauth');
    // and the next call does not reach the refresher at all
    let called = false;
    conn.registerRefresher('jira', async () => {
      called = true;
      throw new Error('should not be called');
    });
    await expect(conn.getCredential(userId, 'jira')).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );
    expect(called).toBe(false);
  });

  it('T52: a transient refresher failure rolls back and leaves the connection active', async () => {
    const userId = await expiredJiraUser();
    conn.registerRefresher('jira', async () => {
      throw new Error('network down');
    });
    await expect(conn.getCredential(userId, 'jira')).rejects.toThrow('network down');
    expect((await connectionRow(userId, 'jira'))!.status).toBe('active');
  });

  it('a non-expired Jira token is returned without touching the refresher', async () => {
    const userId = await fx.createAppUser(sql);
    await save(userId, 'jira', {
      refreshToken: SENTINEL_REFRESH,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    conn.registerRefresher('jira', async () => {
      throw new Error('should not be called');
    });
    expect((await conn.getCredential(userId, 'jira')).accessToken).toBe(SENTINEL_ACCESS);
  });
});
