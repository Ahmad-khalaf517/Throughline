import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { itemVersion } from './item-version';

// ERD section 4.11 / Appendix A. Exact ItemVersion -> ItemVersion lineage
// edges - immutable once created (INV-015), owned by identity (Module
// Boundaries 4.2, layer 1). Append-only via the
// semantic_dependency_append_only trigger (ERD A.2 T1). impact() (ERD
// section 6.3) is the only reader that matters; see
// throughline-lineage-invariants before touching this table's shape.
export const semanticDependency = pgTable(
  'semantic_dependency',
  {
    projectId: uuid('project_id').notNull(),
    downstreamItemVersionId: uuid('downstream_item_version_id').notNull(),
    upstreamItemVersionId: uuid('upstream_item_version_id').notNull(),
    proposedBy: text('proposed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.downstreamItemVersionId, table.upstreamItemVersionId] }),
    foreignKey({
      columns: [table.downstreamItemVersionId, table.projectId],
      foreignColumns: [itemVersion.id, itemVersion.projectId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.upstreamItemVersionId, table.projectId],
      foreignColumns: [itemVersion.id, itemVersion.projectId],
    }).onDelete('restrict'),
    check(
      'semantic_dependency_downstream_not_upstream_check',
      sql`${table.downstreamItemVersionId} <> ${table.upstreamItemVersionId}`,
    ),
    check(
      'semantic_dependency_proposed_by_check',
      sql`${table.proposedBy} IN ('ai','system','user')`,
    ),
    // impact()'s recursive walk traverses upstream -> downstream; this is
    // the traversal index (ERD Appendix A "indexes" section).
    index('semantic_dependency_upstream').on(table.upstreamItemVersionId),
  ],
);
