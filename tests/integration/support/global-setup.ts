import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { applyMigrations } from './migrate';
import { createSupabaseRoles } from './roles';
import './types'; // side-effect: augments vitest's ProvidedContext with pgConnectionUri

// ONE Testcontainers Postgres for the whole `integration` vitest project
// (Project Setup section 5.4 / this ticket's brief), not one per test file:
// started once here, migrated once here, and handed to every *.test.ts file
// via Vitest's globalSetup `provide`/`inject` context (tests/integration/
// support/types.ts). Image pinned to postgres:15-alpine - the same one ERD
// Appendix A/Appendix C were verified against (ERD section 14 / Project
// Setup D-3).
const IMAGE = 'postgres:15-alpine';

// Testcontainers' own container.start() can hang rather than fail cleanly
// when Docker isn't reachable at all (as opposed to reachable-but-slow) - a
// bare 90s wrapper turns that into a clear, actionable message instead of a
// silent hang that looks like a stuck test run.
const DOCKER_STARTUP_TIMEOUT_MS = 90_000;

async function withStartupTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out after ${DOCKER_STARTUP_TIMEOUT_MS}ms waiting for the ${IMAGE} Testcontainers ` +
            'container to start. Is the Docker daemon installed, running, and reachable from this ' +
            'shell (e.g. `docker ps` succeeds)? The integration suite (tests/integration/**) cannot ' +
            'run without it.',
        ),
      );
    }, DOCKER_STARTUP_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    container = await withStartupTimeout(new PostgreSqlContainer(IMAGE).start());
  } catch (err) {
    throw new Error(
      `Failed to start the ${IMAGE} Testcontainers container for tests/integration/**. ` +
        'Docker must be installed and running (Project Setup section 11 assumption 5). ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const connectionUri = container.getConnectionUri();

  // A short-lived setup connection - the container's default user (a real
  // Postgres superuser; the official postgres image bootstraps POSTGRES_USER
  // as the initdb superuser). Every *.test.ts file opens its own connection
  // from the injected `pgConnectionUri` instead of reusing this one.
  const setupSql = postgres(connectionUri, { prepare: false });
  try {
    // Order matters (Appendix C "How it was run"): roles + default
    // privileges before any migration runs, so 0001/0006's REVOKE
    // statements have real Supabase-shaped grants to revoke.
    await createSupabaseRoles(setupSql);
    await applyMigrations(setupSql);
  } finally {
    await setupSql.end({ timeout: 5 });
  }

  project.provide('pgConnectionUri', connectionUri);

  return async () => {
    await container?.stop();
  };
}
