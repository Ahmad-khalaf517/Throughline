import type { ConnectionProvider } from './errors';

// Provider-facing hooks, registered by the layer-5 provider modules (or, for
// the OAuth flows, SCRUM-96/97). This module deliberately contains no provider
// HTTP: it owns the row lock, the re-read and the persistence around a refresh
// or a revocation, and calls whatever is registered here for the network part.

export type RefreshInput = {
  refreshToken: string;
  accountId: string;
  meta: Readonly<Record<string, string>>;
  /** Hard timeout for the one bounded token-endpoint call made under the row lock (ERD 7.6). */
  signal: AbortSignal;
};

export type RefreshResult = {
  accessToken: string;
  /** The rotated refresh token. Omit only if the provider did not rotate it. */
  refreshToken?: string | null;
  expiresAt?: Date | null;
};

/** Throw `InvalidGrantError` for invalid_grant / 401; any other throw is treated as transient. */
export type Refresher = (input: RefreshInput) => Promise<RefreshResult>;

export type RevokeInput = {
  accessToken: string;
  refreshToken: string | null;
  accountId: string;
  meta: Readonly<Record<string, string>>;
};

/** Resolves true when the provider confirmed revocation, false when it did not. */
export type Revoker = (input: RevokeInput) => Promise<boolean>;

const refreshers = new Map<ConnectionProvider, Refresher>();
const revokers = new Map<ConnectionProvider, Revoker>();

export function registerRefresher(provider: ConnectionProvider, fn: Refresher): void {
  refreshers.set(provider, fn);
}

export function registerRevoker(provider: ConnectionProvider, fn: Revoker): void {
  revokers.set(provider, fn);
}

export function getRefresher(provider: ConnectionProvider): Refresher | undefined {
  return refreshers.get(provider);
}

export function getRevoker(provider: ConnectionProvider): Revoker | undefined {
  return revokers.get(provider);
}
