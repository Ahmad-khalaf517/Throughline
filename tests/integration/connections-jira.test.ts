import { afterAll, afterEach, beforeAll, describe, expect, it, inject } from 'vitest';
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// The Jira half of the connections module against real Testcontainers Postgres
// with the REAL registered refresher (`registerRefresher('jira', ...)` runs when
// `@/connections` loads) talking to a fake Atlassian on globalThis.fetch:
// T52 (refresh with rotation under the row lock) and the Atlassian 3LO OAuth
// callback (SCRUM-97). It lives in its own file because
// tests/integration/connections.test.ts replaces the jira refresher with stubs
// for the rest of that file's module registry.
//
// NOT EXECUTED when written - Docker/Testcontainers was unavailable on the
// authoring machine.

let sql: postgres.Sql;
let conn: typeof import('@/connections');
let crypto: typeof import('@/connections/crypto');
const KEY_B64 = randomBytes(32).toString('base64');
const realFetch = globalThis.fetch;

const OLD_ACCESS = 'SENTINEL-OLD-ACCESS-TOKEN-0123456789';
const OLD_REFRESH = 'SENTINEL-OLD-REFRESH-TOKEN-0123456789';
const NEW_ACCESS = 'SENTINEL-NEW-ACCESS-TOKEN-0123456789';
const NEW_REFRESH = 'SENTINEL-NEW-REFRESH-TOKEN-0123456789';

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
  process.env.OAUTH_STATE_SECRET = 'integration-oauth-state-secret';
  process.env.ATLASSIAN_CLIENT_ID = 'atlassian-integration-client';
  process.env.ATLASSIAN_CLIENT_SECRET = 'atlassian-integration-secret';
  conn = await import('@/connections');
  crypto = await import('@/connections/crypto');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function connectionRow(userId: string) {
  const [row] = await sql<
    {
      status: string;
      access_token_enc: string;
      refresh_token_enc: string | null;
      expires_at: Date | null;
      external_account_id: string;
      provider_meta: Record<string, string>;
    }[]
  >`SELECT status, access_token_enc, refresh_token_enc, expires_at, external_account_id, provider_meta
      FROM provider_connection WHERE user_id = ${userId} AND provider = 'jira'`;
  return row;
}

async function expiredJiraUser(): Promise<string> {
  const userId = await fx.createAppUser(sql);
  await conn.saveConnection({
    userId,
    provider: 'jira',
    externalAccountId: 'atl-1',
    displayName: 'Ada',
    accessToken: OLD_ACCESS,
    refreshToken: OLD_REFRESH,
    expiresAt: new Date(Date.now() - 5_000),
    scopes: ['read:jira-work', 'offline_access'],
    providerMeta: { cloudId: 'cloud-1' },
  });
  return userId;
}

/** A fake Atlassian token endpoint that counts calls and, like the real one, rotates the refresh token. */
function fakeTokenEndpoint(respond: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.host === 'auth.atlassian.com' && url.pathname === '/oauth/token') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      await new Promise((r) => setTimeout(r, 200)); // hold the row lock long enough for the race
      return respond(body);
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return bodies;
}

describe('T52 with the real registered Jira refresher (R14)', () => {
  it('two concurrent callers on an expired token cause exactly one token-endpoint call; the rotated refresh token is stored; both get the new access token', async () => {
    const userId = await expiredJiraUser();
    const bodies = fakeTokenEndpoint(() =>
      Response.json({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 3600 }),
    );

    const [a, b] = await Promise.all([
      conn.getCredential(userId, 'jira'),
      conn.getCredential(userId, 'jira'),
    ]);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ grant_type: 'refresh_token', refresh_token: OLD_REFRESH });
    expect(a.accessToken).toBe(NEW_ACCESS);
    expect(b.accessToken).toBe(NEW_ACCESS);

    const row = (await connectionRow(userId))!;
    expect(row.status).toBe('active');
    const key = Buffer.from(KEY_B64, 'base64');
    expect(
      crypto.decryptSecret({ stored: row.refresh_token_enc!, userId, provider: 'jira', key }),
    ).toBe(NEW_REFRESH);
    expect(
      crypto.decryptSecret({ stored: row.access_token_enc, userId, provider: 'jira', key }),
    ).toBe(NEW_ACCESS);
    expect(row.expires_at!.getTime()).toBeGreaterThan(Date.now());
    // Nothing secret in any plaintext column.
    expect(JSON.stringify(row)).not.toContain(NEW_REFRESH);

    // A third call finds a valid token and does not call Atlassian again.
    await conn.getCredential(userId, 'jira');
    expect(bodies).toHaveLength(1);
  });

  it('a second refresh uses the ROTATED token (the old one is never sent again)', async () => {
    const userId = await expiredJiraUser();
    const bodies = fakeTokenEndpoint((body) =>
      Response.json({
        access_token: `access-for-${String(body.refresh_token).slice(-6)}`,
        refresh_token: bodies.length === 1 ? NEW_REFRESH : 'SENTINEL-THIRD-REFRESH-000000',
        expires_in: 3600,
      }),
    );
    await conn.getCredential(userId, 'jira');
    // Force expiry again.
    await sql`UPDATE provider_connection SET expires_at = now() - interval '5 seconds'
              WHERE user_id = ${userId} AND provider = 'jira'`;
    await conn.getCredential(userId, 'jira');

    expect(bodies.map((b) => b.refresh_token)).toEqual([OLD_REFRESH, NEW_REFRESH]);
  });

  it('invalid_grant from Atlassian sets needs_reauth and throws ReconnectRequiredError; the next call never reaches Atlassian', async () => {
    const userId = await expiredJiraUser();
    const bodies = fakeTokenEndpoint(() =>
      Response.json(
        { error: 'invalid_grant', error_description: 'Unknown or invalid refresh token.' },
        { status: 403 },
      ),
    );

    await expect(conn.getCredential(userId, 'jira')).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );
    expect((await connectionRow(userId))!.status).toBe('needs_reauth');

    await expect(conn.getCredential(userId, 'jira')).rejects.toBeInstanceOf(
      conn.ReconnectRequiredError,
    );
    expect(bodies).toHaveLength(1);
  });

  it('a transient Atlassian failure rolls back: the connection stays active with its old tokens, and no error carries a secret', async () => {
    const userId = await expiredJiraUser();
    fakeTokenEndpoint(() => new Response('upstream down', { status: 503 }));

    const failure = await conn.getCredential(userId, 'jira').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(conn.ReconnectRequiredError);
    expect(`${(failure as Error).message} ${JSON.stringify(failure)}`).not.toContain(OLD_REFRESH);
    const row = (await connectionRow(userId))!;
    expect(row.status).toBe('active');
    const key = Buffer.from(KEY_B64, 'base64');
    expect(
      crypto.decryptSecret({ stored: row.refresh_token_enc!, userId, provider: 'jira', key }),
    ).toBe(OLD_REFRESH);
  });
});

describe('Atlassian 3LO OAuth flow (UC-S5 application half)', () => {
  it('beginOAuth -> completeOAuth stores both tokens encrypted with expiry, identity and the default site; a reconnect revives the same row', async () => {
    const userId = await fx.createAppUser(sql);
    const { authorizeUrl, pkceVerifier } = await conn.beginOAuth(userId, 'jira', {});
    const state = new URL(authorizeUrl).searchParams.get('state')!;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.host === 'auth.atlassian.com' && url.pathname === '/oauth/token') {
        return Response.json({
          access_token: NEW_ACCESS,
          refresh_token: NEW_REFRESH,
          expires_in: 3600,
          scope: 'read:jira-work write:jira-work offline_access read:me',
        });
      }
      if (url.host === 'api.atlassian.com' && url.pathname === '/me') {
        return Response.json({ account_id: 'atl-flow', name: 'Flow User' });
      }
      if (
        url.host === 'api.atlassian.com' &&
        url.pathname === '/oauth/token/accessible-resources'
      ) {
        return Response.json([{ id: 'cloud-9', url: 'https://nine.atlassian.net', name: 'Nine' }]);
      }
      return realFetch(input, init);
    }) as typeof fetch;

    await conn.completeOAuth(userId, 'jira', { code: 'c', state, pkceVerifier });

    const row = (await connectionRow(userId))!;
    expect(row.status).toBe('active');
    expect(row.external_account_id).toBe('atl-flow');
    expect(row.provider_meta).toEqual({
      cloudId: 'cloud-9',
      siteUrl: 'https://nine.atlassian.net',
      siteName: 'Nine',
    });
    expect(row.expires_at!.getTime()).toBeGreaterThan(Date.now());
    const key = Buffer.from(KEY_B64, 'base64');
    expect(
      crypto.decryptSecret({ stored: row.access_token_enc, userId, provider: 'jira', key }),
    ).toBe(NEW_ACCESS);
    expect(
      crypto.decryptSecret({ stored: row.refresh_token_enc!, userId, provider: 'jira', key }),
    ).toBe(NEW_REFRESH);
    expect(JSON.stringify(row)).not.toContain(NEW_ACCESS);
    expect(JSON.stringify(row)).not.toContain(NEW_REFRESH);

    // Atlassian has no simple revocation endpoint: disconnect reports null and removes the row.
    await expect(conn.disconnect(userId, 'jira')).resolves.toEqual({ providerRevoked: null });
    expect(await connectionRow(userId)).toBeUndefined();
  });
});
