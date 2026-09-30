// Pure presentation helpers for the Integrations screen, the guided connection
// steps and the target pickers (UC-S7; TR FR-087..FR-090, API Contracts 10A).
// No DB, no `fetch`, no React - same contract as `external-preview.ts`, and the
// testable surface for tests/unit/lib/connections-ui.test.ts. Nothing here ever
// sees, formats or stores a token or key: only status and identity.

import { JIRA_CREATE_PROJECT_SCOPE } from './jira-scopes';
import type { ConnectionDTO, ExternalOperationDTO } from './serialize';

export type ConnectionProvider = ConnectionDTO['provider'];
export type ConnectionStatus = ConnectionDTO['status'];

/** Mirrors API Contracts `PreviewConnectionDTO` (returned by the three preview routes). */
export interface PreviewConnection {
  status: ConnectionStatus;
  /** GitHub/Stitch: true whenever connected (GitHub's owner defaults to the account). Jira: site + project saved. */
  targetReady: boolean;
  /** The connected account's display name (its login for GitHub); null when unknown or not connected. */
  accountName: string | null;
}

export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = ['github', 'jira', 'stitch'];

export const PROVIDER_LABEL: Record<ConnectionProvider, string> = {
  github: 'GitHub',
  jira: 'Jira',
  stitch: 'Stitch',
};

/** The Integrations screen (the route keeps its `/connections` path so OAuth redirects keep working). */
export const CONNECTIONS_PATH = '/connections';

/** What each integration is for, shown on its card and step. */
export const PROVIDER_PURPOSE: Record<ConnectionProvider, string> = {
  github: 'Create the repository',
  jira: 'Export epics and stories',
  stitch: 'Generate UI prototypes',
};

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
// Guided steps at the top of each write screen (FR-089) and reconnect state (FR-090)
// ---------------------------------------------------------------------------

/** `done` = finished; `current` = what to do next; `ready` = available, not the focus; `locked` = blocked. */
export type StepStatus = 'done' | 'current' | 'ready' | 'locked';

export interface ConnectionStep {
  id: 'connect' | 'configure' | 'write';
  label: string;
  status: StepStatus;
  /** Why a `locked` step is locked (never colour-only); null otherwise. */
  lockedReason: string | null;
}

const STEP_LABELS: Record<ConnectionProvider, [string, string, string]> = {
  github: ['Connect GitHub', 'Review & name the repository', 'Create repository'],
  jira: ['Connect Jira', 'Choose site and project', 'Export backlog'],
  stitch: ['Connect Stitch', 'Review prompt', 'Generate'],
};

/**
 * The three steps of a write screen from the preview's `connection` block:
 * connect, then review/choose a target, then the write itself. Pure. An absent
 * `connection` counts as not connected (the steps are only shown once loaded).
 * `targetReady` matters for Jira only (GitHub's owner defaults to the account;
 * Stitch has no target).
 */
export function describeConnectionSteps(
  provider: ConnectionProvider,
  connection: PreviewConnection | null | undefined,
  targetReady: boolean = connection?.targetReady ?? false,
): ConnectionStep[] {
  const [connectLabel, configureLabel, writeLabel] = STEP_LABELS[provider];
  const connected = connection?.status === 'active';
  const connectFirst = `Connect ${PROVIDER_LABEL[provider]} first`;
  const needsTarget = provider === 'jira';

  const configure: ConnectionStep = !connected
    ? { id: 'configure', label: configureLabel, status: 'locked', lockedReason: connectFirst }
    : {
        id: 'configure',
        label: configureLabel,
        status: needsTarget && targetReady ? 'done' : 'current',
        lockedReason: null,
      };

  const write: ConnectionStep = !connected
    ? { id: 'write', label: writeLabel, status: 'locked', lockedReason: connectFirst }
    : needsTarget && !targetReady
      ? {
          id: 'write',
          label: writeLabel,
          status: 'locked',
          lockedReason: 'Choose a site and project first',
        }
      : {
          id: 'write',
          label: writeLabel,
          status: needsTarget ? 'current' : 'ready',
          lockedReason: null,
        };

  return [
    {
      id: 'connect',
      label: connectLabel,
      status: connected ? 'done' : 'current',
      lockedReason: null,
    },
    configure,
    write,
  ];
}

/**
 * The write button stays disabled until the connection is active (and, for Jira,
 * its target is saved). An absent block (older server, or not loaded yet) does
 * not withhold: the write route is still the authority and answers
 * `CONNECTION_REQUIRED` itself.
 */
export function isWriteWithheld(connection: PreviewConnection | null | undefined): boolean {
  if (!connection) return false;
  return connection.status !== 'active' || !connection.targetReady;
}

/**
 * A `409` from a write route (`CONNECTION_REQUIRED`, `RECONNECT_REQUIRED`,
 * `TARGET_REQUIRED`) is a fresher answer than the preview's `connection`
 * block: fold it in so the steps show the real state instead of a dead-end
 * error. Returns `null` for any other code.
 */
export function connectionAfterWriteError(
  code: string | undefined,
  current: PreviewConnection | null,
): PreviewConnection | null {
  const targetReady = current?.targetReady ?? true;
  switch (code) {
    case 'CONNECTION_REQUIRED':
      return { status: 'none', targetReady, accountName: null };
    case 'RECONNECT_REQUIRED':
      return { status: 'needs_reauth', targetReady, accountName: current?.accountName ?? null };
    case 'TARGET_REQUIRED':
      return {
        status: current?.status ?? 'active',
        targetReady: false,
        accountName: current?.accountName ?? null,
      };
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
  missing_scope: 'needs permission to create projects - reconnect',
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

// ---------------------------------------------------------------------------
// Jira site display and project creation (round 17, UC-S11, FR-092)
// ---------------------------------------------------------------------------

/** A connection made before the scope was requested lacks it and must reconnect once. */
export function canCreateJiraProjects(scopes: readonly string[] | null | undefined): boolean {
  return (scopes ?? []).includes(JIRA_CREATE_PROJECT_SCOPE);
}

/** The Integrations card's hint for a usable Jira connection. */
export function describeProjectCreationHint(scopes: readonly string[]): {
  allowed: boolean;
  text: string;
} {
  return canCreateJiraProjects(scopes)
    ? { allowed: true, text: 'Can create projects' }
    : { allowed: false, text: 'Reconnect to allow creating projects' };
}

/**
 * The connected Jira site line. The URL becomes a link only when it is an https
 * `*.atlassian.net` address (it comes from provider metadata, so it is never
 * trusted to be a safe href); anything else is shown as plain text.
 */
export function describeJiraSite(
  site: { name: string; url: string } | null | undefined,
): { name: string; url: string; href: string | null } | null {
  if (!site || (site.name === '' && site.url === '')) return null;
  return { name: site.name, url: site.url, href: safeSiteHref(site.url) };
}

export function safeSiteHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.endsWith('.atlassian.net') || parsed.hostname === '.atlassian.net') {
      return null;
    }
    if (parsed.username !== '' || parsed.password !== '') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** `<site url>/jira/projects`, or null when the site URL is not a safe Atlassian address. */
export function jiraProjectsListHref(siteUrl: string | null | undefined): string | null {
  const origin = safeSiteHref(siteUrl ?? '');
  return origin ? `${origin}/jira/projects` : null;
}

export const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** Suggests a Jira project key from a name: uppercase letters/digits, first a letter, 2-10 chars. */
export function deriveProjectKey(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Z0-9]/g, ''))
    .filter(Boolean);
  if (words.length === 0) return '';
  // Initials read best for multi-word names; the words joined is the fallback when
  // that is too short (or a single word).
  const candidates =
    words.length === 1 ? [words[0]!] : [words.map((word) => word[0]).join(''), words.join('')];
  for (const candidate of candidates) {
    const key = candidate.replace(/^[0-9]+/, '').slice(0, 10);
    if (key.length >= 2) return key;
  }
  return '';
}

/** Client-side format check of a key; `existingKeys` are the site's already-listed projects. */
export function validateProjectKeyInput(
  key: string,
  existingKeys: readonly string[],
): string | null {
  if (key === '') return 'Enter a project key.';
  if (!JIRA_KEY_PATTERN.test(key)) {
    return 'Use 2-10 uppercase letters or digits, starting with a letter.';
  }
  if (existingKeys.includes(key))
    return 'That key is already used in this Jira site - choose another';
  return null;
}

export type CreateProjectErrorKind = 'key_taken' | 'admin_required' | 'reconnect' | 'other';

/** Maps the error codes of `POST /api/connections/jira/projects` to copy the form shows. */
export function describeCreateProjectError(code: string | undefined): {
  kind: CreateProjectErrorKind;
  message: string;
} {
  switch (code) {
    case 'PROJECT_KEY_TAKEN':
      return {
        kind: 'key_taken',
        message: 'That key is already used in this Jira site - choose another',
      };
    case 'JIRA_ADMIN_REQUIRED':
      return {
        kind: 'admin_required',
        message:
          'Your Atlassian account is not a Jira administrator on this site. Ask an admin, or create the project in Jira and refresh',
      };
    case 'RECONNECT_REQUIRED':
    case 'CONNECTION_REQUIRED':
      return {
        kind: 'reconnect',
        message: 'Reconnect Jira to allow creating projects',
      };
    case 'TARGET_NOT_ACCESSIBLE':
      return {
        kind: 'other',
        message: 'That Jira site is not available to your connected account.',
      };
    default:
      return { kind: 'other', message: 'Could not create the project. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// The Integrations link in the header (status hint, computed server-side)
// ---------------------------------------------------------------------------

export interface IntegrationsSummary {
  connected: number;
  total: number;
  needsReconnect: number;
  /** True when something is not fully connected: the header shows a dot for it. */
  attention: boolean;
  /** Screen-reader text for the dot (the dot itself is never the only cue). */
  hint: string;
}

/** Only status strings go in; nothing else about a connection reaches the header. */
export function summarizeIntegrations(statuses: readonly ConnectionStatus[]): IntegrationsSummary {
  const total = CONNECTION_PROVIDERS.length;
  const connected = statuses.filter((status) => status === 'active').length;
  const needsReconnect = statuses.filter(
    (status) => status === 'needs_reauth' || status === 'revoked',
  ).length;
  const hint =
    needsReconnect > 0
      ? `${needsReconnect} ${needsReconnect === 1 ? 'integration needs' : 'integrations need'} reconnecting`
      : `${connected} of ${total} connected`;
  return {
    connected,
    total,
    needsReconnect,
    attention: needsReconnect > 0 || connected < total,
    hint,
  };
}
