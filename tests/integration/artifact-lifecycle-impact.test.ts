import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// artifact-lifecycle's impact/acknowledgement operations for the API layer (Jira
// E3-S11 / SCRUM-46, API Contracts section 6): getImpactWarnings (deterministic
// order), getItemVersionProjectIds (the id -> project lookup that lets the route
// answer 404 for someone else's ids), acknowledgeImpactWarning (re-checks the
// warning under the project lock, idempotent), and the two additive reads it
// rests on - impact.getWarnings(projectId, tx) and identity.getItemVersionProjectIds.
// Cited by INV id (INV-022, INV-025, INV-026) and ERD 4.12/6.1, not by T## id:
// Appendix C's T22/T23 stay E3-T1's, so nothing here converts an `it.todo`.
//
// Fixtures are built through the raw `postgres` connection so every scenario
// passes the real triggers/CHECKs, exactly as tests/integration/lineage/
// impact.test.ts builds its own; only the calls under test go through the
// dynamically imported modules (their import reads env eagerly - same setup as
// artifact-lifecycle-versions.test.ts).

type LifecycleModule = typeof import('@/artifact-lifecycle');
type ImpactModule = typeof import('@/lineage/impact');

let sql: postgres.Sql;
let lifecycle: LifecycleModule;
let impact: ImpactModule;
let identity: typeof import('@/lineage/identity');
let withTx: typeof import('@/db').withTx;

beforeAll(async () => {
  sql = connect();
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  lifecycle = await import('@/artifact-lifecycle');
  impact = await import('@/lineage/impact');
  identity = await import('@/lineage/identity');
  withTx = (await import('@/db')).withTx;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

type Item = { logicalItemId: string; itemVersionId: string };

// Draft -> memberships -> approved: the same "regenerate + approve" shape
// tests/integration/lineage/impact.test.ts uses.
async function approveVersionWithItems(
  artifactId: string,
  items: Item[],
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

async function supersede(versionId: string): Promise<void> {
  await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${versionId}`;
}

async function newRevision(projectId: string, logicalItemId: string, revisionNumber = 2) {
  return fx.createItemVersion(sql, { projectId, logicalItemId, revisionNumber });
}

interface FlaggedStory {
  userId: string;
  projectId: string;
  reqArtifactId: string;
  backlogArtifactId: string;
  /** Requirement R at revision 1: the obsolete ROOT once R is regenerated. */
  r: Item;
  reqV1: string;
  /** R's current item_version (revision 2) and the Requirements version that holds it. */
  rV2: string;
  reqV2: string;
  /** Story S (current) depends on R@1, so (S, R@1) is flagged at depth 0. */
  s: Item;
  backlogV1: string;
}

// R@1 <- S, both approved; then Requirements is regenerated (R@2, R@1 superseded),
// which flags S against the now-obsolete R@1 (ERD 6.1: direct, depth 0).
async function buildFlaggedStory(name: string): Promise<FlaggedStory> {
  const { userId, projectId } = await fx.createProjectWithOwner(sql, { name });
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
  const backlogV1 = await approveVersionWithItems(backlogArtifactId, [s]);

  const rV2 = await newRevision(projectId, r.logicalItemId);
  await supersede(reqV1);
  const reqV2 = await approveVersionWithItems(
    reqArtifactId,
    [{ logicalItemId: r.logicalItemId, itemVersionId: rV2 }],
    2,
  );

  return {
    userId,
    projectId,
    reqArtifactId,
    backlogArtifactId,
    r,
    reqV1,
    rV2,
    reqV2,
    s,
    backlogV1,
  };
}

// One Story S that depends on TWO requirements, R1 and R2 (two causes for one
// subject); then Requirements is regenerated with both revised, so S is flagged
// against R1@1 and, separately, against R2@1 (two rows for one subject, ERD 6.1).
// `ackedByRoot` reads S's rows back as root item_version id -> acknowledged.
async function buildTwoCauses(name: string) {
  const { userId, projectId } = await fx.createProjectWithOwner(sql, { name });
  const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
  const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
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
  const s = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: backlogArtifactId,
    itemType: 'story',
  });
  for (const upstream of [r1, r2]) {
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: upstream.itemVersionId,
    });
  }
  await approveVersionWithItems(backlogArtifactId, [s]);
  const r1V2 = await newRevision(projectId, r1.logicalItemId);
  const r2V2 = await newRevision(projectId, r2.logicalItemId);
  await supersede(reqV1);
  await approveVersionWithItems(
    reqArtifactId,
    [
      { logicalItemId: r1.logicalItemId, itemVersionId: r1V2 },
      { logicalItemId: r2.logicalItemId, itemVersionId: r2V2 },
    ],
    2,
  );
  const ackedByRoot = async () =>
    new Map(
      (await lifecycle.getImpactWarnings(projectId))
        .filter((row) => row.subjectId === s.itemVersionId)
        .map((row) => [row.rootItemVersionId, row.acknowledged]),
    );
  return { userId, projectId, r1, r2, s, ackedByRoot };
}

interface AckRow {
  project_id: string;
  subject_item_version_id: string | null;
  subject_external_ref_id: string | null;
  root_logical_item_id: string;
  obsolete_upstream_item_version_id: string;
  acknowledged_against_upstream_item_version_id: string | null;
  acknowledged_by_user_id: string;
  note: string | null;
}

function ackRows(projectId: string) {
  return sql<AckRow[]>`
    SELECT project_id, subject_item_version_id, subject_external_ref_id, root_logical_item_id,
           obsolete_upstream_item_version_id, acknowledged_against_upstream_item_version_id,
           acknowledged_by_user_id, note
    FROM impact_acknowledgement
    WHERE project_id = ${projectId}
    ORDER BY acknowledged_at, id
  `;
}

describe('getImpactWarnings', () => {
  it('returns the flagged row for a superseded upstream, with its inspectable path (INV-022, INV-023)', async () => {
    const f = await buildFlaggedStory('lifecycle impact: flagged');

    const warnings = await lifecycle.getImpactWarnings(f.projectId);

    expect(warnings).toEqual([
      {
        subjectKind: 'item_version',
        subjectId: f.s.itemVersionId,
        rootItemVersionId: f.r.itemVersionId,
        depth: 0,
        path: [f.r.itemVersionId, f.s.itemVersionId],
        acknowledged: false,
      },
    ]);
  });

  it('returns [] for a project with nothing flagged', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'lifecycle impact: clean' });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    await approveVersionWithItems(reqArtifactId, [r]);

    await expect(lifecycle.getImpactWarnings(projectId)).resolves.toEqual([]);
  });

  it("never returns another project's warnings", async () => {
    const flagged = await buildFlaggedStory('lifecycle impact: flagged (isolation)');
    const { projectId: otherProjectId } = await fx.createProjectWithOwner(sql, {
      name: 'lifecycle impact: other project',
    });

    await expect(lifecycle.getImpactWarnings(otherProjectId)).resolves.toEqual([]);
    await expect(lifecycle.getImpactWarnings(flagged.projectId)).resolves.toHaveLength(1);
  });

  it('orders rows by depth, then root, then subject kind, then subject id - the same way on every read', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, {
      name: 'lifecycle impact: ordering',
    });
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const archArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

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

    const adr = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: archArtifactId,
      itemType: 'architecture_decision',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: adr.itemVersionId,
      upstreamItemVersionId: r1.itemVersionId,
    });
    await approveVersionWithItems(archArtifactId, [adr], 1, { architecture: true });

    // s1 -> R1 and s2 -> R2 (direct, two different roots); s3 -> ADR (transitive
    // to R1, through the still-current ADR).
    const stories: Item[] = [];
    for (const upstream of [r1.itemVersionId, r2.itemVersionId, adr.itemVersionId]) {
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: story.itemVersionId,
        upstreamItemVersionId: upstream,
      });
      stories.push(story);
    }
    const [s1, s2, s3] = stories as [Item, Item, Item];
    const backlogV1 = await approveVersionWithItems(backlogArtifactId, stories);

    // A Jira ref created from s1: the same root as the transitive row s3 and the
    // same depth (1), but an external_ref - so kind is what orders those two.
    const opId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'jira',
      sourceArtifactVersionId: backlogV1,
      sourceItemVersionId: s1.itemVersionId,
    });
    const refId = await fx.createExternalRef(sql, {
      projectId,
      provider: 'jira',
      externalOperationId: opId,
      sourceArtifactVersionId: backlogV1,
      sourceItemVersionId: s1.itemVersionId,
    });

    const r1V2 = await newRevision(projectId, r1.logicalItemId);
    const r2V2 = await newRevision(projectId, r2.logicalItemId);
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [
        { logicalItemId: r1.logicalItemId, itemVersionId: r1V2 },
        { logicalItemId: r2.logicalItemId, itemVersionId: r2V2 },
      ],
      2,
    );

    // Expected order, written independently of the implementation: one
    // fixed-width string key per row (depth, root, kind, subject) sorted as text.
    const expected = [
      { kind: 'item_version', id: adr.itemVersionId, root: r1.itemVersionId, depth: 0 },
      { kind: 'item_version', id: s1.itemVersionId, root: r1.itemVersionId, depth: 0 },
      { kind: 'item_version', id: s2.itemVersionId, root: r2.itemVersionId, depth: 0 },
      { kind: 'item_version', id: s3.itemVersionId, root: r1.itemVersionId, depth: 1 },
      { kind: 'external_ref', id: refId, root: r1.itemVersionId, depth: 1 },
    ]
      .map((row) => ({ ...row, key: `${row.depth}|${row.root}|${row.kind}|${row.id}` }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const first = await lifecycle.getImpactWarnings(projectId);
    const second = await lifecycle.getImpactWarnings(projectId);

    expect(first).toHaveLength(5);
    expect(
      first.map((row) => [row.depth, row.rootItemVersionId, row.subjectKind, row.subjectId]),
    ).toEqual(expected.map((row) => [row.depth, row.root, row.kind, row.id]));
    // Direct before transitive (INV-022), and at equal depth AND root the
    // external_ref sorts before the item_version.
    expect(first.map((row) => row.depth)).toEqual([0, 0, 0, 1, 1]);
    expect(first.slice(3).map((row) => row.subjectKind)).toEqual(['external_ref', 'item_version']);
    expect(second).toEqual(first);

    // Passing through, not filtering: the same rows getWarnings reports, only ordered.
    const raw = await impact.getWarnings(projectId);
    expect(
      new Set(raw.map((row) => `${row.subjectKind}|${row.subjectId}|${row.rootItemVersionId}`)),
    ).toEqual(
      new Set(first.map((row) => `${row.subjectKind}|${row.subjectId}|${row.rootItemVersionId}`)),
    );
    expect(raw).toHaveLength(first.length);
  });
});

describe('impact.getWarnings(projectId, executor) (E3-S11 additive parameter)', () => {
  it('returns the same rows from an open transaction as from the pool', async () => {
    const f = await buildFlaggedStory('lifecycle impact: getWarnings executor');

    const onPool = await impact.getWarnings(f.projectId);
    const inTx = await withTx((tx) => impact.getWarnings(f.projectId, tx));

    expect(onPool).toHaveLength(1);
    expect(inTx).toEqual(onPool);
  });

  it("reads through the caller's transaction: sees its own uncommitted acknowledgement, which the pool does not", async () => {
    const f = await buildFlaggedStory('lifecycle impact: getWarnings same snapshot');
    const rollback = new Error('rollback on purpose');

    await expect(
      withTx(async (tx) => {
        await impact.acknowledge(tx, {
          projectId: f.projectId,
          subject: { itemVersionId: f.s.itemVersionId },
          obsoleteUpstreamItemVersionId: f.r.itemVersionId,
          userId: f.userId,
        });
        const inTx = await impact.getWarnings(f.projectId, tx);
        const onPool = await impact.getWarnings(f.projectId);
        expect(inTx.map((row) => row.acknowledged)).toEqual([true]);
        expect(onPool.map((row) => row.acknowledged)).toEqual([false]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    // The rollback took the acknowledgement with it.
    await expect(ackRows(f.projectId)).resolves.toHaveLength(0);
    expect((await impact.getWarnings(f.projectId)).map((row) => row.acknowledged)).toEqual([false]);
  });
});

describe('getItemVersionProjectIds', () => {
  it('maps each existing item_version id to the project it belongs to', async () => {
    const a = await buildFlaggedStory('lifecycle impact: project ids A');
    const b = await buildFlaggedStory('lifecycle impact: project ids B');

    const map = await lifecycle.getItemVersionProjectIds([
      a.s.itemVersionId,
      a.rV2,
      b.r.itemVersionId,
    ]);

    expect(map).toEqual(
      new Map([
        [a.s.itemVersionId, a.projectId],
        [a.rV2, a.projectId],
        [b.r.itemVersionId, b.projectId],
      ]),
    );
  });

  it('leaves a well-formed uuid that names no item_version out of the map', async () => {
    const f = await buildFlaggedStory('lifecycle impact: project ids unknown');
    const unknown = randomUUID();

    const map = await lifecycle.getItemVersionProjectIds([f.s.itemVersionId, unknown]);

    expect(map.get(f.s.itemVersionId)).toBe(f.projectId);
    expect(map.has(unknown)).toBe(false);
    expect(map.size).toBe(1);
  });

  it('silently drops a string that is not a uuid - it never reaches Postgres (no 22P02), and the valid ids still resolve', async () => {
    const f = await buildFlaggedStory('lifecycle impact: project ids malformed');
    const malformed = ['not-a-uuid', '', '123', "1' OR '1'='1", `${randomUUID()}x`];

    await expect(lifecycle.getItemVersionProjectIds(malformed)).resolves.toEqual(new Map());
    const map = await lifecycle.getItemVersionProjectIds([...malformed, f.s.itemVersionId]);
    expect(map).toEqual(new Map([[f.s.itemVersionId, f.projectId]]));
  });

  it('returns an empty map for empty input', async () => {
    await expect(lifecycle.getItemVersionProjectIds([])).resolves.toEqual(new Map());
  });

  it('counts a repeated id once', async () => {
    const f = await buildFlaggedStory('lifecycle impact: project ids duplicate');

    const map = await lifecycle.getItemVersionProjectIds([f.s.itemVersionId, f.s.itemVersionId]);

    expect(map).toEqual(new Map([[f.s.itemVersionId, f.projectId]]));
  });

  it('accepts any spelling of an id and keys the result by the LOWERCASE id', async () => {
    const f = await buildFlaggedStory('lifecycle impact: project ids mixed case');
    const upper = f.s.itemVersionId.toUpperCase();

    const map = await lifecycle.getItemVersionProjectIds([upper, f.r.itemVersionId]);

    expect(map).toEqual(
      new Map([
        [f.s.itemVersionId, f.projectId],
        [f.r.itemVersionId, f.projectId],
      ]),
    );
    // A caller that passed the same id in two spellings gets it once, lowercase.
    await expect(lifecycle.getItemVersionProjectIds([f.s.itemVersionId, upper])).resolves.toEqual(
      new Map([[f.s.itemVersionId, f.projectId]]),
    );
  });

  it('identity.getItemVersionProjectIds takes a tx and behaves the same (found, unknown, empty)', async () => {
    const f = await buildFlaggedStory('lifecycle impact: identity project ids');
    const unknown = randomUUID();

    const map = await withTx((tx) =>
      identity.getItemVersionProjectIds(tx, [f.s.itemVersionId, unknown]),
    );
    const empty = await withTx((tx) => identity.getItemVersionProjectIds(tx, []));

    expect(map).toEqual(new Map([[f.s.itemVersionId, f.projectId]]));
    expect(empty).toEqual(new Map());
  });
});

describe('acknowledgeImpactWarning', () => {
  it('writes exactly one cause-specific acknowledgement, and getImpactWarnings then reports that row acknowledged (INV-026)', async () => {
    const f = await buildFlaggedStory('lifecycle ack: acknowledged');

    const result = await lifecycle.acknowledgeImpactWarning({
      projectId: f.projectId,
      userId: f.userId,
      subject: { itemVersionId: f.s.itemVersionId },
      obsoleteUpstreamItemVersionId: f.r.itemVersionId,
      note: 'Reviewed - the story is still accurate.',
    });

    expect(result).toEqual({ status: 'acknowledged' });
    expect(await ackRows(f.projectId)).toEqual([
      {
        project_id: f.projectId,
        subject_item_version_id: f.s.itemVersionId,
        subject_external_ref_id: null,
        // Computed by impact.acknowledge from the root, never accepted from the caller (ERD 4.12).
        root_logical_item_id: f.r.logicalItemId,
        obsolete_upstream_item_version_id: f.r.itemVersionId,
        acknowledged_against_upstream_item_version_id: f.rV2,
        acknowledged_by_user_id: f.userId,
        note: 'Reviewed - the story is still accurate.',
      },
    ]);
    const warnings = await lifecycle.getImpactWarnings(f.projectId);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ subjectId: f.s.itemVersionId, acknowledged: true });
  });

  it('accepts any spelling of the project, subject and root ids - never a spurious not_currently_flagged', async () => {
    const f = await buildFlaggedStory('lifecycle ack: mixed-case ids');

    const result = await lifecycle.acknowledgeImpactWarning({
      projectId: f.projectId.toUpperCase(),
      userId: f.userId,
      subject: { itemVersionId: f.s.itemVersionId.toUpperCase() },
      obsoleteUpstreamItemVersionId: f.r.itemVersionId.toUpperCase(),
    });

    expect(result).toEqual({ status: 'acknowledged' });
    const rows = await ackRows(f.projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      project_id: f.projectId,
      subject_item_version_id: f.s.itemVersionId,
      obsolete_upstream_item_version_id: f.r.itemVersionId,
    });
    // ...and the same pair in the other spelling is the same warning: already done.
    await expect(
      lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: f.s.itemVersionId },
        obsoleteUpstreamItemVersionId: f.r.itemVersionId,
      }),
    ).resolves.toEqual({ status: 'already_acknowledged' });
    await expect(ackRows(f.projectId)).resolves.toHaveLength(1);
  });

  it('stores the note verbatim, and NULL when there is none', async () => {
    const withNote = await buildFlaggedStory('lifecycle ack: note verbatim');
    const withoutNote = await buildFlaggedStory('lifecycle ack: no note');
    const note = '  padded  \n and multi-line ';

    await lifecycle.acknowledgeImpactWarning({
      projectId: withNote.projectId,
      userId: withNote.userId,
      subject: { itemVersionId: withNote.s.itemVersionId },
      obsoleteUpstreamItemVersionId: withNote.r.itemVersionId,
      note,
    });
    await lifecycle.acknowledgeImpactWarning({
      projectId: withoutNote.projectId,
      userId: withoutNote.userId,
      subject: { itemVersionId: withoutNote.s.itemVersionId },
      obsoleteUpstreamItemVersionId: withoutNote.r.itemVersionId,
    });

    expect((await ackRows(withNote.projectId)).map((row) => row.note)).toEqual([note]);
    expect((await ackRows(withoutNote.projectId)).map((row) => row.note)).toEqual([null]);
  });

  it('never suppresses a DIFFERENT cause on the same subject: only the acknowledged (subject, root) pair flips (INV-026)', async () => {
    const { userId, projectId, r1, r2, s, ackedByRoot } = await buildTwoCauses(
      'lifecycle ack: two causes',
    );
    expect(await ackedByRoot()).toEqual(
      new Map([
        [r1.itemVersionId, false],
        [r2.itemVersionId, false],
      ]),
    );

    const result = await lifecycle.acknowledgeImpactWarning({
      projectId,
      userId,
      subject: { itemVersionId: s.itemVersionId },
      obsoleteUpstreamItemVersionId: r1.itemVersionId,
    });

    expect(result).toEqual({ status: 'acknowledged' });
    expect(await ackedByRoot()).toEqual(
      new Map([
        [r1.itemVersionId, true],
        [r2.itemVersionId, false],
      ]),
    );
    const rows = await ackRows(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      root_logical_item_id: r1.logicalItemId,
      obsolete_upstream_item_version_id: r1.itemVersionId,
    });
  });

  it('re-acknowledging an already-acknowledged cause is already_acknowledged and leaves the OTHER cause on the same subject open (INV-026)', async () => {
    const { userId, projectId, r1, r2, s, ackedByRoot } = await buildTwoCauses(
      'lifecycle ack: two causes, re-acknowledge one',
    );
    const ackR1 = () =>
      lifecycle.acknowledgeImpactWarning({
        projectId,
        userId,
        subject: { itemVersionId: s.itemVersionId },
        obsoleteUpstreamItemVersionId: r1.itemVersionId,
      });
    await expect(ackR1()).resolves.toEqual({ status: 'acknowledged' });
    expect(await ackedByRoot()).toEqual(
      new Map([
        [r1.itemVersionId, true],
        [r2.itemVersionId, false],
      ]),
    );

    // The (S, R1) pair is answered as already done, and writes nothing...
    await expect(ackR1()).resolves.toEqual({ status: 'already_acknowledged' });

    // ...and neither call touched (S, R2): it is still an open, unacknowledged warning.
    expect(await ackedByRoot()).toEqual(
      new Map([
        [r1.itemVersionId, true],
        [r2.itemVersionId, false],
      ]),
    );
    const rows = await ackRows(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ obsolete_upstream_item_version_id: r1.itemVersionId });
    // The other cause remains acknowledgeable in its own right.
    await expect(
      lifecycle.acknowledgeImpactWarning({
        projectId,
        userId,
        subject: { itemVersionId: s.itemVersionId },
        obsoleteUpstreamItemVersionId: r2.itemVersionId,
      }),
    ).resolves.toEqual({ status: 'acknowledged' });
    expect(await ackedByRoot()).toEqual(
      new Map([
        [r1.itemVersionId, true],
        [r2.itemVersionId, true],
      ]),
    );
    await expect(ackRows(projectId)).resolves.toHaveLength(2);
  });

  it('answers already_acknowledged for a second identical call and writes nothing (still exactly one row)', async () => {
    const f = await buildFlaggedStory('lifecycle ack: idempotent');
    const call = () =>
      lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: f.s.itemVersionId },
        obsoleteUpstreamItemVersionId: f.r.itemVersionId,
        note: 'first',
      });

    await expect(call()).resolves.toEqual({ status: 'acknowledged' });
    // impact.acknowledge would raise ack_item_unique for this; the function must
    // answer before ever calling it.
    await expect(call()).resolves.toEqual({ status: 'already_acknowledged' });
    await expect(call()).resolves.toEqual({ status: 'already_acknowledged' });

    const rows = await ackRows(f.projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.note).toBe('first');
  });

  it('serializes a double-click under the project lock: exactly one wins, the other is already_acknowledged', async () => {
    const f = await buildFlaggedStory('lifecycle ack: concurrent');
    const call = () =>
      lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: f.s.itemVersionId },
        obsoleteUpstreamItemVersionId: f.r.itemVersionId,
      });

    const results = await Promise.all([call(), call()]);

    expect(results.map((result) => result.status).sort()).toEqual([
      'acknowledged',
      'already_acknowledged',
    ]);
    await expect(ackRows(f.projectId)).resolves.toHaveLength(1);
  });

  it("is not_currently_flagged, writing nothing, when the obsolete upstream is not the subject's root", async () => {
    const f = await buildFlaggedStory('lifecycle ack: wrong root');

    // R@2 is real but current, not a root anything is flagged against; the
    // other is a well-formed id that exists nowhere.
    for (const wrongRoot of [f.rV2, randomUUID()]) {
      const result = await lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: f.s.itemVersionId },
        obsoleteUpstreamItemVersionId: wrongRoot,
      });
      expect(result).toEqual({ status: 'not_currently_flagged' });
    }
    await expect(ackRows(f.projectId)).resolves.toHaveLength(0);
    // ...and the real warning is untouched.
    expect((await lifecycle.getImpactWarnings(f.projectId)).map((row) => row.acknowledged)).toEqual(
      [false],
    );
  });

  it('is not_currently_flagged for a current, clean item (nothing depends on anything obsolete)', async () => {
    const f = await buildFlaggedStory('lifecycle ack: clean item');
    const clean = await fx.createLogicalItemWithVersion(sql, {
      projectId: f.projectId,
      artifactId: f.backlogArtifactId,
      itemType: 'story',
    });
    await supersede(f.backlogV1);
    await approveVersionWithItems(f.backlogArtifactId, [f.s, clean], 2);

    for (const subject of [clean.itemVersionId, f.rV2]) {
      const result = await lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: subject },
        obsoleteUpstreamItemVersionId: f.r.itemVersionId,
      });
      expect(result).toEqual({ status: 'not_currently_flagged' });
    }
    await expect(ackRows(f.projectId)).resolves.toHaveLength(0);
  });

  it("is not_currently_flagged for a DRAFT item, which impact() never reports (INV-022); that is overrideNote's job", async () => {
    const f = await buildFlaggedStory('lifecycle ack: draft subject');
    // A second Backlog version, still a draft, holding a new story that depends
    // on the obsolete R@1: the approval gate would flag it (as a candidate), the
    // panel does not - drafts are not active subjects.
    const draftStory = await fx.createLogicalItemWithVersion(sql, {
      projectId: f.projectId,
      artifactId: f.backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId: f.projectId,
      downstreamItemVersionId: draftStory.itemVersionId,
      upstreamItemVersionId: f.r.itemVersionId,
    });
    const draftId = await fx.createDraftArtifactVersion(sql, f.backlogArtifactId, {
      versionNumber: 2,
    });
    for (const item of [f.s, draftStory]) {
      await fx.createMembership(sql, {
        artifactVersionId: draftId,
        artifactId: f.backlogArtifactId,
        logicalItemId: item.logicalItemId,
        itemVersionId: item.itemVersionId,
      });
    }
    const reported = (await lifecycle.getImpactWarnings(f.projectId)).map((row) => row.subjectId);
    expect(reported).toEqual([f.s.itemVersionId]);

    const result = await lifecycle.acknowledgeImpactWarning({
      projectId: f.projectId,
      userId: f.userId,
      subject: { itemVersionId: draftStory.itemVersionId },
      obsoleteUpstreamItemVersionId: f.r.itemVersionId,
    });

    expect(result).toEqual({ status: 'not_currently_flagged' });
    await expect(ackRows(f.projectId)).resolves.toHaveLength(0);
  });

  it("refuses to acknowledge another project's warning when handed the wrong projectId (defense in depth behind the route's 404)", async () => {
    const flagged = await buildFlaggedStory('lifecycle ack: cross-project (flagged)');
    const other = await buildFlaggedStory('lifecycle ack: cross-project (other)');

    const result = await lifecycle.acknowledgeImpactWarning({
      projectId: other.projectId,
      userId: other.userId,
      subject: { itemVersionId: flagged.s.itemVersionId },
      obsoleteUpstreamItemVersionId: flagged.r.itemVersionId,
    });

    expect(result).toEqual({ status: 'not_currently_flagged' });
    await expect(ackRows(flagged.projectId)).resolves.toHaveLength(0);
    await expect(ackRows(other.projectId)).resolves.toHaveLength(0);
  });

  describe('an external_ref subject', () => {
    // A Jira ref created from the flagged story: flagged at depth 1 (its source
    // item's depth + 1, ERD 6.2), root R@1 - the same root as the story's own row.
    async function withJiraRef(f: FlaggedStory): Promise<string> {
      const opId = await fx.createExternalOperation(sql, {
        projectId: f.projectId,
        provider: 'jira',
        sourceArtifactVersionId: f.backlogV1,
        sourceItemVersionId: f.s.itemVersionId,
      });
      return fx.createExternalRef(sql, {
        projectId: f.projectId,
        provider: 'jira',
        externalOperationId: opId,
        sourceArtifactVersionId: f.backlogV1,
        sourceItemVersionId: f.s.itemVersionId,
      });
    }

    it('acknowledges the ref row only - its own subject kind - and is idempotent too', async () => {
      const f = await buildFlaggedStory('lifecycle ack: external ref');
      const refId = await withJiraRef(f);
      const before = await lifecycle.getImpactWarnings(f.projectId);
      expect(before.map((row) => [row.subjectKind, row.acknowledged])).toEqual([
        ['item_version', false], // depth 0: the story itself
        ['external_ref', false], // depth 1: the ref created from it
      ]);
      const call = () =>
        lifecycle.acknowledgeImpactWarning({
          projectId: f.projectId,
          userId: f.userId,
          subject: { externalRefId: refId },
          obsoleteUpstreamItemVersionId: f.r.itemVersionId,
          note: 'Ticket already reflects this change.',
        });

      await expect(call()).resolves.toEqual({ status: 'acknowledged' });
      await expect(call()).resolves.toEqual({ status: 'already_acknowledged' });

      expect(await ackRows(f.projectId)).toEqual([
        {
          project_id: f.projectId,
          subject_item_version_id: null,
          subject_external_ref_id: refId,
          root_logical_item_id: f.r.logicalItemId,
          obsolete_upstream_item_version_id: f.r.itemVersionId,
          acknowledged_against_upstream_item_version_id: f.rV2,
          acknowledged_by_user_id: f.userId,
          note: 'Ticket already reflects this change.',
        },
      ]);
      // The ref's row flipped; the story's own row - a different subject - did not.
      const after = await lifecycle.getImpactWarnings(f.projectId);
      expect(after.map((row) => [row.subjectKind, row.acknowledged])).toEqual([
        ['item_version', false],
        ['external_ref', true],
      ]);
    });

    it("is not_currently_flagged, writing nothing, for a ref that belongs to ANOTHER project than the projectId it is acknowledged under (defense in depth behind the route's 404)", async () => {
      const flagged = await buildFlaggedStory('lifecycle ack: external ref (its own project)');
      const refId = await withJiraRef(flagged);
      const other = await buildFlaggedStory('lifecycle ack: external ref (the wrong project)');
      // Sanity: the ref really is flagged - in ITS project.
      expect(
        (await lifecycle.getImpactWarnings(flagged.projectId)).some(
          (row) => row.subjectKind === 'external_ref' && row.subjectId === refId,
        ),
      ).toBe(true);

      // The ref with its own root, but under the other project's id...
      const withOwnRoot = await lifecycle.acknowledgeImpactWarning({
        projectId: other.projectId,
        userId: other.userId,
        subject: { externalRefId: refId },
        obsoleteUpstreamItemVersionId: flagged.r.itemVersionId,
      });
      // ...and with the other project's (real, flagged) root, under that project.
      const withOtherRoot = await lifecycle.acknowledgeImpactWarning({
        projectId: other.projectId,
        userId: other.userId,
        subject: { externalRefId: refId },
        obsoleteUpstreamItemVersionId: other.r.itemVersionId,
      });

      expect(withOwnRoot).toEqual({ status: 'not_currently_flagged' });
      expect(withOtherRoot).toEqual({ status: 'not_currently_flagged' });
      await expect(ackRows(flagged.projectId)).resolves.toHaveLength(0);
      await expect(ackRows(other.projectId)).resolves.toHaveLength(0);
      // Nothing changed for the ref's own project either.
      expect(
        (await lifecycle.getImpactWarnings(flagged.projectId)).every((row) => !row.acknowledged),
      ).toBe(true);
    });

    it('is not_currently_flagged for a ref that reports no drift, or for a ref id that is really an item_version id', async () => {
      const f = await buildFlaggedStory('lifecycle ack: external ref clean');
      // A ref created from a story with no obsolete dependency: no warning for it.
      const clean = await fx.createLogicalItemWithVersion(sql, {
        projectId: f.projectId,
        artifactId: f.backlogArtifactId,
        itemType: 'story',
      });
      await supersede(f.backlogV1);
      const backlogV2 = await approveVersionWithItems(f.backlogArtifactId, [f.s, clean], 2);
      const opId = await fx.createExternalOperation(sql, {
        projectId: f.projectId,
        provider: 'jira',
        sourceArtifactVersionId: backlogV2,
        sourceItemVersionId: clean.itemVersionId,
      });
      const cleanRefId = await fx.createExternalRef(sql, {
        projectId: f.projectId,
        provider: 'jira',
        externalOperationId: opId,
        sourceArtifactVersionId: backlogV2,
        sourceItemVersionId: clean.itemVersionId,
      });

      for (const externalRefId of [cleanRefId, f.s.itemVersionId]) {
        const result = await lifecycle.acknowledgeImpactWarning({
          projectId: f.projectId,
          userId: f.userId,
          subject: { externalRefId },
          obsoleteUpstreamItemVersionId: f.r.itemVersionId,
        });
        expect(result).toEqual({ status: 'not_currently_flagged' });
      }
      await expect(ackRows(f.projectId)).resolves.toHaveLength(0);
    });
  });

  describe('when the root moves again (ERD 4.12: an acknowledgement stops matching)', () => {
    it("re-flags the pair, and acknowledging it afresh writes a NEW row against the root's newer current version", async () => {
      const f = await buildFlaggedStory('lifecycle ack: root moves again');
      const ack = () =>
        lifecycle.acknowledgeImpactWarning({
          projectId: f.projectId,
          userId: f.userId,
          subject: { itemVersionId: f.s.itemVersionId },
          obsoleteUpstreamItemVersionId: f.r.itemVersionId,
        });
      await expect(ack()).resolves.toEqual({ status: 'acknowledged' });
      expect(
        (await lifecycle.getImpactWarnings(f.projectId)).map((row) => row.acknowledged),
      ).toEqual([true]);

      // R@2 -> R@3. S still depends on R@1 (edges are immutable, INV-015), so the
      // pair (S, R@1) is still flagged - but the acknowledgement was made
      // against R@2, which is no longer current, so it stops matching.
      const rV3 = await newRevision(f.projectId, f.r.logicalItemId, 3);
      await supersede(f.reqV2);
      await approveVersionWithItems(
        f.reqArtifactId,
        [{ logicalItemId: f.r.logicalItemId, itemVersionId: rV3 }],
        3,
      );
      const reflagged = await lifecycle.getImpactWarnings(f.projectId);
      expect(reflagged).toHaveLength(1);
      expect(reflagged[0]).toMatchObject({
        subjectId: f.s.itemVersionId,
        rootItemVersionId: f.r.itemVersionId,
        acknowledged: false,
      });

      // Still a real warning, so it can be acknowledged again: the earlier row
      // (against R@2) is a different row from this one (against R@3).
      await expect(ack()).resolves.toEqual({ status: 'acknowledged' });
      expect(
        (await ackRows(f.projectId)).map(
          (row) => row.acknowledged_against_upstream_item_version_id,
        ),
      ).toEqual([f.rV2, rV3]);
      expect(
        (await lifecycle.getImpactWarnings(f.projectId)).map((row) => row.acknowledged),
      ).toEqual([true]);
      await expect(ack()).resolves.toEqual({ status: 'already_acknowledged' });
      await expect(ackRows(f.projectId)).resolves.toHaveLength(2);
    });

    it('is not_currently_flagged once the SUBJECT was regenerated against the newer root: the old (subject, root) pair is gone', async () => {
      const f = await buildFlaggedStory('lifecycle ack: subject regenerated');
      // S is regenerated against R@2: a new item_version of the same LogicalItem
      // depending on R@2, in a newly approved Backlog. S@1 is no longer current.
      const sV2 = await newRevision(f.projectId, f.s.logicalItemId);
      await fx.createSemanticDependency(sql, {
        projectId: f.projectId,
        downstreamItemVersionId: sV2,
        upstreamItemVersionId: f.rV2,
      });
      await supersede(f.backlogV1);
      await approveVersionWithItems(
        f.backlogArtifactId,
        [{ logicalItemId: f.s.logicalItemId, itemVersionId: sV2 }],
        2,
      );
      await expect(lifecycle.getImpactWarnings(f.projectId)).resolves.toEqual([]);

      const stale = await lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: f.s.itemVersionId },
        obsoleteUpstreamItemVersionId: f.r.itemVersionId,
      });
      expect(stale).toEqual({ status: 'not_currently_flagged' });

      // R moves again: now the regenerated story is flagged, against R@2 - a
      // different root from the one the stale request named.
      const rV3 = await newRevision(f.projectId, f.r.logicalItemId, 3);
      await supersede(f.reqV2);
      await approveVersionWithItems(
        f.reqArtifactId,
        [{ logicalItemId: f.r.logicalItemId, itemVersionId: rV3 }],
        3,
      );
      const stillStale = await lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: f.s.itemVersionId },
        obsoleteUpstreamItemVersionId: f.r.itemVersionId,
      });
      expect(stillStale).toEqual({ status: 'not_currently_flagged' });
      const fresh = await lifecycle.acknowledgeImpactWarning({
        projectId: f.projectId,
        userId: f.userId,
        subject: { itemVersionId: sV2 },
        obsoleteUpstreamItemVersionId: f.rV2,
      });
      expect(fresh).toEqual({ status: 'acknowledged' });
      expect((await ackRows(f.projectId)).map((row) => row.subject_item_version_id)).toEqual([sV2]);
    });

    it('acknowledges a removed root once (acknowledged_against NULL) and answers already_acknowledged after that, never a unique violation', async () => {
      const f = await buildFlaggedStory('lifecycle ack: removed root');
      // Requirements regenerated WITHOUT R: R has no current version (removed).
      const other = await fx.createLogicalItemWithVersion(sql, {
        projectId: f.projectId,
        artifactId: f.reqArtifactId,
        itemType: 'requirement',
      });
      await supersede(f.reqV2);
      await approveVersionWithItems(f.reqArtifactId, [other], 3);
      const call = () =>
        lifecycle.acknowledgeImpactWarning({
          projectId: f.projectId,
          userId: f.userId,
          subject: { itemVersionId: f.s.itemVersionId },
          obsoleteUpstreamItemVersionId: f.r.itemVersionId,
        });

      await expect(call()).resolves.toEqual({ status: 'acknowledged' });
      await expect(call()).resolves.toEqual({ status: 'already_acknowledged' });

      const rows = await ackRows(f.projectId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.acknowledged_against_upstream_item_version_id).toBeNull();
    });
  });
});
