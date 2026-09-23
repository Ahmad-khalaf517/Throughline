-- ERD Appendix A.3, extended to the 15 tables and the impact() function
-- this slice added. The REVOKE statements are schema-wide and safe to
-- re-run (idempotent no-ops for anything already revoked) - re-running them
-- here is what actually closes the gap: Supabase grants its own default
-- privileges to anon/authenticated on every newly created table and
-- function, so each slice that adds objects needs this same treatment in
-- its own migration (ERD Appendix A.3 note; T34 catches a miss).

REVOKE ALL     ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER TABLE project                           ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_version                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE architecture_option               ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_event                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE logical_item                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_version                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_version_item_membership  ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_context_ref            ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_dependency               ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_operation                ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_ref                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE impact_acknowledgement            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generation_run                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE stitch_output                     ENABLE ROW LEVEL SECURITY;
