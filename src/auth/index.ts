import type { EmailOtpType } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { db, schema, withTx } from '@/db';
import { ApiError } from '@/lib/errors';
import { env } from '@/lib/env';
import { createServerSupabaseClient } from './supabase-server';

// A `projectId` never has any other legal shape (uuid primary key) - checked
// up front so a malformed id fails closed as 404 instead of surfacing a raw
// Postgres "invalid input syntax for type uuid" error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { updateSession } from './supabase-middleware';

// Module 2: auth
// Owns: app_user (the upsert-on-login row only; ERD section 4.1).
// See docs/Throughline_Module_Boundaries.md section 4.1.

/**
 * auth.getUser() against Supabase, never getSession() - reads an unverified
 * cookie (ERD section 2). Returns null if unverified. No allowlist check:
 * sign-up is open, gated only by Supabase's own email verification
 * (mailer_autoconfirm off) - ERD Appendix B round 9.
 *
 * Accepts an optional request for the documented scripted-testing path
 * (API Contracts 1.1: `Authorization: Bearer <token>`); omitted, it reads
 * the httpOnly session cookie via next/headers instead.
 */
export async function getVerifiedUser(
  request?: Request,
): Promise<{ id: string; email: string; displayName: string | null } | null> {
  const bearer = request?.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const supabase = await createServerSupabaseClient();
  const { data, error } = bearer
    ? await supabase.auth.getUser(bearer)
    : await supabase.auth.getUser();

  if (error || !data.user?.email) return null;
  const displayName = data.user.user_metadata?.display_name;
  return {
    id: data.user.id,
    email: data.user.email,
    displayName: typeof displayName === 'string' ? displayName : null,
  };
}

/**
 * INSERT ... ON CONFLICT (id) DO UPDATE, called once per authenticated
 * request or on login (ERD section 4.1). Deliberately no unique-email
 * constraint to violate - app_user.email is a display/audit snapshot only.
 */
export async function upsertAppUser(user: {
  id: string;
  email: string;
  displayName?: string | null;
}): Promise<void> {
  await withTx(async (tx) => {
    await tx
      .insert(schema.appUser)
      .values({ id: user.id, email: user.email, displayName: user.displayName ?? null })
      .onConflictDoUpdate({
        target: schema.appUser.id,
        set: { email: user.email, displayName: user.displayName ?? null },
      });
  });
}

/**
 * The ONLY project-ownership check in the codebase (Module Boundaries 4.1).
 * Throws `ApiError('NOT_FOUND')` - never a 403 - for both "no such project"
 * and "project exists but isn't the caller's": API Contracts 1.1 rule 2 and
 * 1.4 are deliberate that these two cases must be indistinguishable to the
 * caller, so an id can never be confirmed to exist in a project it doesn't
 * own (this overrides Module Boundaries' own "throws 403" comment - API
 * Contracts is the more specific, later-reasoned rule here).
 *
 * Reads `project` directly - `auth` is layer 0 and does not import
 * `artifact-lifecycle` (layer 2); this is the one documented place a
 * lower-layer module reads a table it doesn't own (ERD "Authorization" row,
 * Module Boundaries 4.1).
 */
export async function requireProjectOwner(userId: string, projectId: string): Promise<void> {
  if (!UUID_RE.test(projectId)) {
    throw new ApiError('NOT_FOUND', 'Project not found.');
  }

  const [row] = await db
    .select({ ownerUserId: schema.project.ownerUserId })
    .from(schema.project)
    .where(eq(schema.project.id, projectId))
    .limit(1);

  if (!row || row.ownerUserId !== userId) {
    throw new ApiError('NOT_FOUND', 'Project not found.');
  }
}

/**
 * Starts email/password sign-up. Supabase sends the verification email with
 * a link back to /auth/confirm (mandatory - mailer_autoconfirm is off; ERD
 * Appendix B round 9). Sign-up is open, no allowlist.
 */
export async function signUpWithEmail(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email: opts.email,
    password: opts.password,
    options: {
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
      // Key matches app_user.display_name (ERD 4.1): "From the Supabase user metadata".
      data: { display_name: opts.name },
    },
  });
  return { error: error?.message ?? null };
}

export async function signInWithEmail(opts: {
  email: string;
  password: string;
}): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword(opts);
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
}

/**
 * Starts the forgot-password flow. Supabase sends a recovery email with a
 * link back to /auth/confirm?next=/reset-password - handled by the SAME
 * route as sign-up verification (it's already generic over the `code`/
 * `token_hash` pattern and the email `type`), which establishes a recovery
 * session and redirects to /reset-password.
 *
 * Deliberately returns { error: null } even when the email doesn't belong to
 * an account: Supabase's own client does not distinguish "sent" from
 * "unknown email" either, so surfacing a difference here would just
 * reintroduce the account-enumeration leak sign-in already avoids.
 */
export async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/reset-password`,
  });
  // A malformed email is the one case worth surfacing - it's a client-side
  // input error, not information about which emails have accounts.
  if (error && error.code !== 'validation_failed') {
    return { error: null };
  }
  return { error: error?.message ?? null };
}

/**
 * Sets a new password. Only succeeds with a valid session - in practice the
 * short-lived recovery session /auth/confirm established from the reset
 * link. No separate "am I in a recovery flow" check is needed: Supabase
 * rejects this call outright without a session, which is exactly the guard
 * /reset-password needs.
 */
export async function updatePassword(newPassword: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error?.message ?? null };
}

const VALID_OTP_TYPES: readonly EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

/**
 * Verifies the token_hash from the /auth/confirm email link. `type` is
 * accepted as a plain string (it arrives as an untrusted URL query param -
 * TR Appendix A rule 1) and validated here so callers outside src/auth never
 * need to import a @supabase/* type themselves.
 */
export async function verifyEmailOtp(
  tokenHash: string,
  type: string,
): Promise<{ error: string | null }> {
  if (!VALID_OTP_TYPES.includes(type as EmailOtpType)) {
    return { error: 'Invalid verification type.' };
  }
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  return { error: error?.message ?? null };
}

/**
 * Exchanges the PKCE `code` param from the /auth/confirm link for a session.
 * This is the path Supabase's DEFAULT email template actually uses:
 * {{ .ConfirmationURL }} points to Supabase's own hosted verify endpoint,
 * which verifies the OTP server-side and redirects back to emailRedirectTo
 * with `?code=...` - not `?token_hash=...&type=...` (that pattern only
 * applies if the email template is customized to link straight to this app
 * with {{ .TokenHash }}). @supabase/ssr defaults to PKCE, so this is the
 * primary path; verifyEmailOtp above is kept for a customized template.
 */
export async function exchangeCodeForSession(code: string): Promise<{ error: string | null }> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return { error: error?.message ?? null };
}

// Rare read-only lookup (e.g. showing "signed in as" on a page) - not a
// second write path. All writes to app_user still go through upsertAppUser.
export async function getAppUserById(id: string) {
  const [row] = await db.select().from(schema.appUser).where(eq(schema.appUser.id, id)).limit(1);
  return row ?? null;
}
