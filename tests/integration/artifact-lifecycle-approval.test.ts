import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');
let impact: typeof import('@/lineage/impact');
let withTx: typeof import('@/db').withTx;

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
  impact = await import('@/lineage/impact');
  ({ withTx } = await import('@/db'));
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function draftWithItem(
  artifactId: string,
  item: { logicalItemId: string; itemVersionId: string },
  versionNumber: number,
): Promise<string> {
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber });
  await fx.createMembership(sql, { artifactVersionId: versionId, artifactId, ...item });
  return versionId;
}

async function status(versionId: string): Promise<string> {
  const [row] = await sql<{ status: string }[]>`
    select status from artifact_version where id = ${versionId}
  `;
  return row!.status;
}

async function waitForQueuedApprovals(holderPid: number, count: number): Promise<void> {
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
    if (row!.waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${count} queued project approvals`);
}

describe('approveVersion (ERD 3.4/6.5; FR-083)', () => {
  it('T6: blocks a candidate with an unacknowledged impacted member and rolls back', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await draftWithItem(reqArtifactId, requirement, 1);
    expect(await lifecycle.approveVersion(reqV1, userId)).toEqual({ ok: true });

    const requirementV2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: requirement.logicalItemId,
      revisionNumber: 2,
    });
    const reqV2 = await draftWithItem(
      reqArtifactId,
      {
        logicalItemId: requirement.logicalItemId,
        itemVersionId: requirementV2,
      },
      2,
    );
    expect(await lifecycle.approveVersion(reqV2, userId)).toEqual({ ok: true });

    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: requirement.itemVersionId,
    });
    const backlogDraft = await draftWithItem(backlogArtifactId, story, 1);
    const result = await lifecycle.approveVersion(backlogDraft, userId);
    expect(result).toMatchObject({
      ok: false,
      blocking: [
        { subjectId: story.itemVersionId, rootItemVersionId: requirement.itemVersionId, depth: 0 },
      ],
    });
    expect(await status(backlogDraft)).toBe('draft');
    const events =
      await sql`select id from approval_event where artifact_version_id = ${backlogDraft}`;
    expect(events).toHaveLength(0);
  });

  it('T6 / FR-083: blocks a transitively impacted candidate member', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const uiArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await draftWithItem(reqArtifactId, requirement, 1);
    expect(await lifecycle.approveVersion(reqV1, userId)).toEqual({ ok: true });
    const uiItem = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: uiArtifactId,
      itemType: 'ui_requirement',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: uiItem.itemVersionId,
      upstreamItemVersionId: requirement.itemVersionId,
    });
    const uiVersion = await draftWithItem(uiArtifactId, uiItem, 1);
    expect(await lifecycle.approveVersion(uiVersion, userId)).toEqual({ ok: true });
    const requirementV2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: requirement.logicalItemId,
      revisionNumber: 2,
    });
    const reqV2 = await draftWithItem(
      reqArtifactId,
      {
        logicalItemId: requirement.logicalItemId,
        itemVersionId: requirementV2,
      },
      2,
    );
    expect(await lifecycle.approveVersion(reqV2, userId)).toEqual({ ok: true });

    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: uiItem.itemVersionId,
    });
    const backlogDraft = await draftWithItem(backlogArtifactId, story, 1);
    expect(await lifecycle.approveVersion(backlogDraft, userId)).toMatchObject({
      ok: false,
      blocking: [
        {
          subjectId: story.itemVersionId,
          rootItemVersionId: requirement.itemVersionId,
          depth: 1,
          path: [requirement.itemVersionId, uiItem.itemVersionId, story.itemVersionId],
        },
      ],
    });
    expect(await status(backlogDraft)).toBe('draft');
  });

  it('T10: serializes two attempts to approve the same draft', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
    });
    const draft = await draftWithItem(artifactId, requirement, 1);
    const outcomes = await Promise.allSettled([
      lifecycle.approveVersion(draft, userId),
      lifecycle.approveVersion(draft, userId),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await status(draft)).toBe('approved');
    const events =
      await sql`select id from approval_event where artifact_version_id = ${draft} and action = 'approved'`;
    expect(events).toHaveLength(1);
  });

  it('T10: serializes concurrent approvals of Requirements and Backlog', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    const reqV1 = await draftWithItem(reqArtifactId, requirement, 1);
    expect(await lifecycle.approveVersion(reqV1, userId)).toEqual({ ok: true });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: requirement.itemVersionId,
    });
    const requirementV2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: requirement.logicalItemId,
      revisionNumber: 2,
    });
    const reqDraft = await draftWithItem(
      reqArtifactId,
      {
        logicalItemId: requirement.logicalItemId,
        itemVersionId: requirementV2,
      },
      2,
    );
    const backlogDraft = await draftWithItem(backlogArtifactId, story, 1);

    let approveRequirements!: ReturnType<typeof lifecycle.approveVersion>;
    let approveBacklog!: ReturnType<typeof lifecycle.approveVersion>;
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
      const [holder] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      approveRequirements = lifecycle.approveVersion(reqDraft, userId);
      await waitForQueuedApprovals(holder!.pid, 1);
      approveBacklog = lifecycle.approveVersion(backlogDraft, userId);
      await waitForQueuedApprovals(holder!.pid, 2);
    });
    const [requirementResult, backlogResult] = await Promise.all([
      approveRequirements,
      approveBacklog,
    ]);
    expect(requirementResult).toEqual({ ok: true });
    expect(backlogResult).toMatchObject({
      ok: false,
      blocking: [{ subjectId: story.itemVersionId, rootItemVersionId: requirement.itemVersionId }],
    });
    expect(await status(reqV1)).toBe('superseded');
    expect(await status(reqDraft)).toBe('approved');
    expect(await status(backlogDraft)).toBe('draft');
  });

  it('T22/T23: a Requirements candidate replaces the acknowledged current root without an error', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await draftWithItem(reqArtifactId, requirement, 1);
    expect(await lifecycle.approveVersion(reqV1, userId)).toEqual({ ok: true });
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: requirement.itemVersionId,
    });
    const backlog = await draftWithItem(backlogArtifactId, story, 1);
    expect(await lifecycle.approveVersion(backlog, userId)).toEqual({ ok: true });

    const requirementV2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: requirement.logicalItemId,
      revisionNumber: 2,
    });
    const reqV2 = await draftWithItem(
      reqArtifactId,
      {
        logicalItemId: requirement.logicalItemId,
        itemVersionId: requirementV2,
      },
      2,
    );
    expect(await lifecycle.approveVersion(reqV2, userId)).toEqual({ ok: true });
    await withTx((tx) =>
      impact.acknowledge(tx, {
        projectId,
        userId,
        subject: { itemVersionId: story.itemVersionId },
        obsoleteUpstreamItemVersionId: requirement.itemVersionId,
      }),
    );
    expect(
      (await impact.getWarnings(projectId)).find((row) => row.subjectId === story.itemVersionId)
        ?.acknowledged,
    ).toBe(true);

    const requirementV3 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: requirement.logicalItemId,
      revisionNumber: 3,
    });
    const reqV3 = await draftWithItem(
      reqArtifactId,
      {
        logicalItemId: requirement.logicalItemId,
        itemVersionId: requirementV3,
      },
      3,
    );
    const candidateWarnings = await sql<{ subject_id: string; acknowledged: boolean }[]>`
      select subject_id, acknowledged from impact(${projectId}::uuid, ${reqV3}::uuid)
      where subject_id = ${story.itemVersionId}::uuid
    `;
    expect(candidateWarnings).toHaveLength(1);
    expect(candidateWarnings[0]).toMatchObject({
      subject_id: story.itemVersionId,
      acknowledged: false,
    });
    expect(await lifecycle.approveVersion(reqV3, userId)).toEqual({ ok: true });
    expect(
      (await impact.getWarnings(projectId)).find((row) => row.subjectId === story.itemVersionId),
    ).toMatchObject({
      rootItemVersionId: requirement.itemVersionId,
      acknowledged: false,
    });
  });

  it('refuses Architecture while selected-option materialization is unavailable', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const draft = await fx.createDraftArtifactVersion(sql, artifactId);
    await expect(lifecycle.approveVersion(draft, userId)).rejects.toBeInstanceOf(
      lifecycle.ArchitectureMaterializationUnavailableError,
    );
    expect(await status(draft)).toBe('draft');
  });
});
