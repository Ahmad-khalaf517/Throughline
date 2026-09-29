// Pure presentation helpers for the Connections screen, the connect-to-continue
// prompt and the target pickers (UC-S7; TR FR-087..FR-090, API Contracts 10A).
// No DB, no `fetch`, no React - same contract as `external-preview.ts`, and the
// testable surface for tests/unit/lib/connections-ui.test.ts. Nothing here ever
// sees, formats or stores a token or key: only status and identity.

import type { ConnectionDTO, ExternalOperationDTO } from './serialize';

export type ConnectionProvider = ConnectionDTO['provider'];
export type ConnectionStatus = ConnectionDTO['status'];

/** Mirrors API Contracts `PreviewConnectionDTO` (returned by the three preview routes). */
export interface PreviewConnection {
  status: ConnectionStatus;
  targetReady: boolean;
}

export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = ['github', 'jira', 'stitch'];

export const PROVIDER_LABEL: Record<ConnectionProvider, string> = {
  github: 'GitHub',
  jira: 'Jira',
  stitch: 'Stitch',
};

/** Where the user is sent to connect a provider (the Connections screen). */
export const CONNECTIONS_PATH = '/connections';

/**
 * A `returnTo` is only ever a same-site relative path (the server ignores
 * anything else too - `connections.sanitizeReturnTo`). Refused here as well so a
 * link is never built from a value that could point off-site.
 */
export function isSafeReturnTo(path: string | null | undefined): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('\\') &&
    !/[\u0000-\u001f]/.test(path)
  );
}

/** `/api/connections/<provider>/start?returnTo=...` - browser navigation, not a `fetch`. */
export function connectStartHref(provider: 'github' | 'jira', returnTo?: string | null): string {
  const base = `/api/connections/${provider}/start`;
  return isSafeReturnTo(returnTo) ? `${base}?returnTo=${encodeURIComponent(returnTo)}` : base;
}

export type ConnectionTone = 'connected' | 'attention' | 'none';

export interface ConnectionStatusCopy {
  tone: ConnectionTone;
  label: string;
  /** Identity line for a usable connection, or an explanation for a lapsed one. */
  detail: string | null;
}

export function describeConnectionStatus(connection: ConnectionDTO): ConnectionStatusCopy {
  switch (connection.status) {
    case 'active':
      return {
        tone: 'connected',
        label: connection.displayName ? `Connected as ${connection.displayName}` : 'Connected',
        detail: null,
      };
    case 'needs_reauth':
    case 'revoked':
      return {
        tone: 'attention',
        label: 'Needs reconnect',
        detail: connection.displayName
          ? `${PROVIDER_LABEL[connection.provider]} access for ${connection.displayName} has lapsed. Reconnect to keep writing to it - nothing you have planned is affected.`
          : `${PROVIDER_LABEL[connection.provider]} access has lapsed. Reconnect to keep writing to it - nothing you have planned is affected.`,
      };
    case 'none':
      return { tone: 'none', label: 'Not connected', detail: null };
  }
}

export type ConnectionAction = 'connect' | 'reconnect' | 'disconnect';

/** Which buttons a provider card offers for a given status. */
export function availableActions(status: ConnectionStatus): ConnectionAction[] {
  switch (status) {
    case 'active':
      return ['disconnect'];
    case 'needs_reauth':
    case 'revoked':
      return ['reconnect', 'disconnect'];
    case 'none':
      return ['connect'];
  }
}

/** What `DELETE /api/connections/:provider` reports back (API Contracts 10A). */
export function describeDisconnectResult(
  provider: ConnectionProvider,
  providerRevoked: boolean | null,
): string {
  const label = PROVIDER_LABEL[provider];
  if (providerRevoked === true) {
    return `Disconnected. Access revoked at ${label}.`;
  }
  if (providerRevoked === false) {
    return `Disconnected here, but ${label} did not confirm the revocation. You may want to remove Throughline's access in your ${label} account settings.`;
  }
  return `Disconnected. ${label} offers no way to revoke access from here - remove the key in your ${label} account if you want it gone.`;
}

export interface ConnectionsBanner {
  kind: 'success' | 'error';
  message: string;
}

const ERROR_BANNER_COPY: Record<string, string> = {
  invalid_state: 'That connection attempt expired or could not be verified. Please try again.',
  access_denied: 'Access was not granted, so nothing was connected.',
  exchange_failed: 'The provider did not complete the connection. Please try again.',
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `?connected=<provider>` / `?error=<code>` from the OAuth callbacks. Only
 * allowlisted values produce a banner and the message is looked up, never
 * built from the query text - so nothing user-controlled is ever rendered.
 */
export function readConnectionsBanner(query: {
  connected?: string | string[] | undefined;
  error?: string | string[] | undefined;
}): ConnectionsBanner | null {
  const error = firstValue(query.error);
  if (error !== undefined && Object.hasOwn(ERROR_BANNER_COPY, error)) {
    return { kind: 'error', message: ERROR_BANNER_COPY[error]! };
  }
  const connected = firstValue(query.connected);
  if (connected === 'github' || connected === 'jira' || connected === 'stitch') {
    return { kind: 'success', message: `${PROVIDER_LABEL[connected]} connected.` };
  }
  return null;
}

/** `PROVIDER_KEY_REJECTED` -> its fixed copy; any other failure -> a generic one (never the raw body). */
export function describeStitchConnectError(code: string | undefined): string {
  if (code === 'PROVIDER_KEY_REJECTED') return 'That key was rejected';
  if (code === 'VALIDATION_ERROR') return 'Enter a Stitch API key.';
  return 'Could not save the key. Please try again.';
}

// ---------------------------------------------------------------------------
// Connect-to-continue prompt (FR-089) and reconnect-required state (FR-090)
// ---------------------------------------------------------------------------

export type PromptKind = 'connect' | 'reconnect' | 'target';

export interface ConnectionPromptCopy {
  kind: PromptKind;
  message: string;
  /** Link label; the link always goes to the Connections screen or the picker. */
  actionLabel: string | null;
}

/**
 * The prompt shown in place of the write action, or `null` when the write is
 * available. Reads only the preview's `connection` block. An absent block
 * (older server, or the field not loaded yet) shows no prompt: the write route
 * is still the authority and answers `CONNECTION_REQUIRED` itself.
 */
export function describeConnectionPrompt(
  provider: ConnectionProvider,
  connection: PreviewConnection | null | undefined,
): ConnectionPromptCopy | null {
  if (!connection) return null;
  const label = PROVIDER_LABEL[provider];
  if (connection.status === 'none') {
    return {
      kind: 'connect',
      message: `Connect your ${label} account to continue. The preview below is still yours to read.`,
      actionLabel: `Connect ${label}`,
    };
  }
  if (connection.status === 'needs_reauth' || connection.status === 'revoked') {
    return {
      kind: 'reconnect',
      message: `Your ${label} connection needs to be reconnected before anything can be written. Your planning work is unaffected.`,
      actionLabel: `Reconnect ${label}`,
    };
  }
  if (!connection.targetReady && provider !== 'stitch') {
    return {
      kind: 'target',
      message:
        provider === 'github'
          ? 'Choose the GitHub owner the repository is created under to continue.'
          : 'Choose the Jira site and project to export to in order to continue.',
      actionLabel: null,
    };
  }
  return null;
}

/** The write button stays disabled exactly while a prompt is showing. */
export function isWriteWithheld(
  provider: ConnectionProvider,
  connection: PreviewConnection | null | undefined,
): boolean {
  return describeConnectionPrompt(provider, connection) !== null;
}

/**
 * A `409` from a write route (`CONNECTION_REQUIRED`, `RECONNECT_REQUIRED`,
 * `TARGET_REQUIRED`) is a fresher answer than the preview's `connection`
 * block: fold it in so the prompt appears instead of a dead-end error.
 * Returns `null` for any other code.
 */
export function connectionAfterWriteError(
  code: string | undefined,
  current: PreviewConnection | null,
): PreviewConnection | null {
  const targetReady = current?.targetReady ?? true;
  switch (code) {
    case 'CONNECTION_REQUIRED':
      return { status: 'none', targetReady };
    case 'RECONNECT_REQUIRED':
      return { status: 'needs_reauth', targetReady };
    case 'TARGET_REQUIRED':
      return { status: current?.status ?? 'active', targetReady: false };
    default:
      return null;
  }
}

type NeedsReconnect = ExternalOperationDTO['needsReconnect'];

const RECONNECT_REASON_COPY: Record<NonNullable<NeedsReconnect>['reason'], string> = {
  needs_reauth: 'the connection needs to be re-authorized',
  revoked: 'the connection was revoked',
  different_account: 'a different account is connected than the one used for this',
  legacy_credential_missing: 'legacy credential missing',
};

/**
 * FR-090 badge copy for an operation whose recorded connection cannot be used.
 * Deliberately neutral wording: this is not a failure and not a lineage warning.
 */
export function describeNeedsReconnect(needsReconnect: NeedsReconnect | undefined): {
  label: string;
  reason: string;
  provider: ConnectionProvider;
} | null {
  if (!needsReconnect) return null;
  return {
    label: 'Reconnect required',
    reason: RECONNECT_REASON_COPY[needsReconnect.reason],
    provider: needsReconnect.provider,
  };
}

// ---------------------------------------------------------------------------
// Target pickers (FR-088)
// ---------------------------------------------------------------------------

export type TargetErrorKind = 'required' | 'locked' | 'not_accessible' | 'connection' | 'other';

export interface TargetErrorCopy {
  kind: TargetErrorKind;
  message: string;
}

/** Maps the error codes of `PATCH .../targets` and the picker list routes. */
export function describeTargetError(code: string | undefined): TargetErrorCopy {
  switch (code) {
    case 'TARGET_REQUIRED':
      return { kind: 'required', message: 'Pick a target to continue.' };
    case 'TARGET_LOCKED':
      return {
        kind: 'locked',
        message:
          'The GitHub owner cannot change because a repository export already exists for this project.',
      };
    case 'TARGET_NOT_ACCESSIBLE':
      return {
        kind: 'not_accessible',
        message: 'That choice is not available to your connected account. Pick another.',
      };
    case 'CONNECTION_REQUIRED':
    case 'RECONNECT_REQUIRED':
      return { kind: 'connection', message: 'Connect this account to choose a target.' };
    default:
      return { kind: 'other', message: 'Could not save the target. Please try again.' };
  }
}

/** Picker choices never carry text other than the provider's own owner/site/project names. */
export function ownerOptionLabel(owner: { login: string; kind: 'user' | 'org' }): string {
  return owner.kind === 'org' ? `${owner.login} (organization)` : `${owner.login} (you)`;
}
