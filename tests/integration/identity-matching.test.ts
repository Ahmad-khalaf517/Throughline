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

describe('identity.matchAndPersistItems (ERD 5.3-5.4; INV-010/011/012/016)', () => {
  it('claims base keys before writes, reuses unchanged versions, allocates revisions and never reuses an older reverted version', async () => {
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
      await expect(
        identity.matchAndPersistItems(tx, { ...secondOptions, candidates: duplicate }),
      ).rejects.toThrow('Duplicate previousDisplayKey');
      const rows = await tx.select().from(dbModule.schema.artifactVersionItemMembership);
      expect(rows.filter((row) => row.artifactVersionId === secondDraftId)).toHaveLength(0);
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
});
