import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';
import { ConnectionConfigError, OAuthFlowError, type ConnectionProvider } from './errors';

// The signed OAuth `state` and PKCE helpers (Module Boundaries 4.9). `state` is
// HMAC-SHA256 with OAUTH_STATE_SECRET - never GITHUB_MARKER_SECRET - over a
// payload bound to the user, the provider, the (validated) returnTo, the PKCE
// challenge and a short expiry. It is a CSRF token, not a secret: it is visible
// in the browser's address bar, so it carries no credential.

/** How long a started authorization may take to come back (the user is on GitHub's page meanwhile). */
export const STATE_TTL_MS = 10 * 60_000;

const MAX_RETURN_TO_LENGTH = 512;

type StatePayload = {
  /** user id */
  u: string;
  /** provider */
  p: string;
  /** returnTo, or null */
  r: string | null;
  /** PKCE code challenge, so the cookie verifier is bound to this very state */
  c: string;
  /** expiry, ms since epoch */
  e: number;
  /** nonce */
  n: string;
};

function secret(): string {
  if (!env.OAUTH_STATE_SECRET) {
    throw new ConnectionConfigError('OAUTH_STATE_SECRET is not configured.');
  }
  return env.OAUTH_STATE_SECRET;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function mac(body: string): Buffer {
  return createHmac('sha256', secret()).update(body, 'utf8').digest();
}

/**
 * `returnTo` must be a relative path on this site. Anything else - an absolute
 * or protocol-relative URL, a backslash, control characters, an over-long value
 * - is dropped (`undefined`), never repaired.
 */
export function sanitizeReturnTo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > MAX_RETURN_TO_LENGTH) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  if (value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    if (new URL(value, 'http://return-to.invalid').origin !== 'http://return-to.invalid') {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return value;
}

/** RFC 7636 S256: a 256-bit random verifier and its base64url SHA-256 challenge. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function signState(args: {
  userId: string;
  provider: ConnectionProvider;
  returnTo?: string | undefined;
  challenge: string;
  now?: number;
}): string {
  const payload: StatePayload = {
    u: args.userId,
    p: args.provider,
    r: sanitizeReturnTo(args.returnTo) ?? null,
    c: args.challenge,
    e: (args.now ?? Date.now()) + STATE_TTL_MS,
    n: randomBytes(12).toString('base64url'),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${b64url(mac(body))}`;
}

/**
 * Throws `OAuthFlowError('invalid_state')` for anything but a state that this
 * server signed for exactly this user and provider, that has not expired, and
 * whose PKCE challenge matches `pkceVerifier`. A missing OAUTH_STATE_SECRET is
 * a configuration error, not an invalid state.
 */
export function verifyState(
  state: string,
  expected: { userId: string; provider: ConnectionProvider; pkceVerifier: string; now?: number },
): { returnTo?: string } {
  const invalid = () => new OAuthFlowError('invalid_state');
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalid();
  const [body, signature] = parts as [string, string];

  const want = mac(body);
  const got = Buffer.from(signature, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw invalid();

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    throw invalid();
  }
  if (payload.p !== expected.provider || payload.u !== expected.userId) throw invalid();
  if (typeof payload.e !== 'number' || payload.e <= (expected.now ?? Date.now())) throw invalid();
  if (typeof payload.c !== 'string' || payload.c !== pkceChallenge(expected.pkceVerifier)) {
    throw invalid();
  }

  const returnTo = sanitizeReturnTo(payload.r);
  return returnTo === undefined ? {} : { returnTo };
}
