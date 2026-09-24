import { expect } from 'vitest';
import type postgres from 'postgres';
import { asAnon } from './roles';

// Deliberately its own file, separate from ./roles: this is the only place
// under tests/integration/support/ that needs a real (value) `vitest`
// import, and tests/integration/support/global-setup.ts (which imports
// createSupabaseRoles/asAnon from ./roles for the whole `integration`
// project's one-time setup) must never transitively pull `vitest` into its
// module graph - Vitest's globalSetup runs in a separate context from the
// test-worker context where `expect`'s internal state is initialized, and
// an `expect` import reaching globalSetup crashes with "Vitest failed to
// access its internal state" before a single test can run.

// T34's core assertion, reused across every table/verb: the anon role must
// be refused with "permission denied" specifically - not some other error
// (e.g. a typo'd column) that would happen to also reject the query and
// falsely look like a pass.
export async function expectDeniedAsAnon(
  sql: postgres.Sql,
  run: (tx: postgres.TransactionSql) => Promise<unknown>,
): Promise<void> {
  await expect(asAnon(sql, run)).rejects.toThrow(/permission denied/i);
}
