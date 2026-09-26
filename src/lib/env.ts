import { z } from 'zod';

// The single validation boundary for process.env (Module Boundaries
// principle 4 / Project Setup section 7). Parsed once at import time so a
// missing credential fails at boot, not mid-approval. Never import this from
// a client component - several of these are server-only secrets.
//
// Required vs optional here tracks which modules actually exist and are
// wired up, not the full slice 1-4 module list. A var for a module that
// hasn't been built yet must not block every other module's boot - found the
// hard way: db/auth alone couldn't build until this was corrected, because
// this schema originally required every future module's credentials
// unconditionally. Move a field from optional to required in the same
// change that wires its module in for real.

const envSchema = z.object({
  // --- module 1: db --- (wired)
  DATABASE_URL: z.string().url(),
  DIRECT_DATABASE_URL: z.string().url(),

  // --- module 2: auth --- (wired)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Origin used for the email-verification redirect link (Supabase's
  // emailRedirectTo). Must also be added to the project's Auth > URL
  // Configuration > Redirect URLs allowlist in the Supabase dashboard.
  NEXT_PUBLIC_SITE_URL: z.string().url(),

  // --- module 3: ai-client --- (not built yet)
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),

  // --- module 14: github --- (wired, E4-S2/SCRUM-51)
  // All three stay optional here (loadEnv must not block boot for a module
  // whose credentials aren't configured yet) - github/index.ts's own
  // requireOwner()/requireServerSecret() throw a clear error at call time
  // instead if GITHUB_OWNER/GITHUB_MARKER_SECRET are missing when actually
  // needed (initRepo/checkDrift), not at process start.
  GITHUB_TOKEN: z.string().min(1).optional(),
  GITHUB_OWNER: z.string().min(1).optional(),
  GITHUB_MARKER_SECRET: z.string().min(1).optional(),

  // --- module 15: jira --- (not built yet)
  JIRA_BASE_URL: z.string().url().optional(),
  JIRA_EMAIL: z.string().email().optional(),
  JIRA_API_TOKEN: z.string().min(1).optional(),
  JIRA_PROJECT_KEY: z.string().min(1).optional(),

  // --- module 16: stitch --- (wired, E4-S4/SCRUM-53)
  // All optional, same reasoning as GitHub/Jira above - stitch/index.ts's own
  // requireStitchConfig()/requireStorageBucket() throw a clear error at call
  // time (previewPrompt/generate) instead of blocking boot. STITCH_BASE_URL
  // has no verified real Stitch REST API shape behind it yet (no spike has
  // run - E4-S5/Spike B is next); same z.string().url() shape as
  // JIRA_BASE_URL regardless.
  STITCH_API_KEY: z.string().min(1).optional(),
  STITCH_BASE_URL: z.string().url().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // dotenv loads `KEY=` (no value) as an empty string, not undefined - an
  // optional field's .min(1) would otherwise still reject it. Treat blank as
  // absent before validating.
  const raw = Object.fromEntries(
    Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]),
  );
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.issues);
    throw new Error('Invalid environment configuration - see console output above.');
  }
  return parsed.data;
}

export const env = loadEnv();
