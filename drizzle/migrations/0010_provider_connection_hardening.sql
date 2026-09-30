-- ERD Appendix B round 14: hardening for provider_connection (A.3 pattern; T34 catches a miss).
-- provider_connection is MUTABLE (tokens are refreshed, status changes), so none of the append-only /
-- frozen-row triggers apply. Only touch_updated_at does: its updated_at feeds the refresh-expiry decision.

CREATE TRIGGER provider_connection_touch BEFORE UPDATE ON provider_connection
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

REVOKE ALL ON provider_connection FROM anon, authenticated;
ALTER TABLE provider_connection ENABLE ROW LEVEL SECURITY;   -- no policies: deny-all, even after an accidental GRANT

-- Operator cleanup for a deleted Supabase user (known limitation 15) - run by hand, one user at a time:
--   UPDATE provider_connection
--      SET status = 'revoked', access_token_enc = 'revoked', refresh_token_enc = NULL, expires_at = NULL
--    WHERE user_id = '<deleted user id>';
