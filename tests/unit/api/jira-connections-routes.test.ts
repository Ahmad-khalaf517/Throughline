import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring for the Jira connections routes (API Contracts 10A):
// GET .../jira/start, .../jira/callback, .../jira/sites, .../jira/projects.
// `@/connections` and `@/external/jira` are mocked with stand-in error classes
// (the real modules sit on `@/db`); the github twins live in
// connections-routes.test.ts.
const {
  FakeConnectionRequiredError,
  FakeReconnectRequiredError,
  FakeOAuthFlowError,
  FakeJiraTargetRequiredError,
  FakeJiraSiteError,
  beginOAuthMock,
  completeOAuthMock,
  listSitesMock,
  listProjectsMock,
} = vi.hoisted(() => {
  class FakeConnectionRequiredError extends Error {
    provider = 'jira';
  }
  class FakeReconnectRequiredError extends Error {
    provider = 'jira';
    reason = 'needs_reauth';
  }
  class FakeOAuthFlowError extends Error {
    constructor(readonly code: string) {
      super('fixed message');
    }
  }
  class FakeJiraTargetRequiredError extends Error {
    readonly target = 'jira' as const;
  }
  class FakeJiraSiteError extends Error {}
  return {
    FakeConnectionRequiredError,
    FakeReconnectRequiredError,
    FakeOAuthFlowError,
    FakeJiraTargetRequiredError,
    FakeJiraSiteError,
    beginOAuthMock: vi.fn(),
    completeOAuthMock: vi.fn(),
    listSitesMock: vi.fn(),
    listProjectsMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ getVerifiedUser: vi.fn() }));
vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
  OAuthFlowError: FakeOAuthFlowError,
  beginOAuth: beginOAuthMock,
  completeOAuth: completeOAuthMock,
}));
vi.mock('@/external/jira', () => ({
  listSites: listSitesMock,
  listProjects: listProjectsMock,
  JiraTargetRequiredError: FakeJiraTargetRequiredError,
  JiraSiteNotAccessibleError: FakeJiraSiteError,
}));

import { getVerifiedUser } from '@/auth';
import { GET as startRoute } from '@/app/api/connections/jira/start/route';
import { GET as callbackRoute } from '@/app/api/connections/jira/callback/route';
import { GET as sitesRoute } from '@/app/api/connections/jira/sites/route';
import { GET as projectsRoute } from '@/app/api/connections/jira/projects/route';

const mockedUser = vi.mocked(getVerifiedUser);
const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const AUTHORIZE = 'https://auth.atlassian.com/authorize?client_id=x&state=s';
const VERIFIER = 'pkce-verifier-value';

function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, cookie ? { headers: { cookie } } : {});
}

beforeEach(() => {
  mockedUser.mockReset().mockResolvedValue(user);
  beginOAuthMock.mockReset().mockResolvedValue({ authorizeUrl: AUTHORIZE, pkceVerifier: VERIFIER });
  completeOAuthMock.mockReset().mockResolvedValue({});
  listSitesMock.mockReset();
  listProjectsMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/connections/jira/start', () => {
  it('returns 401 without a verified user and starts nothing', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await startRoute(get('/api/connections/jira/start'))).status).toBe(401);
    expect(beginOAuthMock).not.toHaveBeenCalled();
  });

  it('302s to the Atlassian authorize URL and sets the PKCE verifier in the tl_oauth_pkce_jira cookie', async () => {
    const response = await startRoute(get('/api/connections/jira/start?returnTo=/projects/p1'));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(AUTHORIZE);
    expect(beginOAuthMock).toHaveBeenCalledWith('user-1', 'jira', { returnTo: '/projects/p1' });

    const cookie = response.headers
      .getSetCookie()
      .find((c) => c.startsWith('tl_oauth_pkce_jira='))!;
    expect(cookie).toContain(`tl_oauth_pkce_jira=${VERIFIER}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\/api\/connections(;|$)/);
    expect(cookie).toMatch(/Max-Age=600/i);
  });

  it('a missing ATLASSIAN_CLIENT_ID is a generic 500 that does not leak the cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    beginOAuthMock.mockRejectedValue(new Error('ATLASSIAN_CLIENT_ID is not configured.'));
    const response = await startRoute(get('/api/connections/jira/start'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('ATLASSIAN');
    consoleError.mockRestore();
  });
});

describe('GET /api/connections/jira/callback', () => {
  const COOKIE = `tl_oauth_pkce_jira=${VERIFIER}`;
  const qs = '?code=the-code&state=the-state';

  function clearsCookie(response: Response): boolean {
    const cookie = response.headers.getSetCookie().find((c) => c.startsWith('tl_oauth_pkce_jira='));
    return Boolean(cookie && /Max-Age=0/i.test(cookie));
  }

  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    const response = await callbackRoute(get(`/api/connections/jira/callback${qs}`, COOKIE));
    expect(response.status).toBe(401);
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('completes the flow with the cookie verifier, clears the cookie and lands on /connections?connected=jira', async () => {
    const response = await callbackRoute(get(`/api/connections/jira/callback${qs}`, COOKIE));

    expect(completeOAuthMock).toHaveBeenCalledWith('user-1', 'jira', {
      code: 'the-code',
      state: 'the-state',
      pkceVerifier: VERIFIER,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/connections?connected=jira');
    expect(clearsCookie(response)).toBe(true);
  });

  it('redirects to the returnTo from the verified state', async () => {
    completeOAuthMock.mockResolvedValue({ returnTo: '/projects/p1/jira' });
    const response = await callbackRoute(get(`/api/connections/jira/callback${qs}`, COOKIE));
    expect(response.headers.get('location')).toBe('/projects/p1/jira');
  });

  it('a declined consent lands on error=access_denied without calling completeOAuth', async () => {
    const response = await callbackRoute(
      get('/api/connections/jira/callback?error=access_denied&error_description=x', COOKIE),
    );
    expect(response.headers.get('location')).toBe('/connections?error=access_denied');
    expect(completeOAuthMock).not.toHaveBeenCalled();
    expect(clearsCookie(response)).toBe(true);
  });

  it('the github cookie is not accepted for a jira callback', async () => {
    const response = await callbackRoute(
      get(`/api/connections/jira/callback${qs}`, `tl_oauth_pkce_github=${VERIFIER}`),
    );
    expect(response.headers.get('location')).toBe('/connections?error=invalid_state');
    expect(completeOAuthMock).not.toHaveBeenCalled();
  });

  it('maps an OAuthFlowError to its safe code, never its message', async () => {
    completeOAuthMock.mockRejectedValue(new FakeOAuthFlowError('exchange_failed'));
    const response = await callbackRoute(get(`/api/connections/jira/callback${qs}`, COOKIE));
    expect(response.headers.get('location')).toBe('/connections?error=exchange_failed');
    expect(clearsCookie(response)).toBe(true);
  });
});

describe('GET /api/connections/jira/sites', () => {
  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await sitesRoute(get('/api/connections/jira/sites'))).status).toBe(401);
    expect(listSitesMock).not.toHaveBeenCalled();
  });

  it('lists the accessible sites with a user-only ctx', async () => {
    listSitesMock.mockResolvedValue([{ cloudId: 'c1', url: 'https://a.atlassian.net', name: 'A' }]);
    const response = await sitesRoute(get('/api/connections/jira/sites'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sites: [{ cloudId: 'c1', url: 'https://a.atlassian.net', name: 'A' }],
    });
    expect(listSitesMock).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('409 CONNECTION_REQUIRED without a connection, 409 RECONNECT_REQUIRED with a lapsed one', async () => {
    listSitesMock.mockRejectedValueOnce(new FakeConnectionRequiredError('none'));
    const missing = await sitesRoute(get('/api/connections/jira/sites'));
    expect(missing.status).toBe(409);
    expect((await missing.json()).error).toMatchObject({
      code: 'CONNECTION_REQUIRED',
      details: { provider: 'jira' },
    });

    listSitesMock.mockRejectedValueOnce(new FakeReconnectRequiredError('lapsed'));
    const lapsed = await sitesRoute(get('/api/connections/jira/sites'));
    expect(lapsed.status).toBe(409);
    expect((await lapsed.json()).error).toMatchObject({
      code: 'RECONNECT_REQUIRED',
      details: { provider: 'jira', reason: 'needs_reauth' },
    });
  });
});

describe('GET /api/connections/jira/projects', () => {
  it('returns 401 without a verified user', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await projectsRoute(get('/api/connections/jira/projects?cloudId=c1'))).status).toBe(
      401,
    );
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no query', ''],
    ['a blank cloudId', '?cloudId=%20'],
  ])('400 VALIDATION_ERROR for %s, calling nothing', async (_label, query) => {
    const response = await projectsRoute(get(`/api/connections/jira/projects${query}`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(listProjectsMock).not.toHaveBeenCalled();
  });

  it('lists the projects of one site with a user-only ctx', async () => {
    listProjectsMock.mockResolvedValue([{ key: 'PROJ', name: 'Project' }]);
    const response = await projectsRoute(get('/api/connections/jira/projects?cloudId=c1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [{ key: 'PROJ', name: 'Project' }] });
    expect(listProjectsMock).toHaveBeenCalledWith({ userId: 'user-1' }, 'c1');
  });

  it('422 TARGET_NOT_ACCESSIBLE when the cloudId is not one of the caller sites', async () => {
    listProjectsMock.mockRejectedValue(new FakeJiraSiteError('not yours'));
    const response = await projectsRoute(get('/api/connections/jira/projects?cloudId=other'));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatchObject({
      code: 'TARGET_NOT_ACCESSIBLE',
      details: { target: 'jira' },
    });
  });

  it('409 CONNECTION_REQUIRED / RECONNECT_REQUIRED propagate', async () => {
    listProjectsMock.mockRejectedValueOnce(new FakeConnectionRequiredError('none'));
    expect((await projectsRoute(get('/api/connections/jira/projects?cloudId=c1'))).status).toBe(
      409,
    );
    listProjectsMock.mockRejectedValueOnce(new FakeReconnectRequiredError('lapsed'));
    const lapsed = await projectsRoute(get('/api/connections/jira/projects?cloudId=c1'));
    expect((await lapsed.json()).error.code).toBe('RECONNECT_REQUIRED');
  });
});
