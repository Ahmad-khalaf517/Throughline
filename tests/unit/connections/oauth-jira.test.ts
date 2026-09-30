import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Jira (Atlassian 3LO) branch of beginOAuth / completeOAuth and the
// registered refresh-with-rotation call (Module Boundaries 4.9, ERD 7.6, API
// Contracts 10A) with a fake Atlassian on globalThis.fetch. The store (which
// would need a database) is replaced by a spy so the test can assert exactly
// what would be encrypted and persisted.
const { envMock, saveConnectionMock } = vi.hoisted(() => ({
  envMock: {
    env: {
      NEXT_PUBLIC_SITE_URL: 'https://app.example.test/some/path',
      OAUTH_STATE_SECRET: 'unit-test-state-secret',
      ATLASSIAN_CLIENT_ID: 'atlassian-client-id',
      ATLASSIAN_CLIENT_SECRET: 'atlassian-client-secret',
    } as Record<string, string | undefined>,
  },
  saveConnectionMock: vi.fn(),
}));
vi.mock('@/lib/env', () => envMock);
vi.mock('@/connections/store', () => ({ saveConnection: saveConnectionMock }));

import { ConnectionConfigError, InvalidGrantError, OAuthFlowError } from '@/connections/errors';
import { getRefresher, getRevoker } from '@/connections/hooks';
import { beginOAuth, completeOAuth } from '@/connections/oauth';
import { JIRA_SCOPE, jiraRedirectUri } from '@/connections/oauth-jira';

const realFetch = globalThis.fetch;
const ACCESS = 'atl-access-SENTINEL-0123456789';
const REFRESH = 'atl-refresh-SENTINEL-0123456789';

type Call = { url: URL; init: RequestInit };
let calls: Call[] = [];

type Handlers = {
  token?: () => Response;
  me?: () => Response;
  resources?: () => Response;
};

function fakeAtlassian(handlers: Handlers) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    calls.push({ url, init: init ?? {} });
    if (url.hostname === 'auth.atlassian.com' && url.pathname === '/oauth/token') {
      return (
        handlers.token ?? (() => Response.json({ error: 'invalid_grant' }, { status: 403 }))
      )();
    }
    if (url.hostname === 'api.atlassian.com' && url.pathname === '/me') {
      return (handlers.me ?? (() => new Response('{}', { status: 500 })))();
    }
    if (
      url.hostname === 'api.atlassian.com' &&
      url.pathname === '/oauth/token/accessible-resources'
    ) {
      return (handlers.resources ?? (() => Response.json([])))();
    }
    throw new Error(`unexpected fetch ${url.href}`);
  }) as typeof fetch;
}

const okToken = () =>
  Response.json({
    access_token: ACCESS,
    refresh_token: REFRESH,
    expires_in: 3600,
    scope: 'read:jira-work write:jira-work manage:jira-project offline_access read:me',
  });
const okMe = () =>
  Response.json({ account_id: '5b10-acct', name: 'Ada Lovelace', email: 'ada@example.test' });
const okResources = () =>
  Response.json([
    { id: 'cloud-1', url: 'https://acme.atlassian.net', name: 'Acme', scopes: ['read:jira-work'] },
    { id: 'cloud-2', url: 'https://other.atlassian.net', name: 'Other', scopes: [] },
  ]);

async function started(userId = 'user-1', returnTo?: string) {
  const { authorizeUrl, pkceVerifier } = await beginOAuth(
    userId,
    'jira',
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
  envMock.env.ATLASSIAN_CLIENT_ID = 'atlassian-client-id';
  envMock.env.ATLASSIAN_CLIENT_SECRET = 'atlassian-client-secret';
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('beginOAuth (jira)', () => {
  it('builds the Atlassian authorize URL: audience, client, scopes, allowlisted redirect URI, consent, signed state, PKCE S256', async () => {
    const { url, pkceVerifier, state } = await started();

    expect(`${url.origin}${url.pathname}`).toBe('https://auth.atlassian.com/authorize');
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
    expect(url.searchParams.get('client_id')).toBe('atlassian-client-id');
    expect(url.searchParams.get('scope')).toBe(
      'read:jira-work write:jira-work manage:jira-project offline_access read:me',
    );
    expect(JIRA_SCOPE).toBe(
      'read:jira-work write:jira-work manage:jira-project offline_access read:me',
    );
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.test/api/connections/jira/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(url.href).not.toContain(pkceVerifier);
    expect(url.href).not.toContain('atlassian-client-secret');
  });

  it('derives the redirect URI from NEXT_PUBLIC_SITE_URL only (origin + fixed path)', () => {
    envMock.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000/';
    expect(jiraRedirectUri()).toBe('http://localhost:3000/api/connections/jira/callback');
  });

  it.each([['ATLASSIAN_CLIENT_ID'], ['OAUTH_STATE_SECRET']])(
    'a missing %s is a ConnectionConfigError that names the variable',
    async (name) => {
      envMock.env[name] = undefined;
      const failure = await beginOAuth('user-1', 'jira', {}).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ConnectionConfigError);
      expect((failure as Error).message).toContain(name);
    },
  );
});

describe('completeOAuth (jira)', () => {
  it('exchanges the code (JSON, PKCE verifier), reads identity and default site, and saves both tokens', async () => {
    fakeAtlassian({ token: okToken, me: okMe, resources: okResources });
    const { pkceVerifier, state } = await started('user-1', '/projects/p1/jira');
    const before = Date.now();

    const result = await completeOAuth('user-1', 'jira', {
      code: 'the-code',
      state,
      pkceVerifier,
    });

    expect(result).toEqual({ returnTo: '/projects/p1/jira' });
    const exchange = calls.find((c) => c.url.pathname === '/oauth/token')!;
    expect(exchange.init.method).toBe('POST');
    expect(new Headers(exchange.init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(exchange.init.body))).toEqual({
      grant_type: 'authorization_code',
      client_id: 'atlassian-client-id',
      client_secret: 'atlassian-client-secret',
      code: 'the-code',
      redirect_uri: 'https://app.example.test/api/connections/jira/callback',
      code_verifier: pkceVerifier,
    });
    for (const path of ['/me', '/oauth/token/accessible-resources']) {
      const call = calls.find((c) => c.url.pathname === path)!;
      expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${ACCESS}`);
    }

    expect(saveConnectionMock).toHaveBeenCalledTimes(1);
    const saved = saveConnectionMock.mock.calls[0]![0];
    expect(saved).toMatchObject({
      userId: 'user-1',
      provider: 'jira',
      externalAccountId: '5b10-acct',
      displayName: 'Ada Lovelace',
      accessToken: ACCESS,
      refreshToken: REFRESH,
      scopes: [
        'read:jira-work',
        'write:jira-work',
        'manage:jira-project',
        'offline_access',
        'read:me',
      ],
      // Only the first site is the default; the sites route lists all of them live.
      providerMeta: { cloudId: 'cloud-1', siteUrl: 'https://acme.atlassian.net', siteName: 'Acme' },
    });
    expect(saved.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
    expect(saved.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);
  });

  it('falls back to the requested scopes, the email as name, and empty meta when the account has no site', async () => {
    fakeAtlassian({
      token: () => Response.json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 60 }),
      me: () => Response.json({ account_id: 'acct', email: 'ada@example.test' }),
      resources: () => Response.json([]),
    });
    const { pkceVerifier, state } = await started();
    await completeOAuth('user-1', 'jira', { code: 'c', state, pkceVerifier });

    const saved = saveConnectionMock.mock.calls[0]![0];
    expect(saved.displayName).toBe('ada@example.test');
    expect(saved.scopes).toEqual(JIRA_SCOPE.split(' '));
    expect(saved.providerMeta).toEqual({});
  });

  it('a token response without a refresh token cannot be renewed: exchange_failed, nothing stored', async () => {
    fakeAtlassian({
      token: () => Response.json({ access_token: ACCESS, expires_in: 3600 }),
      me: okMe,
      resources: okResources,
    });
    const { pkceVerifier, state } = await started();
    await expect(
      completeOAuth('user-1', 'jira', { code: 'c', state, pkceVerifier }),
    ).rejects.toMatchObject({ code: 'exchange_failed' });
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });

  it.each([
    ['another user', 'user-2', undefined],
    ['a wrong verifier', 'user-1', 'not-the-verifier'],
  ])(
    'rejects %s with invalid_state before any network call or write',
    async (_label, userId, verifier) => {
      fakeAtlassian({ token: okToken, me: okMe, resources: okResources });
      const { pkceVerifier, state } = await started('user-1');

      const failure = await completeOAuth(userId, 'jira', {
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

  it('a jira-signed state is not accepted as another provider', async () => {
    fakeAtlassian({ token: okToken, me: okMe, resources: okResources });
    const { pkceVerifier, state } = await started();
    await expect(
      completeOAuth('user-1', 'github', { code: 'c', state, pkceVerifier }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(calls).toHaveLength(0);
  });

  const failing: Array<[string, Handlers]> = [
    [
      'a rejected code (non-2xx with an error body)',
      {
        token: () =>
          Response.json(
            { error: 'invalid_grant', error_description: 'secret text' },
            { status: 403 },
          ),
      },
    ],
    [
      'an identity lookup failure',
      { token: okToken, me: () => new Response('nope', { status: 401 }) },
    ],
    [
      'an accessible-resources failure',
      { token: okToken, me: okMe, resources: () => new Response('x', { status: 500 }) },
    ],
    [
      'a malformed identity',
      { token: okToken, me: () => Response.json({ name: 'no id' }), resources: okResources },
    ],
  ];

  it.each(failing)(
    '%s is exchange_failed with a fixed message and stores nothing',
    async (_label, handlers) => {
      fakeAtlassian(handlers);
      const { pkceVerifier, state } = await started();

      const failure = await completeOAuth('user-1', 'jira', {
        code: 'c',
        state,
        pkceVerifier,
      }).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(OAuthFlowError);
      expect((failure as OAuthFlowError).code).toBe('exchange_failed');
      expect((failure as Error).message).not.toContain('secret text');
      expect(JSON.stringify(failure)).not.toContain(ACCESS);
      expect(saveConnectionMock).not.toHaveBeenCalled();
    },
  );

  it('a network fault is exchange_failed', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('socket hang up');
    }) as typeof fetch;
    const { pkceVerifier, state } = await started();
    await expect(
      completeOAuth('user-1', 'jira', { code: 'c', state, pkceVerifier }),
    ).rejects.toMatchObject({ code: 'exchange_failed' });
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });
});

describe('jira refresher (registered by the connections module)', () => {
  const input = () => ({
    refreshToken: REFRESH,
    accountId: '5b10-acct',
    meta: {},
    signal: new AbortController().signal,
  });

  it('is registered, and no revoker is (Atlassian has no simple revocation endpoint)', () => {
    expect(getRefresher('jira')).toBeDefined();
    expect(getRevoker('jira')).toBeUndefined();
  });

  it('posts grant_type=refresh_token as JSON and returns the ROTATED refresh token and a new expiry', async () => {
    fakeAtlassian({
      token: () =>
        Response.json({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
    });
    const before = Date.now();

    const result = await getRefresher('jira')!(input());

    const call = calls[0]!;
    expect(call.url.href).toBe('https://auth.atlassian.com/oauth/token');
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(String(call.init.body))).toEqual({
      grant_type: 'refresh_token',
      client_id: 'atlassian-client-id',
      client_secret: 'atlassian-client-secret',
      refresh_token: REFRESH,
    });
    expect(result.accessToken).toBe('new-access');
    expect(result.refreshToken).toBe('new-refresh');
    expect(result.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
  });

  it.each([
    ['403 invalid_grant', 403, JSON.stringify({ error: 'invalid_grant' })],
    ['400 invalid_grant', 400, JSON.stringify({ error: 'invalid_grant' })],
    ['401', 401, '{}'],
  ])(
    '%s -> InvalidGrantError (connections turns it into needs_reauth)',
    async (_label, status, body) => {
      fakeAtlassian({ token: () => new Response(body, { status }) });
      await expect(getRefresher('jira')!(input())).rejects.toBeInstanceOf(InvalidGrantError);
    },
  );

  it('any other failure is a plain, transient error that carries no provider text or secret', async () => {
    fakeAtlassian({
      token: () =>
        new Response(
          JSON.stringify({ error: 'server_error', error_description: 'provider text' }),
          { status: 503 },
        ),
    });
    const failure = await getRefresher('jira')!(input()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InvalidGrantError);
    const text = `${(failure as Error).message} ${JSON.stringify(failure)}`;
    for (const secret of [REFRESH, ACCESS, 'atlassian-client-secret', 'provider text']) {
      expect(text).not.toContain(secret);
    }
  });

  it('an unusable 200 (no access_token) is transient, not invalid_grant', async () => {
    fakeAtlassian({ token: () => Response.json({ hello: 'world' }) });
    const failure = await getRefresher('jira')!(input()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InvalidGrantError);
  });

  it('honours the AbortSignal: an aborted call is transient and drops the underlying error', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      received = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException(`aborted with ${REFRESH}`, 'AbortError')),
        );
      });
    }) as typeof fetch;

    const pending = getRefresher('jira')!({ ...input(), signal: controller.signal }).catch(
      (e: unknown) => e,
    );
    controller.abort();
    const failure = (await pending) as Error;

    expect(received).toBe(controller.signal);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(InvalidGrantError);
    expect(failure.message).not.toContain(REFRESH);
  });

  it('a missing ATLASSIAN_CLIENT_SECRET is a ConnectionConfigError naming the variable, before any network call', async () => {
    envMock.env.ATLASSIAN_CLIENT_SECRET = undefined;
    fakeAtlassian({ token: okToken });
    const failure = await getRefresher('jira')!(input()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ConnectionConfigError);
    expect((failure as Error).message).toContain('ATLASSIAN_CLIENT_SECRET');
    expect(calls).toHaveLength(0);
  });
});
