import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';

export interface ProjectItemCreation {
  itemVersionId: string;
  displayKey: string;
  itemType: string;
  revisionNumber: number;
  createdAt: Date;
  versionIds: string[];
}

export interface ProjectItemVersionDetail {
  id: string;
  displayKey: string;
  itemType: string;
  revisionNumber: number;
  createdAt: Date;
  payload: unknown;
}

/** A retained item version may have no membership after a draft edit. */
export async function getProjectItemVersionDetail(
  projectId: string,
  itemVersionId: string,
): Promise<ProjectItemVersionDetail | null> {
  const [row] = await db
    .select({
      id: schema.itemVersion.id,
      displayKey: schema.logicalItem.displayKey,
      itemType: schema.logicalItem.itemType,
      revisionNumber: schema.itemVersion.revisionNumber,
      createdAt: schema.itemVersion.createdAt,
      payload: schema.itemVersion.payload,
    })
    .from(schema.itemVersion)
    .innerJoin(schema.logicalItem, eq(schema.logicalItem.id, schema.itemVersion.logicalItemId))
    .where(
      and(eq(schema.itemVersion.projectId, projectId), eq(schema.itemVersion.id, itemVersionId)),
    )
    .limit(1);
  return row ?? null;
}

/** Item creation facts and membership links, read from identity-owned tables. */
export async function listProjectItemCreations(projectId: string): Promise<ProjectItemCreation[]> {
  const rows = await db
    .select({
      itemVersionId: schema.itemVersion.id,
      displayKey: schema.logicalItem.displayKey,
      itemType: schema.logicalItem.itemType,
      revisionNumber: schema.itemVersion.revisionNumber,
      createdAt: schema.itemVersion.createdAt,
      versionId: schema.artifactVersionItemMembership.artifactVersionId,
    })
    .from(schema.itemVersion)
    .innerJoin(schema.logicalItem, eq(schema.logicalItem.id, schema.itemVersion.logicalItemId))
    .leftJoin(
      schema.artifactVersionItemMembership,
      eq(schema.artifactVersionItemMembership.itemVersionId, schema.itemVersion.id),
    )
    .where(eq(schema.itemVersion.projectId, projectId))
    .orderBy(desc(schema.itemVersion.createdAt));

  const creations = new Map<string, ProjectItemCreation>();
  for (const row of rows) {
    let creation = creations.get(row.itemVersionId);
    if (!creation) {
      creation = { ...row, versionIds: [] };
      creations.set(row.itemVersionId, creation);
    }
    if (row.versionId) creation.versionIds.push(row.versionId);
  }
  return [...creations.values()];
}

/** Counts memberships for the requested version ids without reading lifecycle tables. */
export async function countVersionItems(versionIds: string[]): Promise<Map<string, number>> {
  if (!versionIds.length) return new Map();
  const rows = await db
    .select({ versionId: schema.artifactVersionItemMembership.artifactVersionId })
    .from(schema.artifactVersionItemMembership)
    .where(inArray(schema.artifactVersionItemMembership.artifactVersionId, versionIds));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.versionId, (counts.get(row.versionId) ?? 0) + 1);
  return counts;
}
