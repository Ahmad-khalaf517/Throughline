// Route glue for the OAuth start/callback pair (API Contracts 10A). The PKCE
// verifier is owned by the ROUTE (Module Boundaries 4.9): it is set in a
// short-lived httpOnly cookie at start and read + cleared at callback. Redirects
// use a relative Location, so nothing here depends on the deployment's origin.
import { NextResponse } from 'next/server';

const COOKIE_PREFIX = 'tl_oauth_pkce_';
const COOKIE_PATH = '/api/connections';
// The authorization page is open in the user's browser meanwhile; matches the
// signed state's own lifetime (src/connections/oauth-state.ts).
const COOKIE_MAX_AGE_SECONDS = 10 * 60;

export type OAuthErrorCode = 'invalid_state' | 'access_denied' | 'exchange_failed';

export function pkceCookieName(provider: string): string {
  return `${COOKIE_PREFIX}${provider}`;
}

/** Reads one cookie from the raw `Cookie` header (works for a plain `Request`). */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function redirectTo(location: string): NextResponse {
  return new NextResponse(null, { status: 302, headers: { Location: location } });
}

/** `httpOnly`, `SameSite=Lax` (the callback is a top-level cross-site GET), `Secure` in production, scoped to the connections routes. */
export function setPkceCookie(response: NextResponse, provider: string, verifier: string): void {
  response.cookies.set(pkceCookieName(provider), verifier, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearPkceCookie(response: NextResponse, provider: string): void {
  response.cookies.set(pkceCookieName(provider), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: COOKIE_PATH,
    maxAge: 0,
  });
}

export function errorRedirect(code: OAuthErrorCode): string {
  return `/connections?error=${code}`;
}
