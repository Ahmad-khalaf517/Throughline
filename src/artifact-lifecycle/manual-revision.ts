// artifact-lifecycle: createManualRevisionDraft (ERD 3.6; TR FR-081; T40 -
// pre-approval half only, the post-approval half needs approveVersion, which
// doesn't exist yet and closes out in E3-T1). See
// docs/Throughline_Module_Boundaries.md section 4.3 for the documented
// signature/behavior this implements.
//
// Nothing outside src/artifact-lifecycle may import this file directly - it
// is re-exported through ./index.ts (Module Boundaries section 7).
import { and, eq } from 'drizzle-orm';
import { schema, withProjectLock } from '@/db';
import { copyMembership } from '@/lineage/identity';
import type { ArtifactType } from '@/lib/serialize';
import { getApprovedVersionId, nextVersionNumber, replaceExistingDraft } from './shared';
import type { ArtifactVersion } from './generation';

/**
 * ERD 3.6 in full: for Requirements, UI Requirements and Backlog, open a new
 * draft of the approved version with no model call - take the lock, reject
 * any existing draft (draft_replaced / replaced_by_regeneration, same as
 * regeneration), insert the draft copying the approved version's payload and
 * schema_version, then identity.copyMembership every membership row of the
 * approved version unchanged (Epic rows first). No ItemVersion is created
 * and no generation_context_ref row is written, because the draft contains
 * no model output.
 *
 * Architecture has no manual revision path (ERD 3.6 closing paragraph): its
 * ADRs only exist after approval, so it is revised by regeneration only.
 */
export async function createManualRevisionDraft(
  projectId: string,
  artifactType: ArtifactType,
  // Not part of Module Boundaries' documented signature: needed to satisfy
  // approval_event.actor_user_id (NOT NULL) for the draft_replaced row this
  // function writes when it replaces an existing draft - same documented
  // deviation as CreateDraftFromGenerationOptions.actorUserId (generation.ts).
  actorUserId: string,
): Promise<ArtifactVersion> {
  if (artifactType === 'architecture') {
    throw new Error(
      'createManualRevisionDraft has no Architecture path - Architecture is revised only by ' +
        'regeneration, because its ADRs are materialized at approval (ERD 3.6 closing paragraph)',
    );
  }

  return withProjectLock(projectId, async (tx) => {
    // ArtifactType/artifact.type share the same string union, but the row
    // itself still has to be resolved: this function takes artifactType, not
    // artifactId (unlike createDraftFromGeneration) - backed by artifact's
    // own UNIQUE (project_id, type) constraint.
    const [artifact] = await tx
      .select({ id: schema.artifact.id })
      .from(schema.artifact)
      .where(and(eq(schema.artifact.projectId, projectId), eq(schema.artifact.type, artifactType)));
    if (!artifact) {
      throw new Error(`No ${artifactType} artifact for project ${projectId}`);
    }
    const artifactId = artifact.id;

    const approvedVersionId = await getApprovedVersionId(tx, artifactId);
    if (!approvedVersionId) {
      throw new Error(`Artifact ${artifactId} has no approved version to revise`);
    }

    const [approved] = await tx
      .select({
        payload: schema.artifactVersion.payload,
        schemaVersion: schema.artifactVersion.schemaVersion,
      })
      .from(schema.artifactVersion)
      .where(eq(schema.artifactVersion.id, approvedVersionId));
    if (!approved) throw new Error('approved artifact_version row disappeared inside the lock');

    // ERD 3.6 step 1: reject any existing draft first (draft_replaced /
    // replaced_by_regeneration) - the same helper createDraftFromGeneration
    // uses for its own step 8.
    await replaceExistingDraft(tx, artifactId, actorUserId);

    const versionNumber = await nextVersionNumber(tx, artifactId);

    // ERD 3.6 step 2: insert the draft, copying payload and schema_version
    // from the approved version.
    const [version] = await tx
      .insert(schema.artifactVersion)
      .values({
        artifactId,
        versionNumber,
        status: 'draft',
        schemaVersion: approved.schemaVersion,
        baseApprovedVersionId: approvedVersionId,
        payload: approved.payload,
      })
      .returning();
    if (!version) throw new Error('artifact_version insert returned no row');

    // ERD 3.6 step 3: copy every membership row of the approved version
    // unchanged. No ItemVersion is created and no generation_context_ref row
    // is written - the draft contains no model output.
    await copyMembership(tx, approvedVersionId, version.id);

    // ERD 3.6 step 4: commit (the transaction commits when this callback
    // returns - withProjectLock's contract, same as generation.ts).
    return version;
  });
}
