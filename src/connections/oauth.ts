import { ConnectionInputError, OAuthFlowError } from './errors';
import { buildGithubAuthorizeUrl, exchangeGithubCode, fetchGithubIdentity } from './oauth-github';
import {
  JIRA_SCOPE,
  buildJiraAuthorizeUrl,
  exchangeJiraCode,
  fetchDefaultJiraSite,
  fetchJiraIdentity,
} from './oauth-jira';
import { createPkce, sanitizeReturnTo, signState, verifyState } from './oauth-state';
import { saveConnection } from './store';

// beginOAuth / completeOAuth (Module Boundaries 4.9). The ROUTE owns the PKCE
// cookie: `beginOAuth` returns the verifier, the route stores it in a
// short-lived httpOnly cookie and hands it back to `completeOAuth`.

type OAuthProvider = 'github' | 'jira';

function assertProvider(provider: string): asserts provider is OAuthProvider {
  if (provider !== 'github' && provider !== 'jira') {
    throw new ConnectionInputError('Unknown OAuth provider.');
  }
}

export async function beginOAuth(
  userId: string,
  provider: OAuthProvider,
  opts: { returnTo?: string } = {},
): Promise<{ authorizeUrl: string; pkceVerifier: string }> {
  assertProvider(provider);
  const { verifier, challenge } = createPkce();
  const state = signState({
    userId,
    provider,
    returnTo: sanitizeReturnTo(opts.returnTo),
    challenge,
  });
  const authorizeUrl =
    provider === 'github'
      ? buildGithubAuthorizeUrl({ state, challenge })
      : buildJiraAuthorizeUrl({ state, challenge });
  return { authorizeUrl, pkceVerifier: verifier };
}

export async function completeOAuth(
  userId: string,
  provider: OAuthProvider,
  query: { code: string; state: string; pkceVerifier: string },
): Promise<{ returnTo?: string }> {
  assertProvider(provider);
  if (!query.code || !query.state || !query.pkceVerifier) {
    throw new OAuthFlowError('invalid_state');
  }
  // Nothing is exchanged and nothing is stored until the state verifies.
  const { returnTo } = verifyState(query.state, {
    userId,
    provider,
    pkceVerifier: query.pkceVerifier,
  });

  if (provider === 'github') {
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
  } else {
    const token = await exchangeJiraCode({ code: query.code, pkceVerifier: query.pkceVerifier });
    // Without a refresh token the connection could never be renewed (ERD 7.6).
    if (!token.refreshToken) throw new OAuthFlowError('exchange_failed');
    const identity = await fetchJiraIdentity(token.accessToken);
    const site = await fetchDefaultJiraSite(token.accessToken);

    await saveConnection({
      userId,
      provider,
      externalAccountId: identity.id,
      displayName: identity.displayName,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scopes: token.scopes.length > 0 ? token.scopes : JIRA_SCOPE.split(' '),
      providerMeta: site ?? {},
    });
  }
  return returnTo === undefined ? {} : { returnTo };
}
