-- ERD Appendix B round 13: whole-project deletion.
--
-- Until now the schema had no way to remove a project: every FK is ON DELETE
-- RESTRICT and six tables are append-only (forbid_mutation) or draft-only
-- (membership_draft_only), and a row trigger fires for every row a purge
-- removes, so a plain `DELETE FROM project` was rejected. Deleting a project
-- is now a real, user-triggered action (DELETE /api/projects/:projectId), so
-- this migration adds the one sanctioned way to do it.
--
-- What changes, and what deliberately does not:
--   * forbid_mutation() and membership_draft_only() let a DELETE through - and
--     ONLY a DELETE - while the transaction-local setting
--     `throughline.project_deletion` is 'on'. Only delete_project() ever sets
--     it, and it clears it again before returning, so the append-only and
--     frozen-membership guarantees hold for every other statement, including
--     any other DELETE in the same transaction after delete_project() returns.
--   * Every FK stays ON DELETE RESTRICT. delete_project() removes the rows in
--     dependency order instead of cascading, so an accidental
--     `DELETE FROM artifact_version` is still refused by the database.
--   * UPDATE stays forbidden everywhere; there is no bypass for it.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('throughline.project_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$;

CREATE OR REPLACE FUNCTION membership_draft_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s text;
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('throughline.project_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  SELECT status INTO s FROM artifact_version
   WHERE id = COALESCE(NEW.artifact_version_id, OLD.artifact_version_id);
  IF s <> 'draft' THEN
    RAISE EXCEPTION 'membership of a non-draft artifact_version is frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- Deletes one project and every row that hangs off it. Returns false (and
-- deletes nothing) when the project does not exist. The caller
-- (artifact-lifecycle.deleteProject) holds the project lock and owns the
-- transaction; this function neither commits nor takes a lock of its own.
--
-- Order is leaves first. The two places a single statement is required:
--   * artifact_version_item_membership references itself (parent_logical_item_id)
--     and artifact_version references itself (base_approved_version_id): RESTRICT
--     is checked when the statement ends, so deleting all of a table's rows in
--     ONE statement satisfies a self-reference regardless of row order.
--   * artifact_version <-> architecture_option is the schema's one real FK cycle
--     (selected_architecture_option_id / artifact_version_id). Neither table can
--     go first, and artifact_version is frozen against the UPDATE that would
--     break the cycle, so both are deleted by one statement (a data-modifying
--     CTE), whose RESTRICT checks also run only once both are gone.
CREATE FUNCTION delete_project(p_project_id uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM project WHERE id = p_project_id) THEN
    RETURN false;
  END IF;

  PERFORM set_config('throughline.project_deletion', 'on', true);

  DELETE FROM stitch_output          WHERE project_id = p_project_id;
  DELETE FROM impact_acknowledgement WHERE project_id = p_project_id;
  DELETE FROM external_ref           WHERE project_id = p_project_id;
  DELETE FROM external_operation     WHERE project_id = p_project_id;
  DELETE FROM ai_generation_run      WHERE project_id = p_project_id;
  DELETE FROM semantic_dependency    WHERE project_id = p_project_id;

  DELETE FROM generation_context_ref
   WHERE target_artifact_version_id IN (
           SELECT av.id FROM artifact_version av JOIN artifact a ON a.id = av.artifact_id
            WHERE a.project_id = p_project_id)
      OR source_artifact_version_id IN (
           SELECT av.id FROM artifact_version av JOIN artifact a ON a.id = av.artifact_id
            WHERE a.project_id = p_project_id);

  DELETE FROM approval_event
   WHERE artifact_version_id IN (
           SELECT av.id FROM artifact_version av JOIN artifact a ON a.id = av.artifact_id
            WHERE a.project_id = p_project_id);

  DELETE FROM artifact_version_item_membership
   WHERE artifact_id IN (SELECT id FROM artifact WHERE project_id = p_project_id);

  DELETE FROM item_version  WHERE project_id = p_project_id;
  DELETE FROM logical_item  WHERE project_id = p_project_id;

  WITH removed_options AS (
    DELETE FROM architecture_option
     WHERE artifact_version_id IN (
             SELECT av.id FROM artifact_version av JOIN artifact a ON a.id = av.artifact_id
              WHERE a.project_id = p_project_id)
    RETURNING id
  )
  DELETE FROM artifact_version
   WHERE artifact_id IN (SELECT id FROM artifact WHERE project_id = p_project_id);

  DELETE FROM artifact WHERE project_id = p_project_id;
  DELETE FROM project  WHERE id = p_project_id;

  PERFORM set_config('throughline.project_deletion', 'off', true);
  RETURN true;
END $$;

-- ERD Appendix A.3 / T34: Supabase grants EXECUTE on every new function to
-- anon/authenticated by default, and this one deletes a whole project, so the
-- same schema-wide revoke as 0001/0006 is repeated for it (idempotent no-op
-- for everything already revoked).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
