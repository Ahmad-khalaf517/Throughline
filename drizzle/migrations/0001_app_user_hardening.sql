-- ERD Appendix A.3 (Supabase hardening), scoped to the tables that exist so far.
--
-- Supabase publishes the public schema through its Data API (PostgREST / GraphQL) to anyone holding the
-- anon/publishable key, which ships to the browser by design, and its default privileges grant the
-- anon and authenticated roles access to every new table and function. Two independent layers close that:
--   1. revoke those grants  -> the Data API gets "permission denied";
--   2. RLS with NO policies -> even a later accidental GRANT exposes zero rows.
-- The server is unaffected: Drizzle connects as the table owner (postgres), and RLS does not apply to it.
--
-- The REVOKE statements are schema-wide (ALL TABLES / ALL FUNCTIONS IN SCHEMA public) and safe to run
-- again as more tables and functions are added - they are idempotent no-ops for anything already revoked.
-- The ALTER TABLE ... ENABLE ROW LEVEL SECURITY line is per-table: every future table needs its own line
-- added in the same migration that creates it (Project Setup section 6, ERD Appendix A.3 note). T34
-- (ERD Appendix C) is what catches a miss.

REVOKE ALL     ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
