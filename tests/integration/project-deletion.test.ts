import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';
import { expectDeniedAsAnon } from './support/assertions';

// ERD T44 (Appendix B round 13): deleting a project removes it and every row
// that hangs off it - in one transaction, through the one sanctioned path -
// while every guarantee that made the schema append-only stays in force for
// any other statement.
//
// The schema this runs against is the real one: Testcontainers postgres with
// drizzle/migrations/0000-0010 applied, so the append-only and draft-only
// triggers, every ON DELETE RESTRICT FK and the RLS/REVOKE hardening are all
// live. Nothing here shortcuts them.

let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');

beforeAll(async () => {
  sql = connect();
  // `@/db` reads DATABASE_URL at MODULE-IMPORT time - point env at the
  // container before dynamically importing anything that reaches it (same
  // gotcha as artifact-lifecycle-rejection.test.ts).
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

// One count query per project-scoped table. `app_user` is deliberately absent:
// a user outlives their projects (approval_event and impact_acknowledgement
// reference them, and the ERD keeps the row - section 4.1), so it is asserted
// separately, not counted as project data.
const VERSIONS_OF_PROJECT = `
  SELECT av.id FROM artifact_version av JOIN artifact a ON a.id = av.artifact_id
   WHERE a.project_id = $1`;
const PROJECT_TABLE_COUNTS: Record<string, string> = {
  project: `SELECT count(*) FROM project WHERE id = $1`,
  artifact: `SELECT count(*) FROM artifact WHERE project_id = $1`,
  artifact_version: `SELECT count(*) FROM (${VERSIONS_OF_PROJECT}) v`,
  architecture_option: `SELECT count(*) FROM architecture_option WHERE artifact_version_id IN (${VERSIONS_OF_PROJECT})`,
  approval_event: `SELECT count(*) FROM approval_event WHERE artifact_version_id IN (${VERSIONS_OF_PROJECT})`,
  logical_item: `SELECT count(*) FROM logical_item WHERE project_id = $1`,
  item_version: `SELECT count(*) FROM item_version WHERE project_id = $1`,
  artifact_version_item_membership: `SELECT count(*) FROM artifact_version_item_membership WHERE artifact_id IN (SELECT id FROM artifact WHERE project_id = $1)`,
  generation_context_ref: `SELECT count(*) FROM generation_context_ref WHERE target_artifact_version_id IN (${VERSIONS_OF_PROJECT})`,
  semantic_dependency: `SELECT count(*) FROM semantic_dependency WHERE project_id = $1`,
  impact_acknowledgement: `SELECT count(*) FROM impact_acknowledgement WHERE project_id = $1`,
  ai_generation_run: `SELECT count(*) FROM ai_generation_run WHERE project_id = $1`,
  external_operation: `SELECT count(*) FROM external_operation WHERE project_id = $1`,
  external_ref: `SELECT count(*) FROM external_ref WHERE project_id = $1`,
  stitch_output: `SELECT count(*) FROM stitch_output WHERE project_id = $1`,
};

async function countProjectRows(projectId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [table, query] of Object.entries(PROJECT_TABLE_COUNTS)) {
    const rows = await sql.unsafe<{ count: string }[]>(query, [projectId]);
    counts[table] = Number(rows[0]!.count);
  }
  return counts;
}

/**
 * A project with at least one row in every project-scoped table, wired the
 * awkward ways: an approved Architecture version whose selected option belongs
 * to it (the schema's one FK cycle), a draft whose `base_approved_version_id`
 * points at an approved sibling (a self-reference), an Epic with a child Story
 * in the same membership table (another self-reference), a GitHub and a Jira
 * ref, and acknowledgements against both an item version and an external ref.
 */
async function seedFullProject(name: string) {
  const userId = await fx.createAppUser(sql);
  const projectId = await fx.createProject(sql, userId, { name });

  const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
  const architectureId = await fx.createArtifact(sql, projectId, 'architecture');
  const uiRequirementsId = await fx.createArtifact(sql, projectId, 'ui_requirements');
  const backlogId = await fx.createArtifact(sql, projectId, 'backlog');

  // Requirements v1 (approved) with one requirement, then a draft v2 based on it.
  const requirementsV1 = await fx.createDraftArtifactVersion(sql, requirementsId);
  const requirement = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: requirementsId,
    itemType: 'requirement',
  });
  await fx.createMembership(sql, {
    artifactVersionId: requirementsV1,
    artifactId: requirementsId,
    logicalItemId: requirement.logicalItemId,
    itemVersionId: requirement.itemVersionId,
  });
  await fx.approveArtifactVersion(sql, requirementsV1);
  await sql`
    INSERT INTO artifact_version
      (artifact_id, version_number, status, schema_version, base_approved_version_id)
    VALUES (${requirementsId}, 2, 'draft', 1, ${requirementsV1})
  `;

  // Architecture v1 (approved) with its two options and the selected one.
  const architectureV1 = await fx.createDraftArtifactVersion(sql, architectureId);
  const optionA = await fx.createArchitectureOption(sql, {
    artifactVersionId: architectureV1,
    optionKey: 'A',
  });
  await fx.createArchitectureOption(sql, { artifactVersionId: architectureV1, optionKey: 'B' });
  const decision = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: architectureId,
    itemType: 'architecture_decision',
  });
  await fx.createMembership(sql, {
    artifactVersionId: architectureV1,
    artifactId: architectureId,
    logicalItemId: decision.logicalItemId,
    itemVersionId: decision.itemVersionId,
  });
  await fx.approveArtifactVersion(sql, architectureV1, { selectedArchitectureOptionId: optionA });
  await sql`
    INSERT INTO generation_context_ref (target_artifact_version_id, source_artifact_version_id)
    VALUES (${architectureV1}, ${requirementsV1})
  `;

  // UI Requirements draft - the source version of the Stitch output.
  const uiRequirementsV1 = await fx.createDraftArtifactVersion(sql, uiRequirementsId);

  // Backlog v1 (approved): an Epic and its Story, parented in the membership table.
  const backlogV1 = await fx.createDraftArtifactVersion(sql, backlogId);
  const epic = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: backlogId,
    itemType: 'epic',
  });
  const story = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: backlogId,
    itemType: 'story',
  });
  await fx.createMembership(sql, {
    artifactVersionId: backlogV1,
    artifactId: backlogId,
    logicalItemId: epic.logicalItemId,
    itemVersionId: epic.itemVersionId,
  });
  await fx.createMembership(sql, {
    artifactVersionId: backlogV1,
    artifactId: backlogId,
    logicalItemId: story.logicalItemId,
    itemVersionId: story.itemVersionId,
    parentLogicalItemId: epic.logicalItemId,
  });
  await fx.approveArtifactVersion(sql, backlogV1);

  // Lineage edges and the decision log.
  await fx.createSemanticDependency(sql, {
    projectId,
    downstreamItemVersionId: decision.itemVersionId,
    upstreamItemVersionId: requirement.itemVersionId,
  });
  await fx.createSemanticDependency(sql, {
    projectId,
    downstreamItemVersionId: story.itemVersionId,
    upstreamItemVersionId: decision.itemVersionId,
  });
  for (const versionId of [requirementsV1, architectureV1, backlogV1]) {
    await sql`
      INSERT INTO approval_event (artifact_version_id, actor_user_id, action)
      VALUES (${versionId}, ${userId}, 'approved')
    `;
  }
  await fx.createAiGenerationRun(sql, { projectId, artifactVersionId: requirementsV1 });

  // External writes: GitHub (from Architecture), Jira (from the Story), Stitch.
  const githubOp = await fx.createExternalOperation(sql, {
    projectId,
    provider: 'github',
    sourceArtifactVersionId: architectureV1,
  });
  const githubRef = await fx.createExternalRef(sql, {
    projectId,
    provider: 'github',
    externalOperationId: githubOp,
    sourceArtifactVersionId: architectureV1,
  });
  const jiraOp = await fx.createExternalOperation(sql, {
    projectId,
    provider: 'jira',
    sourceArtifactVersionId: backlogV1,
    sourceItemVersionId: story.itemVersionId,
  });
  await fx.createExternalRef(sql, {
    projectId,
    provider: 'jira',
    externalOperationId: jiraOp,
    sourceArtifactVersionId: backlogV1,
    sourceItemVersionId: story.itemVersionId,
  });
  const stitchOp = await fx.createExternalOperation(sql, {
    projectId,
    provider: 'stitch',
    sourceArtifactVersionId: uiRequirementsV1,
  });
  const stitchRef = await fx.createExternalRef(sql, {
    projectId,
    provider: 'stitch',
    externalOperationId: stitchOp,
    sourceArtifactVersionId: uiRequirementsV1,
  });
  await sql`
    INSERT INTO stitch_output
      (project_id, source_ui_requirements_version_id, external_ref_id, mode, prompt_text)
    VALUES (${projectId}, ${uiRequirementsV1}, ${stitchRef}, 'api', 'a prompt')
  `;

  // Acknowledgements: one against an item version, one against an external ref.
  await sql`
    INSERT INTO impact_acknowledgement
      (project_id, subject_item_version_id, root_logical_item_id,
       obsolete_upstream_item_version_id, acknowledged_by_user_id)
    VALUES (${projectId}, ${story.itemVersionId}, ${requirement.logicalItemId},
            ${requirement.itemVersionId}, ${userId})
  `;
  await sql`
    INSERT INTO impact_acknowledgement
      (project_id, subject_external_ref_id, root_logical_item_id,
       obsolete_upstream_item_version_id, acknowledged_by_user_id)
    VALUES (${projectId}, ${githubRef}, ${requirement.logicalItemId},
            ${requirement.itemVersionId}, ${userId})
  `;

  return { userId, projectId, storyItemVersionId: story.itemVersionId, backlogV1 };
}

async function userExists(userId: string): Promise<boolean> {
  const rows = await sql`SELECT 1 FROM app_user WHERE id = ${userId}`;
  return rows.length === 1;
}

describe('T44 - deleting a project removes it and all its data, through one sanctioned path', () => {
  it('T44a: delete_project() removes every row of the project across all 15 project-scoped tables, and nothing of another project or any user', async () => {
    const doomed = await seedFullProject('T44a doomed');
    const bystander = await seedFullProject('T44a bystander');

    const before = await countProjectRows(doomed.projectId);
    // The seed must genuinely populate every table, or "0 after" proves nothing.
    for (const [table, count] of Object.entries(before)) {
      expect(count, `seed left ${table} empty`).toBeGreaterThan(0);
    }
    const bystanderBefore = await countProjectRows(bystander.projectId);

    const [row] = await sql<{ deleted: boolean }[]>`
      SELECT delete_project(${doomed.projectId}::uuid) AS deleted
    `;
    expect(row!.deleted).toBe(true);

    const after = await countProjectRows(doomed.projectId);
    for (const [table, count] of Object.entries(after)) {
      expect(count, `${table} still has rows`).toBe(0);
    }
    expect(await countProjectRows(bystander.projectId)).toEqual(bystanderBefore);
    // The owner survives - approval history elsewhere may still reference them.
    expect(await userExists(doomed.userId)).toBe(true);
    expect(await userExists(bystander.userId)).toBe(true);
  });

  it('T44b: an unknown project id returns false and deletes nothing', async () => {
    const bystander = await seedFullProject('T44b bystander');
    const bystanderBefore = await countProjectRows(bystander.projectId);

    const [row] = await sql<{ deleted: boolean }[]>`
      SELECT delete_project(${randomUUID()}::uuid) AS deleted
    `;

    expect(row!.deleted).toBe(false);
    expect(await countProjectRows(bystander.projectId)).toEqual(bystanderBefore);
  });

  it('T44c: the purge is atomic - a transaction that rolls back after delete_project() leaves the whole project in place', async () => {
    const project = await seedFullProject('T44c');
    const before = await countProjectRows(project.projectId);

    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT delete_project(${project.projectId}::uuid)`;
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');

    expect(await countProjectRows(project.projectId)).toEqual(before);
  });

  describe('everything that made the schema append-only still holds', () => {
    it('T44d: without delete_project(), deleting the project, its items, its decisions or its frozen membership is still refused', async () => {
      const project = await seedFullProject('T44d');
      const before = await countProjectRows(project.projectId);

      await expect(sql`DELETE FROM project WHERE id = ${project.projectId}`).rejects.toThrow(
        /foreign key|violates/i,
      );
      await expect(
        sql`DELETE FROM item_version WHERE project_id = ${project.projectId}`,
      ).rejects.toThrow(/append-only/i);
      await expect(
        sql`DELETE FROM approval_event WHERE actor_user_id = ${project.userId}`,
      ).rejects.toThrow(/append-only/i);
      await expect(
        sql`DELETE FROM impact_acknowledgement WHERE project_id = ${project.projectId}`,
      ).rejects.toThrow(/append-only/i);
      await expect(
        sql`DELETE FROM artifact_version_item_membership WHERE artifact_version_id = ${project.backlogV1}`,
      ).rejects.toThrow(/frozen/i);

      expect(await countProjectRows(project.projectId)).toEqual(before);
    });

    it('T44e: the bypass is closed again when delete_project() returns - a later delete in the same transaction is refused', async () => {
      const doomed = await seedFullProject('T44e doomed');
      const other = await seedFullProject('T44e other');
      const otherBefore = await countProjectRows(other.projectId);

      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT delete_project(${doomed.projectId}::uuid)`;
          await tx`DELETE FROM item_version WHERE project_id = ${other.projectId}`;
        }),
      ).rejects.toThrow(/append-only/i);

      // The refusal rolled the whole transaction back, so the doomed project is intact too.
      expect((await countProjectRows(doomed.projectId)).project).toBe(1);
      expect(await countProjectRows(other.projectId)).toEqual(otherBefore);
    });

    it('T44f: UPDATE is never bypassed - an item_version cannot be modified in the same transaction as a purge', async () => {
      const doomed = await seedFullProject('T44f doomed');
      const other = await seedFullProject('T44f other');

      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT delete_project(${doomed.projectId}::uuid)`;
          await tx`UPDATE item_version SET revision_number = revision_number + 1
                   WHERE project_id = ${other.projectId}`;
        }),
      ).rejects.toThrow(/append-only/i);
    });
  });

  it('T44g: anon cannot EXECUTE delete_project() (EXECUTE revoked, T34)', async () => {
    const project = await seedFullProject('T44g');
    await expectDeniedAsAnon(sql, (tx) =>
      tx.unsafe(`SELECT delete_project('${project.projectId}'::uuid)`),
    );
    expect((await countProjectRows(project.projectId)).project).toBe(1);
  });

  it('T44h: artifact-lifecycle.deleteProject deletes the project under the project lock, and reports a second delete as not found', async () => {
    const project = await seedFullProject('T44h');

    expect(await lifecycle.deleteProject(project.projectId)).toBe(true);
    const after = await countProjectRows(project.projectId);
    expect(Object.values(after).every((count) => count === 0)).toBe(true);

    expect(await lifecycle.deleteProject(project.projectId)).toBe(false);
  });
});
