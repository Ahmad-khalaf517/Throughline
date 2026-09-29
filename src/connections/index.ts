// Module 18: connections (layer 3b)
// Owns: provider_connection (sole writer)
// See docs/Throughline_Module_Boundaries.md section 4.9 for this module's
// exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7). Imports layer 0 (db, lib) only; importable by
// layers 4-6 only.
//
// SCRUM-96: beginOAuth / completeOAuth for GitHub, with the GitHub provider HTTP
// (authorize, token exchange, identity, revoke) in ./oauth-github. SCRUM-97 adds
// the Jira branch (./oauth-jira: authorize, token exchange, identity, sites, and
// the registered refresh-with-rotation call). Other providers register their
// refresh / revoke HTTP calls through registerRefresher / registerRevoker.
export type { Credential } from './credential';
export {
  ConnectionRequiredError,
  ReconnectRequiredError,
  InvalidGrantError,
  ConnectionConfigError,
  ConnectionInputError,
  ConnectionStoreError,
  OAuthFlowError,
  type OAuthFlowErrorCode,
  type ReconnectReason,
} from './errors';
export { beginOAuth, completeOAuth } from './oauth';
export { sanitizeReturnTo } from './oauth-state';
export {
  registerRefresher,
  registerRevoker,
  type Refresher,
  type RefreshInput,
  type RefreshResult,
  type Revoker,
  type RevokeInput,
} from './hooks';
export {
  getCredential,
  getCredentialForOperation,
  getConnectionStatusForOperation,
  saveConnection,
  disconnect,
  listConnections,
  reportAuthFailure,
  type Provider,
  type ConnectionStatus,
  type OperationConnectionStatus,
  type SaveConnectionInput,
} from './store';
