import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@/db';

export async function resolveDisplayKeys(
  tx: Tx,
  artifactId: string,
  keys: string[],
): Promise<Map<string, string>> {
  const uniqueKeys = [...new Set(keys)];
  if (!uniqueKeys.length) return new Map();
  const rows = await tx
    .select({ displayKey: schema.logicalItem.displayKey, id: schema.logicalItem.id })
    .from(schema.logicalItem)
    .where(
      and(
        eq(schema.logicalItem.artifactId, artifactId),
        inArray(schema.logicalItem.displayKey, uniqueKeys),
      ),
    );
  const resolved = new Map(rows.map((row) => [row.displayKey, row.id]));
  for (const key of uniqueKeys) {
    if (!resolved.has(key)) throw new Error(`Unresolved display key: ${key}`);
  }
  return resolved;
}

// `itemType`/`parentLogicalItemId` were added by E4-S3 (SCRUM-52): `jira`
// (Module Boundaries 4.6) needs to tell Epics from Stories and resolve a
// Story's Epic parent within one captured Backlog version (ERD 7.4), and
// this shared read already joins `logical_item` and
// `artifact_version_item_membership` - the two columns' own owning tables.
// Purely additive: every existing call site (artifact-lifecycle/approval.ts,
// artifact-lifecycle/generation.ts, architecture-materialization, this
// module's own dependency-binding.bindUpstreamRefs) only ever destructures
// the fields it already used, so two more columns on the same rows change
// nothing for them - confirmed by reading every call site before adding
// these.
export async function getSourceVersionMembers(tx: Tx, sourceVersionIds: string[]) {
  const uniqueSourceVersionIds = [...new Set(sourceVersionIds)];
  if (!uniqueSourceVersionIds.length) return [];
  const rows = await tx
    .select({
      sourceVersionId: schema.artifactVersion.id,
      artifactId: schema.artifactVersion.artifactId,
      projectId: schema.artifact.projectId,
      status: schema.artifactVersion.status,
      logicalItemId: schema.artifactVersionItemMembership.logicalItemId,
      itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
      displayKey: schema.logicalItem.displayKey,
      itemType: schema.logicalItem.itemType,
      parentLogicalItemId: schema.artifactVersionItemMembership.parentLogicalItemId,
    })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifactVersion.artifactId, schema.artifact.id))
    .leftJoin(
      schema.artifactVersionItemMembership,
      eq(schema.artifactVersionItemMembership.artifactVersionId, schema.artifactVersion.id),
    )
    .leftJoin(
      schema.logicalItem,
      eq(schema.artifactVersionItemMembership.logicalItemId, schema.logicalItem.id),
    )
    .where(inArray(schema.artifactVersion.id, uniqueSourceVersionIds));
  const foundVersionIds = new Set(rows.map((row) => row.sourceVersionId));
  if (foundVersionIds.size !== uniqueSourceVersionIds.length) {
    throw new Error('Unknown context source version');
  }
  return rows;
}

export async function getCurrentItemVersionIds(
  tx: Tx,
  projectId: string,
  itemVersionIds: string[],
): Promise<Set<string>> {
  if (!itemVersionIds.length) return new Set();
  const rows = await tx
    .select({ itemVersionId: schema.artifactVersionItemMembership.itemVersionId })
    .from(schema.artifactVersionItemMembership)
    .innerJoin(
      schema.artifactVersion,
      eq(schema.artifactVersionItemMembership.artifactVersionId, schema.artifactVersion.id),
    )
    .innerJoin(schema.artifact, eq(schema.artifactVersion.artifactId, schema.artifact.id))
    .where(
      and(
        eq(schema.artifact.projectId, projectId),
        eq(schema.artifactVersion.status, 'approved'),
        inArray(schema.artifactVersionItemMembership.itemVersionId, itemVersionIds),
      ),
    );
  return new Set(rows.map((row) => row.itemVersionId));
}
