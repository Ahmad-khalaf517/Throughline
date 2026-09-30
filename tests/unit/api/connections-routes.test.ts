import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring for the connections routes (API Contracts 10A):
// GET /api/connections, GET .../github/start, GET .../github/callback,
// GET .../github/owners, DELETE /api/connections/:provider. `@/connections`
// is mocked with stand-in error classes (the real module sits on `@/db`).
const {
  FakeConnectionRequiredError,
  FakeReconnectRequiredError,
  FakeOAuthFlowError,
  beginOAuthMock,
  completeOAuthMock,
  listConnectionsMock,
  disconnectMock,
  listOwnersMock,
} = vi.hoisted(() => {
  class FakeConnectionRequiredError extends Error {
    provider = 'github';
  }
  class FakeReconnectRequiredError extends Error {
    provider = 'github';
    reason = 'needs_reauth';
  }
  class FakeOAuthFlowError extends Error {
    constructor(readonly code: string) {
      super('fixed message');
    }
  }
  return {
    FakeConnectionRequiredError,
    FakeReconnectRequiredError,
    FakeOAuthFlowError,
    beginOAuthMock: vi.fn(),
    completeOAuthMock: vi.fn(),
    listConnectionsMock: vi.fn(),
    disconnectMock: vi.fn(),
    listOwnersMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ getVerifiedUser: vi.fn() }));
vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
  OAuthFlowError: FakeOAuthFlowError,
  beginOAuth: beginOAuthMock,
  completeOAuth: completeOAuthMock,
  listConnections: listConnectionsMock,
  disconnect: disconnectMock,
}));
vi.mock('@/external/github', () => ({ listOwners: listOwnersMock }));

import { getVerifiedUser } from '@/auth';
import { GET as listRoute } from '@/app/api/connections/route';
import { GET as startRoute } from '@/app/api/connections/github/start/route';
import { GET as callbackRoute } from '@/app/api/connections/github/callback/route';
import { GET as ownersRoute } from '@/app/api/connections/github/owners/route';
import { DELETE as disconnectRoute } from '@/app/api/connections/[provider]/route';

const mockedUser = vi.mocked(getVerifiedUser);
const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const AUTHORIZE = 'https://github.com/login/oauth/authorize?client_id=x&state=s';
const VERIFIER = 'pkce-verifier-value';

function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : {});
}

beforeEach(() => {
  mockedUser.mockReset().mockResolvedValue(user);
  beginOAuthMock.mockReset().mockResolvedValue({ authorizeUrl: AUTHORIZE, pkceVerifier: VERIFIER });
  completeOAuthMock.mockReset().mockResolvedValue({});
  listConnectionsMock.mockReset();
  disconnectMock.mockReset();
  listOwnersMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/connections', () => {
  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await listRoute(get('/api/connections'))).status).toBe(401);
    expect(listConnectionsMock).not.toHaveBeenCalled();
  });

  it('returns the three connections as status-only DTOs - nothing but identity and status', async () => {
    listConnectionsMock.mockResolvedValue([
      {
        provider: 'github',
        status: 'active',
        displayName: 'octo',
        scopes: ['repo', 'read:org'],
        connectedAt: new Date('2025-01-02T03:04:05.000Z'),
      },
      { provider: 'jira', status: 'none', displayName: null, scopes: [], connectedAt: null },
      {
        provider: 'stitch',
        status: 'needs_reauth',
        displayName: 'k',
        scopes: [],
        connectedAt: new Date(0),
      },
    ]);

    const response = await listRoute(get('/api/connections'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(listConnectionsMock).toHaveBeenCalledWith('user-1');
    expect(body.connections).toHaveLength(3);
    expect(body.connections[0]).toEqual({
      provider: 'github',
      status: 'active',
      displayName: 'octo',
      scopes: ['repo', 'read:org'],
      connectedAt: '2025-01-02T03:04:05.000Z',
      site: null,
    });
    expect(body.connections[1].status).toBe('none');
  });
});

describe('GET /api/connections/github/start', () => {
  it('returns 401 without a verified user and starts nothing', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await startRoute(get('/api/connections/github/start'))).status).toBe(401);
    expect(beginOAuthMock).not.toHaveBeenCalled();
  });

  it('302s to the authorize URL and sets the PKCE verifier in a short-lived httpOnly SameSite=Lax cookie scoped to /api/connections', async () => {
    const response = await startRoute(get('/api/connections/github/start?returnTo=/projects/p1'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(AUTHORIZE);
    expect(beginOAuthMock).toHaveBeenCalledWith('user-1', 'github', { returnTo: '/projects/p1' });

    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('tl_oauth_pkce_github='))!;
    expect(cookie).toContain(`tl_oauth_pkce_github=${VERIFIER}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/api\/connections(;|$)/);
    expect(cookie).toMatch(/Max-Age=600/i);
    expect(cookie).not.toMatch(/Secure/i); // NODE_ENV=test
  });

  it('marks the cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await startRoute(get('/api/connections/github/start'));
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('tl_oauth_pkce_github='))!;
    expect(cookie).toMatch(/Secure/i);
  });

  it('passes no returnTo when the query has none (validation of a returnTo lives in beginOAuth)', async () => {
    await startRoute(get('/api/connections/github/start'));
    expect(beginOAuthMock).toHaveBeenCalledWith('user-1', 'github', {});
  });

  it('a configuration error is a generic 500 that does not leak the cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    beginOAuthMock.mockRejectedValue(new Error('GITHUB_OAUTH_CLIENT_ID is not configured.'));
    const response = await startRoute(get('/api/connections/github/start'));
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe('INTERNAL_ERROR');
    consoleError.mockRestore();
  });
});

describe('GET /api/connections/github/callback', () => {
  const COOKIE = `tl_oauth_pkce_github=${VERIFIER}`;
  const qs = '?code=the-code&state=the-state';

  function clearsCookie(response: Response): boolean {
    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('tl_oauth_pkce_github='));
    return Boolean(cookie && /Max-Age=0/i.test(cookie) && /Path=\/api\/connections/.test(cookie));
  }

  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    const response = await callbackRoute(get(`/api/connections/github/callback${qs}`, COOKIE));
    expect(response.status).toBe(401);
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('hands code, state and the cookie verifier to completeOAuth, clears the cookie and redirects to /connections?connected=github', async () => {
    const response = await callbackRoute(get(`/api/connections/github/callback${qs}`, COOKIE));

    expect(completeOAuthMock).toHaveBeenCalledWith('user-1', 'github', {
      code: 'the-code',
      state: 'the-state',
      pkceVerifier: VERIFIER,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/connections?connected=github');
    expect(clearsCookie(response)).toBe(true);
  });

  it('redirects to the returnTo from the verified state', async () => {
    completeOAuthMock.mockResolvedValue({ returnTo: '/projects/p1/github' });
    const response = await callbackRoute(get(`/api/connections/github/callback${qs}`, COOKIE));
    expect(response.headers.get('location')).toBe('/projects/p1/github');
  });

  it('finds the verifier among other cookies', async () => {
    await callbackRoute(get(`/api/connections/github/callback${qs}`, `a=b; ${COOKIE}; c=d`));
    expect(completeOAuthMock.mock.calls[0]![2].pkceVerifier).toBe(VERIFIER);
  });

  it('a user who declined on GitHub lands on error=access_denied; the raw provider text is never echoed', async () => {
    const response = await callbackRoute(
      get(
        '/api/connections/github/callback?error=access_denied&error_description=<script>alert(1)</script>',
        COOKIE,
      ),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/connections?error=access_denied');
    expect(completeOAuthMock).not.toHaveBeenCalled();
    expect(clearsCookie(response)).toBe(true);
  });

  it('any other provider error param collapses to exchange_failed', async () => {
    const response = await callbackRoute(
      get('/api/connections/github/callback?error=redirect_uri_mismatch', COOKIE),
    );
    expect(response.headers.get('location')).toBe('/connections?error=exchange_failed');
  });

  it.each([
    ['no cookie', `/api/connections/github/callback${qs}`, undefined],
    ['no code', '/api/connections/github/callback?state=s', COOKIE],
    ['no state', '/api/connections/github/callback?code=c', COOKIE],
  ])('%s -> error=invalid_state without calling completeOAuth', async (_l, path, cookie) => {
    const response = await callbackRoute(get(path, cookie));
    expect(response.headers.get('location')).toBe('/connections?error=invalid_state');
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('maps an OAuthFlowError to its safe code, never its message', async () => {
    completeOAuthMock.mockRejectedValue(new FakeOAuthFlowError('invalid_state'));
    const bad = await callbackRoute(get(`/api/connections/github/callback${qs}`, COOKIE));
    expect(bad.headers.get('location')).toBe('/connections?error=invalid_state');
    expect(clearsCookie(bad)).toBe(true);

    completeOAuthMock.mockRejectedValue(new FakeOAuthFlowError('exchange_failed'));
    const failed = await callbackRoute(get(`/api/connections/github/callback${qs}`, COOKIE));
    expect(failed.headers.get('location')).toBe('/connections?error=exchange_failed');
    expect(failed.headers.get('location')).not.toContain('fixed');
  });

  it('an unexpected error is a generic 500', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    completeOAuthMock.mockRejectedValue(new Error('database is down'));
    const response = await callbackRoute(get(`/api/connections/github/callback${qs}`, COOKIE));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('database is down');
    consoleError.mockRestore();
  });
});

describe('GET /api/connections/github/owners', () => {
  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await ownersRoute(get('/api/connections/github/owners'))).status).toBe(401);
    expect(listOwnersMock).not.toHaveBeenCalled();
  });

  it("lists the caller's own login and organizations using a user-only ctx", async () => {
    listOwnersMock.mockResolvedValue([
      { login: 'octo', kind: 'user' },
      { login: 'acme', kind: 'org' },
    ]);
    const response = await ownersRoute(get('/api/connections/github/owners'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      owners: [
        { login: 'octo', kind: 'user' },
        { login: 'acme', kind: 'org' },
      ],
    });
    expect(listOwnersMock).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('409 CONNECTION_REQUIRED without a connection, 409 RECONNECT_REQUIRED with a lapsed one', async () => {
    listOwnersMock.mockRejectedValueOnce(new FakeConnectionRequiredError('none'));
    const missing = await ownersRoute(get('/api/connections/github/owners'));
    expect(missing.status).toBe(409);
    const missingBody = await missing.json();
    expect(missingBody.error.code).toBe('CONNECTION_REQUIRED');
    expect(missingBody.error.details).toEqual({ provider: 'github' });

    listOwnersMock.mockRejectedValueOnce(new FakeReconnectRequiredError('lapsed'));
    const lapsed = await ownersRoute(get('/api/connections/github/owners'));
    expect(lapsed.status).toBe(409);
    const lapsedBody = await lapsed.json();
    expect(lapsedBody.error.code).toBe('RECONNECT_REQUIRED');
    expect(lapsedBody.error.details).toEqual({ provider: 'github', reason: 'needs_reauth' });
  });
});

describe('DELETE /api/connections/:provider', () => {
  const del = (provider: string) =>
    disconnectRoute(
      new Request(`http://localhost/api/connections/${provider}`, { method: 'DELETE' }),
      {
        params: Promise.resolve({ provider }),
      },
    );
  const connected = (provider: string) => [
    { provider, status: 'active', displayName: 'x', scopes: [], connectedAt: new Date(0) },
  ];

  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await del('github')).status).toBe(401);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND for an unknown provider segment', async () => {
    const response = await del('gitlab');
    expect(response.status).toBe(404);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when nothing is connected', async () => {
    listConnectionsMock.mockResolvedValue([
      { provider: 'github', status: 'none', displayName: null, scopes: [], connectedAt: null },
    ]);
    const response = await del('github');
    expect(response.status).toBe(404);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it.each([true, false, null])(
    'returns { providerRevoked: %s } as disconnect reported it',
    async (revoked) => {
      listConnectionsMock.mockResolvedValue(connected('github'));
      disconnectMock.mockResolvedValue({ providerRevoked: revoked });

      const response = await del('github');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ providerRevoked: revoked });
      expect(disconnectMock).toHaveBeenCalledWith('user-1', 'github');
    },
  );
});
