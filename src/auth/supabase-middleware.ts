import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';

// updateSession() - refreshes the Supabase session cookie on every request.
// @supabase/ssr's Next.js pattern: middleware.ts (project root) calls this
// directly; it never constructs its own Supabase client (Module Boundaries
// 4.1 - only src/auth imports @supabase/*, eslint-enforced).
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Must be called (not skipped) - this is what actually refreshes an
  // expiring token; getSession() alone would not. Result intentionally
  // unused here: route handlers/Server Actions re-verify via
  // auth.getVerifiedUser (never trust the middleware's own check as
  // authorization - ERD section 2, "never getSession()").
  await supabase.auth.getUser();

  return response;
}
