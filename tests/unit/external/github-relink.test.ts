import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// UC-S10 follow-up: what creating a repository does AFTER a project's link was
// removed (`unlinkGithubRepository`) while the old repository still exists on
// GitHub. This pins the behaviour the code actually has; it does not change
// it. The ownership marker is HMAC(GITHUB_MARKER_SECRET, operation_key) and the
// operation key is `github:create_repo:<projectId>:<normalized name>`, so for
// the same project and the same name the marker of a re-created operation is
// IDENTICAL to the removed repository's marker:
//   - the direct create path (send) never reconciles: GitHub's 422 for the
//     taken name becomes a definitive `name_taken_by_other` (no adoption);
//   - the reconcile path (only reached for a stale pending / reconciliation
//     _required / retried operation) verifies only that marker, so it WOULD
//     adopt the old repository;
//   - a different name gives a different key and marker, so the old repository
//     is never matched.
// GitHub is an in-memory fake on globalThis.fetch (as in github-per-user.test.ts);
// `runOperation` is a stand-in that hands the closures back to the test.
const mocks = vi.hoisted(() => ({
  env: {
    GITHUB_TOKEN: undefined,
    GITHUB_OWNER: undefined,
    GITHUB_MARKER_SECRET: 'marker-secret',
  } as Record<string, string | undefined>,
  getCredential: vi.fn(),
  getCredentialForOperation: vi.fn(),
  runOperation: vi.fn(),
  getSelectedOption: vi.fn(),
  getArchitectureDecisionItems: vi.fn(),
}));

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/connections', () => ({
  getCredential: mocks.getCredential,
  getCredentialForOperation: mocks.getCredentialForOperation,
  listConnections: vi.fn(),
  reportAuthFailure: vi.fn(),
  ReconnectRequiredError: class extends Error {},
}));
vi.mock('@/external/operations', () => ({
  runOperation: mocks.runOperation,
  getRefById: vi.fn(),
  getOperationById: vi.fn(),
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

import { checkRepoName, initRepo } from '@/external/github';

const realFetch = globalThis.fetch;
const ctx = { userId: 'user-1', githubOwner: 'octo' };

type Seen = { method: string; path: string; body: unknown };
let seen: Seen[] = [];
let githubRoutes: Record<string, { status: number; body: unknown }> = {};

function installFakeGithub() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    seen.push({
      method,
      path: url.pathname,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const { status, body } = githubRoutes[`${method} ${url.pathname}`] ?? {
      status: 404,
      body: { message: 'Not Found' },
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }) as typeof fetch;
}

const markerFor = (operationKey: string) =>
  `thrln-marker:${createHmac('sha256', 'marker-secret').update(operationKey).digest('hex').slice(0, 16)}`;

const selected = {
  projectId: 'proj-1',
  artifactId: 'art-1',
  versionNumber: 1,
  versionStatus: 'approved',
  option: { optionKey: 'A', title: 'Opt A', summary: 's', stack: {}, tradeoffs: {} },
};

type CapturedOptions = {
  operationKey: string;
  send: (ctx: { operationId: string }) => Promise<unknown>;
  reconcile: (ctx: { operationId: string }) => Promise<Record<string, unknown>>;
};

/** Runs `initRepo` with a `runOperation` that only captures the options it was given. */
async function captureOperation(repoName: string): Promise<CapturedOptions> {
  let captured: CapturedOptions | undefined;
  mocks.runOperation.mockImplementation(async (opts: CapturedOptions) => {
    captured = opts;
    return { status: 'completed', ref: { id: 'ref-1' } };
  });
  await initRepo('av-1', repoName, ctx);
  return captured!;
}

beforeEach(() => {
  seen = [];
  githubRoutes = {};
  mocks.getCredential.mockReset().mockResolvedValue({
    connectionId: 'conn-1',
    provider: 'github',
    accountId: '4242',
    accessToken: 'gho_user_token',
    meta: { login: 'octo' },
  });
  mocks.getCredentialForOperation.mockReset().mockImplementation(() => mocks.getCredential());
  mocks.runOperation.mockReset();
  mocks.getSelectedOption.mockReset().mockResolvedValue(selected);
  mocks.getArchitectureDecisionItems.mockReset().mockResolvedValue([]);
  installFakeGithub();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('re-creating a repository after its link was removed (UC-S10)', () => {
  it('same project + same name -> the same operation key and the same marker as the removed repository; a different name -> neither', async () => {
    const first = await captureOperation('my-repo');
    const again = await captureOperation('My Repo'); // normalizes to the same name
    const other = await captureOperation('other-repo');

    expect(first.operationKey).toBe('github:create_repo:proj-1:my-repo');
    expect(again.operationKey).toBe(first.operationKey);
    expect(other.operationKey).toBe('github:create_repo:proj-1:other-repo');

    // Nothing in the marker distinguishes the removed link from the new one.
    githubRoutes['GET /repos/octo/my-repo'] = {
      status: 200,
      body: {
        id: 5,
        full_name: 'octo/my-repo',
        html_url: 'https://github.com/octo/my-repo',
        description: markerFor(first.operationKey),
      },
    };
    await expect(again.reconcile({ operationId: 'op-2' })).resolves.toMatchObject({ found: true });
    await expect(other.reconcile({ operationId: 'op-3' })).resolves.toEqual({ found: false }); // other-repo does not exist
  });

  it('(a) same name, old repository still on GitHub: the name check reports it taken', async () => {
    githubRoutes['GET /repos/octo/my-repo'] = { status: 200, body: { id: 5 } };

    await expect(checkRepoName('my-repo', ctx)).resolves.toEqual({
      repoName: 'my-repo',
      status: 'taken',
    });
  });

  it('(a) same name, create submitted anyway: GitHub answers 422 and send() fails definitively as name_taken_by_other - no lookup, no adoption', async () => {
    githubRoutes['POST /user/repos'] = {
      status: 422,
      body: {
        message: 'Repository creation failed.',
        errors: [{ message: 'name already exists on this account' }],
      },
    };
    const op = await captureOperation('my-repo');

    await expect(op.send({ operationId: 'op-2' })).rejects.toMatchObject({
      message: 'name_taken_by_other',
    });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /user/repos']);
  });

  it('(a) same name, ambiguous create (reconcile path): the old repository carrying the identical marker IS adopted (found: true, no files written)', async () => {
    const op = await captureOperation('my-repo');
    githubRoutes['GET /repos/octo/my-repo'] = {
      status: 200,
      body: {
        id: 5,
        full_name: 'octo/my-repo',
        html_url: 'https://github.com/octo/my-repo',
        description: markerFor('github:create_repo:proj-1:my-repo'),
      },
    };

    await expect(op.reconcile({ operationId: 'op-2' })).resolves.toMatchObject({
      found: true,
      externalId: '5',
      externalKey: 'octo/my-repo',
      externalUrl: 'https://github.com/octo/my-repo',
    });
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /repos/octo/my-repo']);
  });

  it('(a) same name, but the old repository was edited (marker gone) or belongs to someone else: reconcile answers foreign, never adopts', async () => {
    const op = await captureOperation('my-repo');
    githubRoutes['GET /repos/octo/my-repo'] = {
      status: 200,
      body: { id: 5, full_name: 'octo/my-repo', html_url: 'u', description: 'My own description' },
    };

    await expect(op.reconcile({ operationId: 'op-2' })).resolves.toEqual({ found: 'foreign' });
  });

  it('(b) different name: a new key and marker; the old repository is never looked up or touched', async () => {
    const op = await captureOperation('brand-new-name');
    githubRoutes['POST /user/repos'] = {
      status: 201,
      body: {
        id: 9,
        name: 'brand-new-name',
        full_name: 'octo/brand-new-name',
        html_url: 'https://github.com/octo/brand-new-name',
        owner: { login: 'octo' },
      },
    };
    githubRoutes['PUT /repos/octo/brand-new-name/contents/README.md'] = { status: 201, body: {} };
    githubRoutes['PUT /repos/octo/brand-new-name/contents/docs%2Farchitecture%2Flineage.json'] = {
      status: 201,
      body: {},
    };

    await op.send({ operationId: 'op-2' }).catch(() => {});

    const create = seen.find((s) => s.method === 'POST')!;
    expect((create.body as { name: string; description: string }).name).toBe('brand-new-name');
    expect((create.body as { description: string }).description).toBe(
      markerFor('github:create_repo:proj-1:brand-new-name'),
    );
    expect((create.body as { description: string }).description).not.toBe(
      markerFor('github:create_repo:proj-1:my-repo'),
    );
    expect(seen.some((s) => s.path.includes('/my-repo'))).toBe(false);
  });
});
