import { type NextRequest } from 'next/server';
import { updateSession } from '@/auth';

// Refreshes the Supabase session cookie on every request that isn't a static
// asset (@supabase/ssr's documented Next.js pattern). This does NOT
// authorize anything by itself - route handlers/Server Actions still call
// auth.getVerifiedUser (ERD section 2: never trust getSession()).
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico
     * - common static asset extensions
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
