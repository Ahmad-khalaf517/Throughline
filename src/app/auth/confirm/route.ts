import { NextResponse } from 'next/server';
import { exchangeCodeForSession, getVerifiedUser, upsertAppUser, verifyEmailOtp } from '@/auth';

// The link Supabase emails after sign-up points here. Two possible shapes
// depending on the project's email template (ERD Appendix B round 9 -
// mailer_autoconfirm is off, so this route is the only way a new account
// becomes usable):
//   - default template: {NEXT_PUBLIC_SITE_URL}/auth/confirm?code=... (PKCE -
//     Supabase's own hosted page verifies the OTP first, then redirects here)
//   - customized template using {{ .TokenHash }}: ?token_hash=...&type=...
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type');
  const next = searchParams.get('next') ?? '/';

  let verifyError: string | null = 'missing verification params';
  if (code) {
    verifyError = (await exchangeCodeForSession(code)).error;
  } else if (tokenHash && type) {
    verifyError = (await verifyEmailOtp(tokenHash, type)).error;
  }

  if (!verifyError) {
    const user = await getVerifiedUser();
    if (user) {
      await upsertAppUser(user);
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  // Route the failure back to whichever flow sent the user here, so the
  // error shown matches what actually failed (a sign-up link vs. a
  // password-reset link) instead of always saying "sign up again."
  const failureUrl =
    next === '/reset-password'
      ? '/forgot-password?error=link_failed'
      : '/sign-in?error=verification_failed';
  return NextResponse.redirect(new URL(failureUrl, origin));
}
