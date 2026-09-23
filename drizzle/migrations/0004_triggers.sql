-- ERD Appendix A.2, verbatim.

-- T1. Append-only tables
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER item_version_append_only           BEFORE UPDATE OR DELETE ON item_version
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER semantic_dependency_append_only    BEFORE UPDATE OR DELETE ON semantic_dependency
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER generation_context_ref_append_only BEFORE UPDATE OR DELETE ON generation_context_ref
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER approval_event_append_only         BEFORE UPDATE OR DELETE ON approval_event
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER impact_acknowledgement_append_only BEFORE UPDATE OR DELETE ON impact_acknowledgement
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER architecture_option_append_only    BEFORE UPDATE OR DELETE ON architecture_option
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- T2. A version is born only as draft (normal) or rejected (stale generation, and only that)
CREATE FUNCTION artifact_version_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('draft','rejected') THEN
    RAISE EXCEPTION 'artifact_version must be created as draft or rejected, not %', NEW.status;
  END IF;
  IF NEW.status = 'rejected' AND NEW.status_reason IS DISTINCT FROM 'stale_generation_context' THEN
    RAISE EXCEPTION 'only a stale generation may be created as rejected (got %)', NEW.status_reason;
  END IF;
  IF NEW.selected_architecture_option_id IS NOT NULL THEN
    RAISE EXCEPTION 'selected option cannot be set at insert';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artifact_version_insert_guard BEFORE INSERT ON artifact_version
  FOR EACH ROW EXECUTE FUNCTION artifact_version_insert_guard();

-- T3. Lifecycle guard: legal transitions, frozen once non-draft, architecture selection rules
CREATE FUNCTION artifact_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  IF NEW.artifact_id <> OLD.artifact_id OR NEW.version_number <> OLD.version_number THEN
    RAISE EXCEPTION 'artifact_version % identity columns are immutable', OLD.id;
  END IF;
  IF OLD.status <> NEW.status AND NOT (
       (OLD.status = 'draft'    AND NEW.status IN ('approved','rejected')) OR
       (OLD.status = 'approved' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'illegal transition % -> %', OLD.status, NEW.status;
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'rejected'
     AND NEW.status_reason = 'stale_generation_context' THEN
    RAISE EXCEPTION 'stale_generation_context is reserved for versions created as rejected';
  END IF;
  IF OLD.status <> 'draft' AND (
          NEW.payload                  IS DISTINCT FROM OLD.payload
       OR NEW.raw_output               IS DISTINCT FROM OLD.raw_output
       OR NEW.schema_version           IS DISTINCT FROM OLD.schema_version
       OR NEW.status_reason            IS DISTINCT FROM OLD.status_reason
       OR NEW.base_approved_version_id IS DISTINCT FROM OLD.base_approved_version_id) THEN
    RAISE EXCEPTION 'artifact_version % is frozen', OLD.id;
  END IF;
  IF NEW.selected_architecture_option_id IS DISTINCT FROM OLD.selected_architecture_option_id
     AND NOT (OLD.status = 'draft' AND NEW.status = 'approved') THEN
    RAISE EXCEPTION 'selected option can only be set when approving';
  END IF;
  IF OLD.status = 'draft' AND NEW.status = 'approved' THEN
    SELECT type INTO t FROM artifact WHERE id = NEW.artifact_id;
    IF t = 'architecture' THEN
      IF NEW.selected_architecture_option_id IS NULL THEN
        RAISE EXCEPTION 'architecture approval requires a selected option';
      END IF;
      IF (SELECT count(*) FROM architecture_option WHERE artifact_version_id = NEW.id) <> 2 THEN
        RAISE EXCEPTION 'architecture approval requires exactly 2 options';
      END IF;
    ELSIF NEW.selected_architecture_option_id IS NOT NULL THEN
      RAISE EXCEPTION 'only architecture versions have a selected option';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artifact_version_guard BEFORE UPDATE ON artifact_version
  FOR EACH ROW EXECUTE FUNCTION artifact_version_guard();

-- T4. Membership mutable only while its version is a draft
CREATE FUNCTION membership_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT status INTO s FROM artifact_version
   WHERE id = COALESCE(NEW.artifact_version_id, OLD.artifact_version_id);
  IF s <> 'draft' THEN
    RAISE EXCEPTION 'membership of a non-draft artifact_version is frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER membership_draft_only BEFORE INSERT OR UPDATE OR DELETE
  ON artifact_version_item_membership FOR EACH ROW EXECUTE FUNCTION membership_draft_only();

-- T5. The brief is the seed of all lineage: frozen once any Requirements version exists
CREATE FUNCTION project_seed_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.brief IS DISTINCT FROM OLD.brief OR NEW.input_context IS DISTINCT FROM OLD.input_context)
     AND EXISTS (SELECT 1 FROM artifact_version av JOIN artifact a ON a.id = av.artifact_id
                 WHERE a.project_id = OLD.id AND a.type = 'requirements') THEN
    RAISE EXCEPTION 'project % brief and input_context are frozen once Requirements generation has run', OLD.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_seed_frozen BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION project_seed_frozen();

-- T6. updated_at is maintained by the database, never by callers. external_operation's stale-pending
--     rule (section 7.2) depends on it: a retry that forgot to bump it would look instantly stale.
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER project_touch            BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER artifact_version_touch   BEFORE UPDATE ON artifact_version
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER external_operation_touch BEFORE UPDATE ON external_operation
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
