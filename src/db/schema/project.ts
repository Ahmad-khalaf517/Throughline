import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { appUser } from './app-user';

// ERD section 4.2 / Appendix A. Workspace: brief + input hints. Owned by
// artifact-lifecycle (Module Boundaries 4.3).
//
// [DB] project_seed_frozen trigger (ERD A.2 T5): brief/input_context are
// frozen once any Requirements artifact_version exists - added in the
// triggers custom migration, not expressible in the Drizzle schema.
export const project = pgTable('project', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => appUser.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  brief: text('brief').notNull(),
  // Optional creation-time hints (team size/skills, deadline, budget, scale,
  // tech preferences). Input only - once Requirements exist, project context
  // comes from current constraint items, never from here (ERD section 5.6).
  inputContext: jsonb('input_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // Maintained by the touch_updated_at trigger (ERD A.2 T6), never by callers.
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
