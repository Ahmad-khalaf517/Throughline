-- ERD section 6.3, verbatim. One impact engine, evaluated fresh on every
-- read - the warning panel, dependency view, approval gate, and external-
-- write drift all call this and nothing else computes staleness (INV-025).

CREATE FUNCTION impact(p_project_id uuid, p_candidate_version_id uuid DEFAULT NULL)
RETURNS TABLE (subject_kind text, subject_id uuid, root_item_version_id uuid,
               depth int, path uuid[], acknowledged boolean)
LANGUAGE sql STABLE AS $$
WITH RECURSIVE
current_m AS MATERIALIZED (              -- current = member of an approved version; a candidate REPLACES
  SELECT m.logical_item_id, m.item_version_id   -- its own artifact's approved version (section 5.2)
  FROM artifact_version_item_membership m
  JOIN artifact_version av ON av.id = m.artifact_version_id
  JOIN artifact a ON a.id = av.artifact_id
  WHERE a.project_id = p_project_id
    AND ( av.id = p_candidate_version_id
       OR ( av.status = 'approved'
            AND ( p_candidate_version_id IS NULL
                  OR av.artifact_id <> (SELECT cv.artifact_id FROM artifact_version cv
                                        WHERE cv.id = p_candidate_version_id) ) ) )
),
walk AS (
  SELECT d.downstream_item_version_id AS iv, d.upstream_item_version_id AS root, 0 AS depth,
         ARRAY[d.upstream_item_version_id, d.downstream_item_version_id] AS path
  FROM semantic_dependency d
  WHERE d.downstream_item_version_id IN (SELECT item_version_id FROM current_m)
    AND d.upstream_item_version_id NOT IN (SELECT item_version_id FROM current_m)
  UNION ALL
  SELECT d.downstream_item_version_id, w.root, w.depth + 1, w.path || d.downstream_item_version_id
  FROM walk w
  JOIN semantic_dependency d ON d.upstream_item_version_id = w.iv
  WHERE d.downstream_item_version_id IN (SELECT item_version_id FROM current_m)
    AND d.downstream_item_version_id <> ALL (w.path)      -- cycle guard
    AND w.depth < 50                                      -- hard stop
),
item_rows AS (                                            -- one row per (item, root): shortest path wins
  SELECT DISTINCT ON (iv, root) iv AS subject_id, root, depth, path
  FROM walk
  ORDER BY iv, root, depth                                -- (array_agg over paths of different length would error)
),
ref_items AS (                                            -- source items of each external ref
  SELECT r.id AS ref_id, r.source_item_version_id AS iv
  FROM external_ref r
  WHERE r.project_id = p_project_id AND r.source_item_version_id IS NOT NULL
  UNION ALL
  SELECT r.id, m.item_version_id
  FROM external_ref r
  JOIN artifact_version_item_membership m ON m.artifact_version_id = r.source_artifact_version_id
  WHERE r.project_id = p_project_id AND r.source_item_version_id IS NULL
),
ref_raw AS (
  SELECT ri.ref_id AS subject_id, ri.iv AS root, 0 AS depth, ARRAY[ri.iv] AS path
  FROM ref_items ri
  WHERE ri.iv NOT IN (SELECT item_version_id FROM current_m)
  UNION ALL
  SELECT ri.ref_id, ir.root, ir.depth + 1, ir.path
  FROM ref_items ri JOIN item_rows ir ON ir.subject_id = ri.iv
),
ref_rows AS (                                             -- one row per (ref, root): several source ADRs can
  SELECT DISTINCT ON (subject_id, root) subject_id, root, depth, path   -- trace to the same obsolete root
  FROM ref_raw
  ORDER BY subject_id, root, depth
),
all_rows AS (
  SELECT 'item_version'::text AS subject_kind, subject_id, root, depth, path FROM item_rows
  UNION ALL
  SELECT 'external_ref', subject_id, root, depth, path FROM ref_rows
),
rooted AS (                                               -- the root's CURRENT version, resolved by JOIN:
  SELECT ar.*, c.item_version_id AS root_now              -- never a scalar subquery (see below)
  FROM all_rows ar
  JOIN item_version riv ON riv.id = ar.root
  LEFT JOIN current_m c ON c.logical_item_id = riv.logical_item_id
)
SELECT rr.subject_kind, rr.subject_id, rr.root, rr.depth, rr.path,
       EXISTS (
         SELECT 1 FROM impact_acknowledgement k
         WHERE k.obsolete_upstream_item_version_id = rr.root
           AND (CASE WHEN rr.subject_kind = 'item_version'
                     THEN k.subject_item_version_id ELSE k.subject_external_ref_id END) = rr.subject_id
           AND k.acknowledged_against_upstream_item_version_id IS NOT DISTINCT FROM rr.root_now
       ) AS acknowledged
FROM rooted rr;
$$;
