import { and, eq } from 'drizzle-orm';
import { db, schema, withProjectLock, type Tx } from '@/db';
import { ItemEditError, rebindDraftItem, type RebindDiff } from '@/lineage/identity';

type ItemEditPreview = { itemVersionId: string; changedRefs: RebindDiff[] };
export type CommitItemEditResult = typeof schema.itemVersion.$inferSelect & {
  changedRefs: RebindDiff[];
};

class PreviewRollback extends Error {
  constructor(readonly result: ItemEditPreview) {
    super('Roll back item edit preview');
  }
}

async function projectForVersion(draftVersionId: string): Promise<string> {
  const [target] = await db
    .select({ projectId: schema.artifact.projectId })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, draftVersionId));
  if (!target) {
    throw new ItemEditError(
      'VERSION_NOT_DRAFT',
      `Artifact version ${draftVersionId} is not a draft`,
    );
  }
  return target.projectId;
}

async function currentVersionsForEdit(
  tx: Tx,
  projectId: string,
  draftVersionId: string,
): Promise<string[]> {
  const [draft] = await tx
    .select({ status: schema.artifactVersion.status })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(
      and(eq(schema.artifactVersion.id, draftVersionId), eq(schema.artifact.projectId, projectId)),
    );
  if (!draft || draft.status !== 'draft') {
    throw new ItemEditError(
      'VERSION_NOT_DRAFT',
      `Artifact version ${draftVersionId} is not a draft`,
    );
  }
  const approved = await tx
    .select({ id: schema.artifactVersion.id })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(
      and(eq(schema.artifactVersion.status, 'approved'), eq(schema.artifact.projectId, projectId)),
    );
  return approved.map((version) => version.id);
}

/** FR-082: exercise the real edit in a transaction that never persists. */
export async function proposeItemEdit(
  draftVersionId: string,
  logicalItemId: string,
  editedPayload: unknown,
): Promise<ItemEditPreview> {
  const projectId = await projectForVersion(draftVersionId);
  try {
    await withProjectLock(projectId, async (tx) => {
      const currentApprovedVersionIds = await currentVersionsForEdit(tx, projectId, draftVersionId);
      const { itemVersionId, changedRefs } = await rebindDraftItem(tx, {
        draftVersionId,
        logicalItemId,
        editedPayload,
        currentApprovedVersionIds,
      });
      throw new PreviewRollback({ itemVersionId, changedRefs });
    });
  } catch (error) {
    if (error instanceof PreviewRollback) return error.result;
    throw error;
  }
  throw new Error('Item edit preview unexpectedly committed');
}

/** API Contracts 5: confirmation is checked against current refs inside the commit lock. */
export async function commitItemEdit(
  draftVersionId: string,
  logicalItemId: string,
  editedPayload: unknown,
  confirmed: boolean,
): Promise<CommitItemEditResult> {
  const projectId = await projectForVersion(draftVersionId);
  return withProjectLock(projectId, async (tx) => {
    const currentApprovedVersionIds = await currentVersionsForEdit(tx, projectId, draftVersionId);
    const { item, changedRefs } = await rebindDraftItem(tx, {
      draftVersionId,
      logicalItemId,
      editedPayload,
      currentApprovedVersionIds,
    });
    if (changedRefs.length && confirmed !== true) {
      throw new ItemEditError('CONFIRMATION_REQUIRED', 'Confirm the changed upstream references', {
        changedRefs,
      });
    }
    return { ...item, changedRefs };
  });
}
