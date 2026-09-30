import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// beginOAuth / completeOAuth / the GitHub revoker (Module Boundaries 4.9,
// API Contracts 10A) with a fake GitHub on globalThis.fetch. `@/lib/env` is a
// plain mutable object; the store (which would need a database) is replaced by
// a spy so the test can assert exactly what would be encrypted and persisted.
const { envMock, saveConnectionMock } = vi.hoisted(() => ({
  envMock: {
    env: {
      NEXT_PUBLIC_SITE_URL: 'https://app.example.test/some/path',
      OAUTH_STATE_SECRET: 'unit-test-state-secret',
      GITHUB_OAUTH_CLIENT_ID: 'Iv1.client-id',
      GITHUB_OAUTH_CLIENT_SECRET: 'client-secret-value',
    } as Record<string, string | undefined>,
  },
  saveConnectionMock: vi.fn(),
}));
vi.mock('@/lib/env', () => envMock);
vi.mock('@/connections/store', () => ({ saveConnection: saveConnectionMock }));

import { OAuthFlowError, ConnectionConfigError, ConnectionInputError } from '@/connections/errors';
import { getRevoker } from '@/connections/hooks';
import { beginOAuth, completeOAuth } from '@/connections/oauth';
import { GITHUB_SCOPE, githubRedirectUri } from '@/connections/oauth-github';

const realFetch = globalThis.fetch;
const OAUTH_TOKEN = 'gho_SENTINEL_unit_token_0123456789';

type Call = { url: URL; init: RequestInit };
let calls: Call[] = [];

function fakeGithub(handlers: {
  token?: () => Response;
  user?: () => Response;
  revoke?: () => Response;
}) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push({ url, init: init ?? {} });
    if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') {
      return (handlers.token ?? (() => Response.json({ error: 'bad_verification_code' })))();
    }
    if (url.hostname === 'api.github.com' && url.pathname === '/user') {
      return (handlers.user ?? (() => new Response('{}', { status: 500 })))();
    }
    if (url.hostname === 'api.github.com' && url.pathname.startsWith('/applications/')) {
      return (handlers.revoke ?? (() => new Response(null, { status: 204 })))();
    }
    throw new Error(`unexpected fetch ${url.href}`);
  }) as typeof fetch;
}

const okToken = () =>
  Response.json({ access_token: OAUTH_TOKEN, scope: 'repo,read:org', token_type: 'bearer' });
const okUser = () => Response.json({ id: 4242, login: 'octo-user' });

async function started(userId = 'user-1', returnTo?: string) {
  const { authorizeUrl, pkceVerifier } = await beginOAuth(
    userId,
    'github',
    returnTo === undefined ? {} : { returnTo },
  );
  return {
    url: new URL(authorizeUrl),
    pkceVerifier,
    state: new URL(authorizeUrl).searchParams.get('state')!,
  };
}

beforeEach(() => {
  calls = [];
  saveConnectionMock.mockReset().mockResolvedValue({});
  envMock.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test/some/path';
  envMock.env.OAUTH_STATE_SECRET = 'unit-test-state-secret';
  envMock.env.GITHUB_OAUTH_CLIENT_ID = 'Iv1.client-id';
  envMock.env.GITHUB_OAUTH_CLIENT_SECRET = 'client-secret-value';
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('beginOAuth', () => {
  it('builds the GitHub authorize URL: client, allowlisted redirect URI, scope, signed state, PKCE S256', async () => {
    const { url, pkceVerifier, state } = await started();

    expect(`${url.origin}${url.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('Iv1.client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.test/api/connections/github/callback',
    );
    expect(url.searchParams.get('scope')).toBe('repo read:org');
    expect(GITHUB_SCOPE).toBe('repo read:org');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    // The verifier goes back to the route, never into the URL.
    expect(url.href).not.toContain(pkceVerifier);
    expect(url.href).not.toContain('client-secret-value');
  });

  it('derives the redirect URI from NEXT_PUBLIC_SITE_URL only (origin + fixed path)', () => {
    envMock.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000/';
    expect(githubRedirectUri()).toBe('http://localhost:3000/api/connections/github/callback');
  });

  it('an unknown provider is a ConnectionInputError (the jira flow is covered by oauth-jira.test.ts)', async () => {
    await expect(beginOAuth('user-1', 'stitch' as never, {})).rejects.toBeInstanceOf(
      ConnectionInputError,
    );
    await expect(
      completeOAuth('user-1', 'stitch' as never, { code: 'c', state: 's', pkceVerifier: 'v' }),
    ).rejects.toBeInstanceOf(ConnectionInputError);
  });

  it.each([['GITHUB_OAUTH_CLIENT_ID'], ['OAUTH_STATE_SECRET']])(
    'a missing %s is a ConnectionConfigError that names the variable',
    async (name) => {
      envMock.env[name] = undefined;
      const failure = await beginOAuth('user-1', 'github', {}).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ConnectionConfigError);
      expect((failure as Error).message).toContain(name);
    },
  );
});

describe('completeOAuth', () => {
  it('exchanges the code, reads the identity and saves the token with the granted scopes', async () => {
    fakeGithub({ token: okToken, user: okUser });
    const { pkceVerifier, state } = await started('user-1', '/projects/p1/github');

    const result = await completeOAuth('user-1', 'github', {
      code: 'the-code',
      state,
      pkceVerifier,
    });

    expect(result).toEqual({ returnTo: '/projects/p1/github' });
    // Token endpoint: JSON accepted, PKCE verifier and the same allowlisted redirect URI sent.
    const exchange = calls.find((c) => c.url.pathname === '/login/oauth/access_token')!;
    expect(exchange.init.method).toBe('POST');
    expect(new Headers(exchange.init.headers).get('accept')).toBe('application/json');
    expect(JSON.parse(String(exchange.init.body))).toEqual({
      client_id: 'Iv1.client-id',
      client_secret: 'client-secret-value',
      code: 'the-code',
      redirect_uri: 'https://app.example.test/api/connections/github/callback',
      code_verifier: pkceVerifier,
    });
    const identity = calls.find((c) => c.url.pathname === '/user')!;
    expect(new Headers(identity.init.headers).get('authorization')).toBe(`Bearer ${OAUTH_TOKEN}`);

    // What the connections store is asked to encrypt and persist: the account id as a
    // string, the login as identity, no refresh token, no expiry, the granted scopes.
    expect(saveConnectionMock).toHaveBeenCalledTimes(1);
    expect(saveConnectionMock).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'github',
      externalAccountId: '4242',
      displayName: 'octo-user',
      accessToken: OAUTH_TOKEN,
      refreshToken: null,
      expiresAt: null,
      scopes: ['repo', 'read:org'],
      providerMeta: { login: 'octo-user' },
    });
  });

  it('falls back to the X-OAuth-Scopes header when the token response names no scope', async () => {
    fakeGithub({
      token: () => Response.json({ access_token: OAUTH_TOKEN, token_type: 'bearer' }),
      user: () =>
        new Response(JSON.stringify({ id: 1, login: 'x' }), {
          headers: { 'x-oauth-scopes': 'repo, read:org' },
        }),
    });
    const { pkceVerifier, state } = await started();
    await completeOAuth('user-1', 'github', { code: 'c', state, pkceVerifier });
    expect(saveConnectionMock.mock.calls[0]![0].scopes).toEqual(['repo', 'read:org']);
  });

  it('returns no returnTo when the state carried none', async () => {
    fakeGithub({ token: okToken, user: okUser });
    const { pkceVerifier, state } = await started();
    await expect(
      completeOAuth('user-1', 'github', { code: 'c', state, pkceVerifier }),
    ).resolves.toEqual({});
  });

  it.each([
    ['another user', 'user-2', undefined],
    ['a wrong verifier', 'user-1', 'not-the-verifier'],
  ])(
    'rejects %s with invalid_state before any network call or write',
    async (_label, userId, verifier) => {
      fakeGithub({ token: okToken, user: okUser });
      const { pkceVerifier, state } = await started('user-1');

      const failure = await completeOAuth(userId, 'github', {
        code: 'c',
        state,
        pkceVerifier: verifier ?? pkceVerifier,
      }).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(OAuthFlowError);
      expect((failure as OAuthFlowError).code).toBe('invalid_state');
      expect(calls).toHaveLength(0);
      expect(saveConnectionMock).not.toHaveBeenCalled();
    },
  );

  it('rejects empty code / state / verifier as invalid_state', async () => {
    const { pkceVerifier, state } = await started();
    for (const query of [
      { code: '', state, pkceVerifier },
      { code: 'c', state: '', pkceVerifier },
      { code: 'c', state, pkceVerifier: '' },
    ]) {
      await expect(completeOAuth('user-1', 'github', query)).rejects.toMatchObject({
        code: 'invalid_state',
      });
    }
  });

  it('a rejected code (GitHub answers 200 with an error body) is exchange_failed and stores nothing', async () => {
    fakeGithub({
      token: () =>
        Response.json({ error: 'bad_verification_code', error_description: 'secret text' }),
    });
    const { pkceVerifier, state } = await started();

    const failure = await completeOAuth('user-1', 'github', {
      code: 'c',
      state,
      pkceVerifier,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(OAuthFlowError);
    expect((failure as OAuthFlowError).code).toBe('exchange_failed');
    expect((failure as Error).message).not.toContain('secret text');
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });

  it('a failing identity lookup or a network fault is exchange_failed and stores nothing', async () => {
    fakeGithub({ token: okToken, user: () => new Response('nope', { status: 401 }) });
    const first = await started();
    await expect(
      completeOAuth('user-1', 'github', {
        code: 'c',
        state: first.state,
        pkceVerifier: first.pkceVerifier,
      }),
    ).rejects.toMatchObject({ code: 'exchange_failed' });

    globalThis.fetch = (async () => {
      throw new TypeError('socket hang up');
    }) as typeof fetch;
    const second = await started();
    await expect(
      completeOAuth('user-1', 'github', {
        code: 'c',
        state: second.state,
        pkceVerifier: second.pkceVerifier,
      }),
    ).rejects.toMatchObject({ code: 'exchange_failed' });
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });

  it('the token never appears in a thrown error', async () => {
    fakeGithub({ token: okToken, user: () => new Response('x', { status: 500 }) });
    const { pkceVerifier, state } = await started();
    const failure = await completeOAuth('user-1', 'github', {
      code: 'c',
      state,
      pkceVerifier,
    }).catch((e: unknown) => e);
    expect(JSON.stringify(failure)).not.toContain(OAUTH_TOKEN);
    expect((failure as Error).message).not.toContain(OAUTH_TOKEN);
  });
});

describe('GitHub revoker (registered by the connections module)', () => {
  const input = { accessToken: OAUTH_TOKEN, refreshToken: null, accountId: '1', meta: {} };

  it('is registered at import time and DELETEs the token with Basic client auth', async () => {
    fakeGithub({ revoke: () => new Response(null, { status: 204 }) });
    const revoke = getRevoker('github');
    expect(revoke).toBeDefined();

    await expect(revoke!(input)).resolves.toBe(true);

    const call = calls[0]!;
    expect(call.init.method).toBe('DELETE');
    expect(call.url.href).toBe('https://api.github.com/applications/Iv1.client-id/token');
    expect(new Headers(call.init.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('Iv1.client-id:client-secret-value').toString('base64')}`,
    );
    expect(JSON.parse(String(call.init.body))).toEqual({ access_token: OAUTH_TOKEN });
  });

  it('is false for any answer other than 204', async () => {
    fakeGithub({ revoke: () => new Response('{}', { status: 404 }) });
    await expect(getRevoker('github')!(input)).resolves.toBe(false);
  });

  it('a missing client secret throws a config error naming the variable (disconnect reports providerRevoked=false)', async () => {
    envMock.env.GITHUB_OAUTH_CLIENT_SECRET = undefined;
    await expect(getRevoker('github')!(input)).rejects.toThrow(/GITHUB_OAUTH_CLIENT_SECRET/);
  });
});
