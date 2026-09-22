import { defineConfig } from 'drizzle-kit';

// ERD section 2.1: migrations run over the session pooler / direct
// connection as `postgres`, NOT the transaction pooler (port 6543) the
// application uses at runtime - see src/db/client.ts.
const directUrl = process.env.DIRECT_DATABASE_URL;
if (!directUrl) {
  throw new Error('DIRECT_DATABASE_URL is required for drizzle-kit (see .env.example).');
}

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
