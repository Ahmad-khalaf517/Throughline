import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// artifact-lifecycle.createManualRevisionDraft + identity.copyMembership
// (ERD 3.6; TR FR-081; Jira E2-S7 / SCRUM-33). T40's pre-approval half only
// ("the draft initially shares every ItemVersion with the approved version
// and has no context refs") - the post-approval half needs approveVersion,
// which doesn't exist yet and closes out in E3-T1 (per Jira Plan E2-S7's own
// scope note).

type LifecycleModule = typeof import('@/artifact-lifecycle');

let sql: postgres.Sql;
let lifecycle: LifecycleModule;

beforeAll(async () => {
  sql = connect();
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  lifecycle = await import('@/artifact-lifecycle');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function artifactVersionRow(versionId: string) {
  const rows = await sql<
    {
      status: string;
      status_reason: string | null;
      base_approved_version_id: string | null;
      version_number: number;
    }[]
  >`SELECT status, status_reason, base_approved_version_id, version_number
     FROM artifact_version WHERE id = ${versionId}`;
  return rows[0]!;
}

async function membershipRows(versionId: string) {
  const rows = await sql<
    {
      logical_item_id: string;
      item_version_id: string;
      parent_logical_item_id: string | null;
      position: number | null;
    }[]
  >`SELECT logical_item_id, item_version_id, parent_logical_item_id, position
     FROM artifact_version_item_membership
     WHERE artifact_version_id = ${versionId}
     ORDER BY item_version_id`;
  return rows;
}

describe('artifact-lifecycle.createManualRevisionDraft + identity.copyMembership (ERD 3.6; TR FR-081)', () => {
  it('T40 (pre-approval half): the draft initially shares every ItemVersion and has no context refs', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const approvedVersionId = await fx.createDraftArtifactVersion(sql, requirementsId, {
      versionNumber: 1,
      payload: { note: 'approved payload' },
    });
    const r1 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: requirementsId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    const r2 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: requirementsId,
      itemType: 'requirement',
      displayKey: 'R-02',
    });
    await fx.createMembership(sql, {
      artifactVersionId: approvedVersionId,
      artifactId: requirementsId,
      logicalItemId: r1.logicalItemId,
      itemVersionId: r1.itemVersionId,
      position: 1,
    });
    await fx.createMembership(sql, {
      artifactVersionId: approvedVersionId,
      artifactId: requirementsId,
      logicalItemId: r2.logicalItemId,
      itemVersionId: r2.itemVersionId,
      position: 2,
    });
    await fx.approveArtifactVersion(sql, approvedVersionId);

    const draft = await lifecycle.createManualRevisionDraft(projectId, 'requirements', userId);

    expect(draft.status).toBe('draft');
    expect(draft.baseApprovedVersionId).toBe(approvedVersionId);
    expect(draft.schemaVersion).toBe(1);
    expect(draft.payload).toEqual({ note: 'approved payload' });

    // "shares every ItemVersion with the approved version": same
    // item_version_id / parent_logical_item_id / position, row for row.
    const approvedMembership = await membershipRows(approvedVersionId);
    const draftMembership = await membershipRows(draft.id);
    expect(approvedMembership).toHaveLength(2);
    expect(draftMembership).toEqual(approvedMembership);

    // "has no context refs": a manual revision draft contains no model
    // output, so no generation_context_ref row is ever written for it.
    const contextRefs = await sql<{ source_artifact_version_id: string }[]>`
      SELECT source_artifact_version_id FROM generation_context_ref
      WHERE target_artifact_version_id = ${draft.id}
    `;
    expect(contextRefs).toHaveLength(0);
  });

  it('replaces an existing draft with a rejected/draft_replaced approval_event', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const approvedVersionId = await fx.createDraftArtifactVersion(sql, requirementsId, {
      versionNumber: 1,
    });
    const r1 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: requirementsId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    await fx.createMembership(sql, {
      artifactVersionId: approvedVersionId,
      artifactId: requirementsId,
      logicalItemId: r1.logicalItemId,
      itemVersionId: r1.itemVersionId,
    });
    await fx.approveArtifactVersion(sql, approvedVersionId);

    // A leftover draft (e.g. from an earlier, unfinished revision) that the
    // new manual revision must reject before inserting its own draft.
    const staleDraftId = await fx.createDraftArtifactVersion(sql, requirementsId, {
      versionNumber: 2,
    });

    const draft = await lifecycle.createManualRevisionDraft(projectId, 'requirements', userId);

    expect(draft.versionNumber).toBe(3);

    const staleRow = await artifactVersionRow(staleDraftId);
    expect(staleRow.status).toBe('rejected');
    expect(staleRow.status_reason).toBe('replaced_by_regeneration');

    const events = await sql<{ action: string; actor_user_id: string }[]>`
      SELECT action, actor_user_id FROM approval_event WHERE artifact_version_id = ${staleDraftId}
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('draft_replaced');
    expect(events[0]?.actor_user_id).toBe(userId);

    const drafts = await sql<{ id: string }[]>`
      SELECT id FROM artifact_version WHERE artifact_id = ${requirementsId} AND status = 'draft'
    `;
    expect(drafts).toEqual([{ id: draft.id }]);
  });

  it('throws for Architecture - it has no manual revision path (ERD 3.6)', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const architectureId = await fx.createArtifact(sql, projectId, 'architecture');

    await expect(
      lifecycle.createManualRevisionDraft(projectId, 'architecture', userId),
    ).rejects.toThrow('createManualRevisionDraft has no Architecture path');

    const versions = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${architectureId}
    `;
    expect(Number(versions[0]!.count)).toBe(0);
  });

  it('copies Epic-before-Story membership for a Backlog artifact without an FK violation', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const backlogId = await fx.createArtifact(sql, projectId, 'backlog');
    const approvedVersionId = await fx.createDraftArtifactVersion(sql, backlogId, {
      versionNumber: 1,
    });
    const epic = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogId,
      itemType: 'epic',
      displayKey: 'E-01',
    });
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogId,
      itemType: 'story',
      displayKey: 'S-01',
    });
    await fx.createMembership(sql, {
      artifactVersionId: approvedVersionId,
      artifactId: backlogId,
      logicalItemId: epic.logicalItemId,
      itemVersionId: epic.itemVersionId,
      position: 1,
    });
    await fx.createMembership(sql, {
      artifactVersionId: approvedVersionId,
      artifactId: backlogId,
      logicalItemId: story.logicalItemId,
      itemVersionId: story.itemVersionId,
      parentLogicalItemId: epic.logicalItemId,
      position: 1,
    });
    await fx.approveArtifactVersion(sql, approvedVersionId);

    const draft = await lifecycle.createManualRevisionDraft(projectId, 'backlog', userId);

    const membership = await membershipRows(draft.id);
    expect(membership).toHaveLength(2);
    const epicRow = membership.find((row) => row.logical_item_id === epic.logicalItemId);
    const storyRow = membership.find((row) => row.logical_item_id === story.logicalItemId);
    expect(epicRow?.parent_logical_item_id).toBeNull();
    expect(epicRow?.item_version_id).toBe(epic.itemVersionId);
    expect(storyRow?.parent_logical_item_id).toBe(epic.logicalItemId);
    expect(storyRow?.item_version_id).toBe(story.itemVersionId);
  });
});
