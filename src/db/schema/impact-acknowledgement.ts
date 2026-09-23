import { check, foreignKey, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { project } from './project';
import { itemVersion } from './item-version';
import { externalRef } from './external-ref';
import { appUser } from './app-user';

// ERD section 4.12 / Appendix A. Cause-specific acknowledgement of a
// computed warning (INV-026) - owned by impact (Module Boundaries 4.2, layer
// 1). Append-only via the impact_acknowledgement_append_only trigger (ERD
// A.2 T1); never updated or deleted, per throughline-lineage-invariants.
export const impactAcknowledgement = pgTable(
  'impact_acknowledgement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    subjectItemVersionId: uuid('subject_item_version_id').references(() => itemVersion.id, {
      onDelete: 'restrict',
    }),
    subjectExternalRefId: uuid('subject_external_ref_id').references(() => externalRef.id, {
      onDelete: 'restrict',
    }),
    rootLogicalItemId: uuid('root_logical_item_id').notNull(),
    obsoleteUpstreamItemVersionId: uuid('obsolete_upstream_item_version_id').notNull(),
    // NULL = acknowledging a removal (the root has no current version).
    acknowledgedAgainstUpstreamItemVersionId: uuid('acknowledged_against_upstream_item_version_id'),
    acknowledgedByUserId: uuid('acknowledged_by_user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'restrict' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (table) => [
    check(
      'impact_acknowledgement_exactly_one_subject_check',
      sql`num_nonnulls(${table.subjectItemVersionId}, ${table.subjectExternalRefId}) = 1`,
    ),
    check(
      'impact_acknowledgement_obsolete_not_against_check',
      sql`${table.obsoleteUpstreamItemVersionId} IS DISTINCT FROM ${table.acknowledgedAgainstUpstreamItemVersionId}`,
    ),
    // The obsolete root and the acknowledged-against version must be
    // versions of the SAME logical item.
    foreignKey({
      columns: [table.obsoleteUpstreamItemVersionId, table.rootLogicalItemId],
      foreignColumns: [itemVersion.id, itemVersion.logicalItemId],
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.acknowledgedAgainstUpstreamItemVersionId, table.rootLogicalItemId],
      foreignColumns: [itemVersion.id, itemVersion.logicalItemId],
    }).onDelete('restrict'),
    // ack_item_unique / ack_ref_unique (partial + NULLS NOT DISTINCT unique
    // indexes - "a removal acknowledgement cannot be duplicated") are NOT
    // expressible in this drizzle-orm version's index builder: .where() and
    // .nullsNotDistinct() together aren't supported on an index (only a
    // plain, non-partial unique CONSTRAINT supports .nullsNotDistinct(), and
    // Postgres constraints can't carry a WHERE clause at all). Added verbatim
    // in the 0001_lineage_partial_indexes custom migration instead - same
    // split as triggers/impact() below it.
  ],
);
