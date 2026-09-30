-- FR-093..095 / T55: add terminal BRD and ERD artifact slots.
ALTER TABLE artifact DROP CONSTRAINT artifact_type_check;
ALTER TABLE artifact ADD CONSTRAINT artifact_type_check
  CHECK (type IN ('requirements','architecture','ui_requirements','backlog','brd','erd'));

INSERT INTO artifact (project_id, type)
SELECT p.id, document_type.type
FROM project AS p
CROSS JOIN (VALUES ('brd'), ('erd')) AS document_type(type)
ON CONFLICT (project_id, type) DO NOTHING;
