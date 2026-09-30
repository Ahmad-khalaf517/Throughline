import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `jira.validateProjectKey` / `jira.createProject` (UC-S11, FR-092, ERD 7.8): a
// setup action with the caller's own connection. Atlassian is an in-memory fake on
// globalThis.fetch. What matters: the exact create body, the scope check before
// any network call, the status -> typed error mapping, and that no provider
// response text ever reaches an Error message (NFR-005).
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
  return {
    ReconnectRequiredErrorFake,
    ConnectionRequiredErrorFake,
    getCredential: vi.fn(),
    reportAuthFailure: vi.fn(),
    runOperation: vi.fn(),
  };
});

vi.mock('@/lib/env', () => ({ env: {} }));
vi.mock('@/connections', () => ({
  getCredential: mocks.getCredential,
  getCredentialForOperation: vi.fn(),
  listConnections: vi.fn(),
  reportAuthFailure: mocks.reportAuthFailure,
  ReconnectRequiredError: mocks.ReconnectRequiredErrorFake,
  ConnectionRequiredError: mocks.ConnectionRequiredErrorFake,
}));
vi.mock('@/external/operations', () => ({
  runOperation: mocks.runOperation,
  getRefsForLogicalItem: vi.fn(),
  getRefById: vi.fn(),
  getOperationById: vi.fn(),
  DefinitiveProviderError: class extends Error {},
}));
vi.mock('@/lineage/impact', () => ({ getWarnings: vi.fn(), getExternalDrift: vi.fn() }));
vi.mock('@/artifact-types/backlog', () => ({ getBacklogVersionMembers: vi.fn() }));

import {
  createProject,
  JiraAdminRequiredError,
  JiraSiteNotAccessibleError,
  ProjectKeyTakenError,
  validateProjectKey,
} from '@/external/jira';

const realFetch = globalThis.fetch;
const USER_TOKEN = 'atl-user-access-token';
const PROVIDER_TEXT = 'PROVIDER-BODY-SENTINEL-do-not-leak';
const EX = 'api.atlassian.com/ex/jira/cloud-1';
const RESOURCES = 'GET api.atlassian.com/oauth/token/accessible-resources';
const VALIDATE = `GET ${EX}/rest/api/3/projectvalidate/validProjectKey`;
const CREATE = `POST ${EX}/rest/api/3/project`;

type Seen = {
  method: string;
  host: string;
  path: string;
  search: string;
  auth: string;
  body: unknown;
};
let seen: Seen[] = [];
let routes: Record<string, { status: number; body: unknown }>;

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
    const { status, body } = routes[`${method} ${url.host}${url.pathname}`] ?? {
      status: 404,
      body: {},
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

const credential = (scopes: string[]) => ({
  connectionId: 'conn-1',
  provider: 'jira',
  accountId: 'acct-1',
  accessToken: USER_TOKEN,
  meta: {},
  scopes,
});

const FULL_SCOPES = ['read:jira-work', 'write:jira-work', 'manage:jira-project', 'offline_access'];
const INPUT = { cloudId: 'cloud-1', name: 'ShiftSwap', key: 'SHIFT', template: 'scrum' } as const;

beforeEach(() => {
  seen = [];
  routes = {
    [RESOURCES]: {
      status: 200,
      body: [{ id: 'cloud-1', url: 'https://acme.atlassian.net', name: 'Acme' }],
    },
    [VALIDATE]: { status: 200, body: { errorMessages: [], errors: {} } },
    [CREATE]: {
      status: 201,
      body: { id: '10001', key: 'SHIFT', self: 'https://api.atlassian.com/x' },
    },
  };
  mocks.getCredential.mockReset().mockResolvedValue(credential(FULL_SCOPES));
  mocks.reportAuthFailure.mockReset();
  installFakeAtlassian();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('createProject', () => {
  it('validates the key, then POSTs exactly the documented body with the caller Bearer token', async () => {
    await expect(createProject({ userId: 'user-1' }, INPUT)).resolves.toEqual({
      id: '10001',
      key: 'SHIFT',
      name: 'ShiftSwap',
    });

    expect(mocks.getCredential).toHaveBeenCalledWith('user-1', 'jira');
    const validate = seen.find((s) => s.path.endsWith('/projectvalidate/validProjectKey'))!;
    expect(validate.search).toBe('?key=SHIFT');
    const create = seen.find((s) => s.method === 'POST')!;
    expect(create.path).toBe('/ex/jira/cloud-1/rest/api/3/project');
    expect(create.auth).toBe(`Bearer ${USER_TOKEN}`);
    expect(create.body).toEqual({
      key: 'SHIFT',
      name: 'ShiftSwap',
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-agility-scrum',
      leadAccountId: 'acct-1',
      assigneeType: 'PROJECT_LEAD',
    });
    // Order: site check, key validation, create.
    expect(seen.map((s) => s.method)).toEqual(['GET', 'GET', 'POST']);
  });

  it('uses the Kanban template key for template kanban and tolerates a numeric id', async () => {
    routes[CREATE] = { status: 201, body: { id: 10002, key: 'SHIFT' } };
    await expect(
      createProject({ userId: 'user-1' }, { ...INPUT, template: 'kanban' }),
    ).resolves.toEqual({
      id: '10002',
      key: 'SHIFT',
      name: 'ShiftSwap',
    });
    expect(
      (seen.find((s) => s.method === 'POST')!.body as Record<string, unknown>).projectTemplateKey,
    ).toBe('com.pyxis.greenhopper.jira:gh-simplified-agility-kanban');
  });

  it('a connection without manage:jira-project is reconnect required (missing_scope) and Atlassian is never called', async () => {
    mocks.getCredential.mockResolvedValue(credential(['read:jira-work', 'write:jira-work']));

    const failure = await createProject({ userId: 'user-1' }, INPUT).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(failure).toMatchObject({
      provider: 'jira',
      reason: 'missing_scope',
      connectionId: 'conn-1',
    });
    expect(seen).toHaveLength(0);
  });

  it('propagates a missing or lapsed connection unchanged', async () => {
    mocks.getCredential.mockRejectedValue(new mocks.ConnectionRequiredErrorFake('jira'));
    await expect(createProject({ userId: 'user-1' }, INPUT)).rejects.toBeInstanceOf(
      mocks.ConnectionRequiredErrorFake,
    );
    expect(seen).toHaveLength(0);
  });

  it('a site the connection cannot reach is JiraSiteNotAccessibleError, before any key or create call', async () => {
    await expect(
      createProject({ userId: 'user-1' }, { ...INPUT, cloudId: 'cloud-foreign' }),
    ).rejects.toBeInstanceOf(JiraSiteNotAccessibleError);
    expect(seen.some((s) => s.path.includes('/ex/jira/'))).toBe(false);
  });

  it('a key Jira reports as in use is ProjectKeyTakenError and nothing is created', async () => {
    routes[VALIDATE] = {
      status: 200,
      body: {
        errorMessages: [],
        errors: { projectKey: `Project ${PROVIDER_TEXT} uses this project key.` },
      },
    };
    const failure = await createProject({ userId: 'user-1' }, INPUT).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ProjectKeyTakenError);
    expect((failure as Error).message).not.toContain(PROVIDER_TEXT);
    expect(seen.some((s) => s.method === 'POST')).toBe(false);
  });

  it('a 400 or 409 from the create call is ProjectKeyTakenError', async () => {
    for (const status of [400, 409]) {
      routes[CREATE] = { status, body: { errors: { projectKey: PROVIDER_TEXT } } };
      const failure = await createProject({ userId: 'user-1' }, INPUT).catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ProjectKeyTakenError);
      expect((failure as Error).message).not.toContain(PROVIDER_TEXT);
    }
  });

  it("a 403 is JiraAdminRequiredError naming the 'Administer Jira' permission", async () => {
    routes[CREATE] = { status: 403, body: { errorMessages: [PROVIDER_TEXT] } };
    const failure = await createProject({ userId: 'user-1' }, INPUT).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(JiraAdminRequiredError);
    expect((failure as Error).message).toContain("'Administer Jira'");
    expect((failure as Error).message).not.toContain(PROVIDER_TEXT);
  });

  it('a 401 marks the connection needs_reauth and is ReconnectRequiredError (needs_reauth)', async () => {
    routes[CREATE] = { status: 401, body: { message: PROVIDER_TEXT } };
    const failure = await createProject({ userId: 'user-1' }, INPUT).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(failure).toMatchObject({ reason: 'needs_reauth' });
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });

  it('any other status is a generic error carrying the status only, never the provider body', async () => {
    routes[CREATE] = { status: 500, body: { errorMessages: [PROVIDER_TEXT] } };
    const failure = (await createProject({ userId: 'user-1' }, INPUT).catch(
      (e: unknown) => e,
    )) as Error;
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ProjectKeyTakenError);
    expect(failure).not.toBeInstanceOf(JiraAdminRequiredError);
    expect(failure.message).toContain('500');
    expect(failure.message).not.toContain(PROVIDER_TEXT);
  });

  it('an unusable key-validation answer is unsure: the create call stays the authority', async () => {
    routes[VALIDATE] = { status: 404, body: {} };
    await expect(createProject({ userId: 'user-1' }, INPUT)).resolves.toMatchObject({
      key: 'SHIFT',
    });
  });

  it('writes nothing through the operations module', async () => {
    await createProject({ userId: 'user-1' }, INPUT);
    expect(mocks.runOperation).not.toHaveBeenCalled();
  });
});

describe('validateProjectKey', () => {
  it('valid when Jira answers with no error, invalid/taken when it names one', async () => {
    await expect(validateProjectKey({ userId: 'user-1' }, 'cloud-1', 'SHIFT')).resolves.toEqual({
      valid: true,
    });

    routes[VALIDATE] = {
      status: 200,
      body: { errors: { projectKey: 'Project X uses this project key.' } },
    };
    await expect(validateProjectKey({ userId: 'user-1' }, 'cloud-1', 'SHIFT')).resolves.toEqual({
      valid: false,
      reason: 'taken',
    });

    routes[VALIDATE] = {
      status: 200,
      body: { errorMessages: ['Project key must start with a letter.'] },
    };
    await expect(validateProjectKey({ userId: 'user-1' }, 'cloud-1', '1X')).resolves.toEqual({
      valid: false,
      reason: 'invalid',
    });
  });

  it('does not need manage:jira-project (it is a read) and refuses a foreign site', async () => {
    mocks.getCredential.mockResolvedValue(credential(['read:jira-work']));
    await expect(validateProjectKey({ userId: 'user-1' }, 'cloud-1', 'SHIFT')).resolves.toEqual({
      valid: true,
    });
    await expect(
      validateProjectKey({ userId: 'user-1' }, 'cloud-foreign', 'SHIFT'),
    ).rejects.toBeInstanceOf(JiraSiteNotAccessibleError);
  });
});
