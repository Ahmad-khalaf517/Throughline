// withProjectLock() - pg_advisory_xact_lock(hashtextextended(projectId,0)) then
// the caller's fn, in one transaction (ERD section 3.2).
//
// Imported from exactly one place in the codebase: src/artifact-lifecycle
// (Module Boundaries principle 3). eslint.config.mjs enforces this with
// no-restricted-imports - do not add an eslint-disable to work around it.
export {};
