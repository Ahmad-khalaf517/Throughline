import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// ERD T45 / FR-086..088: six artifact slots, exact document sources, and a
// source-currentness check that prevents approval of an obsolete draft.
let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');

beforeAll(async () => {
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  sql = connect();
  lifecycle = await import('@/artifact-lifecycle');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('T45 generated BRD and ERD artifact slots', () => {
  it('creates six slots and rejects an unknown type', async () => {
    const userId = await fx.createAppUser(sql);
    const project = await lifecycle.createProject(userId, 'T45 slots', 'A project brief');
    const rows = await sql<{ type: string }[]>`
      SELECT type FROM artifact WHERE project_id = ${project.id} ORDER BY type
    `;
    expect(rows.map((row) => row.type)).toEqual([
      'architecture',
      'backlog',
      'brd',
      'erd',
      'requirements',
      'ui_requirements',
    ]);
    await expect(sql`
      INSERT INTO artifact (project_id, type) VALUES (${project.id}, 'unknown')
    `).rejects.toThrow();
  });

  it('marks a BRD source change and refuses approval of its obsolete draft', async () => {
    const userId = await fx.createAppUser(sql);
    const project = await lifecycle.createProject(userId, 'T45 currentness', 'Another brief');
    const requirementsRows = await sql<{ id: string }[]>`
      SELECT id FROM artifact WHERE project_id = ${project.id} AND type = 'requirements'
    `;
    const requirementsId = requirementsRows[0]!.id;
    const brdRows = await sql<{ id: string }[]>`
      SELECT id FROM artifact WHERE project_id = ${project.id} AND type = 'brd'
    `;
    const brdId = brdRows[0]!.id;
    const requirementsV1 = await fx.createDraftArtifactVersion(sql, requirementsId);
    await fx.approveArtifactVersion(sql, requirementsV1);
    const brdV1 = await fx.createDraftArtifactVersion(sql, brdId);
    await sql`
      INSERT INTO generation_context_ref (target_artifact_version_id, source_artifact_version_id)
      VALUES (${brdV1}, ${requirementsV1})
    `;
    expect(await lifecycle.getDocumentSourceCurrentness(brdV1)).toBe(true);

    const requirementsV2 = await fx.createDraftArtifactVersion(sql, requirementsId, {
      versionNumber: 2,
    });
    await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${requirementsV1}`;
    await fx.approveArtifactVersion(sql, requirementsV2);
    expect(await lifecycle.getDocumentSourceCurrentness(brdV1)).toBe(false);
    await expect(lifecycle.approveVersion(brdV1, userId)).rejects.toBeInstanceOf(
      lifecycle.DocumentSourceChangedError,
    );
  });

  it('tracks both ERD source versions without minting lineage items', async () => {
    const userId = await fx.createAppUser(sql);
    const project = await lifecycle.createProject(userId, 'T45 ERD', 'An ERD brief');
    const artifacts = await sql<{ id: string; type: string }[]>`
      SELECT id, type FROM artifact WHERE project_id = ${project.id}
    `;
    const artifactId = (type: string) => artifacts.find((entry) => entry.type === type)!.id;
    const requirementsV1 = await fx.createDraftArtifactVersion(sql, artifactId('requirements'));
    await fx.approveArtifactVersion(sql, requirementsV1);
    const architectureV1 = await fx.createDraftArtifactVersion(sql, artifactId('architecture'));
    const optionA = await fx.createArchitectureOption(sql, {
      artifactVersionId: architectureV1,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: architectureV1, optionKey: 'B' });
    await fx.approveArtifactVersion(sql, architectureV1, { selectedArchitectureOptionId: optionA });

    const erdV1 = await fx.createDraftArtifactVersion(sql, artifactId('erd'));
    await sql`
      INSERT INTO generation_context_ref (target_artifact_version_id, source_artifact_version_id)
      VALUES (${erdV1}, ${requirementsV1}), (${erdV1}, ${architectureV1})
    `;
    expect(await lifecycle.getDocumentSourceCurrentness(erdV1)).toBe(true);
    expect(await lifecycle.approveVersion(erdV1, userId)).toEqual({ ok: true });
    const items = await sql<{ count: string }[]>`
      SELECT count(*) FROM artifact_version_item_membership WHERE artifact_version_id = ${erdV1}
    `;
    expect(Number(items[0]!.count)).toBe(0);

    await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${architectureV1}`;
    expect(await lifecycle.getDocumentSourceCurrentness(erdV1)).toBe(false);
  });
});
