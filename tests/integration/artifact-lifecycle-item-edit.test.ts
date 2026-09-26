import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');
let identity: typeof import('@/lineage/identity');

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
  identity = await import('@/lineage/identity');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const payload = {
  userValueStatement: 'As a reader I can find articles',
  acceptanceCriteria: ['Search by title'],
};

async function scenario() {
  const { projectId, userId } = await fx.createProjectWithOwner(sql);
  const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
  const requirementsVersionId = await fx.createDraftArtifactVersion(sql, requirementsId);
  const requirement = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: requirementsId,
    itemType: 'requirement',
    displayKey: 'R-01',
  });
  const otherRequirement = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: requirementsId,
    itemType: 'requirement',
    displayKey: 'R-02',
  });
  for (const item of [requirement, otherRequirement]) {
    await fx.createMembership(sql, {
      artifactVersionId: requirementsVersionId,
      artifactId: requirementsId,
      ...item,
    });
  }
  await fx.approveArtifactVersion(sql, requirementsVersionId);
  const backlogId = await fx.createArtifact(sql, projectId, 'backlog');
  const approvedId = await fx.createDraftArtifactVersion(sql, backlogId, {
    payload: { summary: 'Backlog summary' },
  });
  const epic = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: backlogId,
    itemType: 'epic',
  });
  const storyLogical = await fx.createLogicalItem(sql, {
    projectId,
    artifactId: backlogId,
    itemType: 'story',
  });
  const story = {
    logicalItemId: storyLogical.id,
    itemVersionId: await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: storyLogical.id,
      payload,
      semanticHash: identity.semanticHash('story', payload, [
        requirement.itemVersionId,
        otherRequirement.itemVersionId,
      ]),
    }),
  };
  await fx.createMembership(sql, {
    artifactVersionId: approvedId,
    artifactId: backlogId,
    ...epic,
    position: 4,
  });
  await fx.createMembership(sql, {
    artifactVersionId: approvedId,
    artifactId: backlogId,
    ...story,
    parentLogicalItemId: epic.logicalItemId,
    position: 7,
  });
  for (const upstream of [requirement, otherRequirement]) {
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: upstream.itemVersionId,
    });
  }
  await fx.approveArtifactVersion(sql, approvedId);
  const draft = await lifecycle.createManualRevisionDraft(projectId, 'backlog', userId);
  return {
    projectId,
    requirementsId,
    requirementsVersionId,
    requirement,
    otherRequirement,
    backlogId,
    approvedId,
    epic,
    story,
    draft,
  };
}

async function advanceRequirements(
  s: Awaited<ReturnType<typeof scenario>>,
  revision: number,
  removed = false,
) {
  await sql`UPDATE artifact_version SET status = 'superseded' WHERE artifact_id = ${s.requirementsId} AND status = 'approved'`;
  const versionId = await fx.createDraftArtifactVersion(sql, s.requirementsId, {
    versionNumber: revision,
  });
  const itemVersionId = removed
    ? null
    : await fx.createItemVersion(sql, {
        projectId: s.projectId,
        logicalItemId: s.requirement.logicalItemId,
        revisionNumber: revision,
        payload: { behavior: `Requirement revision ${revision}` },
      });
  if (itemVersionId) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId: s.requirementsId,
      logicalItemId: s.requirement.logicalItemId,
      itemVersionId,
    });
  }
  await fx.createMembership(sql, {
    artifactVersionId: versionId,
    artifactId: s.requirementsId,
    ...s.otherRequirement,
  });
  await fx.approveArtifactVersion(sql, versionId);
  return itemVersionId;
}

async function snapshot(projectId: string) {
  const items = await sql`SELECT * FROM item_version WHERE project_id = ${projectId} ORDER BY id`;
  const edges =
    await sql`SELECT * FROM semantic_dependency WHERE project_id = ${projectId} ORDER BY downstream_item_version_id, upstream_item_version_id`;
  const members =
    await sql`SELECT m.* FROM artifact_version_item_membership m JOIN artifact a ON a.id = m.artifact_id WHERE a.project_id = ${projectId} ORDER BY m.artifact_version_id, m.logical_item_id`;
  const versions =
    await sql`SELECT v.* FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id WHERE a.project_id = ${projectId} ORDER BY v.id`;
  return { items: [...items], edges: [...edges], members: [...members], versions: [...versions] };
}

describe('manual item edit (ERD 5.3 / T24 / FR-082 / INV-015 / INV-016)', () => {
  it('T24: preview rolls back; confirmation appends current user edges and clears candidate impact', async () => {
    const s = await scenario();
    const currentId = await advanceRequirements(s, 2);
    const before = await snapshot(s.projectId);
    const changedRefs = [
      {
        logicalItemId: s.requirement.logicalItemId,
        displayKey: 'R-01',
        from: s.requirement.itemVersionId,
        to: currentId,
      },
    ];
    const flagged =
      await sql`SELECT * FROM impact(${s.projectId}::uuid, ${s.draft.id}::uuid) WHERE subject_id = ${s.story.itemVersionId}`;
    expect(flagged.length).toBeGreaterThan(0);
    const preview = await lifecycle.proposeItemEdit(s.draft.id, s.story.logicalItemId, payload);
    expect(preview.changedRefs).toEqual(changedRefs);
    expect(await snapshot(s.projectId)).toEqual(before);
    await expect(
      lifecycle.commitItemEdit(s.draft.id, s.story.logicalItemId, payload, false),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED', details: { changedRefs } });
    expect(await snapshot(s.projectId)).toEqual(before);

    const edited = await lifecycle.commitItemEdit(s.draft.id, s.story.logicalItemId, payload, true);
    expect(edited.id).not.toBe(s.story.itemVersionId);
    expect(edited.id).not.toBe(preview.itemVersionId);
    expect(edited.logicalItemId).toBe(s.story.logicalItemId);
    expect(edited.revisionNumber).toBe(2);
    expect(edited.changedRefs).toEqual(changedRefs);
    expect(edited.semanticHash).toBe(
      identity.semanticHash('story', payload, [currentId!, s.otherRequirement.itemVersionId]),
    );
    expect(edited.semanticHashVersion).toBe(identity.SEMANTIC_HASH_VERSION);
    const edges =
      await sql`SELECT upstream_item_version_id, proposed_by FROM semantic_dependency WHERE downstream_item_version_id = ${edited.id} ORDER BY upstream_item_version_id`;
    expect([...edges]).toEqual(
      [currentId!, s.otherRequirement.itemVersionId]
        .sort()
        .map((id) => ({ upstream_item_version_id: id, proposed_by: 'user' })),
    );
    const candidateWarnings =
      await sql`SELECT * FROM impact(${s.projectId}::uuid, ${s.draft.id}::uuid) WHERE subject_id = ${edited.id}`;
    expect(candidateWarnings).toHaveLength(0);
    const after = await snapshot(s.projectId);
    expect(after.versions).toEqual(before.versions);
    expect(after.items.filter((row) => row.id !== edited.id)).toEqual(before.items);
    expect(after.edges.filter((row) => row.downstream_item_version_id !== edited.id)).toEqual(
      before.edges,
    );
    expect(after.members).toEqual(
      before.members.map((row) =>
        row.artifact_version_id === s.draft.id && row.logical_item_id === s.story.logicalItemId
          ? { ...row, item_version_id: edited.id }
          : row,
      ),
    );
  });

  it('FR-082: unchanged references permit unconfirmed edits, including no-op and presentation-only edits', async () => {
    const s = await scenario();
    const first = await lifecycle.commitItemEdit(s.draft.id, s.story.logicalItemId, payload, false);
    expect(first.changedRefs).toEqual([]);
    expect(first.revisionNumber).toBe(2);
    expect(first.id).not.toBe(s.story.itemVersionId);
    const second = await lifecycle.commitItemEdit(
      s.draft.id,
      s.story.logicalItemId,
      { ...payload, title: 'A display title' },
      false,
    );
    expect(second.changedRefs).toEqual([]);
    expect(second.revisionNumber).toBe(3);
    expect(second.id).not.toBe(first.id);
    expect(second.semanticHash).toBe(first.semanticHash);
    expect(second.payload).toEqual({ ...payload, title: 'A display title' });
  });

  it('FR-082: commit recomputes refs when upstream changes after an empty preview', async () => {
    const s = await scenario();
    expect(
      (await lifecycle.proposeItemEdit(s.draft.id, s.story.logicalItemId, payload)).changedRefs,
    ).toEqual([]);
    const currentId = await advanceRequirements(s, 2);
    const before = await snapshot(s.projectId);
    await expect(
      lifecycle.commitItemEdit(s.draft.id, s.story.logicalItemId, payload, false),
    ).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      details: { changedRefs: [{ to: currentId }] },
    });
    expect(await snapshot(s.projectId)).toEqual(before);
    const newestId = await advanceRequirements(s, 3);
    const edited = await lifecycle.commitItemEdit(s.draft.id, s.story.logicalItemId, payload, true);
    expect(edited.changedRefs).toEqual([
      {
        logicalItemId: s.requirement.logicalItemId,
        displayKey: 'R-01',
        from: s.requirement.itemVersionId,
        to: newestId,
      },
    ]);
  });

  it('FR-082: both paths refuse removed upstream items and identify their display key', async () => {
    const s = await scenario();
    await advanceRequirements(s, 2, true);
    const before = await snapshot(s.projectId);
    const error = {
      code: 'UPSTREAM_REMOVED',
      details: { logicalItemId: s.requirement.logicalItemId, displayKey: 'R-01' },
    };
    await expect(
      lifecycle.proposeItemEdit(s.draft.id, s.story.logicalItemId, payload),
    ).rejects.toMatchObject(error);
    await expect(
      lifecycle.commitItemEdit(s.draft.id, s.story.logicalItemId, payload, true),
    ).rejects.toMatchObject(error);
    expect(await snapshot(s.projectId)).toEqual(before);
  });

  it('FR-082: approved versions and items outside the draft are refused without writes', async () => {
    const s = await scenario();
    const before = await snapshot(s.projectId);
    for (const [versionId, logicalItemId, code] of [
      [s.approvedId, s.story.logicalItemId, 'VERSION_NOT_DRAFT'],
      [s.draft.id, s.requirement.logicalItemId, 'ITEM_NOT_IN_VERSION'],
    ]) {
      await expect(
        lifecycle.proposeItemEdit(versionId!, logicalItemId!, payload),
      ).rejects.toMatchObject({ code });
      await expect(
        lifecycle.commitItemEdit(versionId!, logicalItemId!, payload, true),
      ).rejects.toMatchObject({ code });
    }
    expect(await snapshot(s.projectId)).toEqual(before);
  });

  it('ERD 5.3: editing an Epic preserves its child membership and allocates above all historical revisions', async () => {
    const s = await scenario();
    await fx.createItemVersion(sql, {
      projectId: s.projectId,
      logicalItemId: s.epic.logicalItemId,
      revisionNumber: 8,
    });
    const before = await snapshot(s.projectId);
    const edited = await lifecycle.commitItemEdit(
      s.draft.id,
      s.epic.logicalItemId,
      { title: 'Search', scopeStatement: 'Find articles' },
      false,
    );
    expect(edited.revisionNumber).toBe(9);
    expect(edited.changedRefs).toEqual([]);
    const after = await snapshot(s.projectId);
    expect(after.members).toEqual(
      before.members.map((row) =>
        row.artifact_version_id === s.draft.id && row.logical_item_id === s.epic.logicalItemId
          ? { ...row, item_version_id: edited.id }
          : row,
      ),
    );
    expect(after.edges).toEqual(before.edges);
  });
});
