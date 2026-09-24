import type postgres from 'postgres';
import type { QueryExecutor } from './types';

// T34 / ERD Appendix A.3 / Appendix C "How it was run" (docs/Throughline_ERD.md
// ~line 1647). A vanilla postgres:15-alpine container has neither Supabase's
// anon/authenticated roles nor its default privileges, so both are
// reproduced here before the frozen migrations run:
//
//  1. anon/authenticated as NOLOGIN roles - nothing ever connects AS them
//     directly in real Supabase either; PostgREST/the Data API (and, here,
//     this test suite) reach them via SET ROLE.
//  2. `ALTER DEFAULT PRIVILEGES` so every table/function the migrations
//     create from this point on is auto-granted to anon/authenticated, the
//     same way Supabase auto-grants newly created public-schema objects.
//     Without this, 0001/0006's REVOKE statements would be revoking
//     privileges nothing ever held on this container, and the SELECT/
//     INSERT/UPDATE/DELETE-denied half of T34 would pass for the wrong
//     reason (anon never had access, REVOKE or not) rather than proving the
//     migrations' hardening does anything. The accidental-grant half of T34
//     (RLS-with-no-policies) doesn't depend on this either way.
export async function createSupabaseRoles(sql: QueryExecutor): Promise<void> {
  await sql.unsafe(
    `DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  );
  await sql.unsafe(
    `DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  );
  // Postgres 15 no longer grants USAGE/CREATE on `public` to PUBLIC by
  // default (Project Setup section 10 step 9's own note) - Supabase grants
  // its anon/authenticated roles USAGE explicitly, so we do too.
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO anon, authenticated;`);
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;`,
  );
  await sql.unsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;`,
  );
}

// Runs `fn` with the session's role switched to `anon` for the lifetime of
// one transaction only (`SET LOCAL ROLE`, not `SET ROLE` - it reverts
// automatically at COMMIT or ROLLBACK, so a failed assertion can never leak
// `anon` into a later test). The container connects as a superuser, and a
// superuser may `SET ROLE` to any role without being a member of it and, in
// doing so, loses its superuser/BYPASSRLS privileges for the duration
// (PostgreSQL `SET ROLE` docs) - which is exactly what lets one connection
// stand in for both "the app, as owner" (T14/T27/T28) and "the Supabase
// Data API, as anon" (T34) per Appendix C's own methodology.
export function asAnon<T>(sql: postgres.Sql, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx.unsafe('SET LOCAL ROLE anon');
    return fn(tx);
  });
}
