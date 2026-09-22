import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// ERD section 4.1 / Appendix A. Local mirror of the Supabase Auth user - no
// teams/RBAC. Created or refreshed on the user's first authenticated request
// with INSERT ... ON CONFLICT (id) DO UPDATE (module 2: auth).
//
// Deliberately no FK to auth.users and no unique email - see ERD 4.1 for why
// (a cascade would break audit history; a unique email would permanently
// lock out a re-created Supabase user - T35).
export const appUser = pgTable('app_user', {
  // = the Supabase auth.users.id (the verified JWT sub). No default: never
  // generated locally.
  id: uuid('id').primaryKey(),
  // Snapshot for display and audit, refreshed on login. Not unique.
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
