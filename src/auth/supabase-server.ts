import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

// Server-side Supabase client for Server Components, Route Handlers and
// Server Actions - reads/writes the session via next/headers cookies().
// Only src/auth may construct this (Module Boundaries 4.1, eslint-enforced).
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component that can't write cookies - the
          // session is still refreshed by middleware.ts on the next request.
        }
      },
    },
  });
}
