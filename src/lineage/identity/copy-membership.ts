import { eq } from 'drizzle-orm';
import { schema, type Tx } from '@/db';

/**
 * ERD 3.6 (manual revision draft): bit-for-bit copy of every membership row
 * of `fromVersionId` into `toVersionId` - same `item_version_id`,
 * `parent_logical_item_id` and `position`, Epic rows first. No hashing, no
 * new ItemVersions - this is the ONLY function that writes membership
 * without going through matching (Module Boundaries section 4.2).
 *
 * Caller (artifact-lifecycle) owns the lock and the transaction; this
 * function only ever participates in one already opened by `tx`.
 */
export async function copyMembership(
  tx: Tx,
  fromVersionId: string,
  toVersionId: string,
): Promise<void> {
  const rows = await tx
    .select({
      artifactId: schema.artifactVersionItemMembership.artifactId,
      logicalItemId: schema.artifactVersionItemMembership.logicalItemId,
      itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
      parentLogicalItemId: schema.artifactVersionItemMembership.parentLogicalItemId,
      position: schema.artifactVersionItemMembership.position,
    })
    .from(schema.artifactVersionItemMembership)
    .where(eq(schema.artifactVersionItemMembership.artifactVersionId, fromVersionId));

  if (!rows.length) return;

  // Epic rows (parent_logical_item_id IS NULL) before Story rows (parent_logical_item_id
  // = an Epic's logical_item_id) - the self-referential FK on
  // (artifact_version_id, parent_logical_item_id) needs the parent's own row
  // to already be present. A plain multi-row INSERT is checked as one
  // statement in Postgres (order wouldn't matter there), but this ordering
  // is kept anyway to match ERD 3.6 step 3's literal instruction.
  const ordered = [...rows].sort((a, b) => {
    const aHasParent = a.parentLogicalItemId === null ? 0 : 1;
    const bHasParent = b.parentLogicalItemId === null ? 0 : 1;
    return aHasParent - bHasParent;
  });

  await tx.insert(schema.artifactVersionItemMembership).values(
    ordered.map((row) => ({
      artifactVersionId: toVersionId,
      artifactId: row.artifactId,
      logicalItemId: row.logicalItemId,
      itemVersionId: row.itemVersionId,
      parentLogicalItemId: row.parentLogicalItemId,
      position: row.position,
    })),
  );
}
