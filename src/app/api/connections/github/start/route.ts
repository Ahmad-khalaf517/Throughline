import { getVerifiedUser } from '@/auth';
import { beginOAuth } from '@/connections';
import { ApiError, errorResponse } from '@/lib/errors';
import { redirectTo, setPkceCookie } from '@/app/api/_shared/oauth-redirect';
import { oauthStartQuerySchema } from '../../schemas';

/**
 * `GET /api/connections/github/start` -> connections.beginOAuth('github') (API
 * Contracts 10A). Browser navigation: stores the PKCE verifier in a short-lived
 * httpOnly cookie and answers 302 to GitHub's authorize URL. A `returnTo` that is
 * not a relative path on this site is ignored by `beginOAuth`.
 */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const query = oauthStartQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const { authorizeUrl, pkceVerifier } = await beginOAuth(user.id, 'github', {
      ...(query.returnTo !== undefined ? { returnTo: query.returnTo } : {}),
    });

    const response = redirectTo(authorizeUrl);
    setPkceCookie(response, 'github', pkceVerifier);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
