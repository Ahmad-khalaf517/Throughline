import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
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

let sql: postgres.Sql;
let jira: typeof import('@/external/jira');

const JIRA_BASE_URL = 'https://fake-jira.example.test';
const JIRA_EMAIL = 'throughline-test@example.test';
const JIRA_API_TOKEN = 'fake-jira-token';
const DEFAULT_PROJECT_KEY = 'THRLN';

beforeAll(async () => {
  sql = connect();
  const connectionUri = inject('pgConnectionUri');
  process.env.DATABASE_URL = connectionUri;
  process.env.DIRECT_DATABASE_URL = connectionUri;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.JIRA_BASE_URL = JIRA_BASE_URL;
  process.env.JIRA_EMAIL = JIRA_EMAIL;
  process.env.JIRA_API_TOKEN = JIRA_API_TOKEN;
  process.env.JIRA_PROJECT_KEY = DEFAULT_PROJECT_KEY;

  jira = await import('@/external/jira');
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
    const { pathname } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();

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
        labels: body.fields.labels ?? [],
        descriptionText: extractDescriptionText(body.fields.description),
        parentKey: body.fields.parent?.key ?? null,
      };
      issuesByKey.set(key, issue);
      return jsonResponse(201, { id, key, self: `${JIRA_BASE_URL}/rest/api/3/issue/${id}` });
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
      const v1Refs = await withFakeFetch(fake.fetch, () => jira.exportBacklog(v1, new Map()));
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
      const preview = await jira.previewExport(v2);
      expect(preview.skipped).toContainEqual(
        expect.objectContaining({
          kind: 'needs_decision',
          logicalItemId: story.logicalItemId,
          displayKey: story.displayKey,
        }),
      );

      // No decision supplied -> refuses loudly. Never a silent skip or a
      // silent duplicate.
      await expect(jira.exportBacklog(v2, new Map())).rejects.toThrow(
        jira.MissingExportDecisionError,
      );

      // Skip -> the existing Jira issue (THR-42-equivalent) is untouched;
      // no new operation/ref for the new ItemVersion.
      await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(v2, new Map([[story.logicalItemId, 'skip']])),
      );
      expect(await jiraRefRowsForItem(story.itemVersionId)).toHaveLength(1); // still just the original
      expect(await jiraRefRowsForItem(storyV2ItemVersionId)).toHaveLength(0); // nothing new

      // Create New -> a genuinely NEW Jira issue is created (never an update
      // of the old one, never a silent duplicate reusing the old key).
      const afterCreateNew = await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(v2, new Map([[story.logicalItemId, 'create_new']])),
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

      // First export, configured project ALPHA.
      process.env.JIRA_PROJECT_KEY = 'ALPHA';
      vi.resetModules();
      const jiraAlpha = await import('@/external/jira');
      const alphaRefs = await withFakeFetch(fake.fetch, () =>
        jiraAlpha.exportBacklog(versionId, new Map()),
      );
      expect(alphaRefs).toHaveLength(1);

      // Reconfigure to a DIFFERENT Jira project, BETA - a fresh module
      // instance is required because `env` (src/lib/env.ts) is parsed once
      // at import time; `vi.resetModules()` forces every transitive import
      // (this module, external-operations, backlog, identity, db) to
      // re-evaluate against the now-current `process.env`, the same
      // technique used nowhere else in this repo yet but standard Vitest
      // module-registry behavior.
      process.env.JIRA_PROJECT_KEY = 'BETA';
      vi.resetModules();
      const jiraBeta = await import('@/external/jira');

      // Switching the configured project alone must NOT resurface an
      // unnecessary Skip/Create-New prompt (FR-074 is scoped to the
      // CONFIGURED project, ERD 7.4) - nothing has been exported to BETA
      // yet, so this is a plain, undecided-free export.
      const betaPreview = await jiraBeta.previewExport(versionId);
      expect(betaPreview.skipped).toHaveLength(0);

      const betaRefs = await withFakeFetch(fake.fetch, () =>
        jiraBeta.exportBacklog(versionId, new Map()),
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
      await withFakeFetch(fake.fetch, () => jira.exportBacklog(v1, new Map()));
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
      const preview = await jira.previewExport(v2);
      expect(preview.skipped).toContainEqual(
        expect.objectContaining({
          kind: 'needs_decision',
          logicalItemId: epic.logicalItemId,
          displayKey: epic.displayKey,
        }),
      );

      // Choose Skip for E-01.
      const exported = await withFakeFetch(fake.fetch, () =>
        jira.exportBacklog(v2, new Map([[epic.logicalItemId, 'skip']])),
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
});
