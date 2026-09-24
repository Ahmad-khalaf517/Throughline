import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// generateStructured (Module Boundaries 4.1, TR section 33) is the only
// module allowed to call the OpenAI SDK - mocked here (no real network
// calls, and this suite must pass with NO OPENAI_API_KEY set in the real
// process environment) alongside `@/db` (no live Postgres yet - E1-S5's
// testcontainers harness is for tests/integration only). Real `@/db/schema`
// + the real `zodResponseFormat` helper (openai/helpers/zod) are used as-is:
// both are pure, no network/DB connection needed to import or call them -
// same approach as tests/unit/artifact-lifecycle/project.test.ts for schema.
//
// `@/lib/env` is mocked to a plain mutable object (not the real
// envSchema.parse()) so individual tests can flip OPENAI_API_KEY/
// OPENAI_MODEL to undefined to exercise this module's own lazy validation,
// without needing every other module's env vars set.

interface EnvMock {
  OPENAI_API_KEY: string | undefined;
  OPENAI_MODEL: string | undefined;
}

const envMock = vi.hoisted((): EnvMock => ({
  OPENAI_API_KEY: 'test-api-key',
  OPENAI_MODEL: 'test-model',
}));

vi.mock('@/lib/env', () => ({ env: envMock }));

const { parseMock, openAIConstructorMock } = vi.hoisted(() => ({
  parseMock: vi.fn(),
  openAIConstructorMock: vi.fn(),
}));

// Stand-in for the `openai` package's default export: a class whose
// `chat.completions.parse` is the one call this module ever makes.
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { parse: parseMock } };
    constructor(opts: unknown) {
      openAIConstructorMock(opts);
    }
  },
}));

const { withTxMock } = vi.hoisted(() => ({ withTxMock: vi.fn() }));

vi.mock('@/db', async () => {
  const schema = await import('@/db/schema');
  return { schema, withTx: withTxMock };
});

import { schema } from '@/db';
import { generateStructured } from '@/ai-client';

const ResultSchema = z.object({ foo: z.string() });

// A fluent stand-in for drizzle's insert chain, matching the pattern in
// tests/unit/artifact-lifecycle/project.test.ts: `tx.insert(t).values(v)` is
// itself awaitable (the failure path never calls `.returning()`), and
// `.returning()` resolves separately for the success path.
function makeInsertChain(returningRows: unknown[] = []) {
  const returning = vi.fn().mockResolvedValue(returningRows);
  const valuesResult = Object.assign(Promise.resolve(undefined), { returning });
  const values = vi.fn(() => valuesResult);
  const insert = vi.fn(() => ({ values }));
  return { insert, values, returning };
}

function okCompletion(parsed: unknown, usage = { prompt_tokens: 12, completion_tokens: 34 }) {
  return { choices: [{ message: { parsed, refusal: null } }], usage };
}

describe('generateStructured', () => {
  beforeEach(() => {
    envMock.OPENAI_API_KEY = 'test-api-key';
    envMock.OPENAI_MODEL = 'test-model';
    parseMock.mockReset();
    openAIConstructorMock.mockReset();
    withTxMock.mockReset();
  });

  it('logs exactly one succeeded row and returns { data, runId } on success', async () => {
    parseMock.mockResolvedValueOnce(okCompletion({ foo: 'bar' }));
    const tx = makeInsertChain([{ id: 'run-123' }]);
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    const result = await generateStructured({
      projectId: 'project-1',
      purpose: 'generation',
      prompt: 'do the thing',
      schema: ResultSchema,
    });

    expect(result).toEqual({ data: { foo: 'bar' }, runId: 'run-123' });
    expect(withTxMock).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledWith(schema.aiGenerationRun);
    expect(tx.values).toHaveBeenCalledTimes(1);
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        artifactVersionId: null,
        purpose: 'generation',
        provider: 'openai',
        model: 'test-model',
        inputTokens: 12,
        outputTokens: 34,
        status: 'succeeded',
        latencyMs: expect.any(Number),
      }),
    );
    expect(tx.returning).toHaveBeenCalledWith({ id: schema.aiGenerationRun.id });
  });

  it('logs exactly one failed row with error_message and rethrows on Zod validation failure', async () => {
    const zodError = new z.ZodError([]);
    parseMock.mockRejectedValueOnce(zodError);
    const tx = makeInsertChain();
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(
      generateStructured({
        projectId: 'project-1',
        purpose: 'generation',
        prompt: 'do the thing',
        schema: ResultSchema,
      }),
    ).rejects.toBe(zodError);

    expect(withTxMock).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(tx.returning).not.toHaveBeenCalled();
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: expect.any(String) }),
    );
  });

  it('logs exactly one failed row and rethrows when the OpenAI call itself throws', async () => {
    const apiError = new Error('network down');
    parseMock.mockRejectedValueOnce(apiError);
    const tx = makeInsertChain();
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(
      generateStructured({
        projectId: 'project-1',
        purpose: 'quality_check',
        prompt: 'check it',
        schema: ResultSchema,
      }),
    ).rejects.toBe(apiError);

    expect(withTxMock).toHaveBeenCalledTimes(1);
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'network down' }),
    );
  });

  it('logs exactly one failed row and rethrows when the model refuses', async () => {
    parseMock.mockResolvedValueOnce({
      choices: [{ message: { parsed: null, refusal: 'cannot comply with that request' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const tx = makeInsertChain();
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await expect(
      generateStructured({
        projectId: 'project-1',
        purpose: 'revision',
        prompt: 'revise it',
        schema: ResultSchema,
      }),
    ).rejects.toThrow(/refused/i);

    expect(withTxMock).toHaveBeenCalledTimes(1);
    expect(tx.values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('cannot comply with that request'),
      }),
    );
  });

  it('stores artifact_version_id as null when omitted, and passes it through when given', async () => {
    parseMock.mockResolvedValue(okCompletion({ foo: 'bar' }));
    const tx = makeInsertChain([{ id: 'run-1' }]);
    withTxMock.mockImplementation((fn: (tx: unknown) => unknown) => fn(tx));

    await generateStructured({
      projectId: 'project-1',
      purpose: 'generation',
      prompt: 'p',
      schema: ResultSchema,
    });
    expect(tx.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ artifactVersionId: null }),
    );

    await generateStructured({
      projectId: 'project-1',
      artifactVersionId: 'version-9',
      purpose: 'generation',
      prompt: 'p',
      schema: ResultSchema,
    });
    expect(tx.values).toHaveBeenLastCalledWith(
      expect.objectContaining({ artifactVersionId: 'version-9' }),
    );
  });

  it('throws its own clear error (not an OpenAI SDK error) when OPENAI_API_KEY is missing, and never calls OpenAI or logs a run', async () => {
    envMock.OPENAI_API_KEY = undefined;

    await expect(
      generateStructured({
        projectId: 'project-1',
        purpose: 'generation',
        prompt: 'p',
        schema: ResultSchema,
      }),
    ).rejects.toThrow('OPENAI_API_KEY is not configured');

    expect(openAIConstructorMock).not.toHaveBeenCalled();
    expect(parseMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it('throws its own clear error when OPENAI_MODEL is missing, and never calls OpenAI or logs a run', async () => {
    envMock.OPENAI_MODEL = undefined;

    await expect(
      generateStructured({
        projectId: 'project-1',
        purpose: 'generation',
        prompt: 'p',
        schema: ResultSchema,
      }),
    ).rejects.toThrow('OPENAI_MODEL is not configured');

    expect(openAIConstructorMock).not.toHaveBeenCalled();
    expect(parseMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });
});
