import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { Credential } from '@/connections/credential';
import {
  ConnectionConfigError,
  ConnectionRequiredError,
  InvalidGrantError,
  ReconnectRequiredError,
} from '@/connections/errors';
import { validateProviderMeta } from '@/connections/meta';

const TOKEN = 'SENTINEL-ACCESS-TOKEN-do-not-leak-0123456789';

function make() {
  return new Credential({
    connectionId: 'conn-1',
    provider: 'jira',
    accountId: 'acct-1',
    accessToken: TOKEN,
    meta: { cloudId: 'cloud-1' },
    scopes: ['read:jira-work', 'manage:jira-project'],
  });
}

describe('Credential redaction (NFR-005)', () => {
  it('exposes the token to in-process code only through the getter', () => {
    const c = make();
    expect(c.accessToken).toBe(TOKEN);
    expect(c.accountId).toBe('acct-1');
    expect(c.meta).toEqual({ cloudId: 'cloud-1' });
  });

  it('carries the granted scopes (non-secret), frozen, and still redacts the token', () => {
    const c = make();
    expect(c.scopes).toEqual(['read:jira-work', 'manage:jira-project']);
    expect(Object.isFrozen(c.scopes)).toBe(true);
    expect(c.scopes.includes('manage:jira-project')).toBe(true);
    expect(inspect(c)).not.toContain(TOKEN);
    expect(() => JSON.stringify(c)).toThrow();
  });

  it('JSON.stringify throws instead of leaking', () => {
    expect(() => JSON.stringify(make())).toThrow();
    expect(() => JSON.stringify({ nested: make() })).toThrow();
  });

  it('util.inspect, template strings and Object.keys show no token', () => {
    const c = make();
    expect(inspect(c)).not.toContain(TOKEN);
    expect(inspect({ wrapped: c }, { depth: 5 })).not.toContain(TOKEN);
    expect(`${c}`).not.toContain(TOKEN);
    expect(JSON.stringify(Object.keys(c))).not.toContain('accessToken');
    expect(JSON.stringify({ ...c })).not.toContain(TOKEN);
  });
});

describe('providerMeta whitelist', () => {
  it('accepts the documented keys', () => {
    expect(validateProviderMeta('github', { login: 'octo' })).toEqual({ login: 'octo' });
    expect(
      validateProviderMeta('jira', { cloudId: 'c', siteUrl: 'https://x', siteName: 'X' }),
    ).toEqual({ cloudId: 'c', siteUrl: 'https://x', siteName: 'X' });
    expect(validateProviderMeta('stitch', {})).toEqual({});
  });

  it.each([
    ['github', { access_token: 'x' }],
    ['github', { login: 'a', token: 'x' }],
    ['jira', { refresh_token: 'x' }],
    ['jira', { login: 'a' }],
    ['stitch', { apiKey: 'x' }],
    ['github', { login: 42 }],
  ] as const)('rejects %s meta %j', (provider, meta) => {
    expect(() => validateProviderMeta(provider, meta)).toThrow();
  });

  it('rejects non-objects and does not echo values in the message', () => {
    expect(() => validateProviderMeta('github', null)).toThrow();
    expect(() => validateProviderMeta('github', [])).toThrow();
    try {
      validateProviderMeta('github', { access_token: TOKEN });
    } catch (e) {
      expect((e as Error).message).not.toContain(TOKEN);
    }
  });
});

describe('errors carry no secrets', () => {
  it('have fixed messages with only ids/reasons', () => {
    const errors = [
      new ConnectionRequiredError('github'),
      new ReconnectRequiredError('jira', 'refresh_rejected', 'conn-1'),
      new ConnectionConfigError('CONNECTION_ENCRYPTION_KEY is not set.'),
      new InvalidGrantError(),
    ];
    for (const e of errors) {
      expect(e.message).not.toContain(TOKEN);
      expect(e.message).not.toMatch(/v1:[A-Za-z0-9_-]+:/);
    }
    expect(errors[0]!.name).toBe('ConnectionRequiredError');
    expect(errors[1]!.name).toBe('ReconnectRequiredError');
    expect(errors[1]).toBeInstanceOf(Error);
  });
});
