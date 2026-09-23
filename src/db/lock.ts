import { sql } from 'drizzle-orm';
import { db } from './client';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// withProjectLock() - pg_advisory_xact_lock(hashtextextended(projectId,0))
// then the caller's fn, in one transaction (ERD section 3.2).
//
// Imported from exactly one place in the codebase: src/artifact-lifecycle
// (Module Boundaries principle 3). eslint.config.mjs enforces this with
// no-restricted-imports - do not add an eslint-disable to work around it.
export async function withProjectLock<T>(
  projectId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
    return fn(tx);
  });
}

// Plain transaction, no lock - for read-only or single-table writes (e.g.
// module 2's upsertAppUser).
export async function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
