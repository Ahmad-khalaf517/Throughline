import { env } from '@/lib/env';
import { ConnectionConfigError, OAuthFlowError } from './errors';
import { registerRevoker } from './hooks';

// GitHub OAuth App web flow (SCRUM-96). The provider HTTP for the GitHub
// connection lives in this one internal file; the module still imports only db
// and lib. Global `fetch` is resolved on every call so tests can swap it.
//
// OAuth-App tokens do not expire and have no refresh token, so the connection
// is saved with expires_at NULL and no refresh token (ERD 4.17, risk 17).

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const API = 'https://api.github.com';
/**
 * `repo` to create repositories and write their files; `read:org` so org
 * membership (`GET /user/memberships/orgs/{org}`, `GET /user/orgs`) is answered
 * reliably for the owner picker and PATCH .../targets validation.
 */
export const GITHUB_SCOPE = 'repo read:org';
const CALLBACK_PATH = '/api/connections/github/callback';
const REQUEST_TIMEOUT_MS = 10_000;

function requireVar(name: 'GITHUB_OAUTH_CLIENT_ID' | 'GITHUB_OAUTH_CLIENT_SECRET'): string {
  const value = env[name];
  // Names the variable, never a value.
  if (!value) throw new ConnectionConfigError(`${name} is not configured.`);
  return value;
}

/**
 * The single redirect URI GitHub may return to: the allowlist is derived from
 * NEXT_PUBLIC_SITE_URL's origin plus the fixed callback path, so a request can
 * never choose it.
 */
export function githubRedirectUri(): string {
  return `${new URL(env.NEXT_PUBLIC_SITE_URL).origin}${CALLBACK_PATH}`;
}

export function buildGithubAuthorizeUrl(args: { state: string; challenge: string }): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', requireVar('GITHUB_OAUTH_CLIENT_ID'));
  url.searchParams.set('redirect_uri', githubRedirectUri());
  url.searchParams.set('scope', GITHUB_SCOPE);
  url.searchParams.set('state', args.state);
  url.searchParams.set('code_challenge', args.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

function splitScopes(value: unknown): string[] {
  return typeof value === 'string' ? value.split(/[,\s]+/).filter(Boolean) : [];
}

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    // Network failure / timeout. Nothing of the error is kept: it could echo a URL with a code.
    throw new OAuthFlowError('exchange_failed');
  }
}

/** Authorization code + PKCE verifier -> access token and the scopes GitHub actually granted. */
export async function exchangeGithubCode(args: {
  code: string;
  pkceVerifier: string;
}): Promise<{ accessToken: string; scopes: string[] }> {
  const response = await call(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: requireVar('GITHUB_OAUTH_CLIENT_ID'),
      client_secret: requireVar('GITHUB_OAUTH_CLIENT_SECRET'),
      code: args.code,
      redirect_uri: githubRedirectUri(),
      code_verifier: args.pkceVerifier,
    }),
  });
  if (!response.ok) throw new OAuthFlowError('exchange_failed');

  // GitHub answers 200 with `{ error: ... }` for a bad or reused code.
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthFlowError('exchange_failed');
  }
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || record.access_token === '') {
    throw new OAuthFlowError('exchange_failed');
  }
  return { accessToken: record.access_token, scopes: splitScopes(record.scope) };
}

/** The connected account: its stable numeric id (as a string), its login, and the token's scopes header. */
export async function fetchGithubIdentity(
  accessToken: string,
): Promise<{ id: string; login: string; scopes: string[] | null }> {
  const response = await call(`${API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Throughline',
    },
  });
  if (!response.ok) throw new OAuthFlowError('exchange_failed');

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthFlowError('exchange_failed');
  }
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const rawId = record.id;
  if (
    (typeof rawId !== 'number' && typeof rawId !== 'string') ||
    typeof record.login !== 'string' ||
    record.login === ''
  ) {
    throw new OAuthFlowError('exchange_failed');
  }
  const header = response.headers.get('x-oauth-scopes');
  return {
    id: String(rawId),
    login: record.login,
    scopes: header === null ? null : splitScopes(header),
  };
}

/**
 * Revokes the token at GitHub (`DELETE /applications/{client_id}/token`, Basic
 * client_id:client_secret). `true` only on the documented 204.
 */
async function revokeGithubToken(input: { accessToken: string }): Promise<boolean> {
  const clientId = requireVar('GITHUB_OAUTH_CLIENT_ID');
  const clientSecret = requireVar('GITHUB_OAUTH_CLIENT_SECRET');
  const response = await call(`${API}/applications/${encodeURIComponent(clientId)}/token`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'User-Agent': 'Throughline',
    },
    body: JSON.stringify({ access_token: input.accessToken }),
  });
  return response.status === 204;
}

// Registered at import time of the module, so it is in place before any
// `disconnect` can run in this process.
registerRevoker('github', revokeGithubToken);
