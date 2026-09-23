-- ERD Appendix A.1 "indexes" section: ack_item_unique / ack_ref_unique.
-- Not expressible in this drizzle-orm version's schema builder - .where()
-- (partial) and .nullsNotDistinct() aren't supported together on an index
-- (only a plain, non-partial unique CONSTRAINT supports .nullsNotDistinct(),
-- and Postgres constraints can't carry a WHERE clause). Added verbatim here.

-- a removal acknowledgement (against = NULL) cannot be duplicated
CREATE UNIQUE INDEX ack_item_unique ON impact_acknowledgement
  (subject_item_version_id, obsolete_upstream_item_version_id, acknowledged_against_upstream_item_version_id)
  NULLS NOT DISTINCT WHERE subject_item_version_id IS NOT NULL;
CREATE UNIQUE INDEX ack_ref_unique ON impact_acknowledgement
  (subject_external_ref_id, obsolete_upstream_item_version_id, acknowledged_against_upstream_item_version_id)
  NULLS NOT DISTINCT WHERE subject_external_ref_id IS NOT NULL;
