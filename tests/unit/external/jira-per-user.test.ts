import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The jira module's round-14 credential handling (SCRUM-97; ERD 7.4, 7.6): a new
// operation uses the acting user's own Atlassian connection against
// https://api.atlassian.com/ex/jira/<cloudId> with a Bearer token, an existing
// one uses the connection recorded on it, and only an operation with no recorded
// connection falls back to the JIRA_* environment credential (Basic auth against
// JIRA_BASE_URL, unchanged). Atlassian is an in-memory fake on globalThis.fetch;
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
  class ConnectionRequiredErrorFake extends Error {
    constructor(readonly provider: string) {
      super('connect');
    }
  }
  class DefinitiveProviderErrorFake extends Error {}
  return {
    ReconnectRequiredErrorFake,
    ConnectionRequiredErrorFake,
    DefinitiveProviderErrorFake,
    env: {
      JIRA_BASE_URL: 'https://legacy.atlassian.net',
      JIRA_EMAIL: 'legacy@example.test',
      JIRA_API_TOKEN: 'legacy-api-token',
      JIRA_PROJECT_KEY: 'LEG',
    } as Record<string, string | undefined>,
    getCredential: vi.fn(),
    getCredentialForOperation: vi.fn(),
    listConnections: vi.fn(),
    reportAuthFailure: vi.fn(),
    runOperation: vi.fn(),
    getRefsForLogicalItem: vi.fn(),
    getOperationById: vi.fn(),
    getBacklogVersionMembers: vi.fn(),
  };
});

vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/connections', () => ({
  getCredential: mocks.getCredential,
  getCredentialForOperation: mocks.getCredentialForOperation,
  listConnections: mocks.listConnections,
  reportAuthFailure: mocks.reportAuthFailure,
  ReconnectRequiredError: mocks.ReconnectRequiredErrorFake,
  ConnectionRequiredError: mocks.ConnectionRequiredErrorFake,
}));
vi.mock('@/external/operations', () => ({
  runOperation: mocks.runOperation,
  getRefsForLogicalItem: mocks.getRefsForLogicalItem,
  getRefById: vi.fn(),
  getOperationById: mocks.getOperationById,
  DefinitiveProviderError: mocks.DefinitiveProviderErrorFake,
}));
vi.mock('@/lineage/impact', () => ({
  getWarnings: vi.fn().mockResolvedValue([]),
  getExternalDrift: vi.fn(),
}));
vi.mock('@/artifact-types/backlog', () => ({
  getBacklogVersionMembers: mocks.getBacklogVersionMembers,
}));

import {
  checkProjectAccessible,
  exportBacklog,
  JiraOperationConflictError,
  JiraSiteNotAccessibleError,
  JiraTargetRequiredError,
  listProjects,
  listSites,
  previewExport,
  retryOperation,
} from '@/external/jira';

const realFetch = globalThis.fetch;
const USER_TOKEN = 'atl-user-access-token';
const CTX = { userId: 'user-1', jiraCloudId: 'cloud-1', jiraProjectKey: 'PROJ' };
const EX = 'api.atlassian.com/ex/jira/cloud-1';

type Seen = {
  method: string;
  host: string;
  path: string;
  search: string;
  auth: string;
  body: unknown;
};
let seen: Seen[] = [];
let routes: Record<
  string,
  { status: number; body: unknown } | (() => { status: number; body: unknown })
>;

function installFakeAtlassian() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init?.method ?? 'GET').toUpperCase();
    seen.push({
      method,
      host: url.host,
      path: url.pathname,
      search: url.search,
      auth: String(new Headers(init?.headers).get('authorization')),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[`${method} ${url.host}${url.pathname}`];
    const { status, body } = (typeof route === 'function' ? route() : route) ?? {
      status: 404,
      body: { message: 'nf' },
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const credential = (overrides: Record<string, unknown> = {}) => ({
  connectionId: 'conn-1',
  provider: 'jira',
  accountId: 'acct-1',
  accessToken: USER_TOKEN,
  meta: { cloudId: 'cloud-1', siteUrl: 'https://acme.atlassian.net', siteName: 'Acme' },
  ...overrides,
});

function member(overrides: Record<string, unknown> = {}) {
  return {
    logicalItemId: 'li-epic',
    itemVersionId: 'iv-epic',
    displayKey: 'E-01',
    itemType: 'epic',
    parentLogicalItemId: null,
    sourceVersionId: 'backlog-v1',
    projectId: 'proj-1',
    status: 'approved',
    payload: { title: 'Epic title', scopeStatement: 'Scope' },
    ...overrides,
  };
}
const epic = member();
const story = member({
  logicalItemId: 'li-story',
  itemVersionId: 'iv-story',
  displayKey: 'S-01',
  itemType: 'story',
  parentLogicalItemId: 'li-epic',
  payload: { userValueStatement: 'As a user', structuredBehavior: 'Does it' },
});

const ref = { id: 'ref-1', provider: 'jira' };
const epicRef = {
  id: 'ref-epic',
  provider: 'jira',
  externalKey: 'PROJ-1',
  sourceItemVersionId: 'iv-epic',
};
const createdIssue = (key: string) => ({ status: 201, body: { id: '10001', key, self: 'x' } });

/** `runOperation` as the real one drives a fresh insert: call send() with the new row's id. */
function runOperationSends() {
  mocks.runOperation.mockImplementation(async (opts) => {
    await opts.send({ operationId: 'op-1' });
    return { status: 'completed', ref };
  });
}

beforeEach(() => {
  seen = [];
  routes = {};
  mocks.env.JIRA_BASE_URL = 'https://legacy.atlassian.net';
  mocks.env.JIRA_EMAIL = 'legacy@example.test';
  mocks.env.JIRA_API_TOKEN = 'legacy-api-token';
  mocks.env.JIRA_PROJECT_KEY = 'LEG';
  mocks.getCredential.mockReset().mockResolvedValue(credential());
  mocks.getCredentialForOperation.mockReset().mockResolvedValue(credential());
  mocks.listConnections.mockReset().mockResolvedValue([{ provider: 'jira', status: 'active' }]);
  mocks.reportAuthFailure.mockReset();
  mocks.runOperation.mockReset();
  mocks.getRefsForLogicalItem
    .mockReset()
    .mockImplementation(async (logicalItemId: string) =>
      logicalItemId === 'li-epic' ? [epicRef] : [],
    );
  mocks.getOperationById.mockReset();
  mocks.getBacklogVersionMembers.mockReset().mockResolvedValue([epic, story]);
  installFakeAtlassian();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('exportBacklog - new operations use the caller connection', () => {
  it("resolves the caller's credential before runOperation and hands connectionId, accountId, key and target to it", async () => {
    runOperationSends();
    routes[`POST ${EX}/rest/api/3/issue`] = createdIssue('PROJ-9');

    await exportBacklog('backlog-v1', new Map(), CTX);

    expect(mocks.getCredential).toHaveBeenCalledWith('user-1', 'jira');
    expect(mocks.getCredential.mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.runOperation.mock.invocationCallOrder[0]!,
    );
    const epicOpts = mocks.runOperation.mock.calls[0]![0];
    expect(epicOpts).toMatchObject({
      projectId: 'proj-1',
      provider: 'jira',
      operationType: 'create_issue',
      // ERD 7.4's literal key format, unchanged.
      operationKey: 'jira:create_issue:PROJ:iv-epic',
      connectionId: 'conn-1',
      accountId: 'acct-1',
      sourceItemVersionId: 'iv-epic',
      // The names getRefsForLogicalItem filters on.
      targetDescriptor: {
        cloudId: 'cloud-1',
        projectKey: 'PROJ',
        itemType: 'epic',
        displayKey: 'E-01',
        parentKey: null,
      },
    });
    expect(JSON.stringify(epicOpts.targetDescriptor)).not.toContain(USER_TOKEN);
    expect(epicOpts.requestHash).toMatch(/^[0-9a-f]{64}$/);
    const storyOpts = mocks.runOperation.mock.calls[1]![0];
    expect(storyOpts.targetDescriptor).toMatchObject({ itemType: 'story', parentKey: 'PROJ-1' });
  });

  it('the request hash covers the site and the project (a moved target is a conflict, never a resend)', async () => {
    runOperationSends();
    routes[`POST ${EX}/rest/api/3/issue`] = createdIssue('PROJ-9');
    await exportBacklog('backlog-v1', new Map(), CTX);
    const first = mocks.runOperation.mock.calls[0]![0].requestHash;

    mocks.runOperation.mockClear();
    routes['POST api.atlassian.com/ex/jira/cloud-2/rest/api/3/issue'] = createdIssue('PROJ-9');
    await exportBacklog('backlog-v1', new Map(), { ...CTX, jiraCloudId: 'cloud-2' });

    expect(mocks.runOperation.mock.calls[0]![0].requestHash).not.toBe(first);
  });

  it('sends Bearer against the ex/jira base URL - never Basic, never JIRA_BASE_URL - and returns the site browse URL', async () => {
    let sendResult: unknown;
    mocks.runOperation.mockImplementation(async (opts) => {
      sendResult = await opts.send({ operationId: 'op-1' });
      return { status: 'completed', ref };
    });
    routes[`POST ${EX}/rest/api/3/issue`] = createdIssue('PROJ-9');

    await exportBacklog('backlog-v1', new Map(), CTX);

    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    // Epics first, then the Story: the last create is the Story's.
    const creates = seen.filter((s) => s.method === 'POST');
    expect(creates).toHaveLength(2);
    const create = creates[1]!;
    expect(create.host + create.path).toBe(`${EX}/rest/api/3/issue`);
    expect(create.auth).toBe(`Bearer ${USER_TOKEN}`);
    expect(seen.every((s) => !s.auth.startsWith('Basic'))).toBe(true);
    expect(seen.some((s) => s.host === 'legacy.atlassian.net')).toBe(false);
    const fields = (create.body as { fields: Record<string, unknown> }).fields;
    expect(fields.project).toEqual({ key: 'PROJ' });
    expect(fields.labels).toEqual(['tl-iv-story']);
    expect(fields.parent).toEqual({ key: 'PROJ-1' });
    expect(sendResult).toEqual({
      externalId: '10001',
      externalKey: 'PROJ-9',
      externalUrl: 'https://acme.atlassian.net/browse/PROJ-9',
      metadata: { jiraProjectKey: 'PROJ', cloudId: 'cloud-1' },
    });
  });

  it('looks the site URL up in accessible-resources when the stored default site is a different one', async () => {
    mocks.getCredentialForOperation.mockResolvedValue(
      credential({ meta: { cloudId: 'cloud-other', siteUrl: 'https://other.atlassian.net' } }),
    );
    let sendResult: { externalUrl?: string } | undefined;
    mocks.runOperation.mockImplementation(async (opts) => {
      sendResult = await opts.send({ operationId: 'op-1' });
      return { status: 'completed', ref };
    });
    routes[`POST ${EX}/rest/api/3/issue`] = createdIssue('PROJ-9');
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = {
      status: 200,
      body: [{ id: 'cloud-1', url: 'https://acme.atlassian.net/', name: 'Acme' }],
    };

    await exportBacklog('backlog-v1', new Map(), CTX);

    expect(sendResult?.externalUrl).toBe('https://acme.atlassian.net/browse/PROJ-9');
  });

  it("scopes 'already exported here' (FR-074) and parent resolution to the target's cloudId + projectKey", async () => {
    runOperationSends();
    routes[`POST ${EX}/rest/api/3/issue`] = createdIssue('PROJ-9');

    await exportBacklog('backlog-v1', new Map(), CTX);

    expect(mocks.getRefsForLogicalItem).toHaveBeenCalledWith('li-epic', 'jira', {
      cloudId: 'cloud-1',
      projectKey: 'PROJ',
    });
    expect(
      mocks.getRefsForLogicalItem.mock.calls.every(
        (call) =>
          call[1] === 'jira' && call[2]?.cloudId === 'cloud-1' && call[2]?.projectKey === 'PROJ',
      ),
    ).toBe(true);
  });

  it('a Story whose Epic has no Jira ref in this target is not exported', async () => {
    mocks.getRefsForLogicalItem.mockResolvedValue([]);
    runOperationSends();
    routes[`POST ${EX}/rest/api/3/issue`] = createdIssue('PROJ-9');

    await exportBacklog('backlog-v1', new Map(), CTX);

    expect(mocks.runOperation).toHaveBeenCalledTimes(1);
    expect(mocks.runOperation.mock.calls[0]![0].sourceItemVersionId).toBe('iv-epic');
  });

  it('no Jira target -> JiraTargetRequiredError({target: jira}) and no operation row', async () => {
    const failure = await exportBacklog('backlog-v1', new Map(), { userId: 'user-1' }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(JiraTargetRequiredError);
    expect((failure as JiraTargetRequiredError).target).toBe('jira');
    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('half a target is no target', async () => {
    await expect(
      exportBacklog('backlog-v1', new Map(), { userId: 'user-1', jiraCloudId: 'cloud-1' }),
    ).rejects.toBeInstanceOf(JiraTargetRequiredError);
    expect(mocks.runOperation).not.toHaveBeenCalled();
  });

  it('no connection -> the ConnectionRequiredError propagates; no row, no request, never the env credential', async () => {
    mocks.getCredential.mockRejectedValue(new mocks.ConnectionRequiredErrorFake('jira'));

    await expect(exportBacklog('backlog-v1', new Map(), CTX)).rejects.toBeInstanceOf(
      mocks.ConnectionRequiredErrorFake,
    );
    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('a lapsed connection (ReconnectRequiredError from getCredential) propagates before any row', async () => {
    mocks.getCredential.mockRejectedValue(new mocks.ReconnectRequiredErrorFake('jira', 'x', 'c'));
    await expect(exportBacklog('backlog-v1', new Map(), CTX)).rejects.toBeInstanceOf(
      mocks.ReconnectRequiredErrorFake,
    );
    expect(mocks.runOperation).not.toHaveBeenCalled();
  });

  it('a 401 from Jira marks the connection needs_reauth and stops the batch with ReconnectRequiredError', async () => {
    runOperationSends();
    routes[`POST ${EX}/rest/api/3/issue`] = { status: 401, body: { message: 'Unauthorized' } };

    const failure = await exportBacklog('backlog-v1', new Map(), CTX).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
    // The batch stops: the Story's operation is never started.
    expect(mocks.runOperation).toHaveBeenCalledTimes(1);
  });

  it('a definitive 4xx (not 401) is a DefinitiveProviderError that names the status only', async () => {
    let thrown: unknown;
    mocks.runOperation.mockImplementation(async (opts) => {
      thrown = await opts.send({ operationId: 'op-1' }).catch((e: unknown) => e);
      return { status: 'failed', errorMessage: 'x' };
    });
    routes[`POST ${EX}/rest/api/3/issue`] = { status: 400, body: { errors: { summary: 'bad' } } };

    await exportBacklog('backlog-v1', new Map(), CTX);

    expect(thrown).toBeInstanceOf(mocks.DefinitiveProviderErrorFake);
    expect((thrown as Error).message).toBe('jira_create_issue_rejected:400');
    expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
  });

  it('reconcile searches the operation project by the complete label marker with the recorded credential', async () => {
    mocks.runOperation.mockImplementation(async (opts) => {
      const found = await opts.reconcile({ operationId: 'op-1' });
      expect(found).toMatchObject({
        found: true,
        externalId: '10002',
        externalKey: 'PROJ-2',
        externalUrl: 'https://acme.atlassian.net/browse/PROJ-2',
        metadata: { jiraProjectKey: 'PROJ', cloudId: 'cloud-1' },
      });
      return { status: 'completed', ref };
    });
    routes[`POST ${EX}/rest/api/3/search/jql`] = {
      status: 200,
      body: { issues: [{ id: '10002', key: 'PROJ-2' }] },
    };

    await exportBacklog('backlog-v1', new Map(), CTX);

    const search = seen.find((s) => s.path.endsWith('/search/jql'))!;
    expect(search.auth).toBe(`Bearer ${USER_TOKEN}`);
    expect((search.body as { jql: string }).jql).toBe('project = "PROJ" AND labels = "tl-iv-epic"');
    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
  });

  it('a runOperation outcome that is not completed does not abort the batch (partial failure is per object)', async () => {
    mocks.runOperation.mockResolvedValueOnce({ status: 'reconciliation_required' });
    mocks.runOperation.mockResolvedValueOnce({ status: 'completed', ref });

    const created = await exportBacklog('backlog-v1', new Map(), CTX);

    expect(created).toEqual([ref]);
    expect(mocks.runOperation).toHaveBeenCalledTimes(2);
  });
});

describe('retryOperation - existing operations use the recorded connection', () => {
  const userOp = {
    id: 'op-1',
    provider: 'jira',
    operationKey: 'jira:create_issue:PROJ:iv-story',
    sourceArtifactVersionId: 'backlog-v1',
    sourceItemVersionId: 'iv-story',
    connectionId: 'conn-1',
  };

  it("rebuilds only that item's request and resolves the credential from the operation, not the current user", async () => {
    mocks.getOperationById.mockResolvedValue(userOp);
    mocks.runOperation.mockResolvedValue({ status: 'completed', ref });

    const result = await retryOperation('op-1', CTX);

    expect(result).toEqual({ status: 'completed', ref });
    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    expect(mocks.getCredential).not.toHaveBeenCalled();
    expect(mocks.runOperation).toHaveBeenCalledTimes(1);
    expect(mocks.runOperation.mock.calls[0]![0]).toMatchObject({
      operationKey: 'jira:create_issue:PROJ:iv-story',
      connectionId: 'conn-1',
      accountId: 'acct-1',
      targetDescriptor: { cloudId: 'cloud-1', projectKey: 'PROJ', parentKey: 'PROJ-1' },
    });
  });

  it.each([
    ['reconciliation_required', { status: 'reconciliation_required' }, 'reconciliation_required'],
    ['in_flight', { status: 'in_flight' }, 'pending'],
  ])('maps a %s outcome to { status: %s }', async (_label, outcome, expected) => {
    mocks.getOperationById.mockResolvedValue(userOp);
    mocks.runOperation.mockResolvedValue(outcome);
    await expect(retryOperation('op-1', CTX)).resolves.toEqual({ status: expected });
  });

  it('a request-hash conflict is a JiraOperationConflictError; failed and refused throw', async () => {
    mocks.getOperationById.mockResolvedValue(userOp);
    mocks.runOperation.mockResolvedValueOnce({ status: 'conflict' });
    await expect(retryOperation('op-1', CTX)).rejects.toBeInstanceOf(JiraOperationConflictError);
    mocks.runOperation.mockResolvedValueOnce({ status: 'failed', errorMessage: 'nope' });
    await expect(retryOperation('op-1', CTX)).rejects.toThrow(/Jira operation failed/);
    mocks.runOperation.mockResolvedValueOnce({ status: 'refused', reason: 'nope' });
    await expect(retryOperation('op-1', CTX)).rejects.toThrow(/Jira operation refused/);
  });

  it('a recorded connection that is not usable stops the retry before any row change or request', async () => {
    mocks.getOperationById.mockResolvedValue(userOp);
    mocks.getCredentialForOperation.mockRejectedValue(
      new mocks.ReconnectRequiredErrorFake('jira', 'account_mismatch', 'conn-1'),
    );

    await expect(retryOperation('op-1', CTX)).rejects.toBeInstanceOf(
      mocks.ReconnectRequiredErrorFake,
    );
    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('a retry with no project target is JiraTargetRequiredError', async () => {
    mocks.getOperationById.mockResolvedValue(userOp);
    await expect(retryOperation('op-1', { userId: 'user-1' })).rejects.toBeInstanceOf(
      JiraTargetRequiredError,
    );
    expect(mocks.runOperation).not.toHaveBeenCalled();
  });

  it('refuses an operation of another provider', async () => {
    mocks.getOperationById.mockResolvedValue({ ...userOp, provider: 'github' });
    await expect(retryOperation('op-1', CTX)).rejects.toThrow(/not a Jira operation/);
  });
});

describe('legacy operations (connection_id NULL) keep the environment credential exactly as before', () => {
  const legacyOp = {
    id: 'op-legacy',
    provider: 'jira',
    operationKey: 'jira:create_issue:LEG:iv-epic',
    sourceArtifactVersionId: 'backlog-v1',
    sourceItemVersionId: 'iv-epic',
    connectionId: null,
  };

  it('sends Basic auth to JIRA_BASE_URL with the pre-round-14 descriptor shape and no connection', async () => {
    mocks.getOperationById.mockResolvedValue(legacyOp);
    mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
    let sendResult: unknown;
    mocks.runOperation.mockImplementation(async (opts) => {
      sendResult = await opts.send({ operationId: 'op-legacy' });
      return { status: 'completed', ref };
    });
    routes['POST legacy.atlassian.net/rest/api/3/issue'] = createdIssue('LEG-5');

    await retryOperation('op-legacy', { userId: 'user-1' });

    const opts = mocks.runOperation.mock.calls[0]![0];
    expect(opts).toMatchObject({
      operationKey: 'jira:create_issue:LEG:iv-epic',
      connectionId: null,
      targetDescriptor: {
        jiraProjectKey: 'LEG',
        itemType: 'epic',
        displayKey: 'E-01',
        parentKey: null,
      },
    });
    expect(opts.targetDescriptor).not.toHaveProperty('cloudId');
    expect(opts.targetDescriptor).not.toHaveProperty('projectKey');
    const create = seen.find((s) => s.method === 'POST')!;
    expect(create.host).toBe('legacy.atlassian.net');
    expect(create.auth).toBe(
      `Basic ${Buffer.from('legacy@example.test:legacy-api-token').toString('base64')}`,
    );
    expect(sendResult).toEqual({
      externalId: '10001',
      externalKey: 'LEG-5',
      externalUrl: 'https://legacy.atlassian.net/browse/LEG-5',
      metadata: { jiraProjectKey: 'LEG' },
    });
    // A legacy operation never marks any user's connection.
    expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
    expect(mocks.getCredential).not.toHaveBeenCalled();
  });

  it('a legacy 401 keeps its old handling: a plain error, no reportAuthFailure, no ReconnectRequiredError', async () => {
    mocks.getOperationById.mockResolvedValue(legacyOp);
    mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
    let thrown: unknown;
    mocks.runOperation.mockImplementation(async (opts) => {
      thrown = await opts.send({ operationId: 'op-legacy' }).catch((e: unknown) => e);
      return { status: 'failed', errorMessage: 'x' };
    });
    routes['POST legacy.atlassian.net/rest/api/3/issue'] = { status: 401, body: {} };

    await retryOperation('op-legacy', { userId: 'user-1' }).catch(() => undefined);

    expect(thrown).toBeInstanceOf(mocks.DefinitiveProviderErrorFake);
    expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
  });

  it.each([400, 403, 500, 503])(
    'an Atlassian %i error body never reaches the thrown error (NFR-005), while 4xx stays definitive and 5xx ambiguous',
    async (status) => {
      const SENTINEL = 'SENTINEL-atlassian-body-echo-9f3a';
      mocks.getOperationById.mockResolvedValue(legacyOp);
      mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
      let thrown: unknown;
      mocks.runOperation.mockImplementation(async (opts) => {
        thrown = await opts.send({ operationId: 'op-legacy' }).catch((e: unknown) => e);
        return { status: 'failed', errorMessage: 'x' };
      });
      routes['POST legacy.atlassian.net/rest/api/3/issue'] = {
        status,
        body: { errorMessages: [SENTINEL], errors: { summary: SENTINEL } },
      };

      await retryOperation('op-legacy', { userId: 'user-1' }).catch(() => undefined);

      expect(thrown).toBeInstanceOf(Error);
      const error = thrown as Error;
      expect(error.message).not.toContain(SENTINEL);
      expect(String(error.stack)).not.toContain(SENTINEL);
      if (status < 500) {
        expect(error).toBeInstanceOf(mocks.DefinitiveProviderErrorFake);
        expect(error.message).toBe(`jira_create_issue_rejected:${status}`);
      } else {
        expect(error).not.toBeInstanceOf(mocks.DefinitiveProviderErrorFake);
        expect(error.message).toContain(String(status));
      }
    },
  );

  it.each(['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'])(
    'a missing %s is RECONNECT_REQUIRED legacy_credential_missing, before any operation is touched (legacy only)',
    async (variable) => {
      mocks.getOperationById.mockResolvedValue(legacyOp);
      mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
      mocks.env[variable] = '';

      const thrown = await retryOperation('op-legacy', { userId: 'user-1' }).catch(
        (e: unknown) => e,
      );

      expect(thrown).toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
      expect(thrown).toMatchObject({
        provider: 'jira',
        reason: 'legacy_credential_missing',
        connectionId: null,
      });
      // The message names no variable and no value.
      expect((thrown as Error).message).not.toContain(variable);
      expect(mocks.runOperation).not.toHaveBeenCalled();
      expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
      expect(seen).toHaveLength(0);
    },
  );
});

describe('previewExport - local state only', () => {
  it('needs no credential and no request, and reports connection status + targetReady', async () => {
    mocks.listConnections.mockResolvedValue([{ provider: 'jira', status: 'needs_reauth' }]);

    const preview = await previewExport('backlog-v1', CTX);

    expect(preview.epics).toBe(1);
    expect(preview.stories).toBe(1);
    expect(preview.connection).toEqual({
      status: 'needs_reauth',
      targetReady: true,
      accountName: null,
    });
    expect(mocks.getCredential).not.toHaveBeenCalled();
    expect(mocks.getCredentialForOperation).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it('with no connection row the status is none; with no target nothing is scoped and targetReady is false', async () => {
    mocks.listConnections.mockResolvedValue([{ provider: 'github', status: 'active' }]);

    const preview = await previewExport('backlog-v1', { userId: 'user-1' });

    expect(preview.connection).toEqual({ status: 'none', targetReady: false, accountName: null });
    expect(preview.skipped).toEqual([]);
    expect(mocks.getRefsForLogicalItem).not.toHaveBeenCalled();
  });

  it('scopes the FR-074 needs-decision check to the target and reports a changed Epic', async () => {
    mocks.getRefsForLogicalItem.mockImplementation(async (logicalItemId: string) =>
      logicalItemId === 'li-epic'
        ? [{ ...epicRef, sourceItemVersionId: 'iv-epic-old', externalKey: 'PROJ-1' }]
        : [],
    );

    const preview = await previewExport('backlog-v1', CTX);

    expect(mocks.getRefsForLogicalItem).toHaveBeenCalledWith('li-epic', 'jira', {
      cloudId: 'cloud-1',
      projectKey: 'PROJ',
    });
    expect(preview.skipped).toEqual([
      expect.objectContaining({ kind: 'needs_decision', logicalItemId: 'li-epic' }),
    ]);
  });
});

describe('listSites / listProjects / checkProjectAccessible - read-only calls with the caller connection', () => {
  const sites = {
    status: 200,
    body: [
      {
        id: 'cloud-1',
        url: 'https://acme.atlassian.net',
        name: 'Acme',
        scopes: ['read:jira-work'],
      },
      { id: 'cloud-2', url: 'https://other.atlassian.net', name: 'Other', scopes: [] },
    ],
  };

  it('listSites maps accessible-resources with the caller Bearer token', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;

    await expect(listSites({ userId: 'user-1' })).resolves.toEqual([
      { cloudId: 'cloud-1', url: 'https://acme.atlassian.net', name: 'Acme' },
      { cloudId: 'cloud-2', url: 'https://other.atlassian.net', name: 'Other' },
    ]);
    expect(mocks.getCredential).toHaveBeenCalledWith('user-1', 'jira');
    expect(seen[0]!.auth).toBe(`Bearer ${USER_TOKEN}`);
  });

  it('listSites: a 401 marks needs_reauth and throws ReconnectRequiredError; no connection propagates', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = { status: 401, body: {} };
    await expect(listSites({ userId: 'user-1' })).rejects.toBeInstanceOf(
      mocks.ReconnectRequiredErrorFake,
    );
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');

    mocks.getCredential.mockRejectedValue(new mocks.ConnectionRequiredErrorFake('jira'));
    await expect(listSites({ userId: 'user-1' })).rejects.toBeInstanceOf(
      mocks.ConnectionRequiredErrorFake,
    );
  });

  it('listProjects paginates project/search until isLast and maps key + name', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;
    const pages = [
      {
        values: [
          { key: 'A', name: 'Alpha' },
          { key: 'B', name: 'Beta' },
        ],
        isLast: false,
      },
      { values: [{ key: 'C', name: 'Gamma' }], isLast: true },
    ];
    routes[`GET ${EX}/rest/api/3/project/search`] = () => ({ status: 200, body: pages.shift()! });

    await expect(listProjects({ userId: 'user-1' }, 'cloud-1')).resolves.toEqual([
      { key: 'A', name: 'Alpha' },
      { key: 'B', name: 'Beta' },
      { key: 'C', name: 'Gamma' },
    ]);
    const searches = seen.filter((s) => s.path.endsWith('/project/search'));
    expect(searches).toHaveLength(2);
    expect(searches[0]!.search).toContain('startAt=0');
    expect(searches[1]!.search).toContain('startAt=50');
    expect(searches.every((s) => s.auth === `Bearer ${USER_TOKEN}`)).toBe(true);
  });

  it('listProjects: a cloudId that is not one of the caller sites is JiraSiteNotAccessibleError and no project request is made', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;

    await expect(listProjects({ userId: 'user-1' }, 'cloud-foreign')).rejects.toBeInstanceOf(
      JiraSiteNotAccessibleError,
    );
    expect(seen.some((s) => s.path.includes('/ex/jira/'))).toBe(false);
  });

  it('checkProjectAccessible: true on 200 with the caller token; false on 404 or 403', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;
    routes[`GET ${EX}/rest/api/3/project/PROJ`] = { status: 200, body: { key: 'PROJ' } };
    await expect(checkProjectAccessible({ userId: 'user-1' }, 'cloud-1', 'PROJ')).resolves.toBe(
      true,
    );
    expect(seen.find((s) => s.path.endsWith('/project/PROJ'))!.auth).toBe(`Bearer ${USER_TOKEN}`);

    routes[`GET ${EX}/rest/api/3/project/NOPE`] = { status: 404, body: {} };
    await expect(checkProjectAccessible({ userId: 'user-1' }, 'cloud-1', 'NOPE')).resolves.toBe(
      false,
    );
    routes[`GET ${EX}/rest/api/3/project/PRIV`] = { status: 403, body: {} };
    await expect(checkProjectAccessible({ userId: 'user-1' }, 'cloud-1', 'PRIV')).resolves.toBe(
      false,
    );
  });

  it('checkProjectAccessible: false for a site that is not the caller, without asking that site about the project', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;

    await expect(
      checkProjectAccessible({ userId: 'user-1' }, 'cloud-foreign', 'PROJ'),
    ).resolves.toBe(false);
    expect(seen.some((s) => s.path.includes('/ex/jira/'))).toBe(false);
  });

  it('checkProjectAccessible: a 401 is ReconnectRequiredError (needs_reauth), not "not accessible"; a 500 propagates', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;
    routes[`GET ${EX}/rest/api/3/project/PROJ`] = { status: 401, body: {} };
    await expect(
      checkProjectAccessible({ userId: 'user-1' }, 'cloud-1', 'PROJ'),
    ).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');

    routes[`GET ${EX}/rest/api/3/project/PROJ`] = { status: 500, body: {} };
    await expect(checkProjectAccessible({ userId: 'user-1' }, 'cloud-1', 'PROJ')).rejects.toThrow(
      /500/,
    );
  });

  it('checkProjectAccessible: the project key is URL-encoded into the path', async () => {
    routes['GET api.atlassian.com/oauth/token/accessible-resources'] = sites;
    await checkProjectAccessible({ userId: 'user-1' }, 'cloud-1', 'A/../B').catch(() => undefined);
    const call = seen.find((s) => s.path.includes('/project/'))!;
    expect(call.path).toBe('/ex/jira/cloud-1/rest/api/3/project/A%2F..%2FB');
  });
});
