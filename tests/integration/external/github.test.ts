import { randomUUID } from 'node:crypto';
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

  github = await import('@/external/github');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

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
        ? (JSON.parse(String(init.body)) as { name: string; description?: string })
        : { name: '' };
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
      return jsonResponse(201, {
        content: { path: contentsMatch[3] },
        commit: { sha: `fake-${nextFakeGitHubId++}` },
      });
    }

    throw new Error(`fake GitHub fetch: unhandled ${method} ${pathname}`);
  }

  return { fetch: fetchImpl, seedForeignRepo, repos };
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
        await expect(github.initRepo(architectureVersionId, repoName)).rejects.toThrow();

        const afterLoss = await githubOperationRows(projectId);
        expect(afterLoss).toHaveLength(1);
        expect(afterLoss[0]!.status).toBe('pending'); // R6/R9: left exactly as-is, never failed

        const ref = await withClockAdvancedPastThreshold(() =>
          github.initRepo(architectureVersionId, repoName),
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
        await expect(github.initRepo(architectureVersionId, repoName)).rejects.toThrow(
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
        await expect(github.initRepo(architectureVersionId, repoName)).rejects.toThrow();

        const afterLoss = await githubOperationRows(projectId);
        expect(afterLoss).toHaveLength(1);
        expect(afterLoss[0]!.status).toBe('pending');

        // This is the fixed interface gap (src/external/operations/index.ts's
        // new `{found:'foreign'}` ReconcileResult variant): reconcile()
        // finds a repo at the deterministic name whose marker does NOT
        // match ours - a definitive outcome, mapped to `failed`, not left
        // at `reconciliation_required` forever.
        await expect(
          withClockAdvancedPastThreshold(() => github.initRepo(architectureVersionId, repoName)),
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
        await expect(github.initRepo(architectureVersionId, repoName)).rejects.toThrow();

        // Still within T (no clock advance) - a double-click must be
        // rejected as in-flight, never resent (R5).
        await expect(github.initRepo(architectureVersionId, repoName)).rejects.toThrow(
          /in flight/i,
        );

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
      // list) with depth 0 - direct (adr1/adr3) beats transitive (adr2).
      expect(drift).toMatchObject({
        subjectKind: 'external_ref',
        rootItemVersionId: r07.itemVersionId,
        depth: 0,
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
        await expect(github.initRepo(architectureVersionId, takenName)).rejects.toThrow(
          /name_taken_by_other/,
        );

        const differentName = `t18-fresh-${randomUUID().slice(0, 8)}`;
        const ref = await github.initRepo(architectureVersionId, differentName);
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
        await expect(github.initRepo(architectureVersionId, yetAnotherName)).rejects.toThrow(
          /refused/i,
        );

        const rowsAfterRefusal = await githubOperationRows(projectId);
        expect(rowsAfterRefusal).toHaveLength(2); // the refused attempt never inserted a row
      });
    });
  });
});
