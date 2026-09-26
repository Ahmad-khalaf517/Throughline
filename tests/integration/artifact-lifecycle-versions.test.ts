import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// artifact-lifecycle's read-only accessors for the API layer (Jira E3-S10 /
// SCRUM-45, API Contracts sections 4-5): getVersionRef, getArtifactId,
// listArtifactVersions and getArtifactVersionDetail (items built from
// identity.getSourceVersionMembers, impact from impact.getWarnings), plus the
// typed errors the same story added to the transitions. Fixtures are built
// through the raw `postgres` connection so every scenario passes the real
// triggers/CHECKs; only the calls under test go through the dynamically
// imported modules (their import reads env eagerly - same setup as
// backlog-generation.test.ts).

type LifecycleModule = typeof import('@/artifact-lifecycle');

let sql: postgres.Sql;
let lifecycle: LifecycleModule;
let impact: typeof import('@/lineage/impact');
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
// tests/integration/lineage/impact.test.ts uses, so the impact scenarios below
// are built exactly the way that file builds them.
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

describe('getVersionRef', () => {
  it('resolves a version to its artifact, project and type', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);

    await expect(lifecycle.getVersionRef(versionId)).resolves.toEqual({
      versionId,
      artifactId,
      projectId,
      artifactType: 'ui_requirements',
    });
  });

  it('returns null for a well-formed uuid that names no version', async () => {
    await expect(lifecycle.getVersionRef(randomUUID())).resolves.toBeNull();
  });

  it('returns null - without reaching Postgres - for a string that is not a uuid', async () => {
    // A malformed path param must become a clean 404 upstream; sent to Postgres
    // it would be a 22P02 "invalid input syntax for type uuid" (a 500).
    for (const malformed of ['not-a-uuid', '', '123', "1' OR '1'='1", `${randomUUID()}x`]) {
      await expect(lifecycle.getVersionRef(malformed)).resolves.toBeNull();
    }
  });
});

describe('getArtifactId', () => {
  it("returns the project's artifact row for each type, and null where none exists", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const architectureId = await fx.createArtifact(sql, projectId, 'architecture');

    await expect(lifecycle.getArtifactId(projectId, 'requirements')).resolves.toBe(requirementsId);
    await expect(lifecycle.getArtifactId(projectId, 'architecture')).resolves.toBe(architectureId);
    await expect(lifecycle.getArtifactId(projectId, 'backlog')).resolves.toBeNull();
  });

  it("never returns another project's artifact", async () => {
    const first = await fx.createProjectWithOwner(sql);
    const second = await fx.createProjectWithOwner(sql);
    const firstArtifactId = await fx.createArtifact(sql, first.projectId, 'requirements');
    await fx.createArtifact(sql, second.projectId, 'requirements');

    await expect(lifecycle.getArtifactId(first.projectId, 'requirements')).resolves.toBe(
      firstArtifactId,
    );
    await expect(lifecycle.getArtifactId(randomUUID(), 'requirements')).resolves.toBeNull();
  });
});

describe('listArtifactVersions', () => {
  it('lists every version of that artifact newest first, with the row fields the DTO needs', async () => {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    // Another artifact type and another project must not leak in.
    const otherArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
    await fx.createDraftArtifactVersion(sql, otherArtifactId);
    const other = await fx.createProjectWithOwner(sql);
    const otherProjectArtifactId = await fx.createArtifact(sql, other.projectId, 'requirements');
    await fx.createDraftArtifactVersion(sql, otherProjectArtifactId);

    const v1 = await fx.createDraftArtifactVersion(sql, artifactId, {
      versionNumber: 1,
      payload: { businessProblem: 'first' },
    });
    await lifecycle.approveVersion(v1, userId);
    // Approving v2 supersedes v1, the same way a real second approval does.
    const v2 = await fx.createDraftArtifactVersion(sql, artifactId, {
      versionNumber: 2,
      payload: { businessProblem: 'second' },
    });
    await lifecycle.approveVersion(v2, userId);
    const v3 = await fx.createDraftArtifactVersion(sql, artifactId, {
      versionNumber: 3,
      payload: { businessProblem: 'third' },
    });

    const versions = await lifecycle.listArtifactVersions(projectId, 'requirements');

    expect(versions.map((version) => [version.id, version.versionNumber, version.status])).toEqual([
      [v3, 3, 'draft'],
      [v2, 2, 'approved'],
      [v1, 1, 'superseded'],
    ]);
    const [latest] = versions;
    expect(latest).toMatchObject({
      id: v3,
      artifactId,
      artifactType: 'requirements',
      statusReason: null,
      schemaVersion: 1,
      baseApprovedVersionId: null,
      payload: { businessProblem: 'third' },
      rawOutput: null,
      selectedArchitectureOptionId: null,
    });
    expect(latest!.createdAt).toBeInstanceOf(Date);
    expect(latest!.updatedAt).toBeInstanceOf(Date);
    // No item or option bodies on the summary rows.
    expect(latest).not.toHaveProperty('items');
    expect(latest).not.toHaveProperty('options');
  });

  it('returns [] for an artifact with no versions or a type the project has no artifact for', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    await fx.createArtifact(sql, projectId, 'requirements');

    await expect(lifecycle.listArtifactVersions(projectId, 'requirements')).resolves.toEqual([]);
    await expect(lifecycle.listArtifactVersions(projectId, 'backlog')).resolves.toEqual([]);
  });
});

describe('getArtifactVersionDetail', () => {
  it('returns null for an unknown version id and for a string that is not a uuid', async () => {
    await expect(lifecycle.getArtifactVersionDetail(randomUUID())).resolves.toBeNull();
    await expect(lifecycle.getArtifactVersionDetail('not-a-uuid')).resolves.toBeNull();
  });

  it('returns the version row plus artifactType/projectId, and items: [] for a version with no members', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId, {
      payload: { summary: 'Two options' },
    });

    const detail = await lifecycle.getArtifactVersionDetail(versionId);

    expect(detail).not.toBeNull();
    expect(detail!.items).toEqual([]);
    expect(detail!.version).toMatchObject({
      id: versionId,
      artifactId,
      artifactType: 'architecture',
      projectId,
      versionNumber: 1,
      status: 'draft',
      payload: { summary: 'Two options' },
    });
    expect(detail!.version.createdAt).toBeInstanceOf(Date);
  });

  it('builds items with revisionNumber, payload and display key, ordered numerically by display key (R-09 < R-11 < R-100)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);

    const r100 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
      displayKey: 'R-100',
    });
    const r09 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
      displayKey: 'R-09',
    });
    // R-11 is on its second revision: the membership points at revision 2.
    const r11Logical = await fx.createLogicalItem(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
      displayKey: 'R-11',
    });
    await fx.createItemVersion(sql, { projectId, logicalItemId: r11Logical.id });
    const r11v2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r11Logical.id,
      revisionNumber: 2,
      payload: { behavior: 'second wording' },
    });
    // Inserted out of order on purpose: the response order is not insertion order.
    for (const member of [
      { logicalItemId: r100.logicalItemId, itemVersionId: r100.itemVersionId },
      { logicalItemId: r11Logical.id, itemVersionId: r11v2 },
      { logicalItemId: r09.logicalItemId, itemVersionId: r09.itemVersionId },
    ]) {
      await fx.createMembership(sql, { artifactVersionId: versionId, artifactId, ...member });
    }

    const detail = await lifecycle.getArtifactVersionDetail(versionId);

    expect(detail!.items.map((item) => item.displayKey)).toEqual(['R-09', 'R-11', 'R-100']);
    expect(detail!.items[1]).toEqual({
      itemVersionId: r11v2,
      logicalItemId: r11Logical.id,
      displayKey: 'R-11',
      itemType: 'requirement',
      revisionNumber: 2,
      payload: { behavior: 'second wording' },
      parentLogicalItemId: null,
      impact: null,
    });
    expect(detail!.items[0]!.revisionNumber).toBe(1);
    expect(detail!.items[2]!.itemVersionId).toBe(r100.itemVersionId);
  });

  it("orders Epics before Stories and carries each Story's parent from this version's membership", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'backlog');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);

    const item = (itemType: 'epic' | 'story', displayKey: string) =>
      fx.createLogicalItemWithVersion(sql, { projectId, artifactId, itemType, displayKey });
    const e10 = await item('epic', 'E-10');
    const e02 = await item('epic', 'E-02');
    const s11 = await item('story', 'S-11');
    const s02 = await item('story', 'S-02');
    const s01 = await item('story', 'S-01');

    const add = (member: Item, parentLogicalItemId: string | null) =>
      fx.createMembership(sql, {
        artifactVersionId: versionId,
        artifactId,
        ...member,
        parentLogicalItemId,
      });
    // Epics first (the parent FK is not deferrable), Stories in scrambled order.
    await add(e10, null);
    await add(e02, null);
    await add(s11, e10.logicalItemId);
    await add(s02, e10.logicalItemId);
    await add(s01, e02.logicalItemId);

    const detail = await lifecycle.getArtifactVersionDetail(versionId);

    expect(detail!.items.map((row) => row.displayKey)).toEqual([
      'E-02',
      'E-10',
      'S-01',
      'S-02',
      'S-11',
    ]);
    expect(
      Object.fromEntries(detail!.items.map((row) => [row.displayKey, row.parentLogicalItemId])),
    ).toEqual({
      'E-02': null,
      'E-10': null,
      'S-01': e02.logicalItemId,
      'S-02': e10.logicalItemId,
      'S-11': e10.logicalItemId,
    });
  });

  it('populates impact for an item whose upstream was superseded, and leaves clean items null (INV-025)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const reqArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: reqArtifactId,
      itemType: 'requirement',
    });
    const reqV1 = await approveVersionWithItems(reqArtifactId, [r]);

    const flagged = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    const clean = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: flagged.itemVersionId,
      upstreamItemVersionId: r.itemVersionId,
    });
    const backlogV1 = await approveVersionWithItems(backlogArtifactId, [flagged, clean]);

    // Nothing has moved yet: no item is flagged.
    const before = await lifecycle.getArtifactVersionDetail(backlogV1);
    expect(before!.items.map((row) => row.impact)).toEqual([null, null]);

    // Regenerate Requirements: R gets a new current ItemVersion; the story's
    // dependency now points at a superseded one.
    const rNext = await newRevision(projectId, r.logicalItemId);
    await supersede(reqV1);
    const reqV2 = await approveVersionWithItems(
      reqArtifactId,
      [{ logicalItemId: r.logicalItemId, itemVersionId: rNext }],
      2,
    );

    const detail = await lifecycle.getArtifactVersionDetail(backlogV1);
    const byKey = Object.fromEntries(detail!.items.map((row) => [row.displayKey, row]));
    expect(byKey[flagged.displayKey]!.impact).toEqual({
      subjectKind: 'item_version',
      subjectId: flagged.itemVersionId,
      rootItemVersionId: r.itemVersionId,
      depth: 0,
      path: [r.itemVersionId, flagged.itemVersionId],
      acknowledged: false,
    });
    expect(byKey[clean.displayKey]!.impact).toBeNull();

    // The changed Requirement itself is current and not downstream of anything.
    const reqDetail = await lifecycle.getArtifactVersionDetail(reqV2);
    expect(reqDetail!.items).toHaveLength(1);
    expect(reqDetail!.items[0]).toMatchObject({ itemVersionId: rNext, revisionNumber: 2 });
    expect(reqDetail!.items[0]!.impact).toBeNull();
  });

  it('shows the unacknowledged cause when one of two obsolete roots is acknowledged (INV-026), and an acknowledged one once both are', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);
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
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    for (const upstream of [r1, r2]) {
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: story.itemVersionId,
        upstreamItemVersionId: upstream.itemVersionId,
      });
    }
    const backlogV1 = await approveVersionWithItems(backlogArtifactId, [story]);

    const r1Next = await newRevision(projectId, r1.logicalItemId);
    const r2Next = await newRevision(projectId, r2.logicalItemId);
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [
        { logicalItemId: r1.logicalItemId, itemVersionId: r1Next },
        { logicalItemId: r2.logicalItemId, itemVersionId: r2Next },
      ],
      2,
    );

    const acknowledge = (root: { itemVersionId: string }, note: string) =>
      withTx((tx) =>
        impact.acknowledge(tx, {
          projectId,
          subject: { itemVersionId: story.itemVersionId },
          obsoleteUpstreamItemVersionId: root.itemVersionId,
          userId,
          note,
        }),
      );
    const storyImpact = async () =>
      (await lifecycle.getArtifactVersionDetail(backlogV1))!.items[0]!.impact;

    // Two distinct causes, both open, same depth: the tie-break is deterministic
    // (the lexicographically smaller root item_version id wins), never whichever
    // row impact() happened to return first.
    const smallerRootId = [r1.itemVersionId, r2.itemVersionId].sort()[0]!;
    expect(await storyImpact()).toMatchObject({
      rootItemVersionId: smallerRootId,
      acknowledged: false,
      depth: 0,
    });

    // R1's cause acknowledged: showing it would hide R2's still-open cause.
    await acknowledge(r1, 'R1 side reviewed');
    expect(await storyImpact()).toMatchObject({
      rootItemVersionId: r2.itemVersionId,
      acknowledged: false,
    });

    // Both acknowledged: the badge falls back to an acknowledged row.
    await acknowledge(r2, 'R2 side reviewed');
    expect(await storyImpact()).toMatchObject({ acknowledged: true });
  });

  it('prefers the shallowest (direct) cause among unacknowledged rows (INV-022)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
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
      upstreamItemVersionId: r2.itemVersionId,
    });
    await approveVersionWithItems(archArtifactId, [adr], 1, { architecture: true });

    // The story depends directly on R1 and, through the ADR, on R2.
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: r1.itemVersionId,
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: adr.itemVersionId,
    });
    const backlogV1 = await approveVersionWithItems(backlogArtifactId, [story]);

    const r1Next = await newRevision(projectId, r1.logicalItemId);
    const r2Next = await newRevision(projectId, r2.logicalItemId);
    await supersede(reqV1);
    await approveVersionWithItems(
      reqArtifactId,
      [
        { logicalItemId: r1.logicalItemId, itemVersionId: r1Next },
        { logicalItemId: r2.logicalItemId, itemVersionId: r2Next },
      ],
      2,
    );

    // Two open rows exist for the story: (root R1, depth 0) and (root R2, depth 1).
    const rows = (await impact.getWarnings(projectId)).filter(
      (warning) => warning.subjectId === story.itemVersionId,
    );
    expect(rows.map((row) => row.depth).sort()).toEqual([0, 1]);

    const detail = await lifecycle.getArtifactVersionDetail(backlogV1);
    expect(detail!.items[0]!.impact).toMatchObject({
      rootItemVersionId: r1.itemVersionId,
      depth: 0,
      acknowledged: false,
    });
  });
});

describe('typed errors (E3-S10)', () => {
  async function approvedRequirementsVersion() {
    const { projectId, userId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
    await lifecycle.approveVersion(versionId, userId);
    return { versionId, userId };
  }

  it('approveVersion, approveWithOverride, rejectVersion and requestRevision on a non-draft throw VersionNotDraftError with the unchanged message', async () => {
    const { versionId, userId } = await approvedRequirementsVersion();
    const message = `artifact_version ${versionId} is not a draft`;

    const attempts: [string, () => Promise<unknown>][] = [
      ['approveVersion', () => lifecycle.approveVersion(versionId, userId)],
      ['approveWithOverride', () => lifecycle.approveWithOverride(versionId, userId, 'A note.')],
      ['rejectVersion', () => lifecycle.rejectVersion(versionId, userId, 'No.')],
      ['requestRevision', () => lifecycle.requestRevision(versionId, userId, 'Rework.')],
    ];
    for (const [name, attempt] of attempts) {
      const error = await attempt().then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error, name).toBeInstanceOf(lifecycle.VersionNotDraftError);
      expect(error, name).toBeInstanceOf(Error);
      expect((error as Error).message, name).toBe(message);
      expect((error as InstanceType<LifecycleModule['VersionNotDraftError']>).versionId).toBe(
        versionId,
      );
    }
  });

  it('a version id that does not exist is still a plain not-found error, not VersionNotDraftError', async () => {
    const { userId } = await fx.createProjectWithOwner(sql);
    const missing = randomUUID();
    const error = await lifecycle.approveVersion(missing, userId).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).not.toBeInstanceOf(lifecycle.VersionNotDraftError);
    expect((error as Error).message).toBe(`artifact_version ${missing} not found`);
  });

  it('exports ApprovalGateBlockedError (carrying the blocking rows) for the approve route to map to 409 APPROVAL_BLOCKED', () => {
    const blocking = [
      {
        subjectKind: 'item_version' as const,
        subjectId: randomUUID(),
        rootItemVersionId: randomUUID(),
        depth: 0,
        path: [],
        acknowledged: false,
      },
    ];
    const error = new lifecycle.ApprovalGateBlockedError(blocking);
    expect(error).toBeInstanceOf(Error);
    expect(error.blocking).toBe(blocking);
    expect(error.message).toBe('approval gate blocked');
    // The display keys captured inside the rolled-back approval transaction ride
    // along with the block; a hand-built error without them carries an empty map.
    expect(error.displayKeys).toEqual(new Map());
    const displayKeys = new Map([[blocking[0]!.rootItemVersionId, 'R-01']]);
    expect(new lifecycle.ApprovalGateBlockedError(blocking, displayKeys).displayKeys).toBe(
      displayKeys,
    );
  });

  it("re-exports identity's own ItemEditError class, so instanceof matches what commitItemEdit throws", async () => {
    expect(lifecycle.ItemEditError).toBe(identity.ItemEditError);

    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const item = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
    });
    const approved = await approveVersionWithItems(artifactId, [item]);

    // Editing an approved (non-draft) version is refused with identity's error.
    const error = await lifecycle.commitItemEdit(approved, item.logicalItemId, {}, true).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(lifecycle.ItemEditError);
    expect((error as InstanceType<LifecycleModule['ItemEditError']>).code).toBe(
      'VERSION_NOT_DRAFT',
    );
  });
});
