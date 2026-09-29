import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// The stitch module's round-14 credential handling (SCRUM-98; ERD 7.5, 7.6,
// FR-086/089/090): validateApiKey's mapping, a new generate using the acting
// user's own key, an existing operation using the key recorded on it, and only
// an operation with no recorded connection falling back to STITCH_API_KEY.
// `@google/stitch-sdk`, `@/db` and Supabase Storage are in-memory fakes;
// `runOperation` is a stand-in that invokes the closures the way the real one
// does, with `{ operationId }`, and applies its documented finalization.
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
  class StitchErrorFake extends Error {
    readonly code: string;
    constructor(data: { code: string; message: string }) {
      super(data.message);
      this.code = data.code;
    }
  }
  return {
    ReconnectRequiredErrorFake,
    ConnectionRequiredErrorFake,
    DefinitiveProviderErrorFake,
    StitchErrorFake,
    env: {
      STITCH_API_KEY: 'legacy-env-key' as string | undefined,
      SUPABASE_STORAGE_BUCKET: 'bucket',
    } as Record<string, string | undefined>,
    getCredential: vi.fn(),
    getCredentialForOperation: vi.fn(),
    listConnections: vi.fn(),
    reportAuthFailure: vi.fn(),
    runOperation: vi.fn(),
    getOperationById: vi.fn(),
    getRefsForVersion: vi.fn(),
    // SDK world
    sdk: {
      apiKeysSeen: [] as string[],
      projectsResult: 'ok' as 'ok' | string, // 'ok' or a StitchError code
      generateResult: 'ok' as 'ok' | string,
      generateCalls: 0,
    },
    // db world
    db: { inserted: [] as unknown[], existing: [] as unknown[] },
  };
});

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: mocks.env }));
vi.mock('@/db', () => ({
  schema: { stitchOutput: { sourceUiRequirementsVersionId: 'col' } },
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => mocks.db.existing }) }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: () => ({
          returning: async () => {
            mocks.db.inserted.push(values);
            return [{ id: 'so-1', ...values }];
          },
        }),
      }),
    }),
  },
}));
vi.mock('@/auth', () => ({
  getStorageServiceClient: () => ({
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));
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
  getRefById: vi.fn(),
  getRefsForVersion: mocks.getRefsForVersion,
  getOperationById: mocks.getOperationById,
  getOperationsForVersion: vi.fn().mockResolvedValue([]),
  DefinitiveProviderError: mocks.DefinitiveProviderErrorFake,
}));
vi.mock('@/lineage/impact', () => ({
  getWarnings: vi.fn().mockResolvedValue([]),
  getExternalDrift: vi.fn(),
}));
vi.mock('@/artifact-types/ui-requirements', () => ({
  getUiRequirementsForPrompt: vi.fn().mockResolvedValue({
    status: 'approved',
    projectId: 'project-1',
    items: [{ displayKey: 'UI-01', itemVersionId: 'iv-1', payload: { screenOrFlow: 'Login' } }],
  }),
}));
vi.mock('@google/stitch-sdk', () => {
  const screen = {
    id: 'screen-1',
    projectId: 'sp-1',
    getHtml: async () => 'https://assets.test/html',
    getImage: async () => 'https://assets.test/png',
  };
  const project = {
    data: { title: 'x' },
    screens: async () => [],
    generate: async () => {
      mocks.sdk.generateCalls += 1;
      if (mocks.sdk.generateResult !== 'ok') {
        throw new mocks.StitchErrorFake({
          code: mocks.sdk.generateResult,
          message: 'sdk text with secret-user-key',
        });
      }
      return screen;
    },
  };
  class StitchToolClient {
    constructor(config: { apiKey: string }) {
      mocks.sdk.apiKeysSeen.push(config.apiKey);
    }
    async close() {}
  }
  class Stitch {
    constructor(_client: unknown) {}
    async projects() {
      if (mocks.sdk.projectsResult !== 'ok') {
        throw new mocks.StitchErrorFake({
          code: mocks.sdk.projectsResult,
          message: 'sdk text with secret-user-key',
        });
      }
      return [];
    }
    async createProject() {
      return project;
    }
  }
  return { Stitch, StitchToolClient, StitchError: mocks.StitchErrorFake };
});

import { generate, previewPrompt, retryOperation, validateApiKey } from '@/external/stitch';

const realFetch = globalThis.fetch;
const USER_KEY = 'secret-user-key';
const CTX = { userId: 'user-1' };
const VERSION = 'ui-v1';

const credential = (overrides: Record<string, unknown> = {}) => ({
  connectionId: 'conn-1',
  provider: 'stitch',
  accountId: 'key:0123456789abcdef',
  accessToken: USER_KEY,
  meta: {},
  ...overrides,
});

/**
 * Stand-in for the real `runOperation`: send once with an operation id, then the
 * documented finalization (definitive => failed; a ReconnectRequiredError from
 * the closure propagates untouched).
 */
function installRunOperation() {
  mocks.runOperation.mockImplementation(async (opts) => {
    try {
      const sent = await opts.send({ operationId: 'op-1' });
      return {
        status: 'completed',
        ref: { id: 'ref-1', provider: 'stitch', metadata: sent.metadata },
      };
    } catch (error) {
      if (error instanceof mocks.DefinitiveProviderErrorFake) {
        return { status: 'failed', errorMessage: error.message };
      }
      throw error;
    }
  });
}

beforeEach(() => {
  mocks.env.STITCH_API_KEY = 'legacy-env-key';
  mocks.sdk.apiKeysSeen = [];
  mocks.sdk.projectsResult = 'ok';
  mocks.sdk.generateResult = 'ok';
  mocks.sdk.generateCalls = 0;
  mocks.db.inserted = [];
  mocks.db.existing = [];
  mocks.getCredential.mockReset().mockResolvedValue(credential());
  mocks.getCredentialForOperation.mockReset().mockResolvedValue(credential());
  mocks.listConnections.mockReset().mockResolvedValue([]);
  mocks.reportAuthFailure.mockReset().mockResolvedValue(undefined);
  mocks.runOperation.mockReset();
  mocks.getOperationById.mockReset();
  mocks.getRefsForVersion.mockReset();
  installRunOperation();
  globalThis.fetch = (async () => new Response('bytes')) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('validateApiKey (FR-086)', () => {
  it('a working key -> ok with a key:<16 hex> fingerprint account id and a fixed label, and no part of the key', async () => {
    const result = await validateApiKey(USER_KEY);

    expect(result).toEqual({
      ok: true,
      accountId: expect.stringMatching(/^key:[0-9a-f]{16}$/),
      label: 'Stitch API key',
    });
    expect(JSON.stringify(result)).not.toContain(USER_KEY);
    expect(mocks.sdk.apiKeysSeen).toEqual([USER_KEY]);
  });

  it('the same key always gets the same account id, a different key a different one', async () => {
    const a = await validateApiKey('key-a');
    const a2 = await validateApiKey('key-a');
    const b = await validateApiKey('key-b');
    expect(a).toEqual(a2);
    expect(a).not.toEqual(b);
  });

  it.each(['AUTH_FAILED', 'PERMISSION_DENIED'])('%s -> rejected', async (code) => {
    mocks.sdk.projectsResult = code;
    expect(await validateApiKey(USER_KEY)).toEqual({ ok: false, reason: 'rejected' });
  });

  it.each(['NETWORK_ERROR', 'RATE_LIMITED', 'UNKNOWN_ERROR', 'NOT_FOUND', 'VALIDATION_ERROR'])(
    '%s -> unavailable (the key is not judged)',
    async (code) => {
      mocks.sdk.projectsResult = code;
      expect(await validateApiKey(USER_KEY)).toEqual({ ok: false, reason: 'unavailable' });
    },
  );

  it('never echoes SDK text or the key in a failure result', async () => {
    mocks.sdk.projectsResult = 'AUTH_FAILED';
    const result = await validateApiKey(USER_KEY);
    expect(JSON.stringify(result)).not.toContain('sdk text');
    expect(JSON.stringify(result)).not.toContain(USER_KEY);
  });

  it('does not mark any connection as needing reauth (no credential is involved)', async () => {
    mocks.sdk.projectsResult = 'AUTH_FAILED';
    await validateApiKey(USER_KEY);
    expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
  });
});

describe('previewPrompt (FR-089)', () => {
  it('carries the caller Stitch connection status and needs no credential', async () => {
    mocks.listConnections.mockResolvedValue([
      { provider: 'github', status: 'active' },
      { provider: 'stitch', status: 'needs_reauth' },
    ]);

    const preview = await previewPrompt(VERSION, CTX);

    expect(preview.connection).toEqual({ status: 'needs_reauth', targetReady: true });
    expect(preview.prompt).toContain('UI-01');
    expect(mocks.listConnections).toHaveBeenCalledWith('user-1');
    expect(mocks.getCredential).not.toHaveBeenCalled();
  });

  it("no Stitch connection -> status 'none', and it never throws", async () => {
    mocks.listConnections.mockResolvedValue([{ provider: 'github', status: 'active' }]);
    expect((await previewPrompt(VERSION, CTX)).connection).toEqual({
      status: 'none',
      targetReady: true,
    });
  });
});

describe('generate with the acting user connection (ERD 7.5)', () => {
  it("resolves getCredential(userId, 'stitch') and runs the SDK with the user's key, not STITCH_API_KEY", async () => {
    const output = await generate(VERSION, CTX);

    expect(mocks.getCredential).toHaveBeenCalledWith('user-1', 'stitch');
    expect(output.mode).toBe('api');
    expect(mocks.sdk.apiKeysSeen).toEqual([USER_KEY]);
    expect(mocks.sdk.apiKeysSeen).not.toContain('legacy-env-key');
  });

  it('passes connectionId and accountId to runOperation, with the descriptor unchanged', async () => {
    await generate(VERSION, CTX);

    expect(mocks.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stitch',
        connectionId: 'conn-1',
        accountId: 'key:0123456789abcdef',
        targetDescriptor: { uiRequirementsVersionId: VERSION },
      }),
    );
  });

  it('works without STITCH_API_KEY configured', async () => {
    mocks.env.STITCH_API_KEY = undefined;
    expect((await generate(VERSION, CTX)).mode).toBe('api');
  });

  it('no connection -> ConnectionRequiredError, no operation, no stitch_output write, no SDK call', async () => {
    mocks.getCredential.mockRejectedValue(new mocks.ConnectionRequiredErrorFake('stitch'));

    await expect(generate(VERSION, CTX)).rejects.toBeInstanceOf(mocks.ConnectionRequiredErrorFake);

    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(mocks.db.inserted).toHaveLength(0);
    expect(mocks.sdk.apiKeysSeen).toHaveLength(0);
  });

  it('a lapsed connection (ReconnectRequiredError from getCredential) is not a manual_fallback', async () => {
    mocks.getCredential.mockRejectedValue(
      new mocks.ReconnectRequiredErrorFake('stitch', 'needs_reauth', 'conn-1'),
    );

    await expect(generate(VERSION, CTX)).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);

    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(mocks.db.inserted).toHaveLength(0);
  });

  it('SDK AUTH_FAILED on the user key -> reportAuthFailure(connectionId) + ReconnectRequiredError, no stitch_output row', async () => {
    mocks.sdk.generateResult = 'AUTH_FAILED';

    const error = await generate(VERSION, CTX).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(error).toMatchObject({
      provider: 'stitch',
      reason: 'needs_reauth',
      connectionId: 'conn-1',
    });
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
    expect(mocks.db.inserted).toHaveLength(0);
    expect(String((error as Error).message)).not.toContain(USER_KEY);
  });

  it('a non-auth definitive SDK error on the user key still ends as manual_fallback', async () => {
    mocks.sdk.generateResult = 'VALIDATION_ERROR';

    const output = await generate(VERSION, CTX);

    expect(output.mode).toBe('manual_fallback');
    expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
  });

  it('send/reconcile take the key from the operation row, not from the caller', async () => {
    mocks.getCredentialForOperation.mockResolvedValue(
      credential({ accessToken: 'recorded-key', connectionId: 'conn-9' }),
    );

    await generate(VERSION, CTX);

    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    expect(mocks.sdk.apiKeysSeen).toEqual(['recorded-key']);
  });

  it('reconcile: AUTH_FAILED while listing projects -> reportAuthFailure + ReconnectRequiredError', async () => {
    mocks.runOperation.mockImplementation(async (opts) => opts.reconcile({ operationId: 'op-1' }));
    mocks.sdk.projectsResult = 'AUTH_FAILED';

    await expect(generate(VERSION, CTX)).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });

  it('reconcile: AUTH_FAILED on the regenerate is a reconnect, not "not found"', async () => {
    mocks.runOperation.mockImplementation(async (opts) => opts.reconcile({ operationId: 'op-1' }));
    mocks.sdk.generateResult = 'AUTH_FAILED';

    await expect(generate(VERSION, CTX)).rejects.toBeInstanceOf(mocks.ReconnectRequiredErrorFake);
    expect(mocks.reportAuthFailure).toHaveBeenCalledWith('conn-1');
  });
});

describe('retryOperation (existing operations)', () => {
  const stitchOp = { id: 'op-1', provider: 'stitch', sourceArtifactVersionId: VERSION };

  beforeEach(() => {
    mocks.getOperationById.mockResolvedValue(stitchOp);
    mocks.getRefsForVersion.mockResolvedValue([{ id: 'ref-1', provider: 'stitch' }]);
  });

  it('uses the connection recorded on the operation and passes it to runOperation', async () => {
    const result = await retryOperation('op-1', CTX);

    expect(result).toMatchObject({ status: 'completed', ref: { id: 'ref-1' } });
    expect(mocks.getCredentialForOperation).toHaveBeenCalledWith('op-1');
    expect(mocks.getCredential).not.toHaveBeenCalled();
    expect(mocks.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: 'conn-1', accountId: 'key:0123456789abcdef' }),
    );
  });

  it('a recorded connection that is not usable -> ReconnectRequiredError before any operation or SDK call', async () => {
    mocks.getCredentialForOperation.mockRejectedValue(
      new mocks.ReconnectRequiredErrorFake('stitch', 'account_mismatch', 'conn-1'),
    );

    await expect(retryOperation('op-1', CTX)).rejects.toBeInstanceOf(
      mocks.ReconnectRequiredErrorFake,
    );

    expect(mocks.runOperation).not.toHaveBeenCalled();
    expect(mocks.sdk.apiKeysSeen).toHaveLength(0);
  });

  it('legacy (no recorded connection) -> STITCH_API_KEY exactly as before, connectionId null', async () => {
    mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });

    const result = await retryOperation('op-1', CTX);

    expect(result.status).toBe('completed');
    expect(mocks.sdk.apiKeysSeen).toEqual(['legacy-env-key']);
    expect(mocks.runOperation).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: null, accountId: null }),
    );
  });

  it('legacy without STITCH_API_KEY fails before any operation is touched', async () => {
    mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
    mocks.env.STITCH_API_KEY = undefined;

    await expect(retryOperation('op-1', CTX)).rejects.toThrow(/STITCH_API_KEY/);
    expect(mocks.runOperation).not.toHaveBeenCalled();
  });

  it('legacy AUTH_FAILED keeps the old handling: definitive -> manual_fallback (route: known-gap 500), no reportAuthFailure', async () => {
    mocks.getCredentialForOperation.mockResolvedValue({ kind: 'legacy' });
    mocks.sdk.generateResult = 'AUTH_FAILED';

    await expect(retryOperation('op-1', CTX)).rejects.toThrow(/manual_fallback/);

    expect(mocks.reportAuthFailure).not.toHaveBeenCalled();
    expect(mocks.db.inserted).toHaveLength(1);
    expect(mocks.db.inserted[0]).toMatchObject({ mode: 'manual_fallback' });
  });

  it('maps reconciliation_required and in_flight to their statuses', async () => {
    mocks.runOperation.mockResolvedValueOnce({ status: 'reconciliation_required' });
    expect(await retryOperation('op-1', CTX)).toEqual({ status: 'reconciliation_required' });

    mocks.runOperation.mockResolvedValueOnce({ status: 'in_flight' });
    expect(await retryOperation('op-1', CTX)).toEqual({ status: 'pending' });
  });

  it('an operation that is not a Stitch one is rejected', async () => {
    mocks.getOperationById.mockResolvedValue({ ...stitchOp, provider: 'jira' });
    await expect(retryOperation('op-1', CTX)).rejects.toThrow(/not a Stitch operation/);
  });
});
