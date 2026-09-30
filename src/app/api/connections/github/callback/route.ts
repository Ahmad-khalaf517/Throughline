import { getVerifiedUser } from '@/auth';
import { completeOAuth, OAuthFlowError } from '@/connections';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  clearPkceCookie,
  errorRedirect,
  pkceCookieName,
  readCookie,
  redirectTo,
  type OAuthErrorCode,
} from '@/app/api/_shared/oauth-redirect';
import { oauthCallbackQuerySchema } from '../../schemas';

/**
 * `GET /api/connections/github/callback` -> connections.completeOAuth('github')
 * (API Contracts 10A). Reads and always clears the PKCE cookie, then redirects:
 * to `returnTo` (from the verified state) or `/connections?connected=github` on
 * success, `/connections?error=<code>` on any failure. The code is one of
 * `invalid_state`, `access_denied`, `exchange_failed` - never provider text,
 * never a token.
 */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const query = oauthCallbackQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const pkceVerifier = readCookie(request, pkceCookieName('github'));

    const finish = (location: string) => {
      const response = redirectTo(location);
      clearPkceCookie(response, 'github');
      return response;
    };
    const fail = (code: OAuthErrorCode) => finish(errorRedirect(code));

    // GitHub sends `error` (e.g. access_denied) instead of a code when the user
    // declines. Only the "declined" case is named; every other value collapses.
    if (query.error !== undefined) {
      return fail(query.error === 'access_denied' ? 'access_denied' : 'exchange_failed');
    }
    if (!query.code || !query.state || !pkceVerifier) return fail('invalid_state');

    try {
      const { returnTo } = await completeOAuth(user.id, 'github', {
        code: query.code,
        state: query.state,
        pkceVerifier,
      });
      return finish(returnTo ?? '/connections?connected=github');
    } catch (error) {
      if (error instanceof OAuthFlowError) return fail(error.code);
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
