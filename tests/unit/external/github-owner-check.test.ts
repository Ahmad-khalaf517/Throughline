import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// github.checkOwnerAccessible (Module Boundaries 4.6, round 14 D2) with a fake
// GitHub on globalThis.fetch (the technique of tests/integration/external/github.test.ts:
// @octokit/request resolves fetch on every call). Everything the module imports
// that would need a database or env is mocked; the credential comes from a
// mocked `connections.getCredential`, never from GITHUB_TOKEN.
const { getCredentialMock, reportAuthFailureMock, ReconnectRequiredErrorFake } = vi.hoisted(() => {
  class ReconnectRequiredErrorFake extends Error {
    constructor(
      readonly provider: string,
      readonly reason: string,
      readonly connectionId: string,
    ) {
      super('reconnect');
    }
  }
  return {
    getCredentialMock: vi.fn(),
    reportAuthFailureMock: vi.fn(),
    ReconnectRequiredErrorFake,
  };
});

vi.mock('@/lib/env', () => ({ env: { GITHUB_TOKEN: 'legacy-env-token' } }));
vi.mock('@/connections', () => ({
  getCredential: getCredentialMock,
  reportAuthFailure: reportAuthFailureMock,
  ReconnectRequiredError: ReconnectRequiredErrorFake,
}));
vi.mock('@/external/operations', () => ({
  runOperation: vi.fn(),
  getRefById: vi.fn(),
  DefinitiveProviderError: class extends Error {},
}));
vi.mock('@/lineage/impact', () => ({ getWarnings: vi.fn(), getExternalDrift: vi.fn() }));
vi.mock('@/artifact-types/architecture', () => ({
  getSelectedOption: vi.fn(),
  getArchitectureDecisionItems: vi.fn(),
}));

import { checkOwnerAccessible } from '@/external/github';

type Handler = (url: URL, init: RequestInit) => { status: number; body: unknown };
const realFetch = globalThis.fetch;
let seenAuth: string[] = [];

function fakeGithub(routes: Record<string, { status: number; body: unknown }>) {
  const handler: Handler = (url) =>
    routes[url.pathname] ?? { status: 404, body: { message: 'Not Found' } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    seenAuth.push(String(new Headers(init?.headers).get('authorization')));
    const { status, body } = handler(url, init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const ctx = { userId: 'user-1' };

describe('github.checkOwnerAccessible', () => {
  beforeEach(() => {
    seenAuth = [];
    getCredentialMock.mockReset().mockResolvedValue({
      connectionId: 'conn-1',
      accessToken: 'user-token',
    });
    reportAuthFailureMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("is true for the connected account's own login (case-insensitive), using the user's credential", async () => {
    fakeGithub({ '/user': { status: 200, body: { login: 'Octocat' } } });

    await expect(checkOwnerAccessible(ctx, 'octocat')).resolves.toBe(true);

    expect(getCredentialMock).toHaveBeenCalledWith('user-1', 'github');
    expect(seenAuth.every((h) => h.includes('user-token'))).toBe(true);
    expect(seenAuth.some((h) => h.includes('legacy-env-token'))).toBe(false);
  });

  it('is true for an organization with an active membership', async () => {
    fakeGithub({
      '/user': { status: 200, body: { login: 'octocat' } },
      '/user/memberships/orgs/acme': { status: 200, body: { state: 'active' } },
    });
    await expect(checkOwnerAccessible(ctx, 'acme')).resolves.toBe(true);
  });

  it('is false for a pending membership, an unknown owner, or an org the account cannot see', async () => {
    fakeGithub({
      '/user': { status: 200, body: { login: 'octocat' } },
      '/user/memberships/orgs/pending-org': { status: 200, body: { state: 'pending' } },
    });
    await expect(checkOwnerAccessible(ctx, 'pending-org')).resolves.toBe(false);
    await expect(checkOwnerAccessible(ctx, 'nobody')).resolves.toBe(false);
  });

  it('marks the connection needs_reauth and throws ReconnectRequiredError when GitHub answers 401', async () => {
    fakeGithub({ '/user': { status: 401, body: { message: 'Bad credentials' } } });

    await expect(checkOwnerAccessible(ctx, 'acme')).rejects.toBeInstanceOf(
      ReconnectRequiredErrorFake,
    );
    expect(reportAuthFailureMock).toHaveBeenCalledWith('conn-1');
  });

  it('propagates ConnectionRequiredError from getCredential and never calls GitHub', async () => {
    getCredentialMock.mockRejectedValue(new Error('ConnectionRequired'));
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(checkOwnerAccessible(ctx, 'acme')).rejects.toThrow('ConnectionRequired');
    expect(spy).not.toHaveBeenCalled();
  });
});
