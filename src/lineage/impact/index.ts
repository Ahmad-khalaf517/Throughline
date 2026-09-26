// Module 6: lineage/impact
// Owns: impact_acknowledgement - the only consumer of impact()
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// `evaluateGate` is the approval read path (E3-S1); gate acknowledgements
// belong to E3-S2.
import { and, eq, sql } from 'drizzle-orm';
import { db, schema, type Tx } from '@/db';

// The module's own internal shape - raw ids only, no display-key
// resolution (that's src/lib/serialize.ts's later, API-layer ImpactRowDTO;
// deliberately a different type, not reused here). Mirrors impact()'s
// RETURNS TABLE columns (ERD section 6.3) camelCased.
export interface ImpactRow {
  subjectKind: 'item_version' | 'external_ref';
  subjectId: string;
  rootItemVersionId: string;
  depth: number;
  path: string[]; // item_version ids, root to subject, traversal order (ERD 6.1/6.2)
  acknowledged: boolean;
}

// The raw row shape impact() actually returns - snake_case, matching its
// RETURNS TABLE column list verbatim (drizzle/migrations/0005_impact_
// function.sql), regardless of how the CTEs inside alias things.
interface ImpactFunctionRow {
  [column: string]: unknown;
  subject_kind: 'item_version' | 'external_ref';
  subject_id: string;
  root_item_version_id: string;
  depth: number;
  path: string[];
  acknowledged: boolean;
}

function toImpactRow(row: ImpactFunctionRow): ImpactRow {
  return {
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    rootItemVersionId: row.root_item_version_id,
    depth: row.depth,
    path: row.path,
    acknowledged: row.acknowledged,
  };
}

// `db.execute()` against this project's postgres-js driver (drizzle-orm
// 0.44's node_modules/drizzle-orm/postgres-js/session.js: no `fields`/
// `customResultMapper` attaches to a bare `sql` template, so it returns
// `client.unsafe(query, params)` straight through) resolves to postgres-js's
// own `RowList<T>`, which is `T & Iterable<...> & ResultQueryMeta<...>` -
// i.e. the row array itself, directly indexable/mappable, NOT wrapped in a
// `{ rows: [...] }` envelope. Confirmed both statically (postgres-js/
// session.d.ts's `PostgresJsQueryResultHKT`, node_modules/postgres's own
// `RowList<T> = T & ...`) and empirically against the Testcontainers
// database in tests/integration/lineage/impact.test.ts.

/**
 * `impact(project)` with no candidate - the warning panel (ERD 6.3, Module
 * Boundaries 4.2). `p_candidate_version_id` takes its own SQL `DEFAULT
 * NULL`; nothing here ever runs as a candidate/gate evaluation.
 */
export async function getWarnings(projectId: string): Promise<ImpactRow[]> {
  const rows = await db.execute<ImpactFunctionRow>(
    sql`select subject_kind, subject_id, root_item_version_id, depth, path, acknowledged
        from impact(${projectId}::uuid)`,
  );
  return rows.map(toImpactRow);
}

/** Candidate replaces its artifact's approved version inside the caller's locked transaction (ERD 6.5). */
export async function evaluateGate(
  tx: Tx,
  projectId: string,
  candidateVersionId: string,
  candidateItemVersionIds: ReadonlySet<string>,
): Promise<ImpactRow[]> {
  if (!candidateItemVersionIds.size) return [];
  const rows = await tx.execute<ImpactFunctionRow>(
    sql`select i.subject_kind, i.subject_id, i.root_item_version_id, i.depth, i.path, i.acknowledged
        from impact(${projectId}::uuid, ${candidateVersionId}::uuid) i
        where i.subject_kind = 'item_version' and not i.acknowledged`,
  );
  return rows.filter((row) => candidateItemVersionIds.has(row.subject_id)).map(toImpactRow);
}

/**
 * Same `impact()` call, filtered to one external_ref (ERD 6.2) - used by
 * external-write previews (TR FR-085) and the GitHub/Jira/Stitch drift
 * badges. `null` when that ref has no drift (including when it doesn't
 * exist, or exists but is a manual-fallback Stitch output with no ref row
 * to begin with - callers resolve existence separately).
 *
 * A single ref CAN legitimately have more than one (ref, root) row: the
 * SQL function's `ref_rows` CTE is `DISTINCT ON (subject_id, root)`, not
 * `DISTINCT ON (subject_id)`, because a ref whose source is an entire
 * artifact_version (source_item_version_id NULL - e.g. a GitHub ref backed
 * by a whole Architecture version) can have several source items that
 * trace to *different* obsolete roots (ERD section 6.2 - "Output is
 * aggregated per (ref, root)"). This function's own return type is
 * deliberately singular (Module Boundaries 4.2, API Contracts
 * ExternalRefDTO.impact - a "drift badge", not a list), so with more than
 * one candidate row we must pick, not just take whatever order Postgres
 * happens to return. `ORDER BY acknowledged ASC` means an unacknowledged
 * cause always wins over an acknowledged one - picking an acknowledged row
 * while a different, unacknowledged cause exists would silently hide it
 * from the badge, violating "never suppresses a different cause" (INV-026)
 * and "every warning must be inspectable" (INV-023). Among ties, `depth
 * ASC` prefers the shallowest/most-direct cause, matching the "direct wins
 * over transitive" convention used elsewhere (INV-022).
 */
export async function getExternalDrift(
  projectId: string,
  refId: string,
): Promise<ImpactRow | null> {
  const rows = await db.execute<ImpactFunctionRow>(
    sql`select subject_kind, subject_id, root_item_version_id, depth, path, acknowledged
        from impact(${projectId}::uuid)
        where subject_kind = 'external_ref' and subject_id = ${refId}::uuid
        order by acknowledged asc, depth asc
        limit 1`,
  );
  return rows[0] ? toImpactRow(rows[0]) : null;
}

/**
 * Writes one `impact_acknowledgement` row inside the caller's transaction
 * (ERD 4.12). `rootLogicalItemId` and `acknowledgedAgainstUpstreamItem
 * VersionId` are always computed here, re-reading the root's current
 * ItemVersion at call time - never accepted from the caller, so a stale
 * candidate id can never be smuggled into an acknowledgement.
 *
 * This function does not itself verify that `opts.subject` or
 * `opts.obsoleteUpstreamItemVersionId` belong to `opts.projectId` - it
 * receives an already-open `tx` from a trusted caller (Module Boundaries
 * section 6's transaction-discipline rule) and trusts that caller's scope,
 * the same pattern used elsewhere in this codebase (system boundaries
 * validate, internal domain functions trust). The real cross-tenant check
 * belongs to the future `POST /api/impact/acknowledgements` route (E3-S11,
 * API Contracts line 299 - `404 NOT_FOUND` when subject or root is not in
 * the caller's project), not here.
 */
export async function acknowledge(
  tx: Tx,
  opts: {
    projectId: string;
    subject: { itemVersionId: string } | { externalRefId: string };
    obsoleteUpstreamItemVersionId: string;
    userId: string;
    note?: string;
  },
): Promise<void> {
  // Exactly one of these is set - matches the DB's own
  // impact_acknowledgement_exactly_one_subject_check.
  const subjectItemVersionId = 'itemVersionId' in opts.subject ? opts.subject.itemVersionId : null;
  const subjectExternalRefId = 'externalRefId' in opts.subject ? opts.subject.externalRefId : null;

  // The obsolete upstream version's own LogicalItem - the acknowledgement's
  // cause-specific key half (ERD 4.12).
  const [rootRow] = await tx
    .select({ logicalItemId: schema.itemVersion.logicalItemId })
    .from(schema.itemVersion)
    .where(eq(schema.itemVersion.id, opts.obsoleteUpstreamItemVersionId))
    .limit(1);
  if (!rootRow) {
    throw new Error(
      `acknowledge: obsolete upstream item_version ${opts.obsoleteUpstreamItemVersionId} does not exist`,
    );
  }
  const rootLogicalItemId = rootRow.logicalItemId;

  // The root's CURRENT version, resolved by a real JOIN - never a scalar
  // subquery (ERD 6.3's "Round-5 fix" / the T22-T23 regression class;
  // throughline-lineage-invariants point 5 and section "Impact and
  // acknowledgement"). "Current" mirrors impact()'s own current_m CTE:
  // member of an APPROVED artifact_version. A LogicalItem belongs to
  // exactly one artifact and at most one artifact_version of that artifact
  // can be 'approved' at a time (the one_approved_version partial unique
  // index), so this JOIN matches at most one row - LIMIT 1 is defensive,
  // not load-bearing the way a scalar subquery would be. No row (NULL) is
  // the valid "removed" case (impact-acknowledgement.ts's own comment).
  const [currentRow] = await tx
    .select({ itemVersionId: schema.artifactVersionItemMembership.itemVersionId })
    .from(schema.artifactVersionItemMembership)
    .innerJoin(
      schema.artifactVersion,
      eq(schema.artifactVersion.id, schema.artifactVersionItemMembership.artifactVersionId),
    )
    .where(
      and(
        eq(schema.artifactVersion.status, 'approved'),
        eq(schema.artifactVersionItemMembership.logicalItemId, rootLogicalItemId),
      ),
    )
    .limit(1);
  const acknowledgedAgainstUpstreamItemVersionId = currentRow?.itemVersionId ?? null;

  // ack_item_unique/ack_ref_unique (the partial, NULLS-NOT-DISTINCT unique
  // indexes in drizzle/migrations/0003_lineage_partial_indexes.sql) are left
  // to raise on a genuine duplicate acknowledgement - not caught/swallowed
  // here, per this module's own rule: a duplicate is a client bug.
  await tx.insert(schema.impactAcknowledgement).values({
    projectId: opts.projectId,
    subjectItemVersionId,
    subjectExternalRefId,
    rootLogicalItemId,
    obsoleteUpstreamItemVersionId: opts.obsoleteUpstreamItemVersionId,
    acknowledgedAgainstUpstreamItemVersionId,
    acknowledgedByUserId: opts.userId,
    note: opts.note ?? null,
  });
}
