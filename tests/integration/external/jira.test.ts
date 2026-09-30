import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { connect } from '../support/connection';
import * as fx from '../support/fixtures';

// `jira`'s real previewExport/exportBacklog (E4-S3 / SCRUM-52, Module
// Boundaries 4.6, ERD 7.4, TR FR-070..074, TR 30.2) - proves ERD Appendix C's
// T12, T26, T41 (the ids this story's own instructions cite) against real
// Testcontainers Postgres, real triggers/CHECKs, and a real (unmodified)
// raw-fetch Jira REST v3 client whose network call is swapped for an
// in-process fake Jira - the same technique
// tests/integration/external/github.test.ts already established for GitHub
// (itself adapted from scripts/spike-github-reconciliation.mts), adapted
// here to Jira's request/response shapes from
// scripts/spike-jira-reconciliation.ts. No Jira credentials are configured
// anywhere in this environment (that spike's own guard confirms it) -
// matching the spike's own "mock mode" via a fake `fetch`.
//
// tests/integration/appendix-c.test.ts keeps its own `it.todo('T12')`/
// `it.todo('T26')`/`it.todo('T41')` (each commented "Turns green with
// E4-T3") untouched - same deferral pattern E4-S2 established for T11/T13/
// T17/T18: this file proves the behavior for real, at the module level;
// E4-T3 (the slice-4 gate) re-runs it through the real API routes.
//
// Same dynamic-import-after-env-setup gotcha as every other file in this
// directory: `@/external/jira` pulls in `@/lib/env` at MODULE-IMPORT time,
// so every env var it (transitively) reads must be in `process.env` BEFORE
// the first `await import('@/external/jira')`.

// Round 14 (SCRUM-97): every export/preview runs as the project owner with their
// own Jira connection (saved through the real `connections.saveConnection`) and
// the project's Jira target in the ctx; the fake Jira answers on the Atlassian
// gateway path `/ex/jira/<cloudId>/rest/api/3/...` and checks the Bearer token.
// The JIRA_* environment credential is deliberately NOT configured any more:
// nothing in a new-operation path may fall back to it.

let sql: postgres.Sql;
let jira: typeof import('@/external/jira');
let connections: typeof import('@/connections');

const FAKE_SITE_URL = 'https://fake-jira.example.test';
const CLOUD_ID = 'cloud-test-1';
const DEFAULT_PROJECT_KEY = 'THRLN';
const TEST_ACCESS_TOKEN = 'atl_thrln_test_user_token';

beforeAll(async () => {
  sql = connect();
  const connectionUri = inject('pgConnectionUri');
  process.env.DATABASE_URL = connectionUri;
  process.env.DIRECT_DATABASE_URL = connectionUri;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  // 32 bytes, base64 - read by the connections module at call time.
  process.env.CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  jira = await import('@/external/jira');
  connections = await import('@/connections');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// Fixture composition shared by every scenario below.
// ---------------------------------------------------------------------------

/**
 * A draft -> approved Backlog artifact_version with the given Epic/Story
 * memberships. Supersedes whatever was previously approved for this artifact
 * first (one_approved_version) - mirrors github.test.ts's own
 * `approveArchitectureVersion` helper, without the architecture_option
 * machinery (backlog's own approval has no extra CHECK beyond draft ->
 * approved).
 */
async function approveBacklogVersion(
  sql: postgres.Sql,
  artifactId: string,
  versionNumber: number,
  members: {
    logicalItemId: string;
    itemVersionId: string;
    parentLogicalItemId?: string | null;
  }[],
): Promise<string> {
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber });
  for (const member of members) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId: member.logicalItemId,
      itemVersionId: member.itemVersionId,
      parentLogicalItemId: member.parentLogicalItemId ?? null,
    });
  }
  const [current] = await sql<{ id: string }[]>`
    SELECT id FROM artifact_version WHERE artifact_id = ${artifactId} AND status = 'approved'
  `;
  if (current)
    await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${current.id}`;
  await fx.approveArtifactVersion(sql, versionId);
  return versionId;
}

// ---------------------------------------------------------------------------
// Round 14: the acting user's own connection + ctx.
// ---------------------------------------------------------------------------

/** The user's Jira connection: account id `atl-<userId>`, default site = the fake site. */
async function ensureConnection(userId: string, externalAccountId = `atl-${userId}`) {
  await connections.saveConnection({
    userId,
    provider: 'jira',
    externalAccountId,
    displayName: 'Test User',
    accessToken: TEST_ACCESS_TOKEN,
    refreshToken: 'atl_thrln_test_refresh_token',
    // Comfortably valid: this file never reaches the refresh path.
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ['read:jira-work', 'write:jira-work', 'offline_access'],
    providerMeta: { cloudId: CLOUD_ID, siteUrl: FAKE_SITE_URL, siteName: 'Fake' },
  });
}

async function ownerOfBacklogVersion(backlogVersionId: string): Promise<string> {
  const [row] = await sql<{ owner_user_id: string }[]>`
    SELECT p.owner_user_id
    FROM artifact_version av
    JOIN artifact a ON a.id = av.artifact_id
    JOIN project p ON p.id = a.project_id
    WHERE av.id = ${backlogVersionId}
  `;
  return row!.owner_user_id;
}

/** ctx for the owner of the project a backlog version belongs to (a connection is ensured). */
async function ctxForVersion(
  backlogVersionId: string,
  target: { jiraCloudId?: string; jiraProjectKey?: string } = {
    jiraCloudId: CLOUD_ID,
    jiraProjectKey: DEFAULT_PROJECT_KEY,
  },
) {
  const userId = await ownerOfBacklogVersion(backlogVersionId);
  await ensureConnection(userId);
  return { userId, ...target };
}

async function jiraOperationRows(projectId: string) {
  return sql<{ operation_key: string; status: string }[]>`
    SELECT operation_key, status FROM external_operation
    WHERE project_id = ${projectId} AND provider = 'jira'
    ORDER BY created_at
  `;
}

async function jiraRefRowsForItem(itemVersionId: string) {
  return sql<{ id: string; external_key: string | null }[]>`
    SELECT id, external_key FROM external_ref
    WHERE provider = 'jira' AND source_item_version_id = ${itemVersionId}
  `;
}

// ---------------------------------------------------------------------------
// Fake Jira - an in-memory issue store plus a `fetch` implementation for
// exactly the two endpoints this module calls, adapted from
// scripts/spike-jira-reconciliation.ts's own request/response shapes (real
// jiraFetch/error-throwing code in src/external/jira/index.ts still runs on
// top of this; only `fetch` itself is faked, same discipline as
// github.test.ts's own fake GitHub).
// ---------------------------------------------------------------------------

interface FakeJiraIssue {
  id: string;
  key: string;
  projectKey: string;
  summary: string;
  labels: string[];
  descriptionText: string;
  parentKey: string | null;
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function extractDescriptionText(description: unknown): string {
  if (!description || typeof description !== 'object') return '';
  const doc = description as { content?: Array<{ content?: Array<{ text?: string }> }> };
  return (doc.content ?? [])
    .flatMap((paragraph) => (paragraph.content ?? []).map((node) => node.text ?? ''))
    .join('\n');
}

// Module-level counter (not per-`createFakeJira()` call), same reasoning as
// github.test.ts's own `nextFakeGitHubId`: keeps every fake issue's id
// unique across the whole file, even across separately-created fake
// instances sharing one real Testcontainers Postgres.
let nextFakeJiraNumericId = 10_000;

function createFakeJira() {
  const issuesByKey = new Map<string, FakeJiraIssue>();
  const issueNumberByProject = new Map<string, number>();

  async function fetchImpl(url: string | URL, init?: RequestInit): Promise<Response> {
    const parsed = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    // Round 14: only the Atlassian gateway path, only with the user's Bearer token.
    if (
      parsed.host !== 'api.atlassian.com' ||
      !parsed.pathname.startsWith(`/ex/jira/${CLOUD_ID}/`)
    ) {
      throw new Error(`fake Jira fetch: unexpected target ${parsed.host}${parsed.pathname}`);
    }
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${TEST_ACCESS_TOKEN}`) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const pathname = parsed.pathname.slice(`/ex/jira/${CLOUD_ID}`.length);

    if (method === 'POST' && pathname === '/rest/api/3/issue') {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            fields: {
              project: { key: string };
              issuetype: { name: string };
              summary: string;
              labels?: string[];
              description?: unknown;
              parent?: { key: string };
            };
          })
        : { fields: { project: { key: '' }, issuetype: { name: '' }, summary: '' } };
      const projectKey = body.fields.project.key;
      const nextNumber = (issueNumberByProject.get(projectKey) ?? 0) + 1;
      issueNumberByProject.set(projectKey, nextNumber);
      const key = `${projectKey}-${nextNumber}`;
      const id = String(nextFakeJiraNumericId++);
      const issue: FakeJiraIssue = {
        id,
        key,
        projectKey,
        summary: body.fields.summary,
        labels: body.fields.labels ?? [],
        descriptionText: extractDescriptionText(body.fields.description),
        parentKey: body.fields.parent?.key ?? null,
      };
      issuesByKey.set(key, issue);
      return jsonResponse(201, { id, key, self: `${FAKE_SITE_URL}/rest/api/3/issue/${id}` });
    }

    if (method === 'POST' && pathname === '/rest/api/3/search/jql') {
      const body = init?.body ? (JSON.parse(String(init.body)) as { jql: string }) : { jql: '' };
      const jql = body.jql;
      const projectMatch = /project = "([^"]+)"/.exec(jql);
      const labelMatch = /labels = "([^"]+)"/.exec(jql);
      const textMatch = /text ~ "([^"]+)"/.exec(jql);
      let matches = [...issuesByKey.values()];
      if (projectMatch) matches = matches.filter((issue) => issue.projectKey === projectMatch[1]);
      if (labelMatch) matches = matches.filter((issue) => issue.labels.includes(labelMatch[1]!));
      if (textMatch)
        matches = matches.filter((issue) => issue.descriptionText.includes(textMatch[1]!));
      return jsonResponse(200, {
        issues: matches.map((issue) => ({ id: issue.id, key: issue.key })),
      });
    }

    throw new Error(`fake Jira fetch: unhandled ${method} ${pathname}`);
  }

  return { fetch: fetchImpl, issuesByKey };
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

// Thin wrapper implementing "simulate a lost response" (ERD 7.2 / TR 30.2) on
// top of the fake Jira above - same technique
// tests/integration/external/github.test.ts's own `createResponseDropper`
// already uses (itself adapted from scripts/spike-github-reconciliation.mts),
// keyed here on the issue's marker LABEL rather than a repo name (Jira's own
// deterministic-target analogue - `markerFor`/`sendCreateIssue` in
// src/external/jira/index.ts). The underlying call always runs to
// completion - the real fake-Jira issue genuinely gets created, carrying the
// marker label; only the caller's view of the create response is lost.
function createResponseDropper(
  underlyingFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
) {
  const dropNextResponseFor = new Set<string>();

  function simulateLostResponseFor(marker: string): void {
    dropNextResponseFor.add(marker);
  }

  async function fetchWithDrop(url: string | URL, init?: RequestInit): Promise<Response> {
    const { pathname } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    let dropKey: string | undefined;
    if (method === 'POST' && pathname.endsWith('/rest/api/3/issue') && init?.body) {
      const body = JSON.parse(String(init.body)) as { fields?: { labels?: string[] } };
      const marker = body.fields?.labels?.[0];
      if (marker && dropNextResponseFor.has(marker)) dropKey = marker;
    }
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

/**
 * Advances the FAKE clock past jira's 90s RECONCILIATION_THRESHOLD_MS
 * (src/external/operations/index.ts) - same technique
 * tests/integration/external/github.test.ts's own
 * `withClockAdvancedPastThreshold` already uses (itself matching
 * tests/integration/external/operations.test.ts): only `Date` is faked, real
 * Testcontainers I/O is unaffected. E4-S2's own postmortem found this
 * technique corrupted a shared Octokit rate-limiting plugin when applied to
 * GitHub's client - `jira`'s client here is plain `fetch`-based with no such
 * plugin (no Octokit involved at all), so that specific hazard does not
 * apply.
 */
async function withClockAdvancedPastThreshold<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 95_000);
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe('jira (E4-S3 / SCRUM-52)', () => {
  describe('T12 - S-12 changes after THR-42 exists, then export', () => {
    it('Skip / Create New prompt; no update, no silent duplicate', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'jira T12' });
      const artifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'epic',
      });
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'story',
      });

      const v1 = await approveBacklogVersion(sql, artifactId, 1, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const fake = createFakeJira();
      const ctx = await ctxForVersion(v1);
      const v1Refs = await withFakeFetch(fake.fetch, () => jira.exportBacklog(v1, new Map(), ctx));
      expect(v1Refs).toHaveLength(2); // 1 Epic + 1 Story

      const originalStoryRef = (await jiraRefRowsForItem(story.itemVersionId))[0];
      expect(originalStoryRef?.external_key).toBeTruthy();
      const originalStoryKey = originalStoryRef!.external_key;

      // S-12 changes: a new ItemVersion under the SAME LogicalItem.
      const storyV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: story.logicalItemId,
        revisionNumber: 2,
      });
      const v2 = await approveBacklogVersion(sql, artifactId, 2, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: storyV2ItemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      // Skip / Create New prompt appears for the changed Story.
      const ctx2 = await ctxForVersion(v2);
      const preview = await jira.previewExport(v2, ctx2);
      expect(preview.skipped).toContainEqual(
        expect.objectContaining({
          kind: 'needs_decision',
          logicalItemId: story.logicalItemId,
          displayKey: story.displayKey,
        }),
      );
      expect(preview.connection).toEqual({
        status: 'active',
        targetReady: true,
        accountName: null,
      });

      // No decision supplied -> refuses loudly. Never a silent skip or a
      // silent duplicate.
      await expect(jira.exportBacklog(v2, new Map(), ctx2)).rejects.toThrow(
        jira.MissingExportDecisionError,
      );

      // Skip -> the existing Jira issue (THR-42-equivalent) is untouched;
      // no new operation/ref for the new ItemVersion.
      await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(v2, new Map([[story.logicalItemId, 'skip']]), ctx2),
      );
      expect(await jiraRefRowsForItem(story.itemVersionId)).toHaveLength(1); // still just the original
      expect(await jiraRefRowsForItem(storyV2ItemVersionId)).toHaveLength(0); // nothing new

      // Create New -> a genuinely NEW Jira issue is created (never an update
      // of the old one, never a silent duplicate reusing the old key).
      const afterCreateNew = await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(v2, new Map([[story.logicalItemId, 'create_new']]), ctx2),
      );
      const newStoryRef = afterCreateNew.find(
        (ref) => ref.sourceItemVersionId === storyV2ItemVersionId,
      );
      expect(newStoryRef).toBeDefined();
      expect(newStoryRef!.externalKey).not.toBe(originalStoryKey);
      expect(await jiraRefRowsForItem(storyV2ItemVersionId)).toHaveLength(1);
      // The original THR-42-equivalent issue was never mutated - still the
      // only ref for the OLD ItemVersion, still its own distinct fake issue.
      expect(await jiraRefRowsForItem(story.itemVersionId)).toHaveLength(1);
    });
  });

  describe('T26 - export the same Backlog twice with a different configured Jira project in between', () => {
    it('second export creates new operations (target-specific keys); no completed operation is reused for the new target', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'jira T26' });
      const artifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'epic',
      });
      const versionId = await approveBacklogVersion(sql, artifactId, 1, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
      ]);

      const fake = createFakeJira();

      // First export, the project's chosen Jira project is ALPHA.
      const alphaCtx = await ctxForVersion(versionId, {
        jiraCloudId: CLOUD_ID,
        jiraProjectKey: 'ALPHA',
      });
      const alphaRefs = await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(versionId, new Map(), alphaCtx),
      );
      expect(alphaRefs).toHaveLength(1);

      // The project's target is changed to a DIFFERENT Jira project, BETA
      // (PATCH .../targets). It is just another ctx now - nothing is read from
      // the environment any more, so no module reset is needed.
      const betaCtx = { ...alphaCtx, jiraProjectKey: 'BETA' };

      // Switching the chosen project alone must NOT resurface an unnecessary
      // Skip/Create-New prompt (FR-074 is scoped to the chosen site + project,
      // ERD 7.4) - nothing has been exported to BETA yet, so this is a plain,
      // undecided-free export.
      const betaPreview = await jira.previewExport(versionId, betaCtx);
      expect(betaPreview.skipped).toHaveLength(0);

      const betaRefs = await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(versionId, new Map(), betaCtx),
      );
      expect(betaRefs).toHaveLength(1);

      const operations = await jiraOperationRows(projectId);
      expect(operations).toHaveLength(2); // target-specific keys, never one row reused
      expect(operations[0]!.operation_key).toBe(`jira:create_issue:ALPHA:${epic.itemVersionId}`);
      expect(operations[1]!.operation_key).toBe(`jira:create_issue:BETA:${epic.itemVersionId}`);
      expect(operations[0]!.status).toBe('completed');
      expect(operations[1]!.status).toBe('completed');

      const refs = await jiraRefRowsForItem(epic.itemVersionId);
      expect(refs).toHaveLength(2); // one per target, no completed operation reused
      expect(new Set(refs.map((ref) => ref.external_key)).size).toBe(2); // genuinely different issues
    });
  });

  describe('T41 - edit Epic E-01, re-approve, re-export, choose Skip for E-01', () => {
    it('Skip/Create-New prompt for the Epic; no second Jira Epic; Stories parent to the existing Jira Epic', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'jira T41' });
      const artifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'epic',
      });
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'story',
      });

      const v1 = await approveBacklogVersion(sql, artifactId, 1, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const fake = createFakeJira();
      const ctx = await ctxForVersion(v1);
      await withFakeFetch(fake.fetch, () => jira.exportBacklog(v1, new Map(), ctx));
      const originalEpicRef = (await jiraRefRowsForItem(epic.itemVersionId))[0];
      const originalEpicKey = originalEpicRef!.external_key!;

      // Edit E-01's title: a new ItemVersion under the SAME Epic LogicalItem.
      // The Story is UNCHANGED (INV-010: unchanged items reuse their
      // ItemVersion) - the new Backlog version's own membership row for the
      // Story points at the SAME item_version_id as v1.
      const epicV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: epic.logicalItemId,
        revisionNumber: 2,
      });
      const v2 = await approveBacklogVersion(sql, artifactId, 2, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epicV2ItemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      // Skip/Create-New prompt appears for the Epic (FR-074 extended).
      const preview = await jira.previewExport(v2, ctx);
      expect(preview.skipped).toContainEqual(
        expect.objectContaining({
          kind: 'needs_decision',
          logicalItemId: epic.logicalItemId,
          displayKey: epic.displayKey,
        }),
      );

      // Choose Skip for E-01.
      const exported = await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(v2, new Map([[epic.logicalItemId, 'skip']]), ctx),
      );

      // No second Jira Epic is created.
      expect(await jiraRefRowsForItem(epicV2ItemVersionId)).toHaveLength(0);
      expect(await jiraRefRowsForItem(epic.itemVersionId)).toHaveLength(1); // still just the original
      const epicIssuesInFake = [...fake.issuesByKey.values()].filter(
        (issue) =>
          issue.labels.includes(`tl-${epic.itemVersionId}`) ||
          issue.labels.includes(`tl-${epicV2ItemVersionId}`),
      );
      expect(epicIssuesInFake).toHaveLength(1); // only the v1 Epic issue exists

      // Its Story is parented to the EXISTING Jira Epic of E-01 (idempotent
      // reuse of the unchanged Story's own already-completed operation still
      // resolves the SAME, original epic key as parent).
      const storyRef = exported.find((ref) => ref.sourceItemVersionId === story.itemVersionId);
      expect(storyRef).toBeDefined();
      const fakeStoryIssue = fake.issuesByKey.get(storyRef!.externalKey!);
      expect(fakeStoryIssue?.parentKey).toBe(originalEpicKey);
    });
  });

  describe('issue content (FR-071) - regression: issues were created with only the display key', () => {
    it('sends the Epic title / Story user story, behavior and acceptance criteria, and keeps the marker in the description', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'jira issue content' });
      const artifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const epicItem = await fx.createLogicalItem(sql, { projectId, artifactId, itemType: 'epic' });
      const epicItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: epicItem.id,
        payload: {
          title: 'Project intake',
          scopeStatement: 'Capturing the brief and the project setup.',
          explanation: 'model prose',
        },
      });
      const storyItem = await fx.createLogicalItem(sql, {
        projectId,
        artifactId,
        itemType: 'story',
      });
      const storyItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: storyItem.id,
        payload: {
          userValueStatement: 'As a PM, I want to paste a brief, so that a project is created.',
          structuredBehavior: 'Saves the brief and opens the new project.',
          acceptanceCriteria: ['Brief is saved', 'Project page opens'],
          priority: 'high',
          explanation: 'model prose',
        },
      });

      const v1 = await approveBacklogVersion(sql, artifactId, 1, [
        { logicalItemId: epicItem.id, itemVersionId: epicItemVersionId },
        {
          logicalItemId: storyItem.id,
          itemVersionId: storyItemVersionId,
          parentLogicalItemId: epicItem.id,
        },
      ]);

      const fake = createFakeJira();
      const ctx = await ctxForVersion(v1);
      const refs = await withFakeFetch(fake.fetch, () => jira.exportBacklog(v1, new Map(), ctx));
      expect(refs).toHaveLength(2);

      const issues = [...fake.issuesByKey.values()];
      const epicIssue = issues.find((issue) => issue.labels.includes(`tl-${epicItemVersionId}`));
      const storyIssue = issues.find((issue) => issue.labels.includes(`tl-${storyItemVersionId}`));
      expect(epicIssue).toBeDefined();
      expect(storyIssue).toBeDefined();

      expect(epicIssue!.summary).toBe(`${epicItem.displayKey}: Project intake`);
      expect(epicIssue!.descriptionText).toContain('Capturing the brief and the project setup.');

      expect(storyIssue!.summary).toBe(
        `${storyItem.displayKey}: As a PM, I want to paste a brief, so that a project is created.`,
      );
      expect(storyIssue!.descriptionText).toContain('Saves the brief and opens the new project.');
      expect(storyIssue!.descriptionText).toContain('Priority: high');
      expect(storyIssue!.descriptionText).not.toContain('model prose');

      // The backup marker (TR 30.2) must survive the richer description.
      expect(epicIssue!.descriptionText).toContain(`tl-${epicItemVersionId}`);
      expect(storyIssue!.descriptionText).toContain(`tl-${storyItemVersionId}`);
    });
  });

  describe('reconciliation-adoption regression (invariant-reviewer finding, E4-S3)', () => {
    it('a Story ref adopted via RECONCILIATION (not a direct 201) still surfaces the FR-074 Skip/Create-New prompt on re-export - never a silent duplicate', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, {
        name: 'jira reconciliation regression',
      });
      const artifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'epic',
      });
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'story',
      });

      const v1 = await approveBacklogVersion(sql, artifactId, 1, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const fake = createFakeJira();
      const dropper = createResponseDropper(fake.fetch);
      const storyMarker = `tl-${story.itemVersionId}`;

      // First export: the Epic's create succeeds normally (a direct 201);
      // the STORY's create response is lost. The real fake-Jira issue is
      // still created underneath (same as github.test.ts's own dropper) -
      // only the caller's view of it is dropped. `exportOneItem` swallows
      // the resulting ambiguous error (ERD 7.1: one item's ambiguous failure
      // never aborts the rest of the batch) - the Story is simply absent
      // from this call's own return value, and its own operation row is
      // left `pending` (R6/R9), never `failed`.
      dropper.simulateLostResponseFor(storyMarker);
      const ctx = await ctxForVersion(v1);
      const v1Refs = await withFakeFetch(dropper.fetch, () =>
        jira.exportBacklog(v1, new Map(), ctx),
      );
      expect(v1Refs.some((ref) => ref.sourceItemVersionId === epic.itemVersionId)).toBe(true);
      expect(v1Refs.some((ref) => ref.sourceItemVersionId === story.itemVersionId)).toBe(false);

      const afterLoss = await jiraOperationRows(projectId);
      const storyOpAfterLoss = afterLoss.find((row) =>
        row.operation_key.endsWith(`:${story.itemVersionId}`),
      );
      expect(storyOpAfterLoss?.status).toBe('pending');

      // Second call, past the reconciliation threshold, WITHOUT the drop:
      // the Story's operation is now old enough to move to
      // `reconciliation_required`, and `reconcileIssue` adopts the real fake
      // issue it finds by marker label - NOT a direct send() success. This
      // is exactly the path the reviewer's bug lived on: before the fix,
      // `reconcileAndFinalize` never forwarded `metadata`, so this ref would
      // persist with `metadata: {}` and no `jiraProjectKey` at all.
      const v1RefsAgain = await withClockAdvancedPastThreshold(() =>
        withFakeFetch(fake.fetch, () => jira.exportBacklog(v1, new Map(), ctx)),
      );
      const reconciledStoryRef = v1RefsAgain.find(
        (ref) => ref.sourceItemVersionId === story.itemVersionId,
      );
      expect(reconciledStoryRef).toBeDefined();

      const afterReconcile = await jiraOperationRows(projectId);
      const storyOpsAfterReconcile = afterReconcile.filter((row) =>
        row.operation_key.endsWith(`:${story.itemVersionId}`),
      );
      // Exactly one operation row for the Story throughout (ERD 7.1) - the
      // ambiguous first attempt was reconciled in place, never retried as a
      // brand-new operation.
      expect(storyOpsAfterReconcile).toHaveLength(1);
      expect(storyOpsAfterReconcile[0]!.status).toBe('completed');

      // A real change: a new ItemVersion under the SAME Story LogicalItem.
      const storyV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: story.logicalItemId,
        revisionNumber: 2,
      });
      const v2 = await approveBacklogVersion(sql, artifactId, 2, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: storyV2ItemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      // The regression check itself: the FR-074 Skip/Create-New prompt must
      // still appear for the changed Story, even though its ORIGINAL ref was
      // adopted via reconciliation rather than a direct send() success.
      // Before the fix, the reconciled ref's missing `metadata.jiraProjectKey`
      // meant `refsInConfiguredProject` filtered it out entirely,
      // `resolveDecisionNeed` saw zero refs "in the configured project", and
      // this Story would be silently treated as brand new (a silent
      // duplicate on export, exactly what FR-074 forbids).
      const preview = await jira.previewExport(v2, ctx);
      expect(preview.skipped).toContainEqual(
        expect.objectContaining({
          kind: 'needs_decision',
          logicalItemId: story.logicalItemId,
          displayKey: story.displayKey,
        }),
      );

      // No decision supplied -> refuses loudly, never a silent duplicate.
      await expect(jira.exportBacklog(v2, new Map(), ctx)).rejects.toThrow(
        jira.MissingExportDecisionError,
      );
    });
  });

  describe('round 14 - per-user credential (SCRUM-97, ERD 7.4 / 7.6)', () => {
    async function twoItemBacklog(name: string) {
      const { projectId } = await fx.createProjectWithOwner(sql, { name });
      const artifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'epic',
      });
      const versionId = await approveBacklogVersion(sql, artifactId, 1, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
      ]);
      return { projectId, epic, versionId };
    }

    it('snapshots cloudId, projectKey and account_id into target_descriptor and records the connection on the operation', async () => {
      const { projectId, epic, versionId } = await twoItemBacklog('jira descriptor');
      const ctx = await ctxForVersion(versionId);
      const fake = createFakeJira();

      await withFakeFetch(fake.fetch, () => jira.exportBacklog(versionId, new Map(), ctx));

      const [op] = await sql<
        { connection_id: string | null; target_descriptor: Record<string, unknown> }[]
      >`SELECT connection_id, target_descriptor FROM external_operation
        WHERE project_id = ${projectId} AND provider = 'jira'`;
      expect(op!.connection_id).not.toBeNull();
      expect(op!.target_descriptor).toMatchObject({
        cloudId: CLOUD_ID,
        projectKey: DEFAULT_PROJECT_KEY,
        account_id: `atl-${ctx.userId}`,
        itemType: 'epic',
      });
      expect(JSON.stringify(op!.target_descriptor)).not.toContain(TEST_ACCESS_TOKEN);
      const [refRow] = await sql<{ external_url: string | null }[]>`
        SELECT external_url FROM external_ref
        WHERE provider = 'jira' AND source_item_version_id = ${epic.itemVersionId}`;
      expect(refRow!.external_url).toMatch(new RegExp(`^${FAKE_SITE_URL}/browse/`));
    });

    it('FR-074 is scoped to the operation target: a ref made in another Jira project never counts as already exported', async () => {
      const { epic, versionId } = await twoItemBacklog('jira scoped decision');
      const alphaCtx = await ctxForVersion(versionId, {
        jiraCloudId: CLOUD_ID,
        jiraProjectKey: 'ALPHA',
      });
      const fake = createFakeJira();
      await withFakeFetch(fake.fetch, () => jira.exportBacklog(versionId, new Map(), alphaCtx));

      // A new Epic ItemVersion approved afterwards: needs a decision in ALPHA, none in BETA.
      const [artifactRow] = await sql<{ artifact_id: string; project_id: string }[]>`
        SELECT av.artifact_id, a.project_id FROM artifact_version av
        JOIN artifact a ON a.id = av.artifact_id WHERE av.id = ${versionId}`;
      const epicV2 = await fx.createItemVersion(sql, {
        projectId: artifactRow!.project_id,
        logicalItemId: epic.logicalItemId,
        revisionNumber: 2,
      });
      const v2 = await approveBacklogVersion(sql, artifactRow!.artifact_id, 2, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epicV2 },
      ]);

      const inAlpha = await jira.previewExport(v2, alphaCtx);
      expect(inAlpha.skipped).toContainEqual(
        expect.objectContaining({ kind: 'needs_decision', logicalItemId: epic.logicalItemId }),
      );
      const inBeta = await jira.previewExport(v2, { ...alphaCtx, jiraProjectKey: 'BETA' });
      expect(inBeta.skipped).toHaveLength(0);
    });

    it('no connection -> ConnectionRequiredError and NO external_operation row; the preview still works', async () => {
      const { projectId, versionId } = await twoItemBacklog('jira no connection');
      const userId = await ownerOfBacklogVersion(versionId);
      const ctx = { userId, jiraCloudId: CLOUD_ID, jiraProjectKey: DEFAULT_PROJECT_KEY };

      const preview = await jira.previewExport(versionId, ctx);
      expect(preview.connection).toEqual({ status: 'none', targetReady: true, accountName: null });
      await expect(jira.exportBacklog(versionId, new Map(), ctx)).rejects.toBeInstanceOf(
        connections.ConnectionRequiredError,
      );
      expect(await jiraOperationRows(projectId)).toHaveLength(0);
    });

    it('no Jira target -> JiraTargetRequiredError and NO external_operation row', async () => {
      const { projectId, versionId } = await twoItemBacklog('jira no target');
      const ctx = await ctxForVersion(versionId, {});

      const preview = await jira.previewExport(versionId, ctx);
      expect(preview.connection.targetReady).toBe(false);
      await expect(jira.exportBacklog(versionId, new Map(), ctx)).rejects.toBeInstanceOf(
        jira.JiraTargetRequiredError,
      );
      expect(await jiraOperationRows(projectId)).toHaveLength(0);
    });

    it('T49 (jira half): a 401 from Jira marks the connection needs_reauth and leaves the operation pending - never failed, no ref', async () => {
      const { projectId, epic, versionId } = await twoItemBacklog('jira 401');
      const ctx = await ctxForVersion(versionId);
      const unauthorized = async () =>
        new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });

      await expect(
        withFakeFetch(unauthorized, () => jira.exportBacklog(versionId, new Map(), ctx)),
      ).rejects.toBeInstanceOf(connections.ReconnectRequiredError);

      const rows = await jiraOperationRows(projectId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('pending');
      expect(await jiraRefRowsForItem(epic.itemVersionId)).toHaveLength(0);
      const status = (await connections.listConnections(ctx.userId)).find(
        (c) => c.provider === 'jira',
      );
      expect(status?.status).toBe('needs_reauth');
    });

    it('T51 (jira half): a retry after the connected account changed is ReconnectRequired before any request', async () => {
      const { projectId, epic, versionId } = await twoItemBacklog('jira account mismatch');
      const ctx = await ctxForVersion(versionId);
      // Leave a pending operation behind: the create response is lost.
      const fake = createFakeJira();
      const dropper = createResponseDropper(fake.fetch);
      dropper.simulateLostResponseFor(`tl-${epic.itemVersionId}`);
      await withFakeFetch(dropper.fetch, () => jira.exportBacklog(versionId, new Map(), ctx));
      const [op] = await sql<{ id: string }[]>`
        SELECT id FROM external_operation WHERE project_id = ${projectId} AND provider = 'jira'`;

      await ensureConnection(ctx.userId, 'atl-a-different-account');
      let requests = 0;
      await expect(
        withClockAdvancedPastThreshold(() =>
          withFakeFetch(
            async (url, init) => {
              requests += 1;
              return fake.fetch(url, init);
            },
            () => jira.retryOperation(op!.id, ctx),
          ),
        ),
      ).rejects.toBeInstanceOf(connections.ReconnectRequiredError);
      expect(requests).toBe(0);
      expect((await jiraOperationRows(projectId))[0]!.status).toBe('pending');

      // The original account resumes and reconciles the same operation.
      await ensureConnection(ctx.userId);
      const retried = await withClockAdvancedPastThreshold(() =>
        withFakeFetch(fake.fetch, () => jira.retryOperation(op!.id, ctx)),
      );
      expect(retried.status).toBe('completed');
      expect(await jiraOperationRows(projectId)).toHaveLength(1);
    });
  });
});
