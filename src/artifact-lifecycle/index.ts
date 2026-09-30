// Module 7: artifact-lifecycle
// Owns: project, artifact, artifact_version, approval_event, generation_context_ref
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
import { alias } from 'drizzle-orm/pg-core';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { db, schema, withProjectLock, withTx } from '@/db';
import { ARTIFACT_TYPES, type ArtifactSummaryDTO, type ArtifactType } from '@/lib/serialize';

export {
  approveVersion,
  approveWithOverride,
  ApprovalGateBlockedError,
  type ArchitectureApproval,
  type ApproveVersionResult,
} from './approval';
export { VersionNotDraftError } from './errors';
export { DocumentSourceChangedError, getDocumentSourceCurrentness } from './document-currentness';
export { withArchitectureDraft, type ArchitectureDraftContext } from './architecture';

export {
  createDraftFromGeneration,
  type ArtifactVersion,
  type CreateDraftFromGenerationOptions,
  type CreateDraftFromGenerationResult,
} from './generation';
export { createManualRevisionDraft } from './manual-revision';
export { requestRevision, rejectVersion } from './rejection';
export { proposeItemEdit, commitItemEdit, type CommitItemEditResult } from './item-edit';
export { getArtifactVersionPayload } from './version-payload';
export {
  getProjectDashboard,
  getProjectItemVersionDetail,
  type ProjectDashboard,
  type DashboardActivity,
  type DashboardTile,
} from './dashboard';
export {
  getVersionRef,
  getArtifactId,
  listArtifactVersions,
  getArtifactVersionDetail,
  getArtifactVersionDetailResolved,
  type ArtifactVersionRef,
  type ArtifactVersionRecord,
  type ArtifactVersionDetail,
  type VersionItem,
  type ImpactRow,
  type ResolvedArtifactVersionDetail,
  type ResolvedVersionItem,
} from './versions';
export {
  getImpactWarnings,
  getImpactWarningsResolved,
  getCurrentItemImpactCauses,
  getItemVersionProjectIds,
  acknowledgeImpactWarning,
  type AcknowledgeImpactWarningResult,
  type ItemImpactCause,
} from './impact';

// `commitItemEdit`/`proposeItemEdit` throw identity's own `ItemEditError`
// (codes VERSION_NOT_DRAFT / ITEM_NOT_IN_VERSION / UPSTREAM_REMOVED /
// CONFIRMATION_REQUIRED) and return its `RebindDiff`s. Layer 6 may not import
// `identity`, so these are forwarded here - the same class object, so an
// `instanceof` in a route handler matches what item-edit.ts threw; never a
// second class of the same name.
export { ItemEditError, type RebindDiff } from '@/lineage/identity';

export type Project = typeof schema.project.$inferSelect;

export interface ProjectWithArtifacts extends Project {
  artifacts: Record<ArtifactType, ArtifactSummaryDTO>;
}

// Thrown by `updateProject` when the caller tried to change `brief`/
// `inputContext` after a Requirements `artifact_version` already exists
// (ERD INV-007/T33). The `project_seed_frozen` DB trigger is the backstop;
// this pre-check exists so the route can return a clean `409 BRIEF_FROZEN`
// instead of letting the trigger's raw exception surface (API Contracts
// section 3's note on `PATCH /api/projects/:projectId`).
export class BriefFrozenError extends Error {
  constructor(projectId: string) {
    super(
      `project ${projectId} brief and input context are frozen: a Requirements ` +
        'version already exists',
    );
    this.name = 'BriefFrozenError';
  }
}

/**
 * Inserts a project and its 6 blank artifact rows (one per ArtifactType) in
 * one transaction (ERD 4.2, Module Boundaries 4.3). No `artifact_version`
 * rows are created here - the artifacts stay version-less until a later
 * epic generates into them (FR-002 is out of scope for this call).
 */
export async function createProject(
  userId: string,
  name: string,
  brief: string,
  inputContext?: unknown,
): Promise<Project> {
  return withTx(async (tx) => {
    const [project] = await tx
      .insert(schema.project)
      .values({ ownerUserId: userId, name, brief, inputContext: inputContext ?? null })
      .returning();
    if (!project) {
      throw new Error('project insert returned no row');
    }

    await tx
      .insert(schema.artifact)
      .values(ARTIFACT_TYPES.map((type) => ({ projectId: project.id, type })));

    return project;
  });
}

// Shared read path for `getProjectById`/`listProjectsForOwner`: one project
// row per artifact type, left-joined to whichever artifact_version (if any)
// is currently `approved`/`draft` for that artifact. Every project always
// has exactly 6 artifact rows (one per ArtifactType, inserted by
// `createProject`); both version ids are `null` until a later epic ever
// creates an `artifact_version` row - never hardcoded, always the real join.
async function projectsWithArtifacts(where: SQL): Promise<ProjectWithArtifacts[]> {
  const approvedVersion = alias(schema.artifactVersion, 'approved_version');
  const draftVersion = alias(schema.artifactVersion, 'draft_version');

  const rows = await db
    .select({
      project: schema.project,
      artifactType: schema.artifact.type,
      approvedVersionId: approvedVersion.id,
      draftVersionId: draftVersion.id,
    })
    .from(schema.project)
    .leftJoin(schema.artifact, eq(schema.artifact.projectId, schema.project.id))
    .leftJoin(
      approvedVersion,
      and(
        eq(approvedVersion.artifactId, schema.artifact.id),
        eq(approvedVersion.status, 'approved'),
      ),
    )
    .leftJoin(
      draftVersion,
      and(eq(draftVersion.artifactId, schema.artifact.id), eq(draftVersion.status, 'draft')),
    )
    .where(where)
    .orderBy(desc(schema.project.createdAt));

  const byProjectId = new Map<string, ProjectWithArtifacts>();
  for (const row of rows) {
    let entry = byProjectId.get(row.project.id);
    if (!entry) {
      entry = {
        ...row.project,
        artifacts: Object.fromEntries(
          ARTIFACT_TYPES.map((type) => [type, { approvedVersionId: null, draftVersionId: null }]),
        ) as Record<ArtifactType, ArtifactSummaryDTO>,
      };
      byProjectId.set(row.project.id, entry);
    }
    if (row.artifactType) {
      entry.artifacts[row.artifactType as ArtifactType] = {
        approvedVersionId: row.approvedVersionId,
        draftVersionId: row.draftVersionId,
      };
    }
  }
  return [...byProjectId.values()];
}

/** Single project plus its per-artifact-type approved/draft version ids, or `null` if it doesn't exist. */
export async function getProjectById(projectId: string): Promise<ProjectWithArtifacts | null> {
  const [project] = await projectsWithArtifacts(eq(schema.project.id, projectId));
  return project ?? null;
}

/** The caller's own projects only (filtered by `owner_user_id` - API Contracts 3, `GET /api/projects`). */
export async function listProjectsForOwner(userId: string): Promise<ProjectWithArtifacts[]> {
  return projectsWithArtifacts(eq(schema.project.ownerUserId, userId));
}

/**
 * Updates `name` unconditionally when provided. If `brief` and/or
 * `inputContext` are provided, first checks the same condition the
 * `project_seed_frozen` trigger enforces (a Requirements artifact_version
 * already exists) and throws `BriefFrozenError` rather than attempting the
 * write - the trigger remains as the backstop either way.
 */
export async function updateProject(
  projectId: string,
  updates: { name?: string | undefined; brief?: string | undefined; inputContext?: unknown },
): Promise<ProjectWithArtifacts> {
  const changesSeed = updates.brief !== undefined || updates.inputContext !== undefined;

  try {
    await withTx(async (tx) => {
      if (changesSeed) {
        const [requirementsVersion] = await tx
          .select({ id: schema.artifactVersion.id })
          .from(schema.artifactVersion)
          .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
          .where(
            and(eq(schema.artifact.projectId, projectId), eq(schema.artifact.type, 'requirements')),
          )
          .limit(1);

        if (requirementsVersion) {
          throw new BriefFrozenError(projectId);
        }
      }

      const setValues: Partial<typeof schema.project.$inferInsert> = {};
      if (updates.name !== undefined) setValues.name = updates.name;
      if (updates.brief !== undefined) setValues.brief = updates.brief;
      if (updates.inputContext !== undefined) setValues.inputContext = updates.inputContext;

      if (Object.keys(setValues).length > 0) {
        await tx.update(schema.project).set(setValues).where(eq(schema.project.id, projectId));
      }
    });
  } catch (error) {
    // The pre-check above cannot close the race under READ COMMITTED: a
    // concurrent transaction can insert the first Requirements
    // artifact_version between that SELECT and this UPDATE committing. The
    // `project_seed_frozen` trigger (drizzle/migrations/0004_triggers.sql)
    // is the real backstop for that window - translate its raw exception
    // into the same BriefFrozenError the pre-check throws, so the route's
    // mapping to 409 BRIEF_FROZEN (API Contracts section 11) covers this
    // path too instead of surfacing as an unhandled 500.
    if (isProjectSeedFrozenError(error)) {
      throw new BriefFrozenError(projectId);
    }
    throw error;
  }

  const project = await getProjectById(projectId);
  if (!project) {
    // The caller already resolved this id via requireProjectOwner - it
    // cannot have disappeared between that check and this update.
    throw new Error(`project ${projectId} not found immediately after update`);
  }
  return project;
}

/**
 * Permanently deletes a project and everything that hangs off it (ERD 4.2
 * "Deletion", Appendix B round 13): artifacts, versions, items, edges,
 * approvals, acknowledgements, AI runs, external operations/refs and Stitch
 * output. Returns `false` when there is no such project. The `app_user` row
 * stays.
 *
 * The whole purge is one `delete_project()` call (migration 0008) inside one
 * transaction. It is a database function, not a sequence of `DELETE`s written
 * here, because the rows belong to five different modules' tables (Module
 * Boundaries section 5) and the append-only triggers on them refuse a delete
 * unless `delete_project()` itself has switched its bypass on for the length of
 * the call. It runs under the project lock so it is serialized against an
 * in-flight approval or generation persist rather than racing one.
 *
 * Nothing outside Throughline is touched: a GitHub repository, Jira issues or
 * Stitch screens the project created stay where they are (their `external_ref`
 * rows go with the project, so Throughline stops knowing about them).
 */
export async function deleteProject(projectId: string): Promise<boolean> {
  return withProjectLock(projectId, async (tx) => {
    const rows = await tx.execute<{ deleted: boolean }>(
      sql`select delete_project(${projectId}::uuid) as deleted`,
    );
    return rows[0]?.deleted === true;
  });
}

/** `updateProjectTargets` was handed a blank value or half a Jira pair (ERD 4.2 CHECKs, API `VALIDATION_ERROR`). */
export class InvalidProjectTargetsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProjectTargetsError';
  }
}

/**
 * Round 14 (ERD 4.2, TR FR-088, Module Boundaries 4.3): sets where the
 * project's external outputs go. Absent = unchanged, `null` = clear; the Jira
 * pair is set or cleared together. Under `withProjectLock`, writes ONLY
 * `project.github_owner` / `jira_cloud_id` / `jira_project_key` and returns the
 * project.
 *
 * It reads no `external_operation`, calls no provider and never calls
 * `connections`: everything that needs one (provider validation, the
 * `TARGET_LOCKED` check) is done by the ROUTE before this call (Module
 * Boundaries 4.7).
 */
export async function updateProjectTargets(
  projectId: string,
  targets: {
    githubOwner?: string | null | undefined;
    jira?: { cloudId: string; projectKey: string } | null | undefined;
  },
): Promise<ProjectWithArtifacts> {
  const setValues: Partial<typeof schema.project.$inferInsert> = {};

  if (targets.githubOwner !== undefined) {
    if (targets.githubOwner === null) {
      setValues.githubOwner = null;
    } else {
      const owner = targets.githubOwner.trim();
      if (!owner) throw new InvalidProjectTargetsError('githubOwner must not be blank.');
      setValues.githubOwner = owner;
    }
  }

  if (targets.jira !== undefined) {
    if (targets.jira === null) {
      setValues.jiraCloudId = null;
      setValues.jiraProjectKey = null;
    } else {
      const cloudId = typeof targets.jira.cloudId === 'string' ? targets.jira.cloudId.trim() : '';
      const projectKey =
        typeof targets.jira.projectKey === 'string' ? targets.jira.projectKey.trim() : '';
      // Both or neither: a half pair is refused here as well as by the
      // project_jira_target_pair CHECK (ERD 4.2).
      if (!cloudId || !projectKey) {
        throw new InvalidProjectTargetsError(
          'jira requires both a non-blank cloudId and projectKey, or null to clear.',
        );
      }
      setValues.jiraCloudId = cloudId;
      setValues.jiraProjectKey = projectKey;
    }
  }

  if (Object.keys(setValues).length > 0) {
    await withProjectLock(projectId, async (tx) => {
      await tx.update(schema.project).set(setValues).where(eq(schema.project.id, projectId));
    });
  }

  const project = await getProjectById(projectId);
  if (!project) {
    // The caller already resolved this id via requireProjectOwner.
    throw new Error(`project ${projectId} not found after updating targets`);
  }
  return project;
}

// Matches on the trigger's own message, not just SQLSTATE P0001, because
// every plain `RAISE EXCEPTION` in that migration (forbid_mutation,
// membership_draft_only, artifact_version_guard, ...) shares that same
// generic code - message text is the only reliable way to tell them apart.
function isProjectSeedFrozenError(error: unknown): boolean {
  return (
    error instanceof postgres.PostgresError &&
    error.code === 'P0001' &&
    error.message.includes('brief and input_context are frozen')
  );
}
