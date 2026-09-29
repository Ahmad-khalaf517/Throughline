// Typed errors of the connections module (Module Boundaries 4.9). None of them
// ever carries a token, ciphertext or key in its message (rule 5): messages are
// fixed strings; only non-secret ids go in the structured fields.

export type ConnectionProvider = 'github' | 'jira' | 'stitch';

/** No usable connection exists: no row at all. -> API 409 CONNECTION_REQUIRED. */
export class ConnectionRequiredError extends Error {
  readonly provider: ConnectionProvider;

  constructor(provider: ConnectionProvider) {
    super(`No ${provider} connection. Connect your ${provider} account first.`);
    this.name = 'ConnectionRequiredError';
    this.provider = provider;
  }
}

export type ReconnectReason = 'needs_reauth' | 'revoked' | 'refresh_rejected' | 'account_mismatch';

/**
 * The connection exists but cannot be used until the user reconnects
 * (needs_reauth / revoked / refresh rejected / connected account changed).
 * -> API 409 RECONNECT_REQUIRED. Never changes an external_operation (ERD 7.6).
 */
export class ReconnectRequiredError extends Error {
  readonly provider: ConnectionProvider;
  readonly reason: ReconnectReason;
  readonly connectionId: string;

  constructor(provider: ConnectionProvider, reason: ReconnectReason, connectionId: string) {
    super(`The ${provider} connection must be reconnected (${reason}).`);
    this.name = 'ReconnectRequiredError';
    this.provider = provider;
    this.reason = reason;
    this.connectionId = connectionId;
  }
}

/** Server misconfiguration (missing/short encryption key, no refresher registered). Not a 4xx. */
export class ConnectionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionConfigError';
  }
}

export type OAuthFlowErrorCode = 'invalid_state' | 'exchange_failed';

/**
 * The OAuth callback could not be completed: the signed `state` did not verify
 * (`invalid_state`: tampered, expired, another user's, another provider's, or a
 * PKCE verifier that does not belong to it) or the provider's token / identity
 * endpoint refused or failed (`exchange_failed`). `code` is the only thing a
 * route may surface - the message is fixed and never carries provider text, a
 * code, a token or a secret (API Contracts 10A).
 */
export class OAuthFlowError extends Error {
  readonly code: OAuthFlowErrorCode;

  constructor(code: OAuthFlowErrorCode) {
    super(
      code === 'invalid_state'
        ? 'The connection request could not be verified. Start again.'
        : 'The provider did not complete the connection. Start again.',
    );
    this.name = 'OAuthFlowError';
    this.code = code;
  }
}

/** Caller passed input the module refuses (e.g. a provider_meta key outside the whitelist). */
export class ConnectionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionInputError';
  }
}

/**
 * Thrown by a registered refresher when the provider answers invalid_grant / 401
 * to the refresh-token exchange. The module then sets needs_reauth and throws
 * ReconnectRequiredError. Any other error a refresher throws is treated as
 * transient: it propagates, the transaction rolls back, status is unchanged.
 */
export class InvalidGrantError extends Error {
  constructor() {
    super('The provider rejected the refresh token (invalid_grant).');
    this.name = 'InvalidGrantError';
  }
}
