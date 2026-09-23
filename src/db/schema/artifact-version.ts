import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { artifact } from './artifact';

// ERD sections 4.4/4.9 / Appendix A. artifact_version and architecture_option
// are the ERD's one real FK cycle (Appendix A.1 comment: "the selected
// option must belong to THIS version") - kept in one file because of that,
// same as the ERD keeps the cycle-closing ALTER TABLE right next to both
// CREATE TABLEs.
//
// Ordering matters here and is easy to get backwards: a column's own
// `.references()` callback is evaluated lazily by Drizzle (its documented
// pattern for circular/self references - the callback isn't invoked until
// the whole module has been evaluated), but a table's extraConfig callback
// (the array-returning second argument to pgTable, used for foreignKey()/
// unique()/check() below) runs EAGERLY, synchronously, as part of the
// pgTable() call itself. So architectureOption is declared FIRST, with a
// lazy column-level reference forward to artifactVersion (not yet defined -
// fine, because it's lazy); artifactVersion is declared SECOND, with an
// ordinary eager foreignKey() closing the cycle back to architectureOption
// (already fully defined by that point - fine, because it's eager but late).
// Reversing this order throws "Cannot access before initialization".
//
// Both tables owned by artifact-lifecycle / architecture-materialization
// respectively (Module Boundaries 4.3/4.9). All the state-machine rules
// (legal status transitions, frozen-once-non-draft, append-only options,
// exactly-2-options-to-approve) are DB triggers (ERD A.2 T2/T3), not
// expressible here - see the triggers custom migration.

export const architectureOption = pgTable(
  'architecture_option',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Lazy: artifactVersion is defined below in this same module.
    artifactVersionId: uuid('artifact_version_id')
      .notNull()
      .references((): AnyPgColumn => artifactVersion.id, { onDelete: 'restrict' }),
    optionKey: text('option_key').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    stack: jsonb('stack').notNull(),
    candidateDecisions: jsonb('candidate_decisions').notNull(),
    tradeoffs: jsonb('tradeoffs').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.artifactVersionId, table.optionKey),
    // Anchor for artifact_version's composite FK below.
    unique().on(table.id, table.artifactVersionId),
    check('architecture_option_option_key_check', sql`${table.optionKey} IN ('A','B')`),
  ],
);

export const artifactVersion = pgTable(
  'artifact_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    // Self-referential: the artifact's approved version at draft-creation time.
    baseApprovedVersionId: uuid('base_approved_version_id'),
    // Closes the cycle with architecture_option above.
    selectedArchitectureOptionId: uuid('selected_architecture_option_id'),
    payload: jsonb('payload').notNull().default({}),
    // Preserved raw model output for a stale-generation rejection (INV-006) -
    // the only case a rejected version is allowed to be inserted directly.
    rawOutput: jsonb('raw_output'),
    statusReason: text('status_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Maintained by the touch_updated_at trigger (ERD A.2 T6).
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.artifactId, table.versionNumber),
    // Anchor for FKs into (id, artifact_id): this table's own self-referential
    // base_approved_version_id FK, and artifact_version_item_membership's.
    unique().on(table.id, table.artifactId),
    check('artifact_version_version_number_check', sql`${table.versionNumber} > 0`),
    check(
      'artifact_version_status_check',
      sql`${table.status} IN ('draft','approved','superseded','rejected')`,
    ),
    check(
      'artifact_version_status_reason_check',
      sql`${table.statusReason} IN ('revision_requested','user_rejected','replaced_by_regeneration','stale_generation_context')`,
    ),
    check(
      'artifact_version_base_approved_not_self_check',
      sql`${table.baseApprovedVersionId} IS DISTINCT FROM ${table.id}`,
    ),
    check(
      'artifact_version_rejected_has_reason_check',
      sql`(${table.status} = 'rejected') = (${table.statusReason} IS NOT NULL)`,
    ),
    check(
      'artifact_version_option_requires_approved_check',
      sql`${table.selectedArchitectureOptionId} IS NULL OR ${table.status} IN ('approved','superseded')`,
    ),
    check(
      'artifact_version_stale_has_raw_output_check',
      sql`(${table.statusReason} IS NOT DISTINCT FROM 'stale_generation_context') = (${table.rawOutput} IS NOT NULL)`,
    ),
    foreignKey({
      columns: [table.baseApprovedVersionId, table.artifactId],
      foreignColumns: [table.id, table.artifactId],
    }).onDelete('restrict'),
    // The one real FK cycle (ERD A.1): the selected option must belong to
    // THIS version. architectureOption is already fully defined above.
    foreignKey({
      columns: [table.selectedArchitectureOptionId, table.id],
      foreignColumns: [architectureOption.id, architectureOption.artifactVersionId],
    }).onDelete('restrict'),
    // INV-001/INV-005: a plain index on (artifact_id, status) would not
    // enforce "at most one approved/draft version" - only a partial unique
    // index does.
    uniqueIndex('one_approved_version')
      .on(table.artifactId)
      .where(sql`${table.status} = 'approved'`),
    uniqueIndex('one_draft_version')
      .on(table.artifactId)
      .where(sql`${table.status} = 'draft'`),
  ],
);
