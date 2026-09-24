import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { QueryExecutor } from './types';

// The complete, frozen Appendix A schema (16 tables), Appendix A.2 triggers,
// impact() (ERD section 6.3) and Appendix A.3 hardening - drizzle/migrations/
// 0000_app_user.sql through 0007_pin_function_search_path.sql. Applied here
// in the same numeric order Project Setup section 10 step 8 applies them in
// everywhere else (Supabase project, container). Never edit these files from
// a test - they are frozen (E1-S4).
const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');

export async function applyMigrations(sql: QueryExecutor): Promise<void> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No .sql files found under ${MIGRATIONS_DIR} - the integration suite has nothing to run against.`,
    );
  }

  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // No parameters -> postgres-js sends this over the simple query protocol
    // (its `unsafe()` default), which is what lets one call execute a whole
    // file's worth of semicolon-separated statements - including the
    // dollar-quoted plpgsql function bodies in 0004/0005 - in one round trip.
    await sql.unsafe(text);
  }
}
