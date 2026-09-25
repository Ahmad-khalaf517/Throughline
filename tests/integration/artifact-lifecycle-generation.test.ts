import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// artifact-lifecycle.createDraftFromGeneration (ERD 3.3; TR FR-080; Jira
// E2-S6 / SCRUM-32). Composes lineage/dependency-binding and lineage/identity
// exactly the way tests/integration/dependency-binding.test.ts proves those
// compose - see that file for the pattern this test's helpers below reuse
// via the real module boundary (no re-implementation of the binding logic
// here, only fixture setup + assertions on the persisted rows).
//
// T7 (context changes while generation is in flight) and T20 (matcher meets
// a base ItemVersion hashed under a different semantic_hash_version) are
// exercised for real below, at this layer. Both remain `it.todo` in
// tests/integration/appendix-c.test.ts - the Jira Plan cites E2-S9/E3-T1 as
// the gate tasks that flip those stubs green, and this file isn't trying to
// pre-empt that; it only proves this module's own behavior. T43 (generation
// order prerequisites) is out of scope here on purpose - per this story's
// own instructions, refusing to generate out of order is each artifact-type
// module's job inside its own `generate()` callback, which doesn't exist
// yet; this layer's whole contract for that case is "don't catch what
// generate() throws," covered by the "generate() throws" test below.

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

async function approveRequirement(
  projectId: string,
  artifactId: string,
  displayKey: string,
): Promise<{ versionId: string; logicalItemId: string; itemVersionId: string }> {
  const draftId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber: 1 });
  const item = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId,
    itemType: 'requirement',
    displayKey,
  });
  await fx.createMembership(sql, {
    artifactVersionId: draftId,
    artifactId,
    logicalItemId: item.logicalItemId,
    itemVersionId: item.itemVersionId,
  });
  await fx.approveArtifactVersion(sql, draftId);
  return {
    versionId: draftId,
    logicalItemId: item.logicalItemId,
    itemVersionId: item.itemVersionId,
  };
}

async function artifactVersionRow(versionId: string) {
  const rows = await sql<
    {
      status: string;
      status_reason: string | null;
      base_approved_version_id: string | null;
      raw_output: unknown;
      payload: unknown;
      version_number: number;
    }[]
  >`SELECT status, status_reason, base_approved_version_id, raw_output, payload, version_number
     FROM artifact_version WHERE id = ${versionId}`;
  return rows[0]!;
}

async function countArtifactVersions(artifactId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${artifactId}
  `;
  return Number(rows[0]!.count);
}

async function countLogicalItems(artifactId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::int AS count FROM logical_item WHERE artifact_id = ${artifactId}
  `;
  return Number(rows[0]!.count);
}

describe('artifact-lifecycle.createDraftFromGeneration (ERD 3.3; TR FR-080; T7, T20)', () => {
  it('happy path: mints items, records context refs, no prior draft', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirement = await approveRequirement(projectId, requirementsId, 'R-01');
    // ui_requirements rather than architecture on purpose (same reasoning as
    // the T7 test below): itemType 'architecture_decision' is rejected
    // outright by the new pre-transaction guard (ERD 3.3 closing paragraph /
    // ERD 5.5 - ADRs mint only at approval), so a real mint-items happy path
    // needs a non-Architecture artifact type.
    const uiRequirementsId = await fx.createArtifact(sql, projectId, 'ui_requirements');

    const result = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiRequirementsId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [requirement.versionId],
      actorUserId: userId,
      generate: async (ctx) => {
        expect(ctx.baseVersionId).toBeNull();
        expect(ctx.contextSourceVersionIds).toEqual([requirement.versionId]);
        // Matches what ai-client.generateStructured itself inserts at call
        // time: artifact_version_id null (the version doesn't exist yet).
        const runId = await fx.createAiGenerationRun(sql, { projectId });
        return {
          payload: { modelNote: 'first pass' },
          candidates: [
            {
              payload: {
                screenOrFlow: 'Dashboard',
                interactionRequirement: 'View metrics',
                responsiveConstraints: [],
                accessibilityConstraints: [],
              },
              upstreamRefs: ['R-01'],
            },
            {
              payload: {
                screenOrFlow: 'Settings',
                interactionRequirement: 'Edit profile',
                responsiveConstraints: [],
                accessibilityConstraints: [],
              },
              upstreamRefs: ['R-01'],
            },
          ],
          runId,
        };
      },
    });

    expect(result.stale).toBe(false);
    expect(result.version.status).toBe('draft');
    expect(result.version.baseApprovedVersionId).toBeNull();
    expect(result.version.versionNumber).toBe(1);

    const items = await sql<{ id: string }[]>`
      SELECT id FROM logical_item WHERE artifact_id = ${uiRequirementsId} AND item_type = 'ui_requirement'
    `;
    expect(items).toHaveLength(2);
    const membership = await sql<{ item_version_id: string }[]>`
      SELECT item_version_id FROM artifact_version_item_membership WHERE artifact_version_id = ${result.version.id}
    `;
    expect(membership).toHaveLength(2);
    const contextRefs = await sql<{ source_artifact_version_id: string }[]>`
      SELECT source_artifact_version_id FROM generation_context_ref WHERE target_artifact_version_id = ${result.version.id}
    `;
    expect(contextRefs.map((row) => row.source_artifact_version_id)).toEqual([
      requirement.versionId,
    ]);

    // ERD line 60 / 3.3 step 4: a successful call's run row ends up pointing
    // at the version it produced.
    const runs = await sql<{ artifact_version_id: string | null }[]>`
      SELECT artifact_version_id FROM ai_generation_run WHERE project_id = ${projectId}
    `;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.artifact_version_id).toBe(result.version.id);
  });

  it('T7: stale (base_changed) when the artifact is reapproved while generation is in flight', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirement = await approveRequirement(projectId, requirementsId, 'R-01');
    // ui_requirements rather than architecture on purpose: architecture's own
    // approval requires 2 architecture_option rows + a selected option in
    // the same UPDATE (artifact_version_guard, drizzle/migrations/
    // 0004_triggers.sql) - orthogonal to what T7 is testing here (the
    // artifact's OWN base changing mid-flight), so a simpler artifact type
    // keeps this test about exactly one thing.
    const uiRequirementsId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const firstDraftId = await fx.createDraftArtifactVersion(sql, uiRequirementsId, {
      versionNumber: 1,
    });
    await fx.approveArtifactVersion(sql, firstDraftId);

    let capturedRunId = '';
    const result = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiRequirementsId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [requirement.versionId],
      actorUserId: userId,
      generate: async () => {
        // Simulate a concurrent regeneration-and-approval landing between
        // this function's base capture (already done, before generate() was
        // called) and its persist transaction (about to open).
        const secondDraftId = await fx.createDraftArtifactVersion(sql, uiRequirementsId, {
          versionNumber: 2,
        });
        await sql.begin(async (tx) => {
          await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${firstDraftId}`;
          await fx.approveArtifactVersion(tx, secondDraftId);
        });
        capturedRunId = await fx.createAiGenerationRun(sql, { projectId });
        return {
          payload: { modelNote: 'raced' },
          candidates: [
            {
              payload: {
                screenOrFlow: 'Dashboard',
                interactionRequirement: 'View metrics',
                responsiveConstraints: [],
                accessibilityConstraints: [],
              },
              upstreamRefs: ['R-01'],
            },
          ],
          runId: capturedRunId,
        };
      },
    });

    expect(result.stale).toBe(true);
    if (!result.stale) throw new Error('unreachable');
    expect(result.reason).toBe('base_changed');
    const row = await artifactVersionRow(result.version.id);
    expect(row.status).toBe('rejected');
    expect(row.status_reason).toBe('stale_generation_context');
    expect(row.base_approved_version_id).toBe(firstDraftId);
    expect(row.raw_output).toEqual({
      payload: { modelNote: 'raced' },
      candidates: [
        {
          payload: {
            screenOrFlow: 'Dashboard',
            interactionRequirement: 'View metrics',
            responsiveConstraints: [],
            accessibilityConstraints: [],
          },
          upstreamRefs: ['R-01'],
        },
      ],
    });
    expect(row.payload).toEqual({});

    const items = await sql<{ id: string }[]>`
      SELECT id FROM logical_item WHERE artifact_id = ${uiRequirementsId}
    `;
    expect(items).toHaveLength(0);
    const membership = await sql<{ id: string }[]>`
      SELECT * FROM artifact_version_item_membership WHERE artifact_version_id = ${result.version.id}
    `;
    expect(membership).toHaveLength(0);
    const contextRefs = await sql<{ source_artifact_version_id: string }[]>`
      SELECT source_artifact_version_id FROM generation_context_ref WHERE target_artifact_version_id = ${result.version.id}
    `;
    expect(contextRefs.map((r) => r.source_artifact_version_id)).toEqual([requirement.versionId]);

    // Even on the stale/rejected path, the run row is still linked to the
    // rejected version it produced (ERD line 60 - nullable only for calls
    // that failed before any version existed; this one didn't fail).
    const runRow = await sql<{ artifact_version_id: string | null }[]>`
      SELECT artifact_version_id FROM ai_generation_run WHERE id = ${capturedRunId}
    `;
    expect(runRow[0]?.artifact_version_id).toBe(result.version.id);
  });

  it('stale (dependency_superseded) when a bound upstream item is superseded before persist', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirement = await approveRequirement(projectId, requirementsId, 'R-01');
    // ui_requirements rather than architecture, same reasoning as the happy
    // path test above (itemType 'architecture_decision' is now rejected
    // outright by the pre-transaction guard) - a fresh artifact with no
    // approval yet still keeps baseVersionId null on both sides of the race,
    // so only the dependency check can go stale, same as before.
    const uiRequirementsId = await fx.createArtifact(sql, projectId, 'ui_requirements');

    let capturedRunId = '';
    const result = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiRequirementsId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [requirement.versionId],
      actorUserId: userId,
      generate: async () => {
        // Revise R-01 and approve a new Requirements version while this
        // generation is in flight - the bound upstream ItemVersion the
        // model saw is no longer current by persist time.
        const nextDraftId = await fx.createDraftArtifactVersion(sql, requirementsId, {
          versionNumber: 2,
        });
        const revisedItemVersionId = await fx.createItemVersion(sql, {
          projectId,
          logicalItemId: requirement.logicalItemId,
          revisionNumber: 2,
        });
        await fx.createMembership(sql, {
          artifactVersionId: nextDraftId,
          artifactId: requirementsId,
          logicalItemId: requirement.logicalItemId,
          itemVersionId: revisedItemVersionId,
        });
        await sql.begin(async (tx) => {
          await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${requirement.versionId}`;
          await fx.approveArtifactVersion(tx, nextDraftId);
        });
        capturedRunId = await fx.createAiGenerationRun(sql, { projectId });
        return {
          payload: { modelNote: 'dependency raced' },
          candidates: [
            {
              payload: {
                screenOrFlow: 'Dashboard',
                interactionRequirement: 'View metrics',
                responsiveConstraints: [],
                accessibilityConstraints: [],
              },
              upstreamRefs: ['R-01'],
            },
          ],
          runId: capturedRunId,
        };
      },
    });

    expect(result.stale).toBe(true);
    if (!result.stale) throw new Error('unreachable');
    expect(result.reason).toBe('dependency_superseded');
    const row = await artifactVersionRow(result.version.id);
    expect(row.status).toBe('rejected');
    expect(row.status_reason).toBe('stale_generation_context');
    expect(row.base_approved_version_id).toBeNull();
    expect(row.raw_output).toEqual({
      payload: { modelNote: 'dependency raced' },
      candidates: [
        {
          payload: {
            screenOrFlow: 'Dashboard',
            interactionRequirement: 'View metrics',
            responsiveConstraints: [],
            accessibilityConstraints: [],
          },
          upstreamRefs: ['R-01'],
        },
      ],
    });
    expect(row.payload).toEqual({});

    const items = await sql<{ id: string }[]>`
      SELECT id FROM logical_item WHERE artifact_id = ${uiRequirementsId}
    `;
    expect(items).toHaveLength(0);
    const membership = await sql<{ id: string }[]>`
      SELECT * FROM artifact_version_item_membership WHERE artifact_version_id = ${result.version.id}
    `;
    expect(membership).toHaveLength(0);
    const contextRefs = await sql<{ source_artifact_version_id: string }[]>`
      SELECT source_artifact_version_id FROM generation_context_ref WHERE target_artifact_version_id = ${result.version.id}
    `;
    expect(contextRefs.map((r) => r.source_artifact_version_id)).toEqual([requirement.versionId]);

    const runRow = await sql<{ artifact_version_id: string | null }[]>`
      SELECT artifact_version_id FROM ai_generation_run WHERE id = ${capturedRunId}
    `;
    expect(runRow[0]?.artifact_version_id).toBe(result.version.id);
  });

  it('generate() throwing propagates and persists nothing', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');

    const before = await countArtifactVersions(requirementsId);
    expect(before).toBe(0);

    await expect(
      lifecycle.createDraftFromGeneration({
        projectId,
        artifactId: requirementsId,
        itemType: 'requirement',
        contextSourceVersionIds: [],
        actorUserId: userId,
        generate: async () => {
          throw new Error('generation prerequisites not met');
        },
      }),
    ).rejects.toThrow('generation prerequisites not met');

    const after = await countArtifactVersions(requirementsId);
    expect(after).toBe(0);
  });

  it('replaces an existing draft with a rejected/draft_replaced approval_event', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const uiRequirementsId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const existingDraftId = await fx.createDraftArtifactVersion(sql, uiRequirementsId, {
      versionNumber: 1,
    });

    const result = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiRequirementsId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [],
      actorUserId: userId,
      generate: async (ctx) => {
        expect(ctx.baseVersionId).toBeNull();
        const runId = await fx.createAiGenerationRun(sql, { projectId });
        return {
          payload: { modelNote: 'second pass' },
          candidates: [
            {
              payload: {
                screenOrFlow: 'Dashboard',
                interactionRequirement: 'View metrics',
                responsiveConstraints: [],
                accessibilityConstraints: [],
              },
              upstreamRefs: [],
            },
          ],
          runId,
        };
      },
    });

    expect(result.stale).toBe(false);
    expect(result.version.versionNumber).toBe(2);

    const oldDraft = await artifactVersionRow(existingDraftId);
    expect(oldDraft.status).toBe('rejected');
    expect(oldDraft.status_reason).toBe('replaced_by_regeneration');

    const events = await sql<{ action: string; actor_user_id: string }[]>`
      SELECT action, actor_user_id FROM approval_event WHERE artifact_version_id = ${existingDraftId}
    `;
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('draft_replaced');
    expect(events[0]?.actor_user_id).toBe(userId);

    const drafts = await sql<{ id: string }[]>`
      SELECT id FROM artifact_version WHERE artifact_id = ${uiRequirementsId} AND status = 'draft'
    `;
    expect(drafts).toEqual([{ id: result.version.id }]);

    const runs = await sql<{ artifact_version_id: string | null }[]>`
      SELECT artifact_version_id FROM ai_generation_run WHERE project_id = ${projectId}
    `;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.artifact_version_id).toBe(result.version.id);
  });

  it('T20: a semantic_hash_version mismatch throws and rolls back the whole transaction', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const draftId = await fx.createDraftArtifactVersion(sql, requirementsId, { versionNumber: 1 });
    const badItem = await fx.createLogicalItem(sql, {
      projectId,
      artifactId: requirementsId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    const badItemVersionId = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: badItem.id,
      revisionNumber: 1,
      semanticHashVersion: 2, // frozen at 1 (section 22/T20) - this is the mismatch
    });
    await fx.createMembership(sql, {
      artifactVersionId: draftId,
      artifactId: requirementsId,
      logicalItemId: badItem.id,
      itemVersionId: badItemVersionId,
    });
    await fx.approveArtifactVersion(sql, draftId);

    const beforeVersions = await countArtifactVersions(requirementsId);
    const beforeItems = await countLogicalItems(requirementsId);

    await expect(
      lifecycle.createDraftFromGeneration({
        projectId,
        artifactId: requirementsId,
        itemType: 'requirement',
        contextSourceVersionIds: [],
        actorUserId: userId,
        generate: async (ctx) => {
          expect(ctx.baseVersionId).toBe(draftId);
          const runId = await fx.createAiGenerationRun(sql, { projectId });
          return {
            payload: { modelNote: 'third pass' },
            candidates: [
              {
                payload: {
                  type: 'functional',
                  actor: 'Analyst',
                  behavior: 'Do the thing',
                  constraints: [],
                  acceptanceCriteria: ['x'],
                },
                upstreamRefs: [],
              },
            ],
            runId,
          };
        },
      }),
    ).rejects.toThrow('Unsupported semantic hash version');

    const afterVersions = await countArtifactVersions(requirementsId);
    const afterItems = await countLogicalItems(requirementsId);
    expect(afterVersions).toBe(beforeVersions);
    expect(afterItems).toBe(beforeItems);
    const membership = await sql<{ id: string }[]>`
      SELECT * FROM artifact_version_item_membership
      WHERE artifact_id = ${requirementsId} AND artifact_version_id != ${draftId}
    `;
    expect(membership).toHaveLength(0);
  });

  it('refuses to mint architecture_decision items directly - ADRs materialize only at approval', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
    const architectureId = await fx.createArtifact(sql, projectId, 'architecture');

    const before = await countArtifactVersions(architectureId);
    expect(before).toBe(0);

    await expect(
      lifecycle.createDraftFromGeneration({
        projectId,
        artifactId: architectureId,
        itemType: 'architecture_decision',
        contextSourceVersionIds: [],
        actorUserId: userId,
        generate: async () => ({
          payload: { modelNote: 'should never persist' },
          candidates: [
            {
              payload: { decision: 'Use queues', technologyOrApproach: 'Postgres queue' },
              upstreamRefs: [],
            },
          ],
          runId: 'unused-run-id',
        }),
      }),
    ).rejects.toThrow(
      'createDraftFromGeneration must not mint architecture_decision items directly - ' +
        'ADRs are materialized only at approval via architecture-materialization.materialize (ERD 5.5)',
    );

    const after = await countArtifactVersions(architectureId);
    expect(after).toBe(0);
  });
});
