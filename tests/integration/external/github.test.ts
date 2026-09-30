import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type postgres from 'postgres';
import { connect } from '../support/connection';
import * as fx from '../support/fixtures';

// `github`'s real previewInit/initRepo/checkDrift (E4-S2 / SCRUM-51, Module
// Boundaries 4.6, ERD 7.3, TR FR-030..036) - proves ERD Appendix C's T11,
// T13, T17, T18 (the ids docs/Throughline_Jira_Plan.md's E4-S2 row cites)
// against real Testcontainers Postgres, real triggers/CHECKs, and a real
// (unmodified) Octokit client whose network call is swapped for an
// in-process fake GitHub - the exact technique
// scripts/spike-github-reconciliation.mts already proved out (real
// octokit request-building/response-parsing/error-throwing code runs; only
// `fetch` itself is faked), adapted here rather than re-derived. No
// GITHUB_TOKEN is configured anywhere in this environment, matching the
// spike's own "mock mode".
//
// Round 14 (SCRUM-96): every call below runs as a project owner who has a
// GitHub connection (saved through the real `connections.saveConnection`, so
// the token is encrypted at rest and decrypted by the real `getCredential`);
// the repository goes under the ctx's `githubOwner`. The fake GitHub still
// ignores auth headers except where a test asserts on them. The legacy
// (env GITHUB_TOKEN) path has its own cases at the end.
//
// `checkDrift` never calls the network at all (a pure DB read through
// `external-operations.getRefById` + `impact.getExternalDrift`) - T13/T17
// below build their `external_ref` rows directly via `fx.*` fixtures (the
// same convention tests/integration/appendix-c.test.ts's own T1/T1c already
// use for GitHub/Jira-shaped refs) and never touch `globalThis.fetch`.
// T11/T18 exercise `initRepo` end to end, so they do.
//
// Same dynamic-import-after-env-setup gotcha as every other file in this
// directory: `@/external/github` pulls in `@/lib/env` at MODULE-IMPORT
// time, so every env var it (transitively) reads must be in `process.env`
// BEFORE the first `await import('@/external/github')`.

let sql: postgres.Sql;
let github: typeof import('@/external/github');
let connections: typeof import('@/connections');

const FAKE_OWNER = 'thrln-test-owner';
// A fixed, non-random test secret (unlike the spike's own ephemeral
// per-run secret) - this file's own T11 scenarios reconcile ACROSS two
// separate `github.initRepo` calls that must compute the IDENTICAL marker
// both times, which a fresh-per-call random secret would break.
const TEST_MARKER_SECRET = 'github-test-fixture-marker-secret-do-not-use-in-prod';

beforeAll(async () => {
  sql = connect();
  const connectionUri = inject('pgConnectionUri');
  process.env.DATABASE_URL = connectionUri;
  process.env.DIRECT_DATABASE_URL = connectionUri;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.GITHUB_OWNER = FAKE_OWNER;
  process.env.GITHUB_MARKER_SECRET = TEST_MARKER_SECRET;
  // GITHUB_TOKEN deliberately left unset - `new Octokit({ auth: undefined })`
  // is a valid unauthenticated client, and the fake GitHub below never
  // checks auth headers, matching the spike's own mock mode.

  // 32 bytes, base64 - read by the connections module at call time.
  process.env.CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  github = await import('@/external/github');
  connections = await import('@/connections');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// Round 14: the acting user's own connection + ctx.
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'gho_thrln_test_user_token';

/** The user's GitHub connection: account id `gh-<userId>`, login = the fake GitHub's owner. */
async function ensureConnection(userId: string, externalAccountId = `gh-${userId}`) {
  await connections.saveConnection({
    userId,
    provider: 'github',
    externalAccountId,
    displayName: FAKE_OWNER,
    accessToken: TEST_TOKEN,
    scopes: ['repo', 'read:org'],
    providerMeta: { login: FAKE_OWNER },
  });
}

/** ctx for the owner of the project an architecture version belongs to (a connection is ensured). */
async function ctxForVersion(architectureVersionId: string) {
  const [row] = await sql<{ owner_user_id: string }[]>`
    SELECT p.owner_user_id
    FROM artifact_version av
    JOIN artifact a ON a.id = av.artifact_id
    JOIN project p ON p.id = a.project_id
    WHERE av.id = ${architectureVersionId}
  `;
  await ensureConnection(row!.owner_user_id);
  return { userId: row!.owner_user_id, githubOwner: FAKE_OWNER };
}

const initRepo = async (
  architectureVersionId: string,
  repoName: string,
  visibility?: 'public' | 'private',
) =>
  github.initRepo(
    architectureVersionId,
    repoName,
    await ctxForVersion(architectureVersionId),
    visibility,
  );

const previewInit = async (architectureVersionId: string, projectName?: string) =>
  github.previewInit(
    architectureVersionId,
    projectName,
    await ctxForVersion(architectureVersionId),
  );

/** A throwaway user with a connection - `checkRepoName` needs a ctx but no project. */
const checkRepoName = async (repoName: string) => {
  const { userId } = await fx.createProjectWithOwner(sql, { name: 'github name lookup' });
  await ensureConnection(userId);
  return github.checkRepoName(repoName, { userId, githubOwner: FAKE_OWNER });
};

// ---------------------------------------------------------------------------
// Fixture composition shared by every scenario below.
// ---------------------------------------------------------------------------

/**
 * A draft -> approved Architecture artifact_version with the given ADR
 * memberships, always with 2 architecture_option rows (the DB guard
 * requires exactly 2 to approve) and option A selected. Supersedes whatever
 * was previously approved for this artifact first (one_approved_version).
 * Mirrors tests/integration/appendix-c.test.ts's own `approveItemsVersion`
 * helper (not imported - that file exports nothing, per this suite's own
 * "every file builds its own fixture composition" convention).
 */
async function approveArchitectureVersion(
  artifactId: string,
  versionNumber: number,
  adrs: { logicalItemId: string; itemVersionId: string }[],
  optionA: Omit<
    Parameters<typeof fx.createArchitectureOption>[1],
    'artifactVersionId' | 'optionKey'
  > = {},
): Promise<string> {
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber });
  for (const adr of adrs) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId: adr.logicalItemId,
      itemVersionId: adr.itemVersionId,
    });
  }
  const optionAId = await fx.createArchitectureOption(sql, {
    ...optionA,
    artifactVersionId: versionId,
    optionKey: 'A',
  });
  await fx.createArchitectureOption(sql, { artifactVersionId: versionId, optionKey: 'B' });
  const [current] = await sql<{ id: string }[]>`
    SELECT id FROM artifact_version WHERE artifact_id = ${artifactId} AND status = 'approved'
  `;
  if (current)
    await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${current.id}`;
  await fx.approveArtifactVersion(sql, versionId, { selectedArchitectureOptionId: optionAId });
  return versionId;
}

async function githubOperationRows(projectId: string) {
  return sql<{ operation_key: string; status: string; error_message: string | null }[]>`
    SELECT operation_key, status, error_message FROM external_operation
    WHERE project_id = ${projectId} AND provider = 'github'
    ORDER BY created_at
  `;
}

async function githubRefRows(projectId: string) {
  return sql<{ id: string }[]>`
    SELECT id FROM external_ref WHERE project_id = ${projectId} AND provider = 'github'
  `;
}

// ---------------------------------------------------------------------------
// Fake GitHub - an in-memory `Map<owner/repo, repo>` plus a `fetch`
// implementation that only fakes the network call (real octokit
// request-building/response-parsing/error-throwing still runs on top of
// it), adapted from scripts/spike-github-reconciliation.mts. Extended here
// (beyond the spike's own two routes) with the contents-write route
// `initRepo`'s README/ADR/lineage.json step actually calls.
// ---------------------------------------------------------------------------

interface FakeRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
}

// Module-level (NOT per-`createFakeGitHub()` call) so ids stay unique
// across the WHOLE file, not just within one fake GitHub instance - every
// test case below calls `createFakeGitHub()` fresh, and this file's tests
// all share one real Testcontainers Postgres instance where a fake repo's
// numeric `id` becomes `external_ref.external_id`, carrying a real unique
// constraint on `(provider, external_id)`. A per-instance counter starting
// at a fixed 9000 let two different test cases both mint "id 9001" and
// collide for real; a single shared counter can't repeat.
let nextFakeGitHubId = 9000;

function createFakeGitHub(owner: string) {
  const repos = new Map<string, FakeRepo>();
  // `<repo>/<path>` -> decoded file text, for every contents-API write.
  const files = new Map<string, string>();
  // Every `POST /user/repos` body received, in order.
  const createRequests: { name: string; description?: string; private?: boolean }[] = [];

  function repoKey(name: string): string {
    return `${owner}/${name}`;
  }

  function toApiShape(repo: FakeRepo) {
    return {
      id: repo.id,
      name: repo.name,
      full_name: repo.fullName,
      description: repo.description,
      html_url: repo.htmlUrl,
      private: true,
      owner: { login: owner },
    };
  }

  function jsonResponse(status: number, data: unknown): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  /** A repo our own runOperation calls never created - "already taken by something else". */
  function seedForeignRepo(name: string, description: string): void {
    const fullName = repoKey(name);
    repos.set(fullName, {
      id: nextFakeGitHubId++,
      name,
      fullName,
      description,
      htmlUrl: `https://github.com/${fullName}`,
    });
  }

  async function fetchImpl(url: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(url);

    if (method === 'POST' && pathname === '/user/repos') {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            name: string;
            description?: string;
            private?: boolean;
          })
        : { name: '' };
      createRequests.push(body);
      const fullName = repoKey(body.name);
      if (repos.has(fullName)) {
        return jsonResponse(422, {
          message: 'Repository creation failed.',
          errors: [
            {
              resource: 'Repository',
              code: 'custom',
              field: 'name',
              message: 'name already exists on this account',
            },
          ],
        });
      }
      const created: FakeRepo = {
        id: nextFakeGitHubId++,
        name: body.name,
        fullName,
        description: body.description ?? '',
        htmlUrl: `https://github.com/${fullName}`,
      };
      repos.set(fullName, created);
      return jsonResponse(201, toApiShape(created));
    }

    const getMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && getMatch) {
      const [, matchedOwner, name] = getMatch;
      const found = matchedOwner === owner && name ? repos.get(repoKey(name)) : undefined;
      if (!found) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(200, toApiShape(found));
    }

    const contentsMatch = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(pathname);
    if (method === 'PUT' && contentsMatch) {
      // `initRepo`'s README/ADR/lineage.json writes (FR-033/034/035) - the
      // exact file content isn't asserted on by these tests (that's
      // covered by inspecting the description marker instead), so a
      // minimal, valid response shape is enough.
      const { content } = JSON.parse(String(init?.body ?? '{}')) as { content?: string };
      files.set(
        // Octokit percent-encodes the whole path (`docs%2Fadr%2FADR-01.md`).
        `${contentsMatch[2]}/${decodeURIComponent(contentsMatch[3] ?? '')}`,
        Buffer.from(content ?? '', 'base64').toString('utf8'),
      );
      return jsonResponse(201, {
        content: { path: contentsMatch[3] },
        commit: { sha: `fake-${nextFakeGitHubId++}` },
      });
    }

    throw new Error(`fake GitHub fetch: unhandled ${method} ${pathname}`);
  }

  return { fetch: fetchImpl, seedForeignRepo, repos, files, createRequests };
}

// Thin wrapper implementing "simulate a lost response" (ERD 7.2) on top of
// the fake GitHub above - adapted from the spike's own `createResponseDropper`.
function createResponseDropper(
  underlyingFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
) {
  const dropNextResponseFor = new Set<string>();

  function simulateLostResponseFor(repoName: string): void {
    dropNextResponseFor.add(repoName);
  }

  async function fetchWithDrop(url: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(url);
    let dropKey: string | undefined;
    if (method === 'POST' && pathname === '/user/repos' && init?.body) {
      const body = JSON.parse(String(init.body)) as { name?: string };
      if (body.name && dropNextResponseFor.has(body.name)) dropKey = body.name;
    }
    // The call underneath always runs to completion - its real side effect
    // (a fake repo recorded in the Map) genuinely happens either way; only
    // the caller's view of the response is dropped.
    const response = await underlyingFetch(url, init);
    if (dropKey) {
      dropNextResponseFor.delete(dropKey);
      throw new TypeError(
        'test-simulated network fault: response lost before the client could observe it',
      );
    }
    return response;
  }

  return { fetch: fetchWithDrop, simulateLostResponseFor };
}

/** Advances the FAKE clock past github's 90s RECONCILIATION_THRESHOLD_MS (src/external/operations/index.ts), the same technique tests/integration/external/operations.test.ts already uses - only `Date` is faked, real Testcontainers I/O is unaffected. */
async function withClockAdvancedPastThreshold<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 95_000);
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

async function withFakeFetch<T>(
  fakeFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** A project with an approved Architecture (one ADR) - what `previewInit`/`initRepo` start from. */
async function approvedArchitecture(
  name: string,
  optionA?: Parameters<typeof approveArchitectureVersion>[3],
) {
  const { projectId } = await fx.createProjectWithOwner(sql, { name });
  const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
  const adr = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: architectureArtifactId,
    itemType: 'architecture_decision',
  });
  const architectureVersionId = await approveArchitectureVersion(
    architectureArtifactId,
    1,
    [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
    optionA,
  );
  return { projectId, architectureVersionId };
}

/** The fake GitHub, except every `GET /repos/{owner}/{name}` lookup answers `status`/`body`. */
function respondingToLookupWith(
  fake: ReturnType<typeof createFakeGitHub>,
  status: number,
  body: unknown,
) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && /^\/repos\/[^/]+\/[^/]+$/.test(new URL(url).pathname)) {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return fake.fetch(url, init);
  };
}

describe('github (E4-S2 / SCRUM-51)', () => {
  describe('T11 - lost response; unrelated repo with same name; double-click; stale pending', () => {
    it('T11a: a lost create response reconciles via marker match on the next call - exactly one operation row, one ref', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T11a' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const architectureVersionId = await approveArchitectureVersion(architectureArtifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);

      const repoName = `t11a-repo-${randomUUID().slice(0, 8)}`;
      const normalizedRepoName = github.normalizeRepoName(repoName);
      const fake = createFakeGitHub(FAKE_OWNER);
      const dropper = createResponseDropper(fake.fetch);

      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(normalizedRepoName);
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow();

        const afterLoss = await githubOperationRows(projectId);
        expect(afterLoss).toHaveLength(1);
        expect(afterLoss[0]!.status).toBe('pending'); // R6/R9: left exactly as-is, never failed

        const ref = await withClockAdvancedPastThreshold(() =>
          initRepo(architectureVersionId, repoName),
        );

        expect(ref.provider).toBe('github');
        expect(ref.sourceArtifactVersionId).toBe(architectureVersionId);
        expect(ref.sourceItemVersionId).toBeNull();

        const afterAdopt = await githubOperationRows(projectId);
        expect(afterAdopt).toHaveLength(1); // one operation row throughout (ERD 7.1)
        expect(afterAdopt[0]!.status).toBe('completed');

        const refs = await githubRefRows(projectId);
        expect(refs).toHaveLength(1);

        // Marker-verified adoption: the repo genuinely carries our marker,
        // not just a name match (ERD 7.3/30.1).
        const fakeRepo = fake.repos.get(`${FAKE_OWNER}/${normalizedRepoName}`);
        expect(fakeRepo?.description).toMatch(/^thrln-marker:[0-9a-f]{16}$/);
      });
    });

    it('T11b: an immediate name collision at create time ends failed (name_taken_by_other), never adopted', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T11b' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const architectureVersionId = await approveArchitectureVersion(architectureArtifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);

      const repoName = `t11b-repo-${randomUUID().slice(0, 8)}`;
      const normalizedRepoName = github.normalizeRepoName(repoName);
      const fake = createFakeGitHub(FAKE_OWNER);
      fake.seedForeignRepo(normalizedRepoName, 'thrln-marker:0000000000000000');

      await withFakeFetch(fake.fetch, async () => {
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow(
          /name_taken_by_other/,
        );
      });

      const rows = await githubOperationRows(projectId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'failed', error_message: 'name_taken_by_other' });
      expect(await githubRefRows(projectId)).toHaveLength(0); // never adopted
    });

    it('T11c: a lost response over a pre-existing FOREIGN repo reconciles to failed (name_taken_by_other) via marker mismatch, not adoption', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T11c' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const architectureVersionId = await approveArchitectureVersion(architectureArtifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);

      const repoName = `t11c-repo-${randomUUID().slice(0, 8)}`;
      const normalizedRepoName = github.normalizeRepoName(repoName);
      const fake = createFakeGitHub(FAKE_OWNER);
      // Pre-seeded BEFORE any attempt - a genuinely unrelated operation
      // already owns this name (unlike T11b, this repo exists from the
      // start, so the create call below fails ambiguously - see the
      // dropper - and must be resolved by reconcile()'s marker check, not
      // an immediate 422).
      fake.seedForeignRepo(normalizedRepoName, 'thrln-marker:foreign00000000');
      const dropper = createResponseDropper(fake.fetch);

      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(normalizedRepoName);
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow();

        const afterLoss = await githubOperationRows(projectId);
        expect(afterLoss).toHaveLength(1);
        expect(afterLoss[0]!.status).toBe('pending');

        // This is the fixed interface gap (src/external/operations/index.ts's
        // new `{found:'foreign'}` ReconcileResult variant): reconcile()
        // finds a repo at the deterministic name whose marker does NOT
        // match ours - a definitive outcome, mapped to `failed`, not left
        // at `reconciliation_required` forever.
        await expect(
          withClockAdvancedPastThreshold(() => initRepo(architectureVersionId, repoName)),
        ).rejects.toThrow(/name_taken_by_other/);

        const afterReconcile = await githubOperationRows(projectId);
        expect(afterReconcile).toHaveLength(1); // one operation row throughout
        expect(afterReconcile[0]).toMatchObject({
          status: 'failed',
          error_message: 'name_taken_by_other',
        });
        expect(await githubRefRows(projectId)).toHaveLength(0); // never adopted
      });
    });

    it('T11d: a concurrent double-click while the original is still within T is rejected in-flight, never resent', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T11d' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const architectureVersionId = await approveArchitectureVersion(architectureArtifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);

      const repoName = `t11d-repo-${randomUUID().slice(0, 8)}`;
      const normalizedRepoName = github.normalizeRepoName(repoName);
      const fake = createFakeGitHub(FAKE_OWNER);
      const dropper = createResponseDropper(fake.fetch);

      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(normalizedRepoName);
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow();

        // Still within T (no clock advance) - a double-click must be
        // rejected as in-flight, never resent (R5).
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow(/in flight/i);

        const rows = await githubOperationRows(projectId);
        expect(rows).toHaveLength(1); // still exactly one row
        expect(rows[0]!.status).toBe('pending');
      });
    });
  });

  describe('T13 - GitHub drift is item-level (FR-036)', () => {
    it('repository is not flagged after a no-change re-approval, then flagged once the ADR actually changes', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T13' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });

      const v1 = await approveArchitectureVersion(architectureArtifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);

      // A GitHub ref built directly via fixtures (checkDrift is a pure DB
      // read - no network mocking needed for this scenario).
      const opId = await fx.createExternalOperation(sql, {
        projectId,
        provider: 'github',
        sourceArtifactVersionId: v1,
        sourceItemVersionId: null,
      });
      const refId = await fx.createExternalRef(sql, {
        projectId,
        provider: 'github',
        externalOperationId: opId,
        sourceArtifactVersionId: v1,
        sourceItemVersionId: null,
      });

      expect(await github.checkDrift(refId)).toBeNull();

      // Re-approved with NO ADR change: the SAME item_version reused.
      await approveArchitectureVersion(architectureArtifactId, 2, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);
      expect(await github.checkDrift(refId)).toBeNull();

      // Re-approved with the ADR CHANGED: a new item_version under the SAME LogicalItem.
      const adrV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: adr.logicalItemId,
        revisionNumber: 2,
      });
      await approveArchitectureVersion(architectureArtifactId, 3, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adrV2ItemVersionId },
      ]);

      const drift = await github.checkDrift(refId);
      expect(drift).toMatchObject({
        subjectKind: 'external_ref',
        rootItemVersionId: adr.itemVersionId, // the OLD (v1) item_version is the obsolete root
        depth: 0,
      });
    });
  });

  describe('T17 - one impact() row for a ref, not one per embedded ADR; direct beats transitive', () => {
    it('three ADRs all tracing to the same obsolete Requirement collapse to a single drift row', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T17' });
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');

      const r07 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: requirementsArtifactId,
        itemType: 'requirement',
      });
      const rVersion1 = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 1,
      });
      await fx.createMembership(sql, {
        artifactVersionId: rVersion1,
        artifactId: requirementsArtifactId,
        logicalItemId: r07.logicalItemId,
        itemVersionId: r07.itemVersionId,
      });
      await fx.approveArtifactVersion(sql, rVersion1);

      const adr1 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const adr2 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const adr3 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });

      // adr1, adr3: DIRECT on R-07 (depth 0). adr2: TRANSITIVE, via adr1 (depth 1).
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr1.itemVersionId,
        upstreamItemVersionId: r07.itemVersionId,
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr2.itemVersionId,
        upstreamItemVersionId: adr1.itemVersionId,
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr3.itemVersionId,
        upstreamItemVersionId: r07.itemVersionId,
      });

      const architectureVersionId = await approveArchitectureVersion(
        architectureArtifactId,
        1,
        [adr1, adr2, adr3].map((adr) => ({
          logicalItemId: adr.logicalItemId,
          itemVersionId: adr.itemVersionId,
        })),
      );

      const opId = await fx.createExternalOperation(sql, {
        projectId,
        provider: 'github',
        sourceArtifactVersionId: architectureVersionId,
        sourceItemVersionId: null,
      });
      const refId = await fx.createExternalRef(sql, {
        projectId,
        provider: 'github',
        externalOperationId: opId,
        sourceArtifactVersionId: architectureVersionId,
        sourceItemVersionId: null,
      });

      // R-07 changes A -> D (a new revision, approved) - all 3 ADRs still
      // trace to the now-obsolete A.
      const rD = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: r07.logicalItemId,
        revisionNumber: 2,
      });
      const rVersion2 = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 2,
      });
      await fx.createMembership(sql, {
        artifactVersionId: rVersion2,
        artifactId: requirementsArtifactId,
        logicalItemId: r07.logicalItemId,
        itemVersionId: rD,
      });
      await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${rVersion1}`;
      await fx.approveArtifactVersion(sql, rVersion2);

      const drift = await github.checkDrift(refId);
      // Exactly one row (checkDrift's own return type is singular, not a
      // list), rooted at r07's obsolete v1 (A) - direct (adr1/adr3) beats
      // transitive (adr2) among the THREE ADRs' own item-level depths, but
      // the ref's own depth is one hop further than whichever ADR it wins
      // through: `impact()`'s `ref_raw` CTE (drizzle/migrations/0005_impact_
      // function.sql) always adds +1 to a source item's own depth for a ref
      // whose cited item is itself still current (i.e. its identity didn't
      // change - only what it depends on did); depth 0 for a ref is reserved
      // for the case where the ref's OWN cited item_version is the obsolete
      // one (T13's scenario). ERD section 6.3's own results table pins this
      // exact fixture down verbatim: "T17 - one ref, three ADRs, one
      // obsolete root | Exactly one ref row, depth 1" (line ~1657) - this
      // was the test's own bug (E4-S2 fixed it here), not `checkDrift`'s.
      expect(drift).toMatchObject({
        subjectKind: 'external_ref',
        rootItemVersionId: r07.itemVersionId,
        depth: 1,
      });
    });
  });

  describe('T18 - name collision on repo creation, then a different name', () => {
    it('first operation ends failed (name_taken_by_other); a different name starts a fresh operation; a second concurrent GitHub operation is refused', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github T18' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const architectureVersionId = await approveArchitectureVersion(architectureArtifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);

      const takenName = `t18-taken-${randomUUID().slice(0, 8)}`;
      const normalizedTaken = github.normalizeRepoName(takenName);
      const fake = createFakeGitHub(FAKE_OWNER);
      fake.seedForeignRepo(normalizedTaken, 'thrln-marker:someoneelse00000');

      await withFakeFetch(fake.fetch, async () => {
        await expect(initRepo(architectureVersionId, takenName)).rejects.toThrow(
          /name_taken_by_other/,
        );

        const differentName = `t18-fresh-${randomUUID().slice(0, 8)}`;
        const ref = await initRepo(architectureVersionId, differentName);
        expect(ref.provider).toBe('github');

        const rows = await githubOperationRows(projectId);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ status: 'failed', error_message: 'name_taken_by_other' });
        expect(rows[1]!.status).toBe('completed');
        expect(rows[0]!.operation_key).not.toBe(rows[1]!.operation_key); // a NEW key, never reused

        // A second concurrent GitHub operation for the same project is
        // refused (ERD 4.15 line ~515) - the just-completed one still counts
        // as active.
        const yetAnotherName = `t18-third-${randomUUID().slice(0, 8)}`;
        await expect(initRepo(architectureVersionId, yetAnotherName)).rejects.toThrow(/refused/i);

        const rowsAfterRefusal = await githubOperationRows(projectId);
        expect(rowsAfterRefusal).toHaveLength(2); // the refused attempt never inserted a row
      });
    });
  });

  // ERD 7.2: `failed` is reserved for definitive provider rejections (4xx);
  // 5xx/timeouts/lost responses are never `failed`. A GITHUB_TOKEN that
  // can't create repositories answers 403 - before this was classified,
  // that 403 was treated as ambiguous: the operation sat `pending` then
  // `reconciliation_required` forever and no repository was ever created.
  describe('create call rejected by GitHub (ERD 7.2 definitive 4xx vs ambiguous 5xx)', () => {
    function respondingToCreateWith(
      fake: ReturnType<typeof createFakeGitHub>,
      rejection: () => { status: number; body: unknown } | null,
    ) {
      return async (url: string | URL, init?: RequestInit): Promise<Response> => {
        const method = (init?.method ?? 'GET').toUpperCase();
        const { pathname } = new URL(url);
        const rejected = method === 'POST' && pathname === '/user/repos' ? rejection() : null;
        if (rejected) {
          return new Response(JSON.stringify(rejected.body), {
            status: rejected.status,
            headers: { 'content-type': 'application/json; charset=utf-8' },
          });
        }
        return fake.fetch(url, init);
      };
    }

    it("a 403 ends failed with GitHub's own reason (never left pending), and a retry once the token can create repositories resends and completes", async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github 403');
      const repoName = `forbidden-repo-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);
      let tokenCanCreateRepos = false;
      const fetchImpl = respondingToCreateWith(fake, () =>
        tokenCanCreateRepos
          ? null
          : {
              status: 403,
              body: { message: 'Resource not accessible by personal access token', status: '403' },
            },
      );

      await withFakeFetch(fetchImpl, async () => {
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow(
          /Resource not accessible by personal access token/,
        );

        const afterRejection = await githubOperationRows(projectId);
        expect(afterRejection).toHaveLength(1);
        expect(afterRejection[0]!.status).toBe('failed');
        expect(afterRejection[0]!.error_message).toMatch(/403/);
        expect(fake.repos.size).toBe(0);
        expect(await githubRefRows(projectId)).toHaveLength(0);

        // Same name, same inputs: the failed row is retried in place (ERD
        // 7.2 step 3.b "failed -> user may retry; set pending, resend") -
        // no second operation row, no name_taken_by_other.
        tokenCanCreateRepos = true;
        const ref = await initRepo(architectureVersionId, repoName);
        expect(ref.provider).toBe('github');

        const afterRetry = await githubOperationRows(projectId);
        expect(afterRetry).toHaveLength(1);
        expect(afterRetry[0]!.status).toBe('completed');
        // The earlier attempt's failure text must not outlive its own failure.
        expect(afterRetry[0]!.error_message).toBeNull();
        expect(fake.repos.size).toBe(1);
      });
    });

    it('a 5xx on create is ambiguous, never failed - the row stays pending for reconciliation', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github 503');
      const repoName = `unavailable-repo-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);
      const fetchImpl = respondingToCreateWith(fake, () => ({
        status: 503,
        body: { message: 'Service Unavailable' },
      }));

      await withFakeFetch(fetchImpl, async () => {
        await expect(initRepo(architectureVersionId, repoName)).rejects.toThrow();

        const rows = await githubOperationRows(projectId);
        expect(rows).toHaveLength(1);
        expect(rows[0]!.status).toBe('pending');
        expect(rows[0]!.error_message).toBeNull();
      });
    });
  });

  // `checkRepoName` backs POST .../github/check-name - the advisory "is this
  // name free?" answer shown while the user types. Read-only: no operation
  // row, and no repository is ever created by asking.
  describe('checkRepoName - repository-name availability', () => {
    it('reports a free name as available, returns the normalized name, and creates nothing', async () => {
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        await expect(checkRepoName('My New Repo!')).resolves.toEqual({
          repoName: 'my-new-repo',
          status: 'available',
        });
      });

      expect(fake.repos.size).toBe(0);
    });

    it('reports an existing repository at that name as taken, whoever owns it', async () => {
      const fake = createFakeGitHub(FAKE_OWNER);
      fake.seedForeignRepo('already-here', 'some unrelated description');

      await withFakeFetch(fake.fetch, async () => {
        await expect(checkRepoName('Already Here')).resolves.toEqual({
          repoName: 'already-here',
          status: 'taken',
        });
      });
    });

    it('reports a name with nothing usable left as invalid without calling GitHub at all', async () => {
      const neverCalled = vi.fn(async () => {
        throw new Error('GitHub must not be called for an invalid name');
      });

      await withFakeFetch(neverCalled, async () => {
        await expect(checkRepoName('!!! ???')).resolves.toEqual({
          repoName: '',
          status: 'invalid',
        });
      });

      expect(neverCalled).not.toHaveBeenCalled();
    });

    it("turns a definitive 4xx other than not-found into GithubLookupRejectedError carrying GitHub's reason", async () => {
      const fetchImpl = respondingToLookupWith(createFakeGitHub(FAKE_OWNER), 403, {
        message: 'Resource not accessible by personal access token',
      });

      await withFakeFetch(fetchImpl, async () => {
        const failure = await checkRepoName('some-name').catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(github.GithubLookupRejectedError);
        expect((failure as Error).message).toMatch(/403: Resource not accessible/);
      });
    });

    it('lets a 5xx propagate unchanged - it says nothing about the name, so it is not a rejection', async () => {
      const fetchImpl = respondingToLookupWith(createFakeGitHub(FAKE_OWNER), 503, {
        message: 'Service Unavailable',
      });

      await withFakeFetch(fetchImpl, async () => {
        const failure = await checkRepoName('some-name').catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect(failure).not.toBeInstanceOf(github.GithubLookupRejectedError);
      });
    });
  });

  // The preview's suggested name: the project's own name (handed in by the
  // preview route), not the old opaque `throughline-project-<uuid>`.
  describe('previewInit - repository-name suggestion', () => {
    function projectIdName(projectId: string): string {
      return github.normalizeRepoName(`throughline-project-${projectId}`);
    }

    it("suggests the project's name, normalized, when it is free on GitHub", async () => {
      const { architectureVersionId } = await approvedArchitecture('suggest free');
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        const preview = await previewInit(architectureVersionId, 'ShiftSwap Verify');
        expect(preview.repoName).toBe('shiftswap-verify');
        expect(preview.mode).toBe('docs-only');
      });
      expect(fake.repos.size).toBe(0); // suggesting never creates anything
    });

    it('adds the first free numeric suffix when the name is already taken', async () => {
      const { architectureVersionId } = await approvedArchitecture('suggest taken');
      const fake = createFakeGitHub(FAKE_OWNER);
      fake.seedForeignRepo('shiftswap-verify', 'unrelated');

      await withFakeFetch(fake.fetch, async () => {
        expect((await previewInit(architectureVersionId, 'ShiftSwap Verify')).repoName).toBe(
          'shiftswap-verify-2',
        );

        fake.seedForeignRepo('shiftswap-verify-2', 'unrelated');
        expect((await previewInit(architectureVersionId, 'ShiftSwap Verify')).repoName).toBe(
          'shiftswap-verify-3',
        );
      });
    });

    it('falls back to the project-id name (which cannot collide) when every attempt is taken', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('suggest exhausted');
      const fake = createFakeGitHub(FAKE_OWNER);
      fake.seedForeignRepo('busy', 'unrelated');
      for (let n = 2; n <= 10; n++) fake.seedForeignRepo(`busy-${n}`, 'unrelated');

      await withFakeFetch(fake.fetch, async () => {
        const preview = await previewInit(architectureVersionId, 'busy');
        expect(preview.repoName).toBe(projectIdName(projectId));
      });
    });

    it('uses the project-id name, without calling GitHub, when there is no project name to use', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('suggest none');
      const neverCalled = vi.fn(async () => {
        throw new Error('GitHub must not be called without a usable project name');
      });

      await withFakeFetch(neverCalled, async () => {
        // No name at all (what `github/init` passes), and a name that normalizes to nothing.
        expect((await previewInit(architectureVersionId)).repoName).toBe(projectIdName(projectId));
        expect((await previewInit(architectureVersionId, '!!! ???')).repoName).toBe(
          projectIdName(projectId),
        );
      });

      expect(neverCalled).not.toHaveBeenCalled();
    });

    it('still previews, with the unverified project-name slug, when GitHub refuses the lookup', async () => {
      const { architectureVersionId } = await approvedArchitecture('suggest refused');
      const fetchImpl = respondingToLookupWith(createFakeGitHub(FAKE_OWNER), 403, {
        message: 'Resource not accessible by personal access token',
      });

      await withFakeFetch(fetchImpl, async () => {
        const preview = await previewInit(architectureVersionId, 'ShiftSwap Verify');
        expect(preview.repoName).toBe('shiftswap-verify');
      });
    });
  });

  // The files `initRepo` commits carry the real architecture, read from the
  // selected option and each ADR's item-version payload (see repo-docs.ts,
  // whose builders are unit-tested on their own) - not just ids.
  describe('initRepo - repository visibility', () => {
    it('asks GitHub for a public repository by default', async () => {
      const { architectureVersionId } = await approvedArchitecture('github visibility');
      const repoName = `public-repo-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        await initRepo(architectureVersionId, repoName);
      });

      expect(fake.createRequests).toHaveLength(1);
      expect(fake.createRequests[0]).toMatchObject({
        name: github.normalizeRepoName(repoName),
        private: false,
      });
    });

    it('asks GitHub for a private repository when the user chose private, and records it on the operation', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github private');
      const repoName = `private-repo-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        await initRepo(architectureVersionId, repoName, 'private');
      });

      expect(fake.createRequests).toHaveLength(1);
      expect(fake.createRequests[0]).toMatchObject({
        name: github.normalizeRepoName(repoName),
        private: true,
      });
      const [op] = await sql<{ visibility: string | null; request_hash: string }[]>`
        SELECT target_descriptor->>'visibility' AS visibility, request_hash
        FROM external_operation WHERE project_id = ${projectId} AND provider = 'github'
      `;
      expect(op!.visibility).toBe('private');
      // private joins the hash, so it differs from the public request's hash
      const normalized = github.normalizeRepoName(repoName);
      const publicHash = createHash('sha256')
        .update(JSON.stringify({ repoName: normalized, mode: 'docs-only', owner: FAKE_OWNER }))
        .digest('hex');
      expect(op!.request_hash).not.toBe(publicHash);
    });

    it('keeps the public request hash unchanged (no visibility in it) and records public', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github public hash');
      const repoName = `public-hash-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        await initRepo(architectureVersionId, repoName);
      });

      const [op] = await sql<{ visibility: string | null; request_hash: string }[]>`
        SELECT target_descriptor->>'visibility' AS visibility, request_hash
        FROM external_operation WHERE project_id = ${projectId} AND provider = 'github'
      `;
      expect(op!.visibility).toBe('public');
      const expected = createHash('sha256')
        .update(
          JSON.stringify({
            repoName: github.normalizeRepoName(repoName),
            mode: 'docs-only',
            owner: FAKE_OWNER,
          }),
        )
        .digest('hex');
      expect(op!.request_hash).toBe(expected);
    });
  });

  describe('initRepo - repository documentation content', () => {
    it("commits the ADR's decision text and the option's stack table, not just provenance ids", async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'github docs content' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const { id: logicalItemId, displayKey } = await fx.createLogicalItem(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const itemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId,
        payload: {
          title: 'Server-rendered workflow',
          decision: 'Use Django templates with HTMX for the workflow screens.',
          technologyOrApproach: 'Django templates with HTMX',
          constraints: ['Provide submission, manager review, and employee status views.'],
          significantTradeoffs: ['Keeps the UI and workflow in one application.'],
        },
      });
      const architectureVersionId = await approveArchitectureVersion(
        architectureArtifactId,
        1,
        [{ logicalItemId, itemVersionId }],
        {
          title: 'Django Modular Monolith',
          summary: 'A server-rendered Django application in one service.',
          stack: { frontend: 'Django templates with HTMX', backend: 'Django' },
          tradeoffs: [{ factor: 'cost', assessment: 'One service to pay for.' }],
        },
      );

      const repoName = `docs-content-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);
      await withFakeFetch(fake.fetch, async () => {
        await initRepo(architectureVersionId, repoName);
      });

      const repo = github.normalizeRepoName(repoName);
      const adr = fake.files.get(`${repo}/docs/adr/${displayKey}.md`);
      expect(adr).toContain('# ' + displayKey + ': Server-rendered workflow');
      expect(adr).toContain('Use Django templates with HTMX for the workflow screens.');
      expect(adr).toContain('- Provide submission, manager review, and employee status views.');
      expect(adr).toContain(`adr_item_version_id: ${itemVersionId}`);

      const readme = fake.files.get(`${repo}/README.md`);
      expect(readme).toContain('| Frontend | Django templates with HTMX |');
      expect(readme).toContain('- **Cost:** One service to pay for.');
      expect(readme).toContain(
        `[${displayKey}](./docs/adr/${displayKey}.md) - Server-rendered workflow`,
      );
    });
  });

  // FR-031/032: a pinned starter matching the selected stack is generated as
  // real files (scaffold mode); any other stack stays docs-only. The starters
  // themselves are unit-tested (github-starters.test.ts) and were run for
  // real (Django virtualenv, Next.js tsc) - this proves the wiring end to end.
  describe('pinned starter - scaffold mode vs docs-only', () => {
    const DJANGO_OPTION = {
      title: 'Django Modular Monolith',
      summary: 'A server-rendered Django application in one service.',
      stack: {
        frontend: 'Django templates with HTMX',
        backend: 'Django modular monolith',
        database: 'Amazon RDS for PostgreSQL',
        hosting: 'AWS ECS Fargate',
        repositoryLayout: 'Single Django repository organized by domain apps',
      },
    };
    const RAILS_OPTION = {
      title: 'Rails Monolith',
      stack: {
        frontend: 'Rails server-rendered HTML',
        backend: 'Ruby on Rails modular monolith',
        database: 'PostgreSQL',
        hosting: 'Managed Rails platform',
        repositoryLayout: 'Single application repository',
      },
    };

    it('previews the starter and its exact file list for a matching stack', async () => {
      const { architectureVersionId } = await approvedArchitecture(
        'starter preview',
        DJANGO_OPTION,
      );
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        const preview = await previewInit(architectureVersionId, 'ShiftSwap Verify');

        expect(preview.mode).toBe('scaffold');
        expect(preview.starter).toMatchObject({ id: 'django', label: 'Django' });
        expect(preview.starter?.files).toEqual(
          expect.arrayContaining(['manage.py', 'requirements.txt', 'config/settings.py']),
        );
        expect(preview.starter?.notScaffolded.join(' ')).toContain('infrastructure');
      });
    });

    it('previews no starter and docs-only mode for a stack no starter fits', async () => {
      const { architectureVersionId } = await approvedArchitecture('starter none', RAILS_OPTION);
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        const preview = await previewInit(architectureVersionId, 'Rails Thing');

        expect(preview.mode).toBe('docs-only');
        expect(preview.starter).toBeNull();
      });
    });

    it('writes exactly the previewed files, then the docs, with lineage.json last', async () => {
      const { architectureVersionId } = await approvedArchitecture('starter write', DJANGO_OPTION);
      const repoName = `starter-repo-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);
      let previewed: string[] = [];

      const ref = await withFakeFetch(fake.fetch, async () => {
        previewed = (await previewInit(architectureVersionId, repoName)).starter!.files;
        return initRepo(architectureVersionId, repoName);
      });

      const repo = github.normalizeRepoName(repoName);
      const written = [...fake.files.keys()].map((key) => key.slice(repo.length + 1));

      expect(ref.metadata).toMatchObject({ mode: 'scaffold' });
      // Every previewed starter file was written - the preview does not lie (FR-030).
      for (const path of previewed) expect(written, path).toContain(path);
      expect(written).toContain('README.md');
      expect(written.some((path) => path.startsWith('docs/adr/ADR-'))).toBe(true);
      // Provenance last: lineage.json only exists once every file landed.
      expect(written[written.length - 1]).toBe('docs/architecture/lineage.json');
      // README first, before any starter file.
      expect(written[0]).toBe('README.md');
    });

    it('records the starter in lineage.json and explains it in the README', async () => {
      const { architectureVersionId } = await approvedArchitecture(
        'starter lineage',
        DJANGO_OPTION,
      );
      const repoName = `starter-lineage-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        await initRepo(architectureVersionId, repoName);
      });

      const repo = github.normalizeRepoName(repoName);
      const lineage = JSON.parse(fake.files.get(`${repo}/docs/architecture/lineage.json`)!);
      expect(lineage.mode).toBe('scaffold');
      expect(lineage.starter).toMatchObject({ id: 'django', label: 'Django' });
      expect(lineage.starter.files).toContain('manage.py');

      const readme = fake.files.get(`${repo}/README.md`)!;
      expect(readme).toContain('A Django starter was generated from the selected stack');
      expect(readme).toContain('## Getting started');
      expect(readme).toContain('python manage.py runserver');

      // The generated settings really are the repo's own name/title-safe project.
      expect(fake.files.get(`${repo}/manage.py`)).toContain('config.settings');
      expect(fake.files.get(`${repo}/requirements.txt`)).toContain('psycopg');
    });

    it('writes no starter files and says docs-only for a stack no starter fits', async () => {
      const { architectureVersionId } = await approvedArchitecture(
        'starter docs only',
        RAILS_OPTION,
      );
      const repoName = `docsonly-repo-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);

      const ref = await withFakeFetch(fake.fetch, async () =>
        initRepo(architectureVersionId, repoName),
      );

      const repo = github.normalizeRepoName(repoName);
      const written = [...fake.files.keys()].map((key) => key.slice(repo.length + 1));
      expect(ref.metadata).toMatchObject({ mode: 'docs-only' });
      expect(written.filter((path) => path !== 'README.md' && !path.startsWith('docs/'))).toEqual(
        [],
      );

      const lineage = JSON.parse(fake.files.get(`${repo}/docs/architecture/lineage.json`)!);
      expect(lineage.mode).toBe('docs-only');
      expect(lineage.starter).toBeNull();
      expect(fake.files.get(`${repo}/README.md`)).not.toContain('## Getting started');
    });
  });
  // -------------------------------------------------------------------------
  // Round 14 (SCRUM-96, UC-S4): the per-user credential. ERD 7.2 step 0, 7.6, T49, T51.
  // -------------------------------------------------------------------------
  describe('per-user GitHub credential (round 14)', () => {
    async function operationColumns(projectId: string) {
      return sql<
        {
          status: string;
          connection_id: string | null;
          account_id: string | null;
          owner: string | null;
        }[]
      >`
        SELECT status, connection_id,
               target_descriptor->>'account_id' AS account_id,
               target_descriptor->>'owner' AS owner
        FROM external_operation WHERE project_id = ${projectId} AND provider = 'github'
      `;
    }

    it('creates the repository with the connection token, records connection_id + account_id + owner, and never sends the env token', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github r14 happy');
      const fake = createFakeGitHub(FAKE_OWNER);
      const auth: string[] = [];
      const fetchImpl = async (url: string | URL, init?: RequestInit) => {
        auth.push(String(new Headers(init?.headers).get('authorization')));
        return fake.fetch(url, init);
      };

      await withFakeFetch(fetchImpl, async () => {
        const ref = await initRepo(architectureVersionId, `r14-${randomUUID().slice(0, 8)}`);
        expect(ref.provider).toBe('github');
      });

      expect(auth.length).toBeGreaterThan(0);
      expect(auth.every((h) => h.includes(TEST_TOKEN))).toBe(true);
      const [op] = await operationColumns(projectId);
      expect(op!.status).toBe('completed');
      expect(op!.connection_id).not.toBeNull();
      expect(op!.account_id).toMatch(/^gh-/);
      expect(op!.owner).toBe(FAKE_OWNER);
    });

    it('no connection -> ConnectionRequiredError before any operation row exists', async () => {
      const { projectId, userId } = await fx.createProjectWithOwner(sql, {
        name: 'github r14 none',
      });
      const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'architecture_decision',
      });
      const versionId = await approveArchitectureVersion(artifactId, 1, [
        { logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId },
      ]);
      const spy = vi.fn();

      await withFakeFetch(spy as never, async () => {
        await expect(
          github.initRepo(versionId, 'no-connection', { userId, githubOwner: FAKE_OWNER }),
        ).rejects.toBeInstanceOf(connections.ConnectionRequiredError);
      });

      expect(await githubOperationRows(projectId)).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    });

    it("no github_owner on the project -> the repository is created under the connection's own login", async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github r14 target');
      const ctx = await ctxForVersion(architectureVersionId);
      const fake = createFakeGitHub(FAKE_OWNER);

      await withFakeFetch(fake.fetch, async () => {
        const ref = await github.initRepo(architectureVersionId, 'no-owner', {
          userId: ctx.userId,
          githubOwner: null,
        });
        expect(ref.externalKey).toBe(`${FAKE_OWNER}/no-owner`);
      });

      const [op] = await operationColumns(projectId);
      expect(op!.status).toBe('completed');
      expect(op!.owner).toBe(FAKE_OWNER);
      expect(fake.createRequests).toHaveLength(1);
    });

    it('a 401 on create -> connection needs_reauth + ReconnectRequiredError, the operation is NOT failed (T49)', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github r14 401');
      const ctx = await ctxForVersion(architectureVersionId);
      const fetchImpl = async () =>
        new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });

      await withFakeFetch(fetchImpl, async () => {
        await expect(
          github.initRepo(architectureVersionId, 'bad-creds', ctx),
        ).rejects.toBeInstanceOf(connections.ReconnectRequiredError);
      });

      const [op] = await operationColumns(projectId);
      expect(op!.status).toBe('pending'); // never `failed`
      const status = (await connections.listConnections(ctx.userId)).find(
        (c) => c.provider === 'github',
      );
      expect(status!.status).toBe('needs_reauth');
    });

    it('T51: reconnecting as a DIFFERENT GitHub account blocks a retry before any network call; the original account resumes it', async () => {
      const { projectId, architectureVersionId } = await approvedArchitecture('github r14 t51');
      const ctx = await ctxForVersion(architectureVersionId);
      const repoName = `t51-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGitHub(FAKE_OWNER);
      const dropper = createResponseDropper(fake.fetch);

      // A lost response leaves a pending operation created under account A.
      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(github.normalizeRepoName(repoName));
        await expect(github.initRepo(architectureVersionId, repoName, ctx)).rejects.toThrow();
      });
      const [before] = await operationColumns(projectId);
      const operationRows = await sql<{ id: string }[]>`
        SELECT id FROM external_operation WHERE project_id = ${projectId}
      `;
      const operationId = operationRows[0]!.id;

      await ensureConnection(ctx.userId, 'gh-a-different-account');
      const spy = vi.fn();
      await withFakeFetch(spy as never, async () => {
        await expect(github.retryOperation(operationId, ctx)).rejects.toBeInstanceOf(
          connections.ReconnectRequiredError,
        );
      });
      expect(spy).not.toHaveBeenCalled();
      expect(await operationColumns(projectId)).toEqual([before]);

      // The original account resumes the operation.
      await ensureConnection(ctx.userId, before!.account_id!);
      const resumed = await withFakeFetch(fake.fetch, () =>
        withClockAdvancedPastThreshold(() => github.retryOperation(operationId, ctx)),
      );
      expect(resumed.status).toBe('completed');
    });
  });
});
