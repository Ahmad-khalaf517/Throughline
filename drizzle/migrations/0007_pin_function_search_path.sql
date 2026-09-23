-- ERD Appendix B round 10. Closes the Supabase advisor's
-- function_search_path_mutable WARN on all 7 functions this slice added.
-- Zero behavior change: pins search_path so an attacker-controlled schema
-- earlier in a session's search_path can never shadow an unqualified
-- table/function reference inside these bodies.

ALTER FUNCTION forbid_mutation() SET search_path = public;
ALTER FUNCTION artifact_version_insert_guard() SET search_path = public;
ALTER FUNCTION artifact_version_guard() SET search_path = public;
ALTER FUNCTION membership_draft_only() SET search_path = public;
ALTER FUNCTION project_seed_frozen() SET search_path = public;
ALTER FUNCTION touch_updated_at() SET search_path = public;
ALTER FUNCTION impact(uuid, uuid) SET search_path = public;
