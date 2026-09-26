import { and, eq } from 'drizzle-orm';
import { db, schema, withProjectLock, type Tx } from '@/db';
import { acknowledgeGateBlockers, evaluateGate, type ImpactRow } from '@/lineage/impact';
import { getDisplayKeysByItemVersionId, getSourceVersionMembers } from '@/lineage/identity';
import { loadArchitectureDraftContext, type ArchitectureDraftContext } from './architecture';
import { VersionNotDraftError } from './errors';

// Thrown by `approveWithOverride` when the gate recomputed inside its own
// transaction still blocks (FR-084: an override satisfies the gate, it does
// not bypass it - so a block that survives the acknowledgements is a real,
// rolled-back refusal). Exported (E3-S10) so the approve route can map it to
// 409 APPROVAL_BLOCKED; `approveVersion` itself never throws it - it turns the
// same condition into `{ ok: false, blocking, displayKeys }`.
//
// `displayKeys` is `item_version.id -> display_key` for every id `blocking`
// references (each row's root and every `path` entry), captured INSIDE the
// approval transaction before it rolls back. A blocked Architecture approval
// has already minted its ADR ItemVersions (`materialize` runs before the gate),
// and the rollback un-mints them while the blocking rows still name them as
// subject / last path element - so once the transaction is gone no read on the
// pool can resolve them (ERD 3.5, "Why ids never cross the API"). The route
// serializes `details.blocking` from this map instead. Defaults to empty so a
// caller that builds the error by hand (a test) still type-checks.
export class ApprovalGateBlockedError extends Error {
  constructor(
    readonly blocking: ImpactRow[],
    readonly displayKeys: Map<string, string> = new Map(),
  ) {
    super('approval gate blocked');
    this.name = 'ApprovalGateBlockedError';
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

// `displayKeys` (see `ApprovalGateBlockedError`) is present exactly when the
// gate blocked (`code` absent): the keys for every id in `blocking`, resolved
// before the rolled-back transaction closed. Optional so the type stays
// additive for existing callers.
export type ApproveVersionResult =
  | { ok: true }
  | {
      ok: false;
      blocking: ImpactRow[];
      displayKeys?: Map<string, string>;
      code?: ArchitectureApprovalCode;
    };

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
  if (!result.ok && !result.code) {
    throw new ApprovalGateBlockedError(result.blocking, result.displayKeys);
  }
  return result;
}

/** Every item_version id a set of blocking rows names: each root plus every `path` entry (the subject is the last one). */
function referencedItemVersionIds(rows: readonly ImpactRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    ids.add(row.rootItemVersionId);
    for (const id of row.path) ids.add(id);
  }
  return [...ids];
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
        throw new VersionNotDraftError(versionId);
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
      if (blocking.length) {
        // Both the plain and the override path land here (an override runs the
        // same gate again after acknowledging). Resolve the display keys while
        // the transaction - and any ADR ItemVersions `materialize` minted in it
        // - still exists; the throw below rolls all of it back.
        const displayKeys = await getDisplayKeysByItemVersionId(
          tx,
          referencedItemVersionIds(blocking),
        );
        throw new ApprovalGateBlockedError(blocking, displayKeys);
      }

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
    if (error instanceof ApprovalGateBlockedError) {
      return { ok: false, blocking: error.blocking, displayKeys: error.displayKeys };
    }
    if (error instanceof ArchitectureApprovalBlocked)
      return { ok: false, blocking: [], code: error.code };
    throw error;
  }
}
