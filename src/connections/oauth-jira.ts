import { env } from '@/lib/env';
import { ConnectionConfigError, InvalidGrantError, OAuthFlowError } from './errors';
import { registerRefresher, type RefreshInput, type RefreshResult } from './hooks';

// Atlassian 3LO (OAuth 2.0 authorization-code) web flow and the refresh-token
// exchange (SCRUM-97). Like oauth-github.ts, the provider HTTP for the Jira
// connection lives in this one internal file; the module still imports only db
// and lib. Global `fetch` is resolved on every call so tests can swap it.
//
// Atlassian issues a refresh token (scope `offline_access`) and ROTATES it on
// every use: the refresher below returns the new one and `refreshLocked`
// (store.ts) persists it under the row lock (ERD 7.6). There is no simple
// revocation endpoint, so no revoker is registered (disconnect -> null).

const AUTHORIZE_URL = 'https://auth.atlassian.com/authorize';
const TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const API = 'https://api.atlassian.com';
// `manage:jira-project` (round 17, UC-S11) lets the app create a Jira project; a
// connection made before it was requested lacks it and reconnects once.
export const JIRA_SCOPE =
  'read:jira-work write:jira-work manage:jira-project offline_access read:me';
const CALLBACK_PATH = '/api/connections/jira/callback';
const REQUEST_TIMEOUT_MS = 10_000;

function requireVar(name: 'ATLASSIAN_CLIENT_ID' | 'ATLASSIAN_CLIENT_SECRET'): string {
  const value = env[name];
  // Names the variable, never a value.
  if (!value) throw new ConnectionConfigError(`${name} is not configured.`);
  return value;
}

/** The single redirect URI Atlassian may return to: NEXT_PUBLIC_SITE_URL's origin plus the fixed callback path. */
export function jiraRedirectUri(): string {
  return `${new URL(env.NEXT_PUBLIC_SITE_URL).origin}${CALLBACK_PATH}`;
}

export function buildJiraAuthorizeUrl(args: { state: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('audience', 'api.atlassian.com');
  url.searchParams.set('client_id', requireVar('ATLASSIAN_CLIENT_ID'));
  url.searchParams.set('scope', JIRA_SCOPE);
  url.searchParams.set('redirect_uri', jiraRedirectUri());
  url.searchParams.set('state', args.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('prompt', 'consent');
  // Atlassian ignores PKCE for a confidential client; sent so the flow is identical to GitHub's.
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function call(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    // Network failure / timeout / abort. Nothing of the error is kept: it could echo a URL with a code.
    throw new OAuthFlowError('exchange_failed');
  }
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
};

function parseToken(record: Record<string, unknown>): TokenResponse | null {
  if (typeof record.access_token !== 'string' || record.access_token === '') return null;
  const expiresIn = typeof record.expires_in === 'number' ? record.expires_in : null;
  return {
    accessToken: record.access_token,
    refreshToken:
      typeof record.refresh_token === 'string' && record.refresh_token !== ''
        ? record.refresh_token
        : null,
    expiresAt: expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000),
    scopes: typeof record.scope === 'string' ? record.scope.split(/[,\s]+/).filter(Boolean) : [],
  };
}

/** Authorization code -> tokens (access + rotating refresh) and the scopes Atlassian granted. */
export async function exchangeJiraCode(args: {
  code: string;
  pkceVerifier: string;
}): Promise<TokenResponse> {
  const response = await call(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: requireVar('ATLASSIAN_CLIENT_ID'),
      client_secret: requireVar('ATLASSIAN_CLIENT_SECRET'),
      code: args.code,
      redirect_uri: jiraRedirectUri(),
      code_verifier: args.pkceVerifier,
    }),
  });
  if (!response.ok) throw new OAuthFlowError('exchange_failed');
  const token = parseToken(await readObject(response));
  if (!token) throw new OAuthFlowError('exchange_failed');
  return token;
}

/** The connected Atlassian account: its stable `account_id` and a display name. */
export async function fetchJiraIdentity(
  accessToken: string,
): Promise<{ id: string; displayName: string }> {
  const response = await call(`${API}/me`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new OAuthFlowError('exchange_failed');
  const record = await readObject(response);
  if (typeof record.account_id !== 'string' || record.account_id === '') {
    throw new OAuthFlowError('exchange_failed');
  }
  const displayName =
    (typeof record.name === 'string' && record.name) ||
    (typeof record.email === 'string' && record.email) ||
    record.account_id;
  return { id: record.account_id, displayName };
}

/** The first accessible Jira site (`cloudId`, `siteUrl`, `siteName`), or `null` when the account has none. */
export async function fetchDefaultJiraSite(
  accessToken: string,
): Promise<{ cloudId: string; siteUrl: string; siteName: string } | null> {
  const response = await call(`${API}/oauth/token/accessible-resources`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new OAuthFlowError('exchange_failed');
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthFlowError('exchange_failed');
  }
  if (!Array.isArray(body)) throw new OAuthFlowError('exchange_failed');
  for (const entry of body) {
    const site = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (typeof site.id === 'string' && site.id !== '') {
      return {
        cloudId: site.id,
        siteUrl: typeof site.url === 'string' ? site.url : '',
        siteName: typeof site.name === 'string' ? site.name : '',
      };
    }
  }
  return null;
}

/**
 * The refresh-token exchange (ERD 7.6). Returns the NEW rotated refresh token.
 * `invalid_grant` (or 401) -> `InvalidGrantError`, which connections turns into
 * `needs_reauth`; anything else that fails is a plain, transient error whose
 * message carries neither provider text nor any token or secret.
 */
async function refreshJiraToken(input: RefreshInput): Promise<RefreshResult> {
  const clientId = requireVar('ATLASSIAN_CLIENT_ID');
  const clientSecret = requireVar('ATLASSIAN_CLIENT_SECRET');
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: input.refreshToken,
      }),
      signal: input.signal,
    });
  } catch {
    // Timeout / abort / network: transient. The original error is dropped on purpose.
    throw new Error('The Atlassian token endpoint could not be reached.');
  }
  const record = await readObject(response);
  if (!response.ok) {
    if (record.error === 'invalid_grant' || response.status === 401) throw new InvalidGrantError();
    throw new Error(`The Atlassian token endpoint refused the refresh (HTTP ${response.status}).`);
  }
  const token = parseToken(record);
  if (!token) throw new Error('The Atlassian token endpoint returned an unusable response.');
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
  };
}

// Registered at import time of the module, so it is in place before any
// `getCredential` can need a refresh in this process.
registerRefresher('jira', refreshJiraToken);
