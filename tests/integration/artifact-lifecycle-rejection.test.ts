import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');
let impact: typeof import('@/lineage/impact');

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
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const decisions = [
  { method: 'requestRevision', action: 'revision_requested', reason: 'revision_requested' },
  { method: 'rejectVersion', action: 'rejected', reason: 'user_rejected' },
] as const;

async function versionState(versionId: string) {
  const [row] = await sql<{ status: string; status_reason: string | null }[]>`
    select status, status_reason from artifact_version where id = ${versionId}
  `;
  return row!;
}

async function events(versionId: string) {
  return sql<
    {
      actor_user_id: string;
      action: string;
      feedback: string | null;
      overrode_stale_check: boolean;
    }[]
  >`
    select actor_user_id, action, feedback, overrode_stale_check
    from approval_event where artifact_version_id = ${versionId}
  `;
}

async function draftWithItem(
  artifactId: string,
  item: { logicalItemId: string; itemVersionId: string },
  versionNumber: number,
): Promise<string> {
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber });
  await fx.createMembership(sql, { artifactVersionId: versionId, artifactId, ...item });
  return versionId;
}

async function waitForQueuedTransitions(holderPid: number, count: number): Promise<void> {
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
  throw new Error(`timed out waiting for ${count} queued project transitions`);
}

describe.each(decisions)('$method (ERD 3.1/3.2; INV-002/003)', (decision) => {
  it('T5: Requirements v3 draft and rejection preserve current lineage and history', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogId = await fx.createArtifact(sql, projectId, 'backlog');
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
      displayKey: 'R-07',
    });
    const reqV1 = await draftWithItem(artifactId, requirement, 1);
    await lifecycle.approveVersion(reqV1, userId);
    const reqV2 = await draftWithItem(artifactId, requirement, 2);
    await lifecycle.approveVersion(reqV2, userId);
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: requirement.itemVersionId,
    });
    const backlog = await draftWithItem(backlogId, story, 1);
    await lifecycle.approveVersion(backlog, userId);

    const changedItemId = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: requirement.logicalItemId,
      revisionNumber: 2,
      payload: { text: 'R-07@D: changed draft content' },
    });
    const draft = await draftWithItem(
      artifactId,
      { logicalItemId: requirement.logicalItemId, itemVersionId: changedItemId },
      3,
    );
    const beforeVersion = await sql`select * from artifact_version where id = ${draft}`;
    const beforeMembership = await sql`
      select * from artifact_version_item_membership where artifact_version_id = ${draft}
    `;
    const beforeItems =
      await sql`select * from item_version where project_id = ${projectId} order by id`;
    const beforeDependencies = await sql`
      select * from semantic_dependency where project_id = ${projectId}
      order by downstream_item_version_id, upstream_item_version_id
    `;
    expect(await impact.getWarnings(projectId)).toEqual([]);

    const feedback = '  Please revisit R-07.\nKeep the existing constraint.  ';
    await expect(lifecycle[decision.method](draft, userId, feedback)).resolves.toBeUndefined();

    expect(await versionState(draft)).toEqual({
      status: 'rejected',
      status_reason: decision.reason,
    });
    expect(await versionState(reqV1)).toEqual({ status: 'superseded', status_reason: null });
    expect(await versionState(reqV2)).toEqual({ status: 'approved', status_reason: null });
    expect(await events(draft)).toEqual([
      {
        actor_user_id: userId,
        action: decision.action,
        feedback,
        overrode_stale_check: false,
      },
    ]);
    expect(await sql`select * from artifact_version where id = ${draft}`).toEqual([
      {
        ...beforeVersion[0],
        status: 'rejected',
        status_reason: decision.reason,
        updated_at: expect.any(Date),
      },
    ]);
    expect(
      await sql`select * from artifact_version_item_membership where artifact_version_id = ${draft}`,
    ).toEqual(beforeMembership);
    expect(
      await sql`select * from item_version where project_id = ${projectId} order by id`,
    ).toEqual(beforeItems);
    expect(
      await sql`
        select * from semantic_dependency where project_id = ${projectId}
        order by downstream_item_version_id, upstream_item_version_id
      `,
    ).toEqual(beforeDependencies);
    expect(
      await sql`select id from artifact_version where artifact_id = ${artifactId}`,
    ).toHaveLength(3);
    expect(
      await sql`select id from ai_generation_run where project_id = ${projectId}`,
    ).toHaveLength(0);
    expect(await impact.getWarnings(projectId)).toEqual([]);
  });

  it.each([undefined, ''])(
    'INV-003: accepts optional feedback %s and audits the actor',
    async (feedback) => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const actorId = await fx.createAppUser(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const draft = await fx.createDraftArtifactVersion(sql, artifactId);

      await lifecycle[decision.method](draft, actorId, feedback);

      expect(await events(draft)).toEqual([
        {
          actor_user_id: actorId,
          action: decision.action,
          feedback: feedback ?? null,
          overrode_stale_check: false,
        },
      ]);
    },
  );

  it('INV-003: refuses missing and non-draft versions without changing history', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const superseded = await fx.createDraftArtifactVersion(sql, artifactId);
    await lifecycle.approveVersion(superseded, userId);
    const approved = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber: 2 });
    await lifecycle.approveVersion(approved, userId);
    const rejected = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber: 3 });
    await lifecycle[decision.method](rejected, userId);

    const missingId = randomUUID();
    await expect(lifecycle[decision.method](missingId, userId)).rejects.toThrow(
      `artifact_version ${missingId} not found`,
    );
    for (const versionId of [superseded, approved, rejected]) {
      const beforeState = await versionState(versionId);
      const beforeEvents = await events(versionId);
      await expect(lifecycle[decision.method](versionId, userId, 'Retry')).rejects.toThrow(
        `artifact_version ${versionId} is not a draft`,
      );
      expect(await versionState(versionId)).toEqual(beforeState);
      expect(await events(versionId)).toEqual(beforeEvents);
    }
  });

  it('INV-003: rolls back rejection when the audit insert fails', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const approved = await fx.createDraftArtifactVersion(sql, artifactId);
    await lifecycle.approveVersion(approved, userId);
    const draft = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber: 2 });

    await expect(
      lifecycle[decision.method](draft, randomUUID(), 'Missing actor'),
    ).rejects.toMatchObject({
      cause: { code: '23503', constraint_name: 'approval_event_actor_user_id_app_user_id_fk' },
    });

    expect(await versionState(draft)).toEqual({ status: 'draft', status_reason: null });
    expect(await versionState(approved)).toEqual({ status: 'approved', status_reason: null });
    expect(await events(draft)).toEqual([]);
    await expect(lifecycle[decision.method](draft, userId)).resolves.toBeUndefined();
    expect(await events(draft)).toHaveLength(1);
  });

  it.each([true, false])(
    'INV-003 / ERD 3.2: serializes competing approval (rejection first: %s)',
    async (rejectionFirst) => {
      const { projectId, userId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const approved = await fx.createDraftArtifactVersion(sql, artifactId);
      await lifecycle.approveVersion(approved, userId);
      const draft = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber: 2 });
      const reject = () => lifecycle[decision.method](draft, userId, 'Review feedback');
      const approve = () => lifecycle.approveVersion(draft, userId);
      const calls = rejectionFirst ? [reject, approve] : [approve, reject];
      const pending: Promise<PromiseSettledResult<unknown>[]>[] = [];
      try {
        await sql.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`;
          const [holder] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
          for (const call of calls) {
            pending.push(Promise.allSettled([call()]));
            await waitForQueuedTransitions(holder!.pid, pending.length);
          }
        });
      } finally {
        await Promise.all(pending);
      }
      const results = (await Promise.all(pending)).flat();
      expect(results[0]!.status).toBe('fulfilled');
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: new Error(`artifact_version ${draft} is not a draft`),
      });
      expect(await versionState(draft)).toEqual({
        status: rejectionFirst ? 'rejected' : 'approved',
        status_reason: rejectionFirst ? decision.reason : null,
      });
      expect((await versionState(approved)).status).toBe(
        rejectionFirst ? 'approved' : 'superseded',
      );
      expect(await events(draft)).toEqual([
        {
          actor_user_id: userId,
          action: rejectionFirst ? decision.action : 'approved',
          feedback: rejectionFirst ? 'Review feedback' : null,
          overrode_stale_check: false,
        },
      ]);
    },
  );
});
