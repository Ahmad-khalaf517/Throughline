import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { artifact } from './artifact';

// ERD section 4.6 / Appendix A. Stable conceptual identity of an item
// (R-07, S-12, ...). Owned by identity (Module Boundaries 4.2, layer 1).
//
// project_id has no direct FK to project(id) - deliberate, matching the ERD
// exactly: referential integrity to project is enforced transitively
// through the (artifact_id, project_id) -> artifact(id, project_id)
// composite FK below, which is already anchored to project via artifact's
// own project_id FK. Do not "helpfully" add a direct FK; that would be a
// deviation from the frozen DDL, not a fix.
export const logicalItem = pgTable(
  'logical_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    artifactId: uuid('artifact_id').notNull(),
    itemType: text('item_type').notNull(),
    displayKey: text('display_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.projectId, table.displayKey),
    // Anchors for artifact_version_item_membership's / item_version's FKs.
    unique().on(table.id, table.artifactId),
    unique().on(table.id, table.projectId),
    foreignKey({
      columns: [table.artifactId, table.projectId],
      foreignColumns: [artifact.id, artifact.projectId],
    }).onDelete('restrict'),
    check(
      'logical_item_item_type_check',
      sql`${table.itemType} IN ('requirement','architecture_decision','ui_requirement','epic','story')`,
    ),
    // Display-key format is tied to item_type (ERD Appendix A): R-07,
    // ADR-03, UI-05, E-01, S-12. At least two digits, per the regexes.
    check(
      'logical_item_display_key_format_check',
      sql`(${table.itemType} = 'requirement'           AND ${table.displayKey} ~ '^R-[0-9]{2,}$')   OR
          (${table.itemType} = 'architecture_decision' AND ${table.displayKey} ~ '^ADR-[0-9]{2,}$') OR
          (${table.itemType} = 'ui_requirement'        AND ${table.displayKey} ~ '^UI-[0-9]{2,}$')  OR
          (${table.itemType} = 'epic'                  AND ${table.displayKey} ~ '^E-[0-9]{2,}$')   OR
          (${table.itemType} = 'story'                 AND ${table.displayKey} ~ '^S-[0-9]{2,}$')`,
    ),
  ],
);
