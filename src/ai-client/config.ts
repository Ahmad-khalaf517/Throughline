import OpenAI from 'openai';
import { env } from '@/lib/env';

// OPENAI_API_KEY / OPENAI_MODEL stay `.optional()` in src/lib/env.ts on
// purpose (see that file's header comment): env.ts does eager loadEnv() at
// import time, and tests/integration/support/connection.ts imports it too -
// CI has no OpenAI secrets configured, so making these required there would
// break every PR's `pnpm test:int`, not just this module. Validation for
// ai-client's own two vars is done here instead, lazily, only at the point a
// call actually needs a key/model - not at process boot.

/** Throws a clear, ai-client-specific error rather than letting a missing
 * key surface as an OpenAI SDK error deeper in the call. */
export function getOpenAIApiKey(): string {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  return env.OPENAI_API_KEY;
}

export function getOpenAIModel(): string {
  if (!env.OPENAI_MODEL) {
    throw new Error('OPENAI_MODEL is not configured');
  }
  return env.OPENAI_MODEL;
}

/** New client per call - this module has no long-lived state of its own
 * (Module Boundaries principle 5: plain import boundary, not a service). */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: getOpenAIApiKey() });
}
