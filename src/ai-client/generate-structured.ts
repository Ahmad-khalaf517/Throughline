import type { ZodSchema } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import { schema, withTx } from '@/db';
import { createOpenAIClient, getOpenAIModel } from './config';

// ERD 4.13 CHECK constraint - kept here too so a typo can't silently insert a
// purpose the DB would have rejected anyway, and so callers get a TS error
// instead of a runtime CHECK-constraint failure.
export type GenerationPurpose = 'generation' | 'semantic_mapping' | 'revision' | 'quality_check';

export interface GenerateStructuredOptions<T> {
  projectId: string;
  artifactVersionId?: string;
  purpose: GenerationPurpose;
  prompt: string;
  schema: ZodSchema<T>;
}

export interface GenerateStructuredResult<T> {
  data: T;
  runId: string;
}

// Module Boundaries 4.1: fixed for now (the only provider this project
// integrates with). Not read from env - `provider` in ai_generation_run
// records who served the call, independent of which model was configured.
const PROVIDER = 'openai';

/**
 * Calls the LLM provider, validates the response against the caller's Zod
 * schema, and logs exactly one `ai_generation_run` row - `succeeded` or
 * `failed` - regardless of outcome (Module Boundaries 4.1; TR section 33;
 * NFR-004). This is the only module allowed to call the LLM provider's API
 * (eslint.config.mjs restricts the `openai` import to src/ai-client/**).
 *
 * Follows the proven call shape from scripts/spike-structured-output.ts
 * (SCRUM-26 / E2-T1): `client.chat.completions.parse` + `zodResponseFormat`,
 * with no `temperature` passed - the configured OPENAI_MODEL is
 * reasoning-tier and rejects any explicit temperature value (400 on
 * `temperature: 0`) except its own default, so this omits the param
 * entirely rather than hardcoding one.
 *
 * On failure - the API call throwing, the response failing schema
 * validation, or the model refusing - a `failed` row is logged with
 * `error_message` and the error is rethrown (TR section 33: "throws on
 * schema-validation failure - the run is still logged as failed").
 */
export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
): Promise<GenerateStructuredResult<T>> {
  const model = getOpenAIModel();
  const client = createOpenAIClient();
  const artifactVersionId = opts.artifactVersionId ?? null;

  const startedAt = Date.now();
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  try {
    const completion = await client.chat.completions.parse({
      model,
      messages: [{ role: 'user', content: opts.prompt }],
      response_format: zodResponseFormat(opts.schema, 'structured_output'),
    });
    const latencyMs = Date.now() - startedAt;
    inputTokens = completion.usage?.prompt_tokens ?? null;
    outputTokens = completion.usage?.completion_tokens ?? null;

    const choice = completion.choices[0];
    if (!choice) {
      throw new Error('OpenAI response had no choices');
    }
    if (choice.message.refusal) {
      throw new Error(`Model refused the request: ${choice.message.refusal}`);
    }
    if (choice.message.parsed === null || choice.message.parsed === undefined) {
      // Shouldn't happen if .parse() didn't throw, but guard anyway - see
      // the same guard in the spike script.
      throw new Error('OpenAI response did not include parsed structured output');
    }
    const data = choice.message.parsed;

    const [run] = await withTx((tx) =>
      tx
        .insert(schema.aiGenerationRun)
        .values({
          projectId: opts.projectId,
          artifactVersionId,
          purpose: opts.purpose,
          provider: PROVIDER,
          model,
          inputTokens,
          outputTokens,
          latencyMs,
          status: 'succeeded',
        })
        .returning({ id: schema.aiGenerationRun.id }),
    );
    if (!run) {
      throw new Error('ai_generation_run insert returned no row');
    }

    return { data, runId: run.id };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);

    await withTx((tx) =>
      tx.insert(schema.aiGenerationRun).values({
        projectId: opts.projectId,
        artifactVersionId,
        purpose: opts.purpose,
        provider: PROVIDER,
        model,
        inputTokens,
        outputTokens,
        latencyMs,
        status: 'failed',
        errorMessage,
      }),
    );

    throw err;
  }
}
