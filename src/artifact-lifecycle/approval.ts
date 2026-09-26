import { and, eq } from 'drizzle-orm';
import { db, schema, withProjectLock, type Tx } from '@/db';
import { acknowledgeGateBlockers, evaluateGate, type ImpactRow } from '@/lineage/impact';
import { getSourceVersionMembers } from '@/lineage/identity';
import { loadArchitectureDraftContext, type ArchitectureDraftContext } from './architecture';

class GateBlocked extends Error {
  constructor(readonly blocking: ImpactRow[]) {
    super('approval gate blocked');
  }
}

type ArchitectureApprovalCode =
  'OPTION_NOT_SELECTED' | 'OPTION_COUNT_INVALID' | 'STACK_UNCHANGED_DECISIONS';

class ArchitectureApprovalBlocked extends Error {
  constructor(readonly code: ArchitectureApprovalCode) {
    super(code);
  }
}

export interface ArchitectureApproval {
  selectedOptionId: string | undefined;
  materialize: (
    tx: Tx,
    context: ArchitectureDraftContext & { selectedOptionId: string },
  ) => Promise<{ ok: true } | { ok: false; code: ArchitectureApprovalCode }>;
}

export type ApproveVersionResult =
  { ok: true } | { ok: false; blocking: ImpactRow[]; code?: ArchitectureApprovalCode };

/** ERD 3.4 approval transaction and FR-083 currentness gate. */
export async function approveVersion(
  versionId: string,
  actorId: string,
  architecture?: ArchitectureApproval,
): Promise<ApproveVersionResult> {
  return approveVersionInternal(versionId, actorId, undefined, architecture);
}

/** ERD 3.5 / FR-084: satisfy the recomputed gate with cause-specific acknowledgements. */
export async function approveWithOverride(
  versionId: string,
  actorId: string,
  note: string,
  architecture?: ArchitectureApproval,
): Promise<ApproveVersionResult> {
  if (!note.trim()) throw new Error('override note must be non-empty');
  const result = await approveVersionInternal(versionId, actorId, note, architecture);
  if (!result.ok && !result.code) throw new GateBlocked(result.blocking);
  return result;
}

async function approveVersionInternal(
  versionId: string,
  actorId: string,
  overrideNote?: string,
  architecture?: ArchitectureApproval,
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

      // The architecture facade supplies its peer's callback; lifecycle alone
      // owns the lock, rollback, gate, acknowledgements and status transition.
      if (draft.type === 'architecture') {
        if (!architecture?.selectedOptionId)
          throw new ArchitectureApprovalBlocked('OPTION_NOT_SELECTED');
        const result = await architecture.materialize(tx, {
          ...(await loadArchitectureDraftContext(tx, versionId)),
          selectedOptionId: architecture.selectedOptionId,
        });
        if (!result.ok) throw new ArchitectureApprovalBlocked(result.code);
      } else if (architecture) {
        throw new Error('Architecture selection requires an architecture draft');
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
        .set({
          status: 'approved',
          ...(draft.type === 'architecture'
            ? { selectedArchitectureOptionId: architecture!.selectedOptionId! }
            : {}),
        })
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
    if (error instanceof ArchitectureApprovalBlocked)
      return { ok: false, blocking: [], code: error.code };
    throw error;
  }
}
