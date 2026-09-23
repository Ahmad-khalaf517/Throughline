import { check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { project } from './project';

// ERD section 4.3 / Appendix A. Stable slot: one per (project, type). Owned
// by artifact-lifecycle (Module Boundaries 4.3).
export const artifact = pgTable(
  'artifact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.projectId, table.type),
    // Composite-FK anchor for logical_item's (artifact_id, project_id) FK below.
    unique().on(table.id, table.projectId),
    check(
      'artifact_type_check',
      sql`${table.type} IN ('requirements','architecture','ui_requirements','backlog')`,
    ),
  ],
);
