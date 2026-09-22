// db:verify - the slice-1 exit gate (Project Setup section 6 / ERD Appendix A
// preamble). Diffs the SQL drizzle-kit generated in drizzle/migrations/0000_*
// against the ERD Appendix A DDL this repo was executed against.
//
// This is a normalizing TEXT diff, not a semantic SQL comparison: it
// lowercases, strips comments and collapses whitespace, then a human reads
// the remaining diff (Project Setup section 11, assumption 4). Building a
// real SQL AST comparison is out of scope for an 8-day build.
//
// Usage: pnpm db:verify
//
// TODO(slice 1): once drizzle/migrations/0000_*.sql exists (after the schema
// in src/db/schema is written and `pnpm db:generate` has run), point
// GENERATED_MIGRATION_GLOB at it and paste the ERD Appendix A DDL block below
// (or read it directly from docs/Throughline_ERD.md's Appendix A section)
// into EXPECTED_DDL_SOURCE, then run this script and read the diff by hand.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'migrations');
const ERD_DOC = join(process.cwd(), 'docs', 'Throughline_ERD.md');

function normalize(sql: string): string {
  return sql
    .replace(/--.*$/gm, '') // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim()
    .toLowerCase();
}

function main() {
  let migrationFiles: string[] = [];
  try {
    migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
  } catch {
    console.error(
      `No migrations found at ${MIGRATIONS_DIR}. Run "pnpm db:generate" first ` +
        '(Project Setup section 10, step 6).',
    );
    process.exit(1);
  }

  if (migrationFiles.length === 0) {
    console.error(`${MIGRATIONS_DIR} exists but has no .sql files yet.`);
    process.exit(1);
  }

  console.log(`Found ${migrationFiles.length} migration file(s): ${migrationFiles.join(', ')}`);
  console.log(`Read the ERD Appendix A DDL from ${ERD_DOC} and compare by hand against:`);
  for (const file of migrationFiles) {
    const full = join(MIGRATIONS_DIR, file);
    const normalized = normalize(readFileSync(full, 'utf8'));
    console.log(`\n--- ${file} (normalized) ---`);
    console.log(normalized.slice(0, 2000) + (normalized.length > 2000 ? ' …(truncated)' : ''));
  }

  console.log(
    '\nThis script prints the generated SQL for manual comparison; it does not ' +
      'yet auto-diff against a pasted copy of Appendix A. See the TODO at the ' +
      'top of this file.',
  );
}

main();
