// Module 18: connections (layer 3b)
// Owns: provider_connection (sole writer)
// See docs/Throughline_Module_Boundaries.md section 4.9 for this module's
// exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7). Imports layer 0 (db, lib) only; importable by
// layers 4-6 only.
//
// SCRUM-96/97: beginOAuth / completeOAuth and the provider token-endpoint
// adapters are NOT here yet. The providers register their refresh / revoke
// HTTP calls through registerRefresher / registerRevoker.
export type { Credential } from './credential';
export {
  ConnectionRequiredError,
  ReconnectRequiredError,
  InvalidGrantError,
  ConnectionConfigError,
  ConnectionInputError,
  type ReconnectReason,
} from './errors';
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
