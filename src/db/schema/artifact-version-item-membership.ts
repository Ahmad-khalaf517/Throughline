import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { artifactVersion } from './artifact-version';
import { logicalItem } from './logical-item';
import { itemVersion } from './item-version';

// ERD section 4.8 / Appendix A. Which ItemVersions an ArtifactVersion
// contains (M:N), also holds the Epic -> Story parent (parent_logical_item_id).
// Owned by identity (Module Boundaries 4.2, layer 1). Mutable only while its
// artifact_version is a draft - enforced by the membership_draft_only
// trigger (ERD A.2 T4), not expressible here.
export const artifactVersionItemMembership = pgTable(
  'artifact_version_item_membership',
  {
    artifactVersionId: uuid('artifact_version_id').notNull(),
    artifactId: uuid('artifact_id').notNull(),
    logicalItemId: uuid('logical_item_id').notNull(),
    itemVersionId: uuid('item_version_id').notNull(),
    // Epic -> Story parent, this version's membership only (Backlog only).
    parentLogicalItemId: uuid('parent_logical_item_id'),
    position: integer('position'),
  },
  (table) => [
    primaryKey({ columns: [table.artifactVersionId, table.itemVersionId] }),
    // Anchor for the self-referential parent FK below, and for
    // external_operation's/external_ref's (artifact_version_id, item_version_id) FK.
    unique().on(table.artifactVersionId, table.logicalItemId),
    foreignKey({
      columns: [table.artifactVersionId, table.artifactId],
      foreignColumns: [artifactVersion.id, artifactVersion.artifactId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.logicalItemId, table.artifactId],
      foreignColumns: [logicalItem.id, logicalItem.artifactId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.itemVersionId, table.logicalItemId],
      foreignColumns: [itemVersion.id, itemVersion.logicalItemId],
    }).onDelete('restrict'),
    // Self-referential: the parent's own membership row, in the SAME version.
    foreignKey({
      columns: [table.artifactVersionId, table.parentLogicalItemId],
      foreignColumns: [table.artifactVersionId, table.logicalItemId],
    }).onDelete('restrict'),
    check(
      'artifact_version_item_membership_parent_not_self_check',
      sql`${table.parentLogicalItemId} IS DISTINCT FROM ${table.logicalItemId}`,
    ),
    // Traversal index (ERD Appendix A "indexes" section) - impact() and
    // membership lookups by item_version_id.
    index('membership_item_version').on(table.itemVersionId),
  ],
);
