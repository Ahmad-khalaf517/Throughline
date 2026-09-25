import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import type postgres from 'postgres';
import { connect } from '../support/connection';
import * as fx from '../support/fixtures';

// lineage/impact's real getWarnings/getExternalDrift/acknowledge (Jira
// SCRUM-34 / E2-S8, Module Boundaries 4.2, ERD section 6) - real scenarios
// against the impact() SQL function, cited by INV id (throughline-lineage-
// invariants), not T## id: this story earns no T## closure (that's E2-S9's
// job - see tests/integration/appendix-c.test.ts's own T17/T25 `it.todo`s,
// which stay untouched here per this story's explicit scope).
//
// Infrastructure note (first of its kind in this repo): every other
// integration test uses a raw `postgres` connection, deliberately
// independent of @/db/@/lib/env (tests/integration/support/connection.ts's
// own comment) - because until now no domain module's real TS functions
// needed to run against the Testcontainers database. getWarnings/
// getExternalDrift/acknowledge go through the @/db Drizzle singleton, which
// reads DATABASE_URL from @/lib/env at MODULE-IMPORT time (`export const
// env = loadEnv()`, eagerly `.safeParse()`-ing every required field, not
// just the ones this module cares about). So this file:
//   1. gets the Testcontainers connection string via inject() in beforeAll,
//   2. points DATABASE_URL/DIRECT_DATABASE_URL at it and stubs valid-but-
//      unused values for the other required env fields (Supabase auth -
//      never touched by this module's code path, just needed to satisfy
//      envSchema.safeParse), BEFORE
//   3. dynamically `await import('@/lineage/impact')` / `await
//      import('@/db')` - a static top-of-file import would run before step 2
//      and throw out of loadEnv()'s eager parse.
// Fixture setup still goes through the raw `postgres`/`fx.*` helpers (same
// pattern as appendix-c.test.ts) so every scenario is built through the real
// triggers/CHECKs; only the three calls under test go through the
// dynamically-imported real module.

let sql: postgres.Sql;
let getWarnings: typeof import('@/lineage/impact').getWarnings;
let getExternalDrift: typeof import('@/lineage/impact').getExternalDrift;
let acknowledge: typeof import('@/lineage/impact').acknowledge;
let withTx: typeof import('@/db').withTx;

beforeAll(async () => {
  sql = connect();

  const connectionUri = inject('pgConnectionUri');
  process.env.DATABASE_URL = connectionUri;
  process.env.DIRECT_DATABASE_URL = connectionUri;
  // Required by src/lib/env.ts's envSchema but never exercised by this
  // module's code path - valid-shaped stand-ins only, so
  // envSchema.safeParse doesn't throw at @/db's import time.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

  const impact = await import('@/lineage/impact');
  getWarnings = impact.getWarnings;
  getExternalDrift = impact.getExternalDrift;
  acknowledge = impact.acknowledge;
  const db = await import('@/db');
  withTx = db.withTx;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// Creates a draft artifact_version, adds one membership per item, and
// approves it - the shared "regenerate + approve" shape every scenario
// below needs, since artifact-lifecycle's real approveVersion (E3-S1/S2)
// doesn't exist yet. Mirrors appendix-c.test.ts's own T14c/T27/T28 fixture
// composition, not a shortcut around the real triggers.
async function approveVersionWithItems(
  artifactId: string,
  items: { logicalItemId: string; itemVersionId: string }[],
  versionNumber = 1,
  opts: { architecture?: boolean } = {},
): Promise<string> {
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber });
  for (const item of items) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId: item.logicalItemId,
      itemVersionId: item.itemVersionId,
    });
  }
  if (opts.architecture) {
    const optionAId = await fx.createArchitectureOption(sql, {
      artifactVersionId: versionId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: versionId, optionKey: 'B' });
    await fx.approveArtifactVersion(sql, versionId, { selectedArchitectureOptionId: optionAId });
  } else {
    await fx.approveArtifactVersion(sql, versionId);
  }
  return versionId;
}

// approved -> superseded is a legal transition (artifact_version_guard) but
// not automatic - must happen before a second version of the same artifact
// is approved, or the one_approved_version partial unique index rejects it.
async function supersede(versionId: string): Promise<void> {
  await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${versionId}`;
}

describe('getWarnings', () => {
  it('reports a direct impact at depth 0 when a current item depends on a non-current upstream (ERD 6.1, INV-022)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'impact: direct' });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const s = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    await approveVersionWithItems(backlogArtifactId, [s]);

    // Regenerate Requirements: R gets a new current ItemVersion; the old
    // one (what S actually depends on) becomes non-current.
    const rNext = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r.logicalItemId,
      revisionNumber: 2,
    });
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rNext }],
      2,
    );

    const warnings = await getWarnings(projectId);
    const row = warnings.find((w) => w.subjectId === s.itemVersionId);

    expect(row).toMatchObject({
      subjectKind: 'item_version',
      rootItemVersionId: r.itemVersionId,
      depth: 0,
      acknowledged: false,
    });
    expect(row!.path).toEqual([r.itemVersionId, s.itemVersionId]);
  });

  it('reports a transitive (two-hop) impact separately from a direct one, never flattened (INV-022)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'impact: transitive' });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const archArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const adr = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: archArtifactId,
      itemType: 'architecture_decision',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: adr.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    await approveVersionWithItems(archArtifactId, [adr], 1, { architecture: true });

    const s = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: adr.itemVersionId,
    });
    await approveVersionWithItems(backlogArtifactId, [s]);

    // Regenerate Requirements only - ADR stays current but now depends on
    // an obsolete R (direct); S stays current and reaches the same
    // obsolete R only through the (still current) ADR (transitive).
    const rNext = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r.logicalItemId,
      revisionNumber: 2,
    });
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rNext }],
      2,
    );

    const warnings = await getWarnings(projectId);
    const adrRow = warnings.find((w) => w.subjectId === adr.itemVersionId);
    const sRow = warnings.find((w) => w.subjectId === s.itemVersionId);

    expect(adrRow).toMatchObject({ rootItemVersionId: r.itemVersionId, depth: 0 });
    expect(sRow).toMatchObject({ rootItemVersionId: r.itemVersionId, depth: 1 });
    expect(sRow!.path).toEqual([r.itemVersionId, adr.itemVersionId, s.itemVersionId]);
    // Both rows exist independently, one per (subject, root) - the
    // transitive row on S is never merged into ADR's direct row.
    expect(
      warnings.filter((w) => w.subjectId === adr.itemVersionId || w.subjectId === s.itemVersionId),
    ).toHaveLength(2);
  });

  it('terminates on a deliberate semantic_dependency cycle and reports each node once (INV-022, ERD 6.3 cycle guard)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'impact: cycle' });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    // A real item_version that is never given any membership - trivially
    // non-current, so it can serve as the walk's root without needing a
    // full regenerate-and-supersede sequence.
    const obsolete = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });

    const x = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    const y = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await approveVersionWithItems(backlogArtifactId, [x, y]);

    // X depends on the obsolete root; Y depends on X; X ALSO depends on Y -
    // a direct cycle between X and Y, inserted straight via SQL, bypassing
    // any app-level cycle prevention (same spirit as ERD's own T25, but a
    // new scenario, not a stand-in for it).
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: x.itemVersionId,
      upstreamItemVersionId: obsolete.itemVersionId,
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: y.itemVersionId,
      upstreamItemVersionId: x.itemVersionId,
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: x.itemVersionId,
      upstreamItemVersionId: y.itemVersionId,
    });

    const warnings = await getWarnings(projectId);
    const xRows = warnings.filter((w) => w.subjectId === x.itemVersionId);
    const yRows = warnings.filter((w) => w.subjectId === y.itemVersionId);

    expect(xRows).toHaveLength(1);
    expect(xRows[0]).toMatchObject({ rootItemVersionId: obsolete.itemVersionId, depth: 0 });
    expect(yRows).toHaveLength(1);
    expect(yRows[0]).toMatchObject({ rootItemVersionId: obsolete.itemVersionId, depth: 1 });
  });
});

describe('getExternalDrift', () => {
  it('scopes to exactly one ref and returns null for a ref with no drift', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'impact: external drift' });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const flaggedStory = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: flaggedStory.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    const cleanStory = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    const backlogV1 = await approveVersionWithItems(backlogArtifactId, [flaggedStory, cleanStory]);

    // Two Jira refs (ERD 6.2: Jira's source is a single source_item_version_id).
    const flaggedOpId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'jira',
      sourceArtifactVersionId: backlogV1,
      sourceItemVersionId: flaggedStory.itemVersionId,
    });
    const flaggedRefId = await fx.createExternalRef(sql, {
      projectId,
      provider: 'jira',
      externalOperationId: flaggedOpId,
      sourceArtifactVersionId: backlogV1,
      sourceItemVersionId: flaggedStory.itemVersionId,
    });

    const cleanOpId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'jira',
      sourceArtifactVersionId: backlogV1,
      sourceItemVersionId: cleanStory.itemVersionId,
    });
    const cleanRefId = await fx.createExternalRef(sql, {
      projectId,
      provider: 'jira',
      externalOperationId: cleanOpId,
      sourceArtifactVersionId: backlogV1,
      sourceItemVersionId: cleanStory.itemVersionId,
    });

    // Regenerate Requirements - flags flaggedStory (created from R@A) but
    // leaves cleanStory (which depends on nothing) alone.
    const rNext = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r.logicalItemId,
      revisionNumber: 2,
    });
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rNext }],
      2,
    );

    // The ref's source (flaggedStory.itemVersionId) is itself CURRENT and
    // depends on the obsolete root at depth 0 in the item-version chain; per
    // 0005_impact_function.sql's ref_raw CTE, a ref's depth is always its
    // source item's own depth + 1, never equal to it - so depth here is 1,
    // not 0.
    const flaggedDrift = await getExternalDrift(projectId, flaggedRefId);
    expect(flaggedDrift).toMatchObject({
      subjectKind: 'external_ref',
      subjectId: flaggedRefId,
      rootItemVersionId: r.itemVersionId,
      depth: 1,
      acknowledged: false,
    });

    const cleanDrift = await getExternalDrift(projectId, cleanRefId);
    expect(cleanDrift).toBeNull();
  });

  it('prefers the unacknowledged cause when a whole-version ref traces to two distinct obsolete roots (INV-023, INV-026, ERD 6.2)', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, {
      name: 'impact: multi-root drift',
    });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const archArtifactId = await fx.createArtifact(sql, projectId, 'architecture');

    const r1 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const r2 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r1, r2]);

    const adr1 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: archArtifactId,
      itemType: 'architecture_decision',
    });
    const adr2 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: archArtifactId,
      itemType: 'architecture_decision',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: adr1.itemVersionId,
      upstreamItemVersionId: r1.itemVersionId,
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: adr2.itemVersionId,
      upstreamItemVersionId: r2.itemVersionId,
    });
    const archV1 = await approveVersionWithItems(archArtifactId, [adr1, adr2], 1, {
      architecture: true,
    });

    // A ref sourced from the WHOLE architecture version (source_item_
    // version_id NULL) - external_ref_jira_requires_item_check forbids this
    // for provider 'jira' (jira always needs a single source item), so this
    // scenario needs 'github', per ref_items' membership-join branch in
    // 0005_impact_function.sql.
    const opId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'github',
      sourceArtifactVersionId: archV1,
    });
    const refId = await fx.createExternalRef(sql, {
      projectId,
      provider: 'github',
      externalOperationId: opId,
      sourceArtifactVersionId: archV1,
    });

    // Regenerate BOTH requirements - ADR1 and ADR2 stay current but each now
    // depends on a different obsolete root, so the ref traces to two
    // distinct (ref, root) rows (ERD 6.2: "Output is aggregated per (ref,
    // root)" - ref_rows is DISTINCT ON (subject_id, root), not just
    // subject_id).
    const r1Next = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r1.logicalItemId,
      revisionNumber: 2,
    });
    const r2Next = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r2.logicalItemId,
      revisionNumber: 2,
    });
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [
        { logicalItemId: r1.logicalItemId, itemVersionId: r1Next },
        { logicalItemId: r2.logicalItemId, itemVersionId: r2Next },
      ],
      2,
    );

    // Acknowledge only the R1 cause - the R2 cause is deliberately left
    // unacknowledged.
    await withTx((tx) =>
      acknowledge(tx, {
        projectId,
        subject: { externalRefId: refId },
        obsoleteUpstreamItemVersionId: r1.itemVersionId,
        userId,
        note: 'R1 side reviewed - ADR1 text unaffected',
      }),
    );

    const drift = await getExternalDrift(projectId, refId);

    // The fix under test: getExternalDrift orders by `acknowledged asc` so
    // the still-unacknowledged R2 cause always wins over the now-
    // acknowledged R1 cause - never the reverse, and never picked
    // arbitrarily by whatever order Postgres happens to return (INV-023:
    // every warning must be inspectable, not silently dropped; INV-026:
    // never suppresses a different cause).
    expect(drift).not.toBeNull();
    expect(drift).toMatchObject({
      subjectKind: 'external_ref',
      subjectId: refId,
      rootItemVersionId: r2.itemVersionId,
      acknowledged: false,
    });
  });
});

describe('acknowledge', () => {
  it('writes a cause-specific row and getWarnings then reports it acknowledged (INV-026)', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, {
      name: 'impact: acknowledge',
    });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const s = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    await approveVersionWithItems(backlogArtifactId, [s]);

    const rNext = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r.logicalItemId,
      revisionNumber: 2,
    });
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rNext }],
      2,
    );

    const before = await getWarnings(projectId);
    expect(before.find((w) => w.subjectId === s.itemVersionId)).toMatchObject({
      acknowledged: false,
    });

    await withTx((tx) =>
      acknowledge(tx, {
        projectId,
        subject: { itemVersionId: s.itemVersionId },
        obsoleteUpstreamItemVersionId: r.itemVersionId,
        userId,
        note: 'reviewed - story text is still accurate',
      }),
    );

    const ackRows = await sql<
      {
        root_logical_item_id: string;
        acknowledged_against_upstream_item_version_id: string | null;
      }[]
    >`
      SELECT root_logical_item_id, acknowledged_against_upstream_item_version_id
      FROM impact_acknowledgement
      WHERE subject_item_version_id = ${s.itemVersionId}
        AND obsolete_upstream_item_version_id = ${r.itemVersionId}
    `;
    expect(ackRows).toHaveLength(1);
    expect(ackRows[0]!.root_logical_item_id).toBe(r.logicalItemId);
    // Resolved by re-reading R's current membership at ack time - R@next,
    // never passed in by the caller (ERD 4.12).
    expect(ackRows[0]!.acknowledged_against_upstream_item_version_id).toBe(rNext);

    const after = await getWarnings(projectId);
    expect(after.find((w) => w.subjectId === s.itemVersionId)).toMatchObject({
      acknowledged: true,
    });
  });

  it('resolves acknowledged_against to NULL for a removed root, and getWarnings still matches it (INV-026)', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, {
      name: 'impact: removal ack',
    });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const s = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    await approveVersionWithItems(backlogArtifactId, [s]);

    // Regenerate Requirements with R entirely absent (removed) - the new
    // approved version has no membership at all for r.logicalItemId.
    const other = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    await supersede(reqV1);
    await approveVersionWithItems(reqArtifactId, [other], 2);

    await withTx((tx) =>
      acknowledge(tx, {
        projectId,
        subject: { itemVersionId: s.itemVersionId },
        obsoleteUpstreamItemVersionId: r.itemVersionId,
        userId,
      }),
    );

    const ackRows = await sql<{ acknowledged_against_upstream_item_version_id: string | null }[]>`
      SELECT acknowledged_against_upstream_item_version_id FROM impact_acknowledgement
      WHERE subject_item_version_id = ${s.itemVersionId}
        AND obsolete_upstream_item_version_id = ${r.itemVersionId}
    `;
    expect(ackRows).toHaveLength(1);
    expect(ackRows[0]!.acknowledged_against_upstream_item_version_id).toBeNull();

    // impact()'s own acknowledged EXISTS check matches by `IS NOT DISTINCT
    // FROM`, so a NULL-against acknowledgement still matches a NULL
    // root_now (ERD 6.3's closing "Verified behaviour" note).
    const warnings = await getWarnings(projectId);
    expect(warnings.find((w) => w.subjectId === s.itemVersionId)).toMatchObject({
      acknowledged: true,
    });
  });

  it('stops matching once the acknowledged root moves again (INV-026 negative case)', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, {
      name: 'impact: ack stale after second move',
    });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const s = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    await approveVersionWithItems(backlogArtifactId, [s]);

    // R@v1 -> R@v2: R@v1 becomes the obsolete root S is flagged against.
    // The semantic_dependency edge always points at R@v1 (INV-015 -
    // dependency edges are immutable), no matter how many times R moves
    // again afterward.
    const rV2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r.logicalItemId,
      revisionNumber: 2,
    });
    await supersede(reqV1);
    const reqV2 = await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rV2 }],
      2,
    );

    await withTx((tx) =>
      acknowledge(tx, {
        projectId,
        subject: { itemVersionId: s.itemVersionId },
        obsoleteUpstreamItemVersionId: r.itemVersionId,
        userId,
        note: 'reviewed against R@v2',
      }),
    );

    const afterFirstAck = await getWarnings(projectId);
    expect(afterFirstAck.find((w) => w.subjectId === s.itemVersionId)).toMatchObject({
      rootItemVersionId: r.itemVersionId,
      acknowledged: true,
    });

    // R@v2 -> R@v3: the acknowledgement was resolved against R's current
    // version AT ACK TIME (R@v2, acknowledged_against_upstream_item_
    // version_id) - impact()'s acknowledged EXISTS check compares that
    // stored value against root_now (R's CURRENT version, resolved fresh on
    // every read), so once R@v2 is itself superseded the stored value no
    // longer matches and the ack stops applying (INV-026: "stops matching
    // the moment that root's logical item moves again"). This is a
    // different scenario from ERD test id T4 (tests/integration/
    // appendix-c.test.ts), which needs the identity module to re-add
    // removed content as a new LogicalItem - not exercised here.
    const rV3 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r.logicalItemId,
      revisionNumber: 3,
    });
    await supersede(reqV2);
    await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rV3 }],
      3,
    );

    const afterSecondMove = await getWarnings(projectId);
    expect(afterSecondMove.find((w) => w.subjectId === s.itemVersionId)).toMatchObject({
      rootItemVersionId: r.itemVersionId,
      acknowledged: false,
    });
  });
});
