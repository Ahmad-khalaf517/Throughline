import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './app-user';

// ERD section 4.2 / Appendix A. Workspace: brief + input hints. Owned by
// artifact-lifecycle (Module Boundaries 4.3).
//
// [DB] project_seed_frozen trigger (ERD A.2 T5): brief/input_context are
// frozen once any Requirements artifact_version exists - added in the
// triggers custom migration, not expressible in the Drizzle schema.
export const project = pgTable(
  'project',
  {
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
    // ERD 4.2 / A.5: where this project's external outputs go (replace the env
    // GITHUB_OWNER / JIRA_PROJECT_KEY for NEW operations). Nullable = fall
    // back to env. Written only by artifact-lifecycle.updateProjectTargets; not covered
    // by the seed freeze.
    githubOwner: text('github_owner'),
    jiraCloudId: text('jira_cloud_id'),
    jiraProjectKey: text('jira_project_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Maintained by the touch_updated_at trigger (ERD A.2 T6), never by callers.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'project_jira_target_pair',
      sql`(${table.jiraCloudId} IS NULL) = (${table.jiraProjectKey} IS NULL)`,
    ),
    check(
      'project_target_not_blank',
      sql`(${table.githubOwner} IS NULL OR length(btrim(${table.githubOwner})) > 0)
        AND (${table.jiraCloudId} IS NULL OR length(btrim(${table.jiraCloudId})) > 0)
        AND (${table.jiraProjectKey} IS NULL OR length(btrim(${table.jiraProjectKey})) > 0)`,
    ),
  ],
);
