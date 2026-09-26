import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@/db';
import { semanticHash, SEMANTIC_HASH_VERSION, type ItemType } from './projection';

export type RebindDiff = {
  logicalItemId: string;
  displayKey: string;
  from: string;
  to: string;
};

export class ItemEditError extends Error {
  constructor(
    readonly code:
      'VERSION_NOT_DRAFT' | 'ITEM_NOT_IN_VERSION' | 'UPSTREAM_REMOVED' | 'CONFIRMATION_REQUIRED',
    message: string,
    readonly details?:
      { logicalItemId: string; displayKey: string } | { changedRefs: RebindDiff[] },
  ) {
    super(message);
    this.name = 'ItemEditError';
  }
}

export type RebindDraftItemResult = {
  itemVersionId: string;
  item: typeof schema.itemVersion.$inferSelect;
  changedRefs: RebindDiff[];
};

/** ERD 5.3 / FR-082: caller holds the project lock; old versions and edges stay immutable. */
export async function rebindDraftItem(
  tx: Tx,
  opts: {
    draftVersionId: string;
    logicalItemId: string;
    editedPayload: unknown;
    // Additional orchestration input: lifecycle validates the draft and resolves
    // approved versions under its project lock, retaining artifact_version ownership.
    currentApprovedVersionIds: string[];
  },
): Promise<RebindDraftItemResult> {
  const { draftVersionId, logicalItemId, editedPayload, currentApprovedVersionIds } = opts;

  const [member] = await tx
    .select({
      itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
      projectId: schema.logicalItem.projectId,
      itemType: schema.logicalItem.itemType,
    })
    .from(schema.artifactVersionItemMembership)
    .innerJoin(
      schema.logicalItem,
      eq(schema.logicalItem.id, schema.artifactVersionItemMembership.logicalItemId),
    )
    .where(
      and(
        eq(schema.artifactVersionItemMembership.artifactVersionId, draftVersionId),
        eq(schema.artifactVersionItemMembership.logicalItemId, logicalItemId),
      ),
    );
  if (!member) {
    throw new ItemEditError(
      'ITEM_NOT_IN_VERSION',
      `Logical item ${logicalItemId} is not in this draft`,
    );
  }

  const previousRefs = await tx
    .select({
      logicalItemId: schema.logicalItem.id,
      displayKey: schema.logicalItem.displayKey,
      itemVersionId: schema.itemVersion.id,
    })
    .from(schema.semanticDependency)
    .innerJoin(
      schema.itemVersion,
      eq(schema.itemVersion.id, schema.semanticDependency.upstreamItemVersionId),
    )
    .innerJoin(schema.logicalItem, eq(schema.logicalItem.id, schema.itemVersion.logicalItemId))
    .where(eq(schema.semanticDependency.downstreamItemVersionId, member.itemVersionId))
    .orderBy(asc(schema.logicalItem.displayKey), asc(schema.itemVersion.id));

  const currentRefs =
    previousRefs.length && currentApprovedVersionIds.length
      ? await tx
          .select({
            logicalItemId: schema.artifactVersionItemMembership.logicalItemId,
            itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
          })
          .from(schema.artifactVersionItemMembership)
          .where(
            and(
              inArray(
                schema.artifactVersionItemMembership.artifactVersionId,
                currentApprovedVersionIds,
              ),
              inArray(
                schema.artifactVersionItemMembership.logicalItemId,
                previousRefs.map((ref) => ref.logicalItemId),
              ),
            ),
          )
      : [];
  const currentByLogicalId = new Map(
    currentRefs.map((ref) => [ref.logicalItemId, ref.itemVersionId]),
  );
  const changedRefs: RebindDiff[] = [];
  const upstreamIds = new Set<string>();
  for (const ref of previousRefs) {
    const currentId = currentByLogicalId.get(ref.logicalItemId);
    if (!currentId) {
      throw new ItemEditError(
        'UPSTREAM_REMOVED',
        `Upstream item ${ref.displayKey} has been removed`,
        {
          logicalItemId: ref.logicalItemId,
          displayKey: ref.displayKey,
        },
      );
    }
    upstreamIds.add(currentId);
    if (currentId !== ref.itemVersionId) {
      changedRefs.push({
        logicalItemId: ref.logicalItemId,
        displayKey: ref.displayKey,
        from: ref.itemVersionId,
        to: currentId,
      });
    }
  }

  const hash = semanticHash(member.itemType as ItemType, editedPayload, [...upstreamIds]);
  const [latest] = await tx
    .select({ revisionNumber: schema.itemVersion.revisionNumber })
    .from(schema.itemVersion)
    .where(eq(schema.itemVersion.logicalItemId, logicalItemId))
    .orderBy(desc(schema.itemVersion.revisionNumber))
    .limit(1);
  // Manual edits always append, including presentation-only and no-op edits.
  const [item] = await tx
    .insert(schema.itemVersion)
    .values({
      projectId: member.projectId,
      logicalItemId,
      revisionNumber: (latest?.revisionNumber ?? 0) + 1,
      payload: editedPayload,
      semanticHash: hash,
      semanticHashVersion: SEMANTIC_HASH_VERSION,
    })
    .returning();
  if (!item) throw new Error('Failed to create edited item version');
  if (upstreamIds.size) {
    await tx.insert(schema.semanticDependency).values(
      [...upstreamIds].sort().map((upstreamItemVersionId) => ({
        projectId: member.projectId,
        downstreamItemVersionId: item.id,
        upstreamItemVersionId,
        proposedBy: 'user',
      })),
    );
  }
  // UPDATE preserves position and the Epic parent FK, including when editing an Epic itself.
  await tx
    .update(schema.artifactVersionItemMembership)
    .set({ itemVersionId: item.id })
    .where(
      and(
        eq(schema.artifactVersionItemMembership.artifactVersionId, draftVersionId),
        eq(schema.artifactVersionItemMembership.logicalItemId, logicalItemId),
      ),
    );
  return { itemVersionId: item.id, item, changedRefs };
}
