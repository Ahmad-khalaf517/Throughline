import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The signed OAuth `state`, PKCE and returnTo validation (Module Boundaries
// 4.9). `@/lib/env` is mocked so OAUTH_STATE_SECRET can be varied per test.
const envMock = vi.hoisted(() => ({
  env: { OAUTH_STATE_SECRET: 'unit-test-state-secret' } as Record<string, string | undefined>,
}));
vi.mock('@/lib/env', () => envMock);

import { ConnectionConfigError, OAuthFlowError } from '@/connections/errors';
import {
  STATE_TTL_MS,
  createPkce,
  pkceChallenge,
  sanitizeReturnTo,
  signState,
  verifyState,
} from '@/connections/oauth-state';

const NOW = 1_700_000_000_000;

function fresh(overrides: { returnTo?: string; userId?: string } = {}) {
  const { verifier, challenge } = createPkce();
  const state = signState({
    userId: overrides.userId ?? 'user-1',
    provider: 'github',
    returnTo: overrides.returnTo,
    challenge,
    now: NOW,
  });
  return { verifier, challenge, state };
}

const verify = (
  state: string,
  verifier: string,
  extra: { userId?: string; provider?: 'github' | 'jira'; now?: number } = {},
) =>
  verifyState(state, {
    userId: extra.userId ?? 'user-1',
    provider: extra.provider ?? 'github',
    pkceVerifier: verifier,
    now: extra.now ?? NOW + 1000,
  });

describe('PKCE', () => {
  it('derives the RFC 7636 S256 challenge: base64url(sha256(verifier))', () => {
    // RFC 7636 appendix B test vector.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const { verifier, challenge } = createPkce();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(createPkce().verifier).not.toBe(verifier);
  });
});

describe('signState / verifyState', () => {
  beforeEach(() => {
    envMock.env.OAUTH_STATE_SECRET = 'unit-test-state-secret';
  });

  it('round-trips for the same user and provider and returns the validated returnTo', () => {
    const { state, verifier } = fresh({ returnTo: '/projects/p1/github' });
    expect(verify(state, verifier)).toEqual({ returnTo: '/projects/p1/github' });
  });

  it('has no returnTo when none (or an unsafe one) was given', () => {
    const a = fresh();
    expect(verify(a.state, a.verifier)).toEqual({});
    const b = fresh({ returnTo: 'https://evil.example/x' });
    expect(verify(b.state, b.verifier)).toEqual({});
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const { state, verifier } = fresh();
    const [body, sig] = state.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    payload.u = 'user-2';
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect(() => verify(forged, verifier, { userId: 'user-2' })).toThrow(OAuthFlowError);
  });

  it('rejects a tampered or truncated signature and malformed state', () => {
    const { state, verifier } = fresh();
    const [body] = state.split('.') as [string];
    for (const bad of [
      `${body}.AAAA`,
      `${body}.`,
      body,
      '',
      'a.b.c',
      `${body}.${'A'.repeat(43)}`,
    ]) {
      expect(() => verify(bad, verifier)).toThrow(OAuthFlowError);
    }
  });

  it('rejects an expired state and accepts right up to the deadline', () => {
    const { state, verifier } = fresh();
    expect(() => verify(state, verifier, { now: NOW + STATE_TTL_MS })).toThrow(OAuthFlowError);
    expect(() => verify(state, verifier, { now: NOW + STATE_TTL_MS + 1 })).toThrow(OAuthFlowError);
    expect(() => verify(state, verifier, { now: NOW + STATE_TTL_MS - 1 })).not.toThrow();
  });

  it("rejects another user's state (CSRF: an attacker's link used by the victim)", () => {
    const { state, verifier } = fresh({ userId: 'attacker' });
    expect(() => verify(state, verifier, { userId: 'victim' })).toThrow(OAuthFlowError);
  });

  it("rejects another provider's state", () => {
    const { state, verifier } = fresh();
    expect(() => verify(state, verifier, { provider: 'jira' })).toThrow(OAuthFlowError);
  });

  it('rejects a PKCE verifier that does not belong to the state', () => {
    const { state } = fresh();
    expect(() => verify(state, createPkce().verifier)).toThrow(OAuthFlowError);
  });

  it('rejects a state signed with a different secret', () => {
    const { state, verifier } = fresh();
    envMock.env.OAUTH_STATE_SECRET = 'a-different-secret';
    expect(() => verify(state, verifier)).toThrow(OAuthFlowError);
  });

  it('carries the invalid_state code and no secret in the error', () => {
    const { state, verifier } = fresh();
    try {
      verify(state, verifier, { userId: 'someone-else' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OAuthFlowError);
      expect((error as OAuthFlowError).code).toBe('invalid_state');
      expect((error as Error).message).not.toContain('unit-test-state-secret');
    }
  });

  it('a missing OAUTH_STATE_SECRET is a ConnectionConfigError naming the variable, never an invalid state', () => {
    envMock.env.OAUTH_STATE_SECRET = undefined;
    expect(() => signState({ userId: 'u', provider: 'github', challenge: 'c' })).toThrow(
      ConnectionConfigError,
    );
    expect(() => signState({ userId: 'u', provider: 'github', challenge: 'c' })).toThrow(
      /OAUTH_STATE_SECRET/,
    );
  });
});

describe('sanitizeReturnTo', () => {
  it.each(['/projects', '/projects/abc/github?tab=1', '/connections#x'])('keeps %s', (value) => {
    expect(sanitizeReturnTo(value)).toBe(value);
  });

  it.each([
    undefined,
    '',
    'projects',
    '//evil.example',
    'https://evil.example/x',
    'http://localhost:3000/x',
    '/\\evil.example',
    '/ok\nX-Injected: 1',
    `/${'a'.repeat(600)}`,
    'javascript:alert(1)',
  ])('drops %j', (value) => {
    expect(sanitizeReturnTo(value)).toBeUndefined();
  });
});
