import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Tx } from '@/db';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

type DbModule = typeof import('@/db');
type BindingModule = typeof import('@/lineage/dependency-binding');
type IdentityModule = typeof import('@/lineage/identity');

let sql: postgres.Sql;
let dbModule: DbModule;
let binding: BindingModule;
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
  binding = await import('@/lineage/dependency-binding');
  identity = await import('@/lineage/identity');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function bindUpstreamRefs(
  tx: Tx,
  opts: { contextSourceVersionIds: string[]; candidates: { upstreamRefs: string[] }[] },
) {
  const members = await identity.getSourceVersionMembers(tx, opts.contextSourceVersionIds);
  return binding.bindUpstreamRefs({ members, candidates: opts.candidates });
}

async function checkFreshness(
  tx: Tx,
  opts: { artifactId: string; baseVersionId: string | null; boundUpstream: Map<string, string> },
) {
  const [artifact] = await tx
    .select({ projectId: dbModule.schema.artifact.projectId })
    .from(dbModule.schema.artifact)
    .where(eq(dbModule.schema.artifact.id, opts.artifactId));
  if (!artifact) throw new Error('Unknown artifact');
  const [approved] = await tx
    .select({ id: dbModule.schema.artifactVersion.id })
    .from(dbModule.schema.artifactVersion)
    .where(
      and(
        eq(dbModule.schema.artifactVersion.artifactId, opts.artifactId),
        eq(dbModule.schema.artifactVersion.status, 'approved'),
      ),
    );
  const currentItemVersionIds = await identity.getCurrentItemVersionIds(tx, artifact.projectId, [
    ...opts.boundUpstream.values(),
  ]);
  return binding.checkFreshness({
    approvedVersionId: approved?.id ?? null,
    baseVersionId: opts.baseVersionId,
    boundUpstream: opts.boundUpstream,
    currentItemVersionIds,
  });
}

describe('dependency binding (ERD 3.3, 6.1; INV-006)', () => {
  it('binds only captured membership and detects revised and removed upstream items', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const sourceArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const targetArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const sourceV1 = await fx.createDraftArtifactVersion(sql, sourceArtifactId);
    const reused = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: sourceArtifactId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    const revised = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: sourceArtifactId,
      itemType: 'requirement',
      displayKey: 'R-02',
    });
    const removed = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: sourceArtifactId,
      itemType: 'requirement',
      displayKey: 'R-03',
    });
    for (const item of [reused, revised, removed]) {
      await fx.createMembership(sql, {
        artifactVersionId: sourceV1,
        artifactId: sourceArtifactId,
        logicalItemId: item.logicalItemId,
        itemVersionId: item.itemVersionId,
      });
    }
    await fx.approveArtifactVersion(sql, sourceV1);

    const refs = await dbModule.withTx((tx) =>
      bindUpstreamRefs(tx, {
        contextSourceVersionIds: [sourceV1],
        candidates: [{ upstreamRefs: ['R-01', 'R-02', 'R-03'] }],
      }),
    );
    expect(refs).toEqual(
      new Map([
        ['R-01', reused.itemVersionId],
        ['R-02', revised.itemVersionId],
        ['R-03', removed.itemVersionId],
      ]),
    );
    await expect(
      dbModule.withTx((tx) =>
        bindUpstreamRefs(tx, {
          contextSourceVersionIds: [sourceV1],
          candidates: [{ upstreamRefs: ['R-99'] }],
        }),
      ),
    ).rejects.toThrow('Unresolved upstream reference: R-99');
    await expect(
      dbModule.withTx((tx) =>
        bindUpstreamRefs(tx, {
          contextSourceVersionIds: [randomUUID()],
          candidates: [{ upstreamRefs: ['R-01'] }],
        }),
      ),
    ).rejects.toThrow('Unknown context source version');
    expect(
      await dbModule.withTx((tx) =>
        checkFreshness(tx, {
          artifactId: targetArtifactId,
          baseVersionId: null,
          boundUpstream: refs,
        }),
      ),
    ).toEqual({ stale: false });

    const sourceV2 = await fx.createDraftArtifactVersion(sql, sourceArtifactId, {
      versionNumber: 2,
    });
    const revisedV2 = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: revised.logicalItemId,
      revisionNumber: 2,
    });
    for (const [logicalItemId, itemVersionId] of [
      [reused.logicalItemId, reused.itemVersionId],
      [revised.logicalItemId, revisedV2],
    ] as const) {
      await fx.createMembership(sql, {
        artifactVersionId: sourceV2,
        artifactId: sourceArtifactId,
        logicalItemId,
        itemVersionId,
      });
    }
    await sql.begin(async (tx) => {
      await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${sourceV1}`;
      await fx.approveArtifactVersion(tx, sourceV2);
    });
    expect(
      await dbModule.withTx((tx) =>
        bindUpstreamRefs(tx, {
          contextSourceVersionIds: [sourceV1],
          candidates: [{ upstreamRefs: ['R-02'] }],
        }),
      ),
    ).toEqual(new Map([['R-02', revised.itemVersionId]]));
    expect(
      await dbModule.withTx((tx) =>
        checkFreshness(tx, {
          artifactId: targetArtifactId,
          baseVersionId: null,
          boundUpstream: new Map([['R-01', reused.itemVersionId]]),
        }),
      ),
    ).toEqual({ stale: false });
    for (const item of [revised, removed]) {
      expect(
        await dbModule.withTx((tx) =>
          checkFreshness(tx, {
            artifactId: targetArtifactId,
            baseVersionId: null,
            boundUpstream: new Map([[item.displayKey, item.itemVersionId]]),
          }),
        ),
      ).toEqual({ stale: true, reason: 'dependency_superseded' });
    }
  });

  it('detects changed bases and rejects ambiguous or cross-project source scopes', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const sourceArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const targetArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const sourceV1 = await fx.createDraftArtifactVersion(sql, sourceArtifactId);
    const sourceItem = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: sourceArtifactId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    await fx.createMembership(sql, {
      artifactVersionId: sourceV1,
      artifactId: sourceArtifactId,
      logicalItemId: sourceItem.logicalItemId,
      itemVersionId: sourceItem.itemVersionId,
    });
    await fx.approveArtifactVersion(sql, sourceV1);
    const targetV1 = await fx.createDraftArtifactVersion(sql, targetArtifactId);
    await fx.approveArtifactVersion(sql, targetV1);
    expect(
      await dbModule.withTx((tx) =>
        checkFreshness(tx, {
          artifactId: targetArtifactId,
          baseVersionId: null,
          boundUpstream: new Map(),
        }),
      ),
    ).toEqual({ stale: true, reason: 'base_changed' });
    expect(
      await dbModule.withTx((tx) =>
        checkFreshness(tx, {
          artifactId: targetArtifactId,
          baseVersionId: targetV1,
          boundUpstream: new Map(),
        }),
      ),
    ).toEqual({ stale: false });

    const sourceV2 = await fx.createDraftArtifactVersion(sql, sourceArtifactId, {
      versionNumber: 2,
    });
    const sourceRevision = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: sourceItem.logicalItemId,
      revisionNumber: 2,
    });
    await fx.createMembership(sql, {
      artifactVersionId: sourceV2,
      artifactId: sourceArtifactId,
      logicalItemId: sourceItem.logicalItemId,
      itemVersionId: sourceRevision,
    });
    await expect(
      dbModule.withTx((tx) =>
        bindUpstreamRefs(tx, {
          contextSourceVersionIds: [sourceV1, sourceV2],
          candidates: [{ upstreamRefs: ['R-01'] }],
        }),
      ),
    ).rejects.toThrow('Context source version was never approved');
    await sql.begin(async (tx) => {
      await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${sourceV1}`;
      await fx.approveArtifactVersion(tx, sourceV2);
    });
    await expect(
      dbModule.withTx((tx) =>
        bindUpstreamRefs(tx, {
          contextSourceVersionIds: [sourceV1, sourceV2],
          candidates: [{ upstreamRefs: ['R-01'] }],
        }),
      ),
    ).rejects.toThrow('Ambiguous upstream reference: R-01');

    const { projectId: otherProjectId } = await fx.createProjectWithOwner(sql);
    const otherArtifactId = await fx.createArtifact(sql, otherProjectId, 'requirements');
    const otherV1 = await fx.createDraftArtifactVersion(sql, otherArtifactId);
    const otherItem = await fx.createLogicalItemWithVersion(sql, {
      projectId: otherProjectId,
      artifactId: otherArtifactId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    await fx.createMembership(sql, {
      artifactVersionId: otherV1,
      artifactId: otherArtifactId,
      logicalItemId: otherItem.logicalItemId,
      itemVersionId: otherItem.itemVersionId,
    });
    await fx.approveArtifactVersion(sql, otherV1);
    await expect(
      dbModule.withTx((tx) =>
        bindUpstreamRefs(tx, {
          contextSourceVersionIds: [sourceV2, otherV1],
          candidates: [{ upstreamRefs: ['R-01'] }],
        }),
      ),
    ).rejects.toThrow('Context source versions cross projects');
  });
});
