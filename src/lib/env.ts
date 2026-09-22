import { z } from 'zod';

// The single validation boundary for process.env (Module Boundaries
// principle 4 / Project Setup section 7). Parsed once at import time so a
// missing credential fails at boot, not mid-approval. Never import this from
// a client component - several of these are server-only secrets.

const envSchema = z.object({
  // --- module 1: db ---
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),

  // --- module 2: auth ---
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ALLOWLISTED_EMAILS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),

  // --- module 3: ai-client ---
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),

  // --- module 14: github ---
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_OWNER: z.string().min(1),
  GITHUB_MARKER_SECRET: z.string().min(1),

  // --- module 15: jira ---
  JIRA_BASE_URL: z.string().url(),
  JIRA_EMAIL: z.string().email(),
  JIRA_API_TOKEN: z.string().min(1),
  JIRA_PROJECT_KEY: z.string().min(1),

  // --- module 16: stitch ---
  STITCH_API_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console -- boot-time failure, no logger exists yet
    console.error('Invalid environment configuration:', parsed.error.issues);
    throw new Error('Invalid environment configuration - see console output above.');
  }
  return parsed.data;
}

export const env = loadEnv();
