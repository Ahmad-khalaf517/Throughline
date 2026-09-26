// artifact-lifecycle: typed errors the API layer maps to HTTP statuses (Jira
// E3-S10 / SCRUM-45). Kept in their own file because two transition files
// (approval.ts, rejection.ts) throw the same one.
//
// Nothing outside src/artifact-lifecycle may import this file directly - it
// is re-exported through ./index.ts (Module Boundaries section 7).

/**
 * The version a transition targeted exists but is not a `draft` (approved,
 * superseded or rejected already) - thrown by `approveVersion` /
 * `approveWithOverride` (approval.ts) and `requestRevision` / `rejectVersion`
 * (rejection.ts) from inside the project lock, where the status is re-read.
 * Routes map it to 409 VERSION_NOT_DRAFT instead of letting it surface as a
 * 500.
 *
 * The message is exactly what those two files threw as a plain `Error` before
 * this class existed (existing tests match on it); only the type is new.
 */
export class VersionNotDraftError extends Error {
  constructor(readonly versionId: string) {
    super(`artifact_version ${versionId} is not a draft`);
    this.name = 'VersionNotDraftError';
  }
}
