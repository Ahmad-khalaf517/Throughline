import { defineConfig } from 'drizzle-kit';

// ERD section 2.1: migrations run over the session pooler / direct
// connection as `postgres`, NOT the transaction pooler (port 6543) the
// application uses at runtime - see src/db/client.ts.
//
// Only commands that open a live connection (migrate, push, studio, pull)
// need this to be a real URL; `generate` diffs local schema snapshots and
// never connects, so it must not be blocked by a missing .env.local.
const directUrl = process.env.DIRECT_DATABASE_URL ?? '';

export default defineConfig({
  schema: './src/db/schema',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  // Never touch Supabase's auth/storage schemas (ERD section 2.1 point 3).
  schemaFilter: ['public'],
  dbCredentials: {
    url: directUrl,
  },
});
