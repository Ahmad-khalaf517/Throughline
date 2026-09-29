import { ConnectionConfigError, ConnectionInputError, OAuthFlowError } from './errors';
import { buildGithubAuthorizeUrl, exchangeGithubCode, fetchGithubIdentity } from './oauth-github';
import { createPkce, sanitizeReturnTo, signState, verifyState } from './oauth-state';
import { saveConnection } from './store';

// beginOAuth / completeOAuth (Module Boundaries 4.9). The ROUTE owns the PKCE
// cookie: `beginOAuth` returns the verifier, the route stores it in a
// short-lived httpOnly cookie and hands it back to `completeOAuth`.

type OAuthProvider = 'github' | 'jira';

function assertImplemented(provider: OAuthProvider): asserts provider is 'github' {
  if (provider === 'jira') {
    throw new ConnectionConfigError('Jira OAuth is not implemented until SCRUM-97.');
  }
  if (provider !== 'github') throw new ConnectionInputError('Unknown OAuth provider.');
}

export async function beginOAuth(
  userId: string,
  provider: OAuthProvider,
  opts: { returnTo?: string } = {},
): Promise<{ authorizeUrl: string; pkceVerifier: string }> {
  assertImplemented(provider);
  const { verifier, challenge } = createPkce();
  const state = signState({
    userId,
    provider,
    returnTo: sanitizeReturnTo(opts.returnTo),
    challenge,
  });
  return { authorizeUrl: buildGithubAuthorizeUrl({ state, challenge }), pkceVerifier: verifier };
}

export async function completeOAuth(
  userId: string,
  provider: OAuthProvider,
  query: { code: string; state: string; pkceVerifier: string },
): Promise<{ returnTo?: string }> {
  assertImplemented(provider);
  if (!query.code || !query.state || !query.pkceVerifier) {
    throw new OAuthFlowError('invalid_state');
  }
  // Nothing is exchanged and nothing is stored until the state verifies.
  const { returnTo } = verifyState(query.state, {
    userId,
    provider,
    pkceVerifier: query.pkceVerifier,
  });

  const token = await exchangeGithubCode({ code: query.code, pkceVerifier: query.pkceVerifier });
  const identity = await fetchGithubIdentity(token.accessToken);

  await saveConnection({
    userId,
    provider,
    externalAccountId: identity.id,
    displayName: identity.login,
    accessToken: token.accessToken,
    // OAuth-App tokens do not expire and carry no refresh token.
    refreshToken: null,
    expiresAt: null,
    scopes: token.scopes.length > 0 ? token.scopes : (identity.scopes ?? []),
    providerMeta: { login: identity.login },
  });
  return returnTo === undefined ? {} : { returnTo };
}
