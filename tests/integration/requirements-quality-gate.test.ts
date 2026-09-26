import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import type { RequirementItem, RequirementsPayload } from '@/artifact-types/requirements';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// artifact-types/requirements.qualityGate (TR FR-012; Jira E3-S6 / SCRUM-41)
// against a real database: drafts are minted through the real
// createDraftFromGeneration path (requirements.toCandidates -> identity
// match/persist), so the gate reads exactly what generation persisted. The
// rules themselves are covered exhaustively, without a database, in
// tests/unit/artifact-types/requirements.test.ts - this file only proves the
// loading glue (members via identity, payload via artifact-lifecycle, the
// LEFT JOIN quirk of an empty version, the wrong-artifact-type refusal) and
// that the gate writes nothing.

type LifecycleModule = typeof import('@/artifact-lifecycle');
type RequirementsModule = typeof import('@/artifact-types/requirements');

let sql: postgres.Sql;
let lifecycle: LifecycleModule;
let requirements: RequirementsModule;

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
  requirements = await import('@/artifact-types/requirements');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

const GOOD_PAYLOAD: RequirementsPayload = {
  businessProblem: 'Teams cannot tell which downstream work is stale.',
  actors: ['Reviewer'],
  assumptions: [],
  unresolvedQuestions: [],
  userJourneys: [],
};

function requirement(overrides: Partial<RequirementItem> = {}): RequirementItem {
  return {
    displayKey: 'R-01',
    previousDisplayKey: null,
    type: 'functional',
    actor: 'Reviewer',
    behavior: 'Approve a draft.',
    constraints: [],
    acceptanceCriteria: ['The approval is recorded.'],
    dimension: null,
    value: null,
    explanation: 'Free prose.',
    ...overrides,
  };
}

async function seedRequirementsDraft(items: RequirementItem[], payload: RequirementsPayload) {
  const { userId, projectId } = await fx.createProjectWithOwner(sql);
  const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
  const result = await lifecycle.createDraftFromGeneration({
    projectId,
    artifactId,
    itemType: 'requirement',
    contextSourceVersionIds: [],
    actorUserId: userId,
    generate: async () => ({
      payload,
      candidates: requirements.toCandidates(items),
      runId: await fx.createAiGenerationRun(sql, { projectId }),
    }),
  });
  expect(result.stale).toBe(false);

  const rows = await sql<{ id: string; behavior: string }[]>`
    SELECT li.id, iv.payload->>'behavior' AS behavior
    FROM artifact_version_item_membership m
    JOIN logical_item li ON li.id = m.logical_item_id
    JOIN item_version iv ON iv.id = m.item_version_id
    WHERE m.artifact_version_id = ${result.version.id}
  `;
  const idByBehavior = new Map(rows.map((row) => [row.behavior, row.id]));
  return {
    projectId,
    versionId: result.version.id,
    logicalItemId(behavior: string): string {
      const id = idByBehavior.get(behavior);
      if (!id) throw new Error(`no minted item with behavior "${behavior}"`);
      return id;
    },
  };
}

async function snapshot(projectId: string) {
  const versions =
    await sql`SELECT v.* FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id WHERE a.project_id = ${projectId} ORDER BY v.id`;
  const items = await sql`SELECT * FROM item_version WHERE project_id = ${projectId} ORDER BY id`;
  const members =
    await sql`SELECT m.* FROM artifact_version_item_membership m JOIN artifact a ON a.id = m.artifact_id WHERE a.project_id = ${projectId} ORDER BY m.artifact_version_id, m.logical_item_id`;
  return { versions: [...versions], items: [...items], members: [...members] };
}

describe('requirements.qualityGate (FR-012)', () => {
  it('returns [] for a well-formed generated draft', async () => {
    const draft = await seedRequirementsDraft(
      [
        requirement({ behavior: 'Approve a draft.' }),
        requirement({ type: 'non_functional', behavior: 'Load a review page within 2 seconds.' }),
        requirement({
          type: 'constraint',
          behavior: 'Stay within the launch scale.',
          dimension: 'scale',
          value: '5,000 concurrent users',
        }),
      ],
      GOOD_PAYLOAD,
    );

    await expect(requirements.qualityGate(draft.versionId)).resolves.toEqual([]);
  });

  it('reports item and payload issues against the right logical items, and writes nothing', async () => {
    const draft = await seedRequirementsDraft(
      [
        requirement({ behavior: 'Export the audit log.', acceptanceCriteria: [] }),
        requirement({ behavior: 'Stay consistent with R-99.' }),
        requirement({ behavior: 'Approve a draft.' }),
      ],
      { ...GOOD_PAYLOAD, unresolvedQuestions: ['Is multi-region required?'] },
    );
    const before = await snapshot(draft.projectId);

    const issues = await requirements.qualityGate(draft.versionId);

    expect(issues).toHaveLength(3);
    expect(issues).toEqual(
      expect.arrayContaining([
        {
          code: 'MISSING_ACCEPTANCE_CRITERIA',
          message: expect.stringContaining('has no acceptance criteria'),
          logicalItemId: draft.logicalItemId('Export the audit log.'),
        },
        {
          code: 'INVALID_REFERENCE',
          message: expect.stringContaining('R-99'),
          logicalItemId: draft.logicalItemId('Stay consistent with R-99.'),
        },
        {
          code: 'UNRESOLVED_ASSUMPTION',
          message: 'Unresolved question: "Is multi-region required?"',
          logicalItemId: null,
        },
      ]),
    );
    // Payload-level issues come after every per-item issue.
    expect(issues.at(-1)?.code).toBe('UNRESOLVED_ASSUMPTION');

    expect(await snapshot(draft.projectId)).toEqual(before);
  });

  it('handles a version with no members (the LEFT JOIN yields one all-null row)', async () => {
    for (const [payload, expectedCodes] of [
      [GOOD_PAYLOAD, []],
      [{}, ['REQUIRED_FIELD_MISSING']],
    ] as const) {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { payload });

      const issues = await requirements.qualityGate(versionId);
      expect(issues.map((issue) => issue.code)).toEqual(expectedCodes);
      expect(issues.every((issue) => issue.logicalItemId === null)).toBe(true);
    }
  });

  it('rejects an unknown version id', async () => {
    await expect(requirements.qualityGate(randomUUID())).rejects.toThrow(
      'Unknown context source version',
    );
  });

  it('rejects, rather than reporting an issue, for a version of another artifact type', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
    const item = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'ui_requirement',
    });
    await fx.createMembership(sql, { artifactVersionId: versionId, artifactId, ...item });

    await expect(requirements.qualityGate(versionId)).rejects.toThrow(/not a requirement/);
  });
});
