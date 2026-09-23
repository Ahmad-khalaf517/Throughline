import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { appUser } from './app-user';
import { artifactVersion } from './artifact-version';

// ERD section 4.5 / Appendix A. Append-only human decision log. Owned by
// artifact-lifecycle (Module Boundaries 4.3). Append-only is enforced by the
// approval_event_append_only trigger (ERD A.2 T1), not expressible here.
export const approvalEvent = pgTable(
  'approval_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    artifactVersionId: uuid('artifact_version_id')
      .notNull()
      .references(() => artifactVersion.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    feedback: text('feedback'),
    overrodeStaleCheck: boolean('overrode_stale_check').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'approval_event_action_check',
      sql`${table.action} IN ('approved','revision_requested','rejected','draft_replaced')`,
    ),
    // TR FR-084 / ERD T6: an override must carry a non-empty note on an
    // approved event - the DB's own backstop for the approve-anyway path.
    check(
      'approval_event_override_requires_note_check',
      sql`NOT ${table.overrodeStaleCheck} OR (${table.action} = 'approved' AND ${table.feedback} IS NOT NULL AND btrim(${table.feedback}) <> '')`,
    ),
    uniqueIndex('one_approval_event')
      .on(table.artifactVersionId)
      .where(sql`${table.action} = 'approved'`),
    index('approval_event_version_time').on(table.artifactVersionId, table.createdAt),
  ],
);
