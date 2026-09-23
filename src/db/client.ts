import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '@/lib/env';
import * as schema from './schema';

// Connects via the Supavisor transaction pooler (port 6543). prepare:false is
// required behind it - the pooler multiplexes connections across clients, so
// a prepared statement from one request can't be relied on to still exist for
// the next (ERD section 2.1 point 3).
const queryClient = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(queryClient, { schema });
