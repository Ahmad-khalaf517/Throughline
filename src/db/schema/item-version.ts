import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { logicalItem } from './logical-item';

// ERD section 4.7 / Appendix A. Immutable content version of a logical item.
// Owned by identity (Module Boundaries 4.2, layer 1). Append-only enforced
// by the item_version_append_only trigger (ERD A.2 T1) - the highest-risk
// table in the project (ERD section 14 risk 1); see throughline-lineage-
// invariants for the match/hash/reuse rules this table exists to support.
//
// project_id has no direct FK to project(id), same rationale as
// logical_item - enforced transitively via (logical_item_id, project_id).
export const itemVersion = pgTable(
  'item_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    logicalItemId: uuid('logical_item_id').notNull(),
    revisionNumber: integer('revision_number').notNull(),
    payload: jsonb('payload').notNull(),
    // SHA-256 hex of the canonicalized semantic projection (INV-016) -
    // frozen at semantic_hash_version 1 (ERD section 22).
    semanticHash: text('semantic_hash').notNull(),
    semanticHashVersion: integer('semantic_hash_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.logicalItemId, table.revisionNumber),
    // Anchors for artifact_version_item_membership's / semantic_dependency's FKs.
    unique().on(table.id, table.logicalItemId),
    unique().on(table.id, table.projectId),
    foreignKey({
      columns: [table.logicalItemId, table.projectId],
      foreignColumns: [logicalItem.id, logicalItem.projectId],
    }).onDelete('restrict'),
    check('item_version_revision_number_check', sql`${table.revisionNumber} > 0`),
    check('item_version_semantic_hash_check', sql`${table.semanticHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
