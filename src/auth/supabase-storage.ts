import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// Service-role Supabase client, Storage-only use (ERD 4.16 / TR FR-052):
// `stitch` (module 16, layer 5) writes HTML/screenshot bytes to a private
// Supabase Storage bucket with the service-role key on the server, and reads
// them back only through short-lived signed URLs - never a public/anon-key
// path, never a remote URL depended on long-term. Only src/auth may import
// `@supabase/*` (Module Boundaries 4.1, eslint-enforced) - `stitch` (layer 5)
// imports this function from `@/auth` instead (eslint.config.mjs's
// layer5-external-provider allow-list has `layer0-auth` but not
// `@supabase/*` directly), the same compose-above pattern
// `architecture.getArchitectureDecisionItems`/`backlog.getBacklogVersionMembers`
// already established for their own cross-layer reads.
//
// Deliberately NOT `createServerSupabaseClient` (supabase-server.ts): that
// client is cookie-based, anon-key, per-request auth/SSR - Storage's own RLS
// is irrelevant here anyway (grants are revoked / RLS enabled with no
// policies for the Data API, ERD section A.3), and this client never reads
// or writes a session, so `persistSession`/`autoRefreshToken` are off.
//
// Constructed fresh on every call (no module-level singleton), same
// convention `github`'s own `createOctokitClient()` uses - `resolveFetch`
// inside @supabase/storage-js re-invokes the global `fetch` on every request
// rather than capturing a reference at construction time (confirmed in
// node_modules/@supabase/storage-js's own `resolveFetch` helper), so tests
// can swap `globalThis.fetch` for an in-process fake Supabase Storage around
// individual calls without this module needing a test-only seam.
export function getStorageServiceClient(): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
