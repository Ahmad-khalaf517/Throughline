import { and, eq } from 'drizzle-orm';
import { db, schema, withProjectLock } from '@/db';
import { VersionNotDraftError } from './errors';

/** ERD 3.1: reject the draft for revision without starting a new generation. */
export async function requestRevision(
  versionId: string,
  actorId: string,
  feedback?: string,
): Promise<void> {
  return rejectDraft(versionId, actorId, 'revision_requested', feedback);
}

/** ERD 3.1: reject the draft while retaining the authoritative approved version. */
export async function rejectVersion(
  versionId: string,
  actorId: string,
  feedback?: string,
): Promise<void> {
  return rejectDraft(versionId, actorId, 'rejected', feedback);
}

async function rejectDraft(
  versionId: string,
  actorId: string,
  action: 'revision_requested' | 'rejected',
  feedback?: string,
): Promise<void> {
  const [target] = await db
    .select({ projectId: schema.artifact.projectId })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, versionId))
    .limit(1);
  if (!target) throw new Error(`artifact_version ${versionId} not found`);

  await withProjectLock(target.projectId, async (tx) => {
    const [draft] = await tx
      .select({ status: schema.artifactVersion.status })
      .from(schema.artifactVersion)
      .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
      .where(
        and(
          eq(schema.artifactVersion.id, versionId),
          eq(schema.artifact.projectId, target.projectId),
        ),
      )
      .limit(1);
    if (!draft || draft.status !== 'draft') {
      throw new VersionNotDraftError(versionId);
    }

    await tx
      .update(schema.artifactVersion)
      .set({
        status: 'rejected',
        statusReason: action === 'revision_requested' ? 'revision_requested' : 'user_rejected',
      })
      .where(eq(schema.artifactVersion.id, versionId));
    await tx.insert(schema.approvalEvent).values({
      artifactVersionId: versionId,
      actorUserId: actorId,
      action,
      feedback: feedback ?? null,
      overrodeStaleCheck: false,
    });
  });
}
