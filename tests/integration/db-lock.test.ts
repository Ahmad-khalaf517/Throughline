import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { sql as drizzleSql } from 'drizzle-orm';
import type postgres from 'postgres';
import { connect } from './support/connection';

// db.withProjectLock's lock key against a real Postgres (ERD 3.2, Module
// Boundaries section 6). The unit test (tests/unit/db/lock.test.ts) proves which
// text is bound as the key; this proves what Postgres does with it: every
// spelling of one project uuid must contend for ONE advisory lock, because
// `requireProjectOwner` accepts an uppercase uuid and a route handed one passes
// it through, while approval / acknowledgement pass the lowercase id Postgres
// returned. Keyed by the exact text before the fix, those two never queued
// behind each other. No project row is needed - the lock is just a key.
//
// Same setup as identity-matching.test.ts: the `@/db` import reads env eagerly,
// so it is dynamic and comes after the env is pointed at the Testcontainers db.

type DbModule = typeof import('@/db');

let sql: postgres.Sql;
let dbModule: DbModule;

beforeAll(async () => {
  sql = connect();
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  dbModule = await import('@/db');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// Fixed uuids (each with hex letters, so the uppercase spelling really differs),
// one per test, so no two tests - or files - ever contend for the same key.
const LOWER_FIRST = 'abcdef01-1111-4111-8111-abcdefabcde1';
const UPPER_FIRST = 'abcdef02-2222-4222-8222-abcdefabcde2';
const TWO_PROJECTS_A = 'abcdef03-3333-4333-8333-abcdefabcde3';
const TWO_PROJECTS_B = 'abcdef04-4444-4444-8444-abcdefabcde4';

// Holds the project lock, under the given spelling, until `release()`.
async function holdProjectLock(projectId: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let onLocked!: (pid: number) => void;
  const locked = new Promise<number>((resolve) => {
    onLocked = resolve;
  });
  const done = dbModule.withProjectLock(projectId, async (tx) => {
    const rows = await tx.execute<{ pid: number }>(drizzleSql`select pg_backend_pid() as pid`);
    onLocked(rows[0]!.pid);
    await gate;
  });
  return { pid: await locked, release, done };
}

// Polls pg_locks until some advisory lock the holder has been granted has a
// waiter queued behind it - the same probe artifact-lifecycle-approval.test.ts
// uses. Throws on timeout, which is what a lock that did NOT contend looks like.
async function waitForQueuedLock(holderPid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await sql<{ waiting: number }[]>`
      select count(*)::int as waiting
      from pg_locks held
      join pg_locks queued
        on queued.locktype = held.locktype
       and queued.database is not distinct from held.database
       and queued.classid is not distinct from held.classid
       and queued.objid is not distinct from held.objid
       and queued.objsubid is not distinct from held.objsubid
      where held.pid = ${holderPid}
        and held.locktype = 'advisory'
        and held.granted
        and not queued.granted
    `;
    if (row!.waiting >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for a second withProjectLock to queue behind the holder');
}

// Starts a second lock taker under `waiterSpelling` while `holderSpelling` holds
// the lock, and proves it queues (its fn has not run) until the holder lets go.
async function expectSpellingsSerialize(holderSpelling: string, waiterSpelling: string) {
  const holder = await holdProjectLock(holderSpelling);
  let waiterRan = false;
  const waiter = dbModule.withProjectLock(waiterSpelling, async () => {
    waiterRan = true;
  });
  try {
    await waitForQueuedLock(holder.pid);
    expect(waiterRan).toBe(false);
  } finally {
    holder.release();
  }
  await Promise.all([holder.done, waiter]);
  expect(waiterRan).toBe(true);
}

describe('withProjectLock spellings of one project id (Module Boundaries section 6)', () => {
  it('an UPPERCASE spelling queues behind a lowercase holder', async () => {
    expect(LOWER_FIRST.toUpperCase()).not.toBe(LOWER_FIRST);

    await expectSpellingsSerialize(LOWER_FIRST, LOWER_FIRST.toUpperCase());
  });

  it('a lowercase spelling queues behind an UPPERCASE holder', async () => {
    expect(UPPER_FIRST.toUpperCase()).not.toBe(UPPER_FIRST);

    await expectSpellingsSerialize(UPPER_FIRST.toUpperCase(), UPPER_FIRST);
  });

  it('two DIFFERENT projects still do not block each other', async () => {
    const holder = await holdProjectLock(TWO_PROJECTS_A);
    try {
      // Would hang (and time the test out) if the key were coarser than the project.
      await expect(
        dbModule.withProjectLock(TWO_PROJECTS_B.toUpperCase(), async () => 'ran'),
      ).resolves.toBe('ran');
    } finally {
      holder.release();
    }
    await holder.done;
  });
});
