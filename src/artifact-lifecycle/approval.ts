import { and, eq } from 'drizzle-orm';
import { db, schema, withProjectLock } from '@/db';
import { acknowledgeGateBlockers, evaluateGate, type ImpactRow } from '@/lineage/impact';
import { getSourceVersionMembers } from '@/lineage/identity';

class GateBlocked extends Error {
  constructor(readonly blocking: ImpactRow[]) {
    super('approval gate blocked');
  }
}

export class ArchitectureMaterializationUnavailableError extends Error {
  constructor() {
    super('Architecture approval requires selected-option materialization before the gate');
    this.name = 'ArchitectureMaterializationUnavailableError';
  }
}

export type ApproveVersionResult = { ok: true } | { ok: false; blocking: ImpactRow[] };

/** ERD 3.4 approval transaction and FR-083 currentness gate. */
export async function approveVersion(
  versionId: string,
  actorId: string,
): Promise<ApproveVersionResult> {
  return approveVersionInternal(versionId, actorId);
}

/** ERD 3.5 / FR-084: satisfy the recomputed gate with cause-specific acknowledgements. */
export async function approveWithOverride(
  versionId: string,
  actorId: string,
  note: string,
): Promise<{ ok: true }> {
  if (!note.trim()) throw new Error('override note must be non-empty');
  const result = await approveVersionInternal(versionId, actorId, note);
  if (!result.ok) throw new GateBlocked(result.blocking);
  return result;
}

async function approveVersionInternal(
  versionId: string,
  actorId: string,
  overrideNote?: string,
): Promise<ApproveVersionResult> {
  const [target] = await db
    .select({ projectId: schema.artifact.projectId })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, versionId))
    .limit(1);
  if (!target) throw new Error(`artifact_version ${versionId} not found`);

  try {
    return await withProjectLock(target.projectId, async (tx) => {
      const [draft] = await tx
        .select({
          artifactId: schema.artifactVersion.artifactId,
          status: schema.artifactVersion.status,
          type: schema.artifact.type,
        })
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
        throw new Error(`artifact_version ${versionId} is not a draft`);
      }

      // E3-S3 supplies the selected option and materializes its ADRs before
      // this gate. Approving without that step would make impact() inspect an
      // empty candidate and silently bypass FR-083.
      if (draft.type === 'architecture') {
        throw new ArchitectureMaterializationUnavailableError();
      }

      const members = await getSourceVersionMembers(tx, [versionId]);
      const candidateItemVersionIds = new Set(
        members.flatMap((member) => (member.itemVersionId ? [member.itemVersionId] : [])),
      );
      if (overrideNote !== undefined) {
        await acknowledgeGateBlockers(
          tx,
          target.projectId,
          versionId,
          overrideNote,
          actorId,
          candidateItemVersionIds,
        );
      }
      const blocking = await evaluateGate(tx, target.projectId, versionId, candidateItemVersionIds);
      if (blocking.length) throw new GateBlocked(blocking);

      await tx
        .update(schema.artifactVersion)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(schema.artifactVersion.artifactId, draft.artifactId),
            eq(schema.artifactVersion.status, 'approved'),
          ),
        );
      await tx
        .update(schema.artifactVersion)
        .set({ status: 'approved' })
        .where(eq(schema.artifactVersion.id, versionId));
      await tx.insert(schema.approvalEvent).values({
        artifactVersionId: versionId,
        actorUserId: actorId,
        action: 'approved',
        feedback: overrideNote ?? null,
        overrodeStaleCheck: overrideNote !== undefined,
      });
      return { ok: true };
    });
  } catch (error) {
    if (error instanceof GateBlocked) return { ok: false, blocking: error.blocking };
    throw error;
  }
}
