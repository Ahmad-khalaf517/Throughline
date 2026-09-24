import type postgres from 'postgres';

// A structurally-typed stand-in for postgres-js's own (mapped-type)
// `JSONValue`, so fixture helpers can accept a plain object/array literal
// for a jsonb column and pass it straight to `sql.json()` without TS
// rejecting the call (a bare `object` isn't assignable to a mapped type).
export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

// A plain connection (`postgres(...)`) and a transaction/session handed to a
// `sql.begin()` callback both satisfy this - every support helper below only
// ever runs queries, never opens a nested transaction or closes the
// connection, so it never needs the extra members `Sql` and `TransactionSql`
// don't share (`begin`/`end` vs `savepoint`/`prepare`).
export type QueryExecutor = postgres.Sql | postgres.TransactionSql;

// Vitest's cross-process handoff from the integration project's globalSetup
// (one Testcontainers Postgres for the whole suite, Project Setup section
// 10 step 9 / section 5.4) to every `*.test.ts` file, via `provide`/`inject`.
declare module 'vitest' {
  interface ProvidedContext {
    pgConnectionUri: string;
  }
}
