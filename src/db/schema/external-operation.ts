import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { project } from './project';
import { artifactVersion } from './artifact-version';
import { artifactVersionItemMembership } from './artifact-version-item-membership';

// ERD section 4.14 / Appendix A. Pre-write record, one per external object -
// the insert-first half of the external-write protocol (ERD 7.2). Owned by
// external-operations (Module Boundaries 4.5, layer 4).
export const externalOperation = pgTable(
  'external_operation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    provider: text('provider').notNull(),
    operationType: text('operation_type').notNull(),
    operationKey: text('operation_key').notNull(),
    status: text('status').notNull(),
    requestHash: text('request_hash').notNull(),
    sourceArtifactVersionId: uuid('source_artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    // Nullable: Jira requires it (see the provider/item CHECK below),
    // GitHub/Stitch operate on the whole artifact version, not one item.
    sourceItemVersionId: uuid('source_item_version_id'),
    targetDescriptor: jsonb('target_descriptor').notNull().default({}),
    externalId: text('external_id'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Refreshed by the touch_updated_at trigger (ERD A.2 T6) on EVERY
    // update - section 7.2's stale-pending check depends on this being real.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.operationKey),
    check(
      'external_operation_status_check',
      sql`${table.status} IN ('pending','completed','failed','reconciliation_required')`,
    ),
    check(
      'external_operation_provider_check',
      sql`${table.provider} IN ('github','jira','stitch')`,
    ),
    check(
      'external_operation_completed_has_external_id_check',
      sql`${table.status} <> 'completed' OR ${table.externalId} IS NOT NULL`,
    ),
    // Same provenance rule as external_ref, so a malformed write fails at
    // step 1, BEFORE the provider call (ERD Appendix A comment).
    check(
      'external_operation_jira_requires_item_check',
      sql`(${table.provider} = 'jira') = (${table.sourceItemVersionId} IS NOT NULL)`,
    ),
    // MATCH SIMPLE (Postgres default): skipped when source_item_version_id
    // is NULL - non-Jira operations aren't item-scoped.
    foreignKey({
      columns: [table.sourceArtifactVersionId, table.sourceItemVersionId],
      foreignColumns: [
        artifactVersionItemMembership.artifactVersionId,
        artifactVersionItemMembership.itemVersionId,
      ],
    }).onDelete('restrict'),
  ],
);
