import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

type DbModule = typeof import('@/db');
type IdentityModule = typeof import('@/lineage/identity');

let sql: postgres.Sql;
let dbModule: DbModule;
let identity: IdentityModule;

beforeAll(async () => {
  sql = connect();
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  dbModule = await import('@/db');
  identity = await import('@/lineage/identity');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function draftFromBase(
  artifactId: string,
  baseVersionId: string,
  versionNumber: number,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO artifact_version (artifact_id, version_number, status, schema_version, base_approved_version_id)
    VALUES (${artifactId}, ${versionNumber}, 'draft', 1, ${baseVersionId})
    RETURNING id
  `;
  return rows[0]!.id;
}

describe('identity.matchAndPersistItems (ERD 5.3-5.4; INV-010/011/012/014/016)', () => {
  it('T32 rejects duplicate claims before inserts and preserves base-only reuse and revisions', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const firstDraftId = await fx.createDraftArtifactVersion(sql, artifactId);
    const originalA = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View report',
      constraints: [],
      acceptanceCriteria: ['Readable report'],
    };
    const originalB = {
      type: 'functional',
      actor: 'Manager',
      behavior: 'Export report',
      constraints: [],
      acceptanceCriteria: ['CSV'],
    };
    const first = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId,
        draftVersionId: firstDraftId,
        baseVersionId: null,
        itemType: 'requirement',
        candidates: [
          { payload: originalA, upstreamRefs: [] },
          { payload: originalB, upstreamRefs: [] },
        ],
        boundUpstream: new Map(),
      }),
    );
    expect(first.every((item) => item.isNew)).toBe(true);
    await fx.approveArtifactVersion(sql, firstDraftId);

    // A historical key outside the comparison base still reserves its number.
    await fx.createLogicalItem(sql, {
      projectId,
      artifactId,
      itemType: 'requirement',
      displayKey: 'R-90',
    });
    const secondDraftId = await draftFromBase(artifactId, firstDraftId, 2);
    const secondOptions = {
      projectId,
      artifactId,
      draftVersionId: secondDraftId,
      baseVersionId: firstDraftId,
      itemType: 'requirement' as const,
      boundUpstream: new Map<string, string>(),
    };
    const duplicate = [
      { previousDisplayKey: 'R-01', payload: originalA, upstreamRefs: [] },
      { previousDisplayKey: 'R-01', payload: originalA, upstreamRefs: [] },
    ];
    await dbModule.withProjectLock(projectId, async (tx) => {
      const before = {
        logicalItems: (await tx.select().from(dbModule.schema.logicalItem)).length,
        itemVersions: (await tx.select().from(dbModule.schema.itemVersion)).length,
        dependencies: (await tx.select().from(dbModule.schema.semanticDependency)).length,
        memberships: (await tx.select().from(dbModule.schema.artifactVersionItemMembership)).length,
      };
      await expect(
        identity.matchAndPersistItems(tx, { ...secondOptions, candidates: duplicate }),
      ).rejects.toThrow('Duplicate previousDisplayKey');
      expect({
        logicalItems: (await tx.select().from(dbModule.schema.logicalItem)).length,
        itemVersions: (await tx.select().from(dbModule.schema.itemVersion)).length,
        dependencies: (await tx.select().from(dbModule.schema.semanticDependency)).length,
        memberships: (await tx.select().from(dbModule.schema.artifactVersionItemMembership)).length,
      }).toEqual(before);
    });

    const changedB = { ...originalB, behavior: 'Export selected report' };
    const second = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        ...secondOptions,
        candidates: [
          {
            previousDisplayKey: 'R-01',
            payload: { ...originalA, actor: ' analyst ', explanation: 'new prose' },
            upstreamRefs: [],
          },
          { previousDisplayKey: 'R-02', payload: changedB, upstreamRefs: [] },
          {
            previousDisplayKey: 'invalid-key',
            payload: { ...originalA, behavior: 'Audit report' },
            upstreamRefs: [],
          },
        ],
      }),
    );
    expect(second[0]).toEqual({ ...first[0], isNew: false });
    expect(second[1]?.logicalItemId).toBe(first[1]?.logicalItemId);
    expect(second[1]?.itemVersionId).not.toBe(first[1]?.itemVersionId);
    expect(second[1]?.isNew).toBe(false);
    expect(second[2]?.isNew).toBe(true);
    const newKey = await sql<
      { display_key: string }[]
    >`SELECT display_key FROM logical_item WHERE id = ${second[2]!.logicalItemId}`;
    expect(newKey[0]?.display_key).toBe('R-91');
    const secondRevision = await sql<
      { revision_number: number }[]
    >`SELECT revision_number FROM item_version WHERE id = ${second[1]!.itemVersionId}`;
    expect(secondRevision[0]?.revision_number).toBe(2);

    await sql.begin(async (tx) => {
      await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${firstDraftId}`;
      await fx.approveArtifactVersion(tx, secondDraftId);
    });
    const thirdDraftId = await draftFromBase(artifactId, secondDraftId, 3);
    const reverted = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        ...secondOptions,
        draftVersionId: thirdDraftId,
        baseVersionId: secondDraftId,
        candidates: [{ previousDisplayKey: 'R-02', payload: originalB, upstreamRefs: [] }],
      }),
    );
    expect(reverted[0]?.logicalItemId).toBe(first[1]?.logicalItemId);
    expect(reverted[0]?.itemVersionId).not.toBe(first[1]?.itemVersionId);
    const thirdRevision = await sql<
      { revision_number: number }[]
    >`SELECT revision_number FROM item_version WHERE id = ${reverted[0]!.itemVersionId}`;
    expect(thirdRevision[0]?.revision_number).toBe(3);
  });

  it('T31 keeps an ADR and its downstream current when its key is omitted, with explicit claims taking precedence', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirementsDraftId = await fx.createDraftArtifactVersion(sql, requirementsId);
    const requirements = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId: requirementsId,
        draftVersionId: requirementsDraftId,
        baseVersionId: null,
        itemType: 'requirement',
        candidates: [
          { payload: { type: 'functional', behavior: 'Record work' }, upstreamRefs: [] },
          { payload: { type: 'functional', behavior: 'Review work' }, upstreamRefs: [] },
        ],
        boundUpstream: new Map(),
      }),
    );
    await fx.approveArtifactVersion(sql, requirementsDraftId);

    const architectureId = await fx.createArtifact(sql, projectId, 'architecture');
    const firstDraftId = await fx.createDraftArtifactVersion(sql, architectureId);
    const adr = { decision: 'Use queues', technologyOrApproach: 'Postgres queue' };
    const otherAdr = { decision: 'Use cache', technologyOrApproach: 'Redis' };
    const boundUpstream = new Map([['R-01', requirements[0]!.itemVersionId]]);
    const first = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId: architectureId,
        draftVersionId: firstDraftId,
        baseVersionId: null,
        itemType: 'architecture_decision',
        candidates: [
          { payload: adr, upstreamRefs: ['R-01'] },
          { payload: otherAdr, upstreamRefs: ['R-01'] },
        ],
        boundUpstream,
      }),
    );
    const firstOption = await fx.createArchitectureOption(sql, {
      artifactVersionId: firstDraftId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: firstDraftId, optionKey: 'B' });
    await fx.approveArtifactVersion(sql, firstDraftId, {
      selectedArchitectureOptionId: firstOption,
    });

    const uiArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const uiDraftId = await fx.createDraftArtifactVersion(sql, uiArtifactId);
    const uiItem = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: uiArtifactId,
      itemType: 'ui_requirement',
    });
    await fx.createMembership(sql, {
      artifactVersionId: uiDraftId,
      artifactId: uiArtifactId,
      logicalItemId: uiItem.logicalItemId,
      itemVersionId: uiItem.itemVersionId,
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: uiItem.itemVersionId,
      upstreamItemVersionId: first[0]!.itemVersionId,
    });
    await fx.approveArtifactVersion(sql, uiDraftId);

    const secondDraftId = await draftFromBase(architectureId, firstDraftId, 2);
    const second = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId: architectureId,
        draftVersionId: secondDraftId,
        baseVersionId: firstDraftId,
        itemType: 'architecture_decision',
        candidates: [
          { payload: adr, upstreamRefs: ['R-01'] },
          { previousDisplayKey: 'ADR-02', payload: otherAdr, upstreamRefs: ['R-01'] },
        ],
        boundUpstream,
      }),
    );
    expect(second).toEqual(first.map((item) => ({ ...item, isNew: false })));
    const keys = await sql<{ display_key: string }[]>`
      SELECT display_key FROM logical_item WHERE artifact_id = ${architectureId} ORDER BY display_key
    `;
    expect(keys.map((row) => row.display_key)).toEqual(['ADR-01', 'ADR-02']);
    const secondOption = await fx.createArchitectureOption(sql, {
      artifactVersionId: secondDraftId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: secondDraftId, optionKey: 'B' });
    await sql.begin(async (tx) => {
      await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${firstDraftId}`;
      await fx.approveArtifactVersion(tx, secondDraftId, {
        selectedArchitectureOptionId: secondOption,
      });
    });
    const warnings = await sql<
      { subject_id: string }[]
    >`SELECT subject_id FROM impact(${projectId}::uuid)`;
    expect(warnings).toHaveLength(0);

    const thirdDraftId = await draftFromBase(architectureId, secondDraftId, 3);
    const third = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId: architectureId,
        draftVersionId: thirdDraftId,
        baseVersionId: secondDraftId,
        itemType: 'architecture_decision',
        candidates: [
          { payload: otherAdr, upstreamRefs: ['R-01'] },
          { previousDisplayKey: 'ADR-02', payload: otherAdr, upstreamRefs: ['R-01'] },
          { previousDisplayKey: 'invalid', payload: adr, upstreamRefs: ['R-02'] },
        ],
        boundUpstream: new Map([
          ['R-01', requirements[0]!.itemVersionId],
          ['R-02', requirements[1]!.itemVersionId],
        ]),
      }),
    );
    expect(third[0]?.isNew).toBe(true);
    expect(third[1]).toEqual({ ...first[1], isNew: false });
    expect(third[2]?.logicalItemId).toBe(first[0]?.logicalItemId);
    expect(third[2]?.itemVersionId).not.toBe(first[0]?.itemVersionId);
    expect(third[2]?.isNew).toBe(false);
    const edges = await sql<{ upstream_item_version_id: string }[]>`
      SELECT upstream_item_version_id FROM semantic_dependency
      WHERE downstream_item_version_id = ${third[2]!.itemVersionId}
    `;
    expect(edges[0]?.upstream_item_version_id).toBe(requirements[1]?.itemVersionId);
  });

  it('INV-014 creates a new identity for ambiguous matches and does not match another item type', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'backlog');
    const firstDraftId = await fx.createDraftArtifactVersion(sql, artifactId);
    const payload = {
      title: 'Reports',
      scopeStatement: 'See reports',
      userValueStatement: 'See reports',
      acceptanceCriteria: [],
      structuredBehavior: {},
    };
    const first = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId,
        draftVersionId: firstDraftId,
        baseVersionId: null,
        itemType: 'epic',
        candidates: [
          { payload, upstreamRefs: [] },
          { payload, upstreamRefs: [] },
        ],
        boundUpstream: new Map(),
      }),
    );
    await fx.approveArtifactVersion(sql, firstDraftId);
    const secondDraftId = await draftFromBase(artifactId, firstDraftId, 2);
    const ambiguous = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId,
        draftVersionId: secondDraftId,
        baseVersionId: firstDraftId,
        itemType: 'epic',
        candidates: [{ payload, upstreamRefs: [] }],
        boundUpstream: new Map(),
      }),
    );
    expect(ambiguous[0]?.isNew).toBe(true);
    expect(first.map((item) => item.logicalItemId)).not.toContain(ambiguous[0]?.logicalItemId);
    const story = await dbModule.withProjectLock(projectId, (tx) =>
      identity.matchAndPersistItems(tx, {
        projectId,
        artifactId,
        draftVersionId: secondDraftId,
        baseVersionId: firstDraftId,
        itemType: 'story',
        candidates: [{ payload, upstreamRefs: [] }],
        boundUpstream: new Map(),
      }),
    );
    expect(story[0]?.isNew).toBe(true);
    expect(first.map((item) => item.logicalItemId)).not.toContain(story[0]?.logicalItemId);
  });
});
