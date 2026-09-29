import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The github module's round-14 credential handling (SCRUM-96 part B): a new
// operation uses the acting user's own connection, an existing one uses the
// connection recorded on it, and only an operation with no recorded connection
// falls back to the environment token. GitHub is an in-memory fake on
// globalThis.fetch (real Octokit request/response code runs on top of it);
// `runOperation` is a stand-in that invokes the closures the way the real one
// does, with `{ operationId }`.
const mocks = vi.hoisted(() => {
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
    ReconnectRequiredErrorFake,
    env: {
      GITHUB_TOKEN: 'legacy-env-token',
      GITHUB_OWNER: 'legacy-owner',
      GITHUB_MARKER_SECRET: 'marker-secret',
    } as Record<string, string | undefined>,
    getCredential: vi.fn(),
    getCredentialForOperation: vi.fn(),
    listConnections: vi.fn(),
    reportAuthFailure: vi.fn(),
    runOperation: vi.fn(),
    getOperationById: vi.fn(),
    getSelectedOption: vi.fn(),
    getArchitectureDecisionItems: vi.fn(),
  };
});

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/connections', () => ({
  getCredential: mocks.getCredential,
  getCredentialForOperation: mocks.getCredentialForOperation,
  listConnections: mocks.listConnections,
  reportAuthFailure: mocks.reportAuthFailure,
  ReconnectRequiredError: mocks.ReconnectRequiredErrorFake,
}));
vi.mock('@/external/operations', () => ({
  runOperation: mocks.runOperation,
  getRefById: vi.fn(),
  getOperationById: mocks.getOperationById,
  DefinitiveProviderError: class DefinitiveProviderError extends Error {},
}));
vi.mock('@/lineage/impact', () => ({
  getWarnings: vi.fn().mockResolvedValue([]),
  getExternalDrift: vi.fn(),
}));
vi.mock('@/artifact-types/architecture', () => ({
  getSelectedOption: mocks.getSelectedOption,
  getArchitectureDecisionItems: mocks.getArchitectureDecisionItems,
}));

import {
  checkRepoName,
  GithubTargetRequiredError,
  initRepo,
  listOwners,
  previewInit,
  retryOperation,
} from '@/external/github';

const realFetch = globalThis.fetch;
const USER_TOKEN = 'gho_user_token';

type Seen = { method: string; path: string; auth: string; body: unknown };
let seen: Seen[] = [];
let githubRoutes: Record<string, { status: number; body: unknown }> = {};

function installFakeGithub() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    seen.push({
      method,
      path: url.pathname,
      auth: String(new Headers(init?.headers).get('authorization')),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    // initRepo writes README / starter / ADR / lineage.json through the contents
    // API right after creating the repo; unless a test overrides a path, accept them.
    const isContentsWrite =
      method === 'PUT' && /^\/repos\/[^/]+\/[^/]+\/contents\//.test(url.pathname);
    const route =
      githubRoutes[`${method} ${url.pathname}`] ??
      (isContentsWrite
        ? { status: 201, body: { content: {}, commit: { sha: 'abc' } } }
        : undefined);
    const { status, body } = route ?? { status: 404, body: { message: 'Not Found' } };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }) as typeof fetch;
}

const credential = (overrides: Record<string, unknown> = {}) => ({
  connectionId: 'conn-1',
  provider: 'github',
  accountId: '4242',
  accessToken: USER_TOKEN,
  meta: { login: 'octo' },
  ...overrides,
});

const createdRepo = (owner: string, name: string) => ({
  status: 201,
  body: {
    id: 77,
    name,
    full_name: `${owner}/${name}`,
    html_url: `https://github.com/${owner}/${name}`,
    owner: { login: owner },
  },
});
const contentsOk = { status: 201, body: { content: {}, commit: { sha: 'abc' } } };

const selected = {
  projectId: 'proj-1',
  artifactId: 'art-1',
  versionNumber: 1,
  versionStatus: 'approved',
  option: { optionKey: 'A', title: 'Opt A', summary: 's', stack: {}, tradeoffs: {} },
};
const ref = { id: 'ref-1', provider: 'github' };

/** `runOperation` as the real one drives a fresh insert: call send() with the new row's id. */
function runOperationSends() {
  mocks.runOperation.mockImplementation(async (opts) => {
    await opts.send({ operationId: 'op-1' });
    return { status: 'completed', ref };
  });
}

beforeEach(() => {
  seen = [];
  githubRoutes = {};
  mocks.env.GITHUB_TOKEN = 'legacy-env-token';
  mocks.env.GITHUB_OWNER = 'legacy-owner';
  mocks.getCredential.mockReset().mockResolvedValue(credential());
  mocks.getCredentialForOperation.mockReset().mockResolvedValue(credential());
  mocks.listConnections.mockReset().mockResolvedValue([{ provider: 'github', status: 'active' }]);
  mocks.reportAuthFailure.mockReset();
  mocks.runOperation.mockReset();
  mocks.getOperationById.mockReset();
  mocks.getSelectedOption.mockReset().mockResolvedValue(selected);
  mocks.getArchitectureDecisionItems.mockReset().mockResolvedValue([]);
  installFakeGithub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('initRepo - new operation', () => {
  it("resolves the caller's credential before runOperation and hands connectionId, accountId and the owner to it", async () => {
    runOperationSends();
    githubRoutes['POST /user/repos'] = createdRepo('octo', 'my-repo');
    githubRoutes['PUT /repos/octo/my-repo/contents/README.md'] = contentsOk;
    githubRoutes['PUT /repos/octo/my-repo/contents/docs%2Farchitecture%2Flineage.json'] =
      contentsOk;

    await initRepo('av-1', 'My Repo', { userId: 'user-1', githubOwner: 'octo' });

    expect(mocks.getCredential).toHaveBeenCalledWith('user-1', 'github');
    expect(mocks.getCredential.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.runOperation.mock.invocationCallOrder[0]!,
    );
    const opts = mocks.runOperation.mock.calls[0]![0];
    expect(opts).toMatchObject({
      projectId: 'proj-1',
      provider: 'github',
      operationKey: 'github:create_repo:proj-1:my-repo',
      connectionId: 'conn-1',
      accountId: '4242',
      targetDescriptor: { repoName: 'my-repo', mode: 'docs-only', owner: 'octo' },
    });
    expect(JSON.stringify(opts.targetDescriptor)).not.toContain(USER_TOKEN);
  });

  it("creates under the user's own account with the connection token - never the environment token", async () => {
    runOperationSends();
    githubRoutes['POST /user/repos'] = createdRepo('octo', 'my-repo');

    await initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'OCTO' });

    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.auth.includes(USER_TOKEN))).toBe(true);
    expect(seen.some((s) => s.auth.includes('legacy-env-token'))).toBe(false);
    const create = seen.find((s) => s.method === 'POST')!;
    expect(create.path).toBe('/user/repos');
    expect(create.body).toMatchObject({ name: 'my-repo', private: false });
  });

  it('creates under an organization through the org endpoint', async () => {
    runOperationSends();
    githubRoutes['POST /orgs/acme/repos'] = createdRepo('acme', 'my-repo');

    await initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'acme' });

    const create = seen.find((s) => s.method === 'POST')!;
    expect(create.path).toBe('/orgs/acme/repos');
    // The provenance files go under the org too.
    expect(
      seen
        .filter((s) => s.method === 'PUT')
        .every((s) => s.path.startsWith('/repos/acme/my-repo/')),
    ).toBe(true);
  });

  it('keeps the HMAC ownership marker: the description is thrln-marker:<16 hex> from GITHUB_MARKER_SECRET', async () => {
    runOperationSends();
    githubRoutes['POST /user/repos'] = createdRepo('octo', 'my-repo');

    await initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'octo' });

    const create = seen.find((s) => s.method === 'POST')!;
    expect((create.body as { description: string }).description).toMatch(
      /^thrln-marker:[0-9a-f]{16}$/,
    );
  });

  it('no github_owner -> GithubTargetRequiredError, and neither runOperation nor GitHub is touched', async () => {
    const failure = await initRepo('av-1', 'my-repo', { userId: 'user-1' }).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(GithubTargetRequiredError);
    expect((failure as GithubTargetRequiredError).target).toBe('githubOwner');
    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('no connection -> the ConnectionRequiredError propagates and no operation row can exist', async () => {
    mocks.getCredential.mockRejectedValue(new Error('ConnectionRequired'));

    await expect(
      initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'octo' }),
    ).rejects.toThrow('ConnectionRequired');

    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('a 401 from GitHub on create -> reportAuthFailure + ReconnectRequiredError, never a failed operation', async () => {
    runOperationSends();
    githubRoutes['POST /user/repos'] = { status: 401, body: { message: 'Bad credentials' } };

    const failure = await initRepo('av-1', 'my-repo', {
      userId: 'user-1',
      githubOwner: 'octo',
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(failure).toMatchObject({
      provider: 'github',
      reason: 'needs_reauth',
      connectionId: 'conn-1',
    });
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });

  it('a 401 while writing the provenance files is treated the same way', async () => {
    runOperationSends();
    githubRoutes['POST /user/repos'] = createdRepo('octo', 'my-repo');
    githubRoutes['PUT /repos/octo/my-repo/contents/README.md'] = {
      status: 401,
      body: { message: 'Bad credentials' },
    };

    await expect(
      initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'octo' }),
    ).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });

  it("a 403 is a definitive rejection described for the user's connection, not GITHUB_TOKEN", async () => {
    mocks.runOperation.mockImplementation(async (opts) => {
      try {
        await opts.send({ operationId: 'op-1' });
      } catch (error) {
        return { status: 'failed', errorMessage: (error as Error).message };
      }
      return { status: 'completed', ref };
    });
    githubRoutes['POST /orgs/acme/repos'] = { status: 403, body: { message: 'Forbidden by org' } };

    const failure = await initRepo('av-1', 'my-repo', {
      userId: 'user-1',
      githubOwner: 'acme',
    }).catch((e: unknown) => e);

    expect((failure as { reason: string }).reason).toMatch(/403: Forbidden by org/);
    expect((failure as { reason: string }).reason).toMatch(/connected GitHub account/);
    expect((failure as { reason: string }).reason).not.toMatch(/GITHUB_TOKEN/);
  });
});

describe('reconcile and retry of an existing operation', () => {
  function runOperationReconciles() {
    mocks.runOperation.mockImplementation(async (opts) => {
      const result = await opts.reconcile({ operationId: 'op-1' });
      return result.found === false
        ? { status: 'reconciliation_required' }
        : { status: 'completed', ref };
    });
  }

  it("reconcile uses the credential recorded on the operation (a different connection than the caller's current one)", async () => {
    runOperationReconciles();
    mocks.getCredentialForOperation.mockResolvedValue(
      credential({ connectionId: 'conn-recorded', accessToken: 'gho_recorded_token' }),
    );
    githubRoutes['GET /repos/octo/my-repo'] = {
      status: 200,
      body: { id: 1, full_name: 'octo/my-repo', html_url: 'u', description: 'x' },
    };

    await initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'octo' }).catch(() => {});

    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    const lookup = seen.find((s) => s.method === 'GET')!;
    expect(lookup.auth).toContain('gho_recorded_token');
    expect(lookup.auth).not.toContain(USER_TOKEN);
  });

  it('a 401 during reconcile -> reportAuthFailure on the recorded connection + ReconnectRequiredError', async () => {
    runOperationReconciles();
    mocks.getCredentialForOperation.mockResolvedValue(
      credential({ connectionId: 'conn-recorded' }),
    );
    githubRoutes['GET /repos/octo/my-repo'] = { status: 401, body: { message: 'Bad credentials' } };

    await expect(
      initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'octo' }),
    ).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-recorded');
  });

  it('a recorded connection that is not usable stops the reconcile before any network call', async () => {
    runOperationReconciles();
    mocks.getCredentialForOperation.mockRejectedValue(
      new mocks.ReconnectRequiredErrorFake('github', 'account_mismatch', 'conn-1'),
    );

    await expect(
      initRepo('av-1', 'my-repo', { userId: 'user-1', githubOwner: 'octo' }),
    ).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(seen).toHaveLength(0);
  });

  it('legacy: an operation with no recorded connection reconciles with GITHUB_TOKEN under GITHUB_OWNER, exactly as before', async () => {
    runOperationReconciles();
    mocks.getOperationById.mockResolvedValue({
      id: 'op-1',
      provider: 'github',
      sourceArtifactVersionId: 'av-1',
      targetDescriptor: { repoName: 'my-repo' },
    });
    mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
    githubRoutes['GET /repos/legacy-owner/my-repo'] = {
      status: 404,
      body: { message: 'Not Found' },
    };

    const result = await retryOperation('op-1', { userId: 'user-1' });

    expect(result).toEqual({ status: 'reconciliation_required' });
    expect(mocks.getCredential).not.toHaveBeenCalled();
    const opts = mocks.runOperation.mock.calls[0]![0];
    expect(opts.connectionId).toBeNull();
    // Legacy request shape is unchanged: no owner in the hash input or descriptor.
    expect(opts.targetDescriptor).toEqual({ repoName: 'my-repo', mode: 'docs-only' });
    const lookup = seen.find((s) => s.method === 'GET')!;
    expect(lookup.auth).toContain('legacy-env-token');
    expect(lookup.auth).not.toContain(USER_TOKEN);
  });

  it('retryOperation on a connection-backed operation requires the ctx owner and reports pending / reconciliation_required as statuses', async () => {
    mocks.getOperationById.mockResolvedValue({
      id: 'op-1',
      provider: 'github',
      sourceArtifactVersionId: 'av-1',
      targetDescriptor: { repoName: 'my-repo', owner: 'octo' },
    });
    mocks.getCredentialForOperation.mockResolvedValue(credential());

    await expect(retryOperation('op-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      GithubTargetRequiredError,
    );
    expect(mocks.runOperation).not.toHaveBeenCalled();

    mocks.runOperation.mockResolvedValue({ status: 'in_flight' });
    await expect(
      retryOperation('op-1', { userId: 'user-1', githubOwner: 'octo' }),
    ).resolves.toEqual({
      status: 'pending',
    });
    mocks.runOperation.mockResolvedValue({ status: 'reconciliation_required' });
    await expect(
      retryOperation('op-1', { userId: 'user-1', githubOwner: 'octo' }),
    ).resolves.toEqual({
      status: 'reconciliation_required',
    });
    mocks.runOperation.mockResolvedValue({ status: 'completed', ref });
    await expect(
      retryOperation('op-1', { userId: 'user-1', githubOwner: 'octo' }),
    ).resolves.toEqual({
      status: 'completed',
      ref,
    });
    // The credential of a retry is the one recorded on the operation, never the caller's current one.
    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    expect(mocks.getCredential).not.toHaveBeenCalled();
  });

  it("retryOperation stops with the recorded connection's ReconnectRequiredError before runOperation", async () => {
    mocks.getOperationById.mockResolvedValue({
      id: 'op-1',
      provider: 'github',
      sourceArtifactVersionId: 'av-1',
      targetDescriptor: { repoName: 'my-repo' },
    });
    mocks.getCredentialForOperation.mockRejectedValue(
      new mocks.ReconnectRequiredErrorFake('github', 'revoked', 'conn-1'),
    );

    await expect(
      retryOperation('op-1', { userId: 'user-1', githubOwner: 'octo' }),
    ).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.runOperation).not.toHaveBeenCalled();
  });
});

describe('checkRepoName', () => {
  it("looks the name up under the project's owner with the caller's token", async () => {
    githubRoutes['GET /repos/acme/my-repo'] = { status: 200, body: { id: 1 } };

    await expect(
      checkRepoName('My Repo', { userId: 'user-1', githubOwner: 'acme' }),
    ).resolves.toEqual({
      repoName: 'my-repo',
      status: 'taken',
    });
    expect(seen[0]!.path).toBe('/repos/acme/my-repo');
    expect(seen[0]!.auth).toContain(USER_TOKEN);

    await expect(checkRepoName('Free', { userId: 'user-1', githubOwner: 'acme' })).resolves.toEqual(
      {
        repoName: 'free',
        status: 'available',
      },
    );
  });

  it('an unusable name is invalid without a credential or a network call', async () => {
    await expect(checkRepoName('!!!', { userId: 'user-1' })).resolves.toEqual({
      repoName: '',
      status: 'invalid',
    });
    expect(mocks.getCredential).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('no owner -> GithubTargetRequiredError; no connection -> its error propagates; both before GitHub', async () => {
    await expect(checkRepoName('x', { userId: 'user-1' })).rejects.toBeInstanceOf(
      GithubTargetRequiredError,
    );
    mocks.getCredential.mockRejectedValue(new Error('ConnectionRequired'));
    await expect(checkRepoName('x', { userId: 'user-1', githubOwner: 'acme' })).rejects.toThrow(
      'ConnectionRequired',
    );
    expect(seen).toHaveLength(0);
  });

  it('a 401 marks the connection needs_reauth and throws ReconnectRequiredError', async () => {
    githubRoutes['GET /repos/acme/x'] = { status: 401, body: { message: 'Bad credentials' } };
    await expect(
      checkRepoName('x', { userId: 'user-1', githubOwner: 'acme' }),
    ).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });
});

describe('listOwners', () => {
  it("lists the caller's own login first, then their organizations, with the caller's token", async () => {
    githubRoutes['GET /user'] = { status: 200, body: { login: 'octo' } };
    githubRoutes['GET /user/orgs'] = {
      status: 200,
      body: [{ login: 'acme' }, { login: 'globex' }],
    };

    await expect(listOwners({ userId: 'user-1' })).resolves.toEqual([
      { login: 'octo', kind: 'user' },
      { login: 'acme', kind: 'org' },
      { login: 'globex', kind: 'org' },
    ]);
    expect(mocks.getCredential).toHaveBeenCalledWith('user-1', 'github');
    expect(seen.every((s) => s.auth.includes(USER_TOKEN))).toBe(true);
  });

  it('propagates a missing connection and turns a 401 into ReconnectRequiredError', async () => {
    mocks.getCredential.mockRejectedValueOnce(new Error('ConnectionRequired'));
    await expect(listOwners({ userId: 'user-1' })).rejects.toThrow('ConnectionRequired');

    githubRoutes['GET /user'] = { status: 401, body: { message: 'Bad credentials' } };
    await expect(listOwners({ userId: 'user-1' })).rejects.toBeInstanceOf(
      mocks.ReconnectRequiredErrorFake,
    );
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });
});

describe('previewInit - stays readable without a connection (FR-089)', () => {
  it('returns the preview plus the connection block; suggestions use the caller token when a connection and owner exist', async () => {
    githubRoutes['GET /repos/acme/shiftswap'] = { status: 404, body: { message: 'Not Found' } };

    const preview = await previewInit('av-1', 'ShiftSwap', {
      userId: 'user-1',
      githubOwner: 'acme',
    });

    expect(preview).toMatchObject({
      mode: 'docs-only',
      repoName: 'shiftswap',
      connection: { status: 'active', targetReady: true },
    });
    expect(seen[0]!.auth).toContain(USER_TOKEN);
  });

  it('no connection: no throw, no GitHub call, the unverified slug, status none', async () => {
    mocks.getCredential.mockRejectedValue(new Error('ConnectionRequired'));
    mocks.listConnections.mockResolvedValue([{ provider: 'github', status: 'none' }]);

    const preview = await previewInit('av-1', 'ShiftSwap', {
      userId: 'user-1',
      githubOwner: 'acme',
    });

    expect(preview.repoName).toBe('shiftswap');
    expect(preview.connection).toEqual({ status: 'none', targetReady: true });
    expect(seen).toHaveLength(0);
  });

  it('no owner chosen: targetReady=false and still no failure', async () => {
    const preview = await previewInit('av-1', 'ShiftSwap', { userId: 'user-1' });
    expect(preview.connection).toEqual({ status: 'active', targetReady: false });
    expect(preview.repoName).toBe('shiftswap');
    expect(seen).toHaveLength(0);
  });

  it('a lapsed credential (401 on the lookup) still yields a preview, now reporting needs_reauth', async () => {
    githubRoutes['GET /repos/acme/shiftswap'] = {
      status: 401,
      body: { message: 'Bad credentials' },
    };
    mocks.listConnections.mockResolvedValue([{ provider: 'github', status: 'needs_reauth' }]);

    const preview = await previewInit('av-1', 'ShiftSwap', {
      userId: 'user-1',
      githubOwner: 'acme',
    });

    expect(preview.repoName).toBe('shiftswap');
    expect(preview.connection.status).toBe('needs_reauth');
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });
});
