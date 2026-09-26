import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import type { OptionInput } from '@/architecture-materialization';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

let sql: postgres.Sql;
let architecture: typeof import('@/artifact-types/architecture');
let lifecycle: typeof import('@/artifact-lifecycle');
let impact: typeof import('@/lineage/impact');

beforeAll(async () => {
  sql = connect();
  process.env.DATABASE_URL = inject('pgConnectionUri');
  process.env.DIRECT_DATABASE_URL = inject('pgConnectionUri');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  architecture = await import('@/artifact-types/architecture');
  lifecycle = await import('@/artifact-lifecycle');
  impact = await import('@/lineage/impact');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

function option(
  decisions: string[],
  refs: string[] = [],
  stack: Record<string, unknown> = { database: 'postgres', frontend: 'react' },
): OptionInput {
  return {
    title: 'Architecture',
    summary: 'Project-specific approach',
    stack,
    tradeoffs: [{ factor: 'deadline', assessment: 'Use the existing team skills' }],
    candidateDecisions: decisions.map((decision) => ({
      title: decision,
      decision,
      technologyOrApproach: 'implementation',
      constraints: [],
      significantTradeoffs: [],
      upstreamRefs: refs,
    })),
  };
}

async function setup() {
  const { projectId, userId } = await fx.createProjectWithOwner(sql);
  const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
  const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
  const requirement = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: requirementsId,
    itemType: 'requirement',
    displayKey: 'R-01',
  });
  const requirementsVersionId = await fx.createDraftArtifactVersion(sql, requirementsId);
  await fx.createMembership(sql, {
    artifactVersionId: requirementsVersionId,
    artifactId: requirementsId,
    ...requirement,
  });
  await lifecycle.approveVersion(requirementsVersionId, userId);
  return { projectId, userId, artifactId, requirementsId, requirementsVersionId, requirement };
}

async function draft(artifactId: string, sourceId: string, number = 1, base: string | null = null) {
  const [row] = await sql<{ id: string }[]>`
    insert into artifact_version (artifact_id, version_number, status, schema_version, payload, base_approved_version_id)
    values (${artifactId}, ${number}, 'draft', 1, '{}', ${base}) returning id
  `;
  const id = row!.id;
  await sql`insert into generation_context_ref (target_artifact_version_id, source_artifact_version_id) values (${id}, ${sourceId})`;
  return id;
}

async function members(versionId: string) {
  return sql<
    {
      logical_item_id: string;
      item_version_id: string;
      display_key: string;
      revision_number: number;
    }[]
  >`
    select m.logical_item_id, m.item_version_id, l.display_key, i.revision_number
    from artifact_version_item_membership m join logical_item l on l.id = m.logical_item_id
    join item_version i on i.id = m.item_version_id
    where m.artifact_version_id = ${versionId} order by l.display_key
  `;
}

async function counts(projectId: string) {
  const [row] = await sql`
    select (select count(*)::int from logical_item where project_id = ${projectId}) as logical,
           (select count(*)::int from item_version where project_id = ${projectId}) as versions,
           (select count(*)::int from semantic_dependency where project_id = ${projectId}) as edges,
           (select count(*)::int from impact_acknowledgement where project_id = ${projectId}) as acknowledgements
  `;
  return row;
}

describe('architecture materialization (FR-020/021/022; ERD 3.4/5.5)', () => {
  it('T8/T9: only the selected option mints ADRs; reuse, revise, removal and downstream impact retain identity', async () => {
    const f = await setup();
    const v1 = await draft(f.artifactId, f.requirementsVersionId);
    const before = await counts(f.projectId);
    const [a, b] = await architecture.createOptions(v1, [
      option(['one', 'two', 'three', 'four'], ['R-01']),
      option(['five', 'six', 'seven', 'eight'], ['R-01']),
    ]);
    expect(a!.optionKey).toBe('A');
    expect(b!.optionKey).toBe('B');
    expect(await counts(f.projectId)).toEqual(before);
    expect(await members(v1)).toEqual([]);
    await architecture.selectOption(v1, b!.id);
    expect(await architecture.getSelectedOption(v1)).toBeNull();
    // Selection stays request scoped: the earlier validation of B cannot replace A here.
    expect(await architecture.approveVersion(v1, f.userId, a!.id)).toEqual({ ok: true });
    const base = await members(v1);
    expect(base.map((item) => item.display_key)).toEqual(['ADR-01', 'ADR-02', 'ADR-03', 'ADR-04']);
    expect((await architecture.getSelectedOption(v1))?.option.id).toBe(a!.id);
    expect(await architecture.getArchitectureDecisionItems(v1)).toHaveLength(4);

    const backlogId = await fx.createArtifact(sql, f.projectId, 'backlog');
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId: f.projectId,
      artifactId: backlogId,
      itemType: 'story',
    });
    const backlog = await fx.createDraftArtifactVersion(sql, backlogId);
    await fx.createMembership(sql, { artifactVersionId: backlog, artifactId: backlogId, ...story });
    await fx.createSemanticDependency(sql, {
      projectId: f.projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: base[3]!.item_version_id,
    });
    expect(await lifecycle.approveVersion(backlog, f.userId)).toEqual({ ok: true });

    const v2 = await draft(f.artifactId, f.requirementsVersionId, 2, v1);
    const selected = option(['one', 'two', 'three changed'], ['R-01']);
    selected.candidateDecisions.forEach((decision, index) => {
      decision.previousDisplayKey = `ADR-0${index + 1}`;
    });
    const [, next] = await architecture.createOptions(v2, [
      option(['five', 'six', 'seven', 'eight']),
      selected,
    ]);
    expect(await architecture.approveVersion(v2, f.userId, next!.id)).toEqual({ ok: true });
    const result = await members(v2);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(base[0]);
    expect(result[1]).toEqual(base[1]);
    expect(result[2]).toMatchObject({
      logical_item_id: base[2]!.logical_item_id,
      display_key: 'ADR-03',
      revision_number: 2,
    });
    expect(result[2]!.item_version_id).not.toBe(base[2]!.item_version_id);
    const keys = await sql<
      { display_key: string }[]
    >`select display_key from logical_item where artifact_id = ${f.artifactId} order by display_key`;
    expect(keys.map((row) => row.display_key)).toEqual(['ADR-01', 'ADR-02', 'ADR-03', 'ADR-04']);
    expect(
      (await impact.getWarnings(f.projectId)).find((row) => row.subjectId === story.itemVersionId),
    ).toMatchObject({ rootItemVersionId: base[3]!.item_version_id, acknowledged: false });
    await expect(architecture.createOptions(v2, [selected, selected])).rejects.toThrow(
      'architecture draft',
    );
    await expect(
      sql`update architecture_option set title = 'mutated' where id = ${next!.id}`,
    ).rejects.toThrow();
  });

  it('T9: rejects missing/foreign selection and one or three options without minting items', async () => {
    const f = await setup();
    const v = await draft(f.artifactId, f.requirementsVersionId);
    const before = await counts(f.projectId);
    await expect(
      architecture.createOptions(v, [option(['one'])] as unknown as [OptionInput, OptionInput]),
    ).rejects.toMatchObject({ code: 'OPTION_COUNT_INVALID' });
    await expect(
      architecture.createOptions(v, [
        option(['one']),
        option(['two']),
        option(['three']),
      ] as unknown as [OptionInput, OptionInput]),
    ).rejects.toMatchObject({ code: 'OPTION_COUNT_INVALID' });
    const only = await fx.createArchitectureOption(sql, { artifactVersionId: v, optionKey: 'A' });
    expect(await architecture.approveVersion(v, f.userId, only)).toMatchObject({
      ok: false,
      code: 'OPTION_COUNT_INVALID',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: v, optionKey: 'B' });
    expect(await architecture.approveVersion(v, f.userId)).toMatchObject({
      ok: false,
      code: 'OPTION_NOT_SELECTED',
    });
    const other = await setup();
    const foreignDraft = await draft(other.artifactId, other.requirementsVersionId);
    const [foreign] = await architecture.createOptions(foreignDraft, [
      option(['foreign']),
      option(['alternative']),
    ]);
    expect(await architecture.approveVersion(v, f.userId, foreign!.id)).toMatchObject({
      ok: false,
      code: 'OPTION_NOT_SELECTED',
    });
    expect(
      await architecture.approveWithOverride(v, f.userId, 'Review complete', foreign!.id),
    ).toMatchObject({ ok: false, code: 'OPTION_NOT_SELECTED' });
    await expect(
      architecture.createOptions(v, [option(['one']), option(['two'])]),
    ).rejects.toMatchObject({ code: 'OPTION_COUNT_INVALID' });
    expect(await counts(f.projectId)).toEqual(before);
    expect(await members(v)).toEqual([]);
    const nonArchitecture = await fx.createDraftArtifactVersion(sql, f.requirementsId, {
      versionNumber: 2,
    });
    await expect(
      architecture.createOptions(nonArchitecture, [option(['one']), option(['two'])]),
    ).rejects.toThrow('architecture draft');
  });

  it('T30: all reused decisions require a deep-equal stack on normal and override approval', async () => {
    const f = await setup();
    const v1 = await draft(f.artifactId, f.requirementsVersionId);
    const [first] = await architecture.createOptions(v1, [
      option(['one'], ['R-01']),
      option(['unused']),
    ]);
    await architecture.approveVersion(v1, f.userId, first!.id);
    const v2 = await draft(f.artifactId, f.requirementsVersionId, 2, v1);
    const [changed, equal] = await architecture.createOptions(v2, [
      option(['one'], ['R-01'], { database: 'mysql', frontend: 'react' }),
      option(['one'], ['R-01'], { frontend: 'react', database: 'postgres' }),
    ]);
    const before = await counts(f.projectId);
    for (const approve of [
      () => architecture.approveVersion(v2, f.userId, changed!.id),
      () => architecture.approveWithOverride(v2, f.userId, 'Reviewed', changed!.id),
    ]) {
      expect(await approve()).toEqual({
        ok: false,
        code: 'STACK_UNCHANGED_DECISIONS',
        blocking: [],
      });
      expect(await counts(f.projectId)).toEqual(before);
      expect(await members(v2)).toEqual([]);
      expect(await architecture.getSelectedOption(v2)).toBeNull();
    }
    expect(await architecture.approveVersion(v2, f.userId, equal!.id)).toEqual({ ok: true });
    expect(await members(v2)).toEqual(await members(v1));
  });

  it('T9/FR-083/FR-084/INV-006: binds captured Requirements, rolls back blocked ADRs, then override rematerializes without orphans', async () => {
    const f = await setup();
    const v = await draft(f.artifactId, f.requirementsVersionId);
    const [selected] = await architecture.createOptions(v, [
      option(['chosen'], ['R-01']),
      option(['unused']),
    ]);
    const requirementV2 = await fx.createItemVersion(sql, {
      projectId: f.projectId,
      logicalItemId: f.requirement.logicalItemId,
      revisionNumber: 2,
    });
    const reqV2 = await fx.createDraftArtifactVersion(sql, f.requirementsId, { versionNumber: 2 });
    await fx.createMembership(sql, {
      artifactVersionId: reqV2,
      artifactId: f.requirementsId,
      logicalItemId: f.requirement.logicalItemId,
      itemVersionId: requirementV2,
    });
    await lifecycle.approveVersion(reqV2, f.userId);
    const before = await counts(f.projectId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(await architecture.approveVersion(v, f.userId, selected!.id)).toMatchObject({
        ok: false,
        blocking: [{ rootItemVersionId: f.requirement.itemVersionId }],
      });
      expect(await counts(f.projectId)).toEqual(before);
      expect(await members(v)).toEqual([]);
      expect(await architecture.getSelectedOption(v)).toBeNull();
    }
    await expect(architecture.approveWithOverride(v, f.userId, ' ', selected!.id)).rejects.toThrow(
      'non-empty',
    );
    expect(
      await architecture.approveWithOverride(
        v,
        f.userId,
        'Reviewed the superseded requirement',
        selected!.id,
      ),
    ).toEqual({ ok: true });
    const [adr] = await members(v);
    expect(adr!.display_key).toBe('ADR-01');
    const edges = await sql<
      { upstream_item_version_id: string }[]
    >`select upstream_item_version_id from semantic_dependency where downstream_item_version_id = ${adr!.item_version_id}`;
    expect(edges).toEqual([{ upstream_item_version_id: f.requirement.itemVersionId }]);
    const after = await counts(f.projectId);
    expect(after).toMatchObject({
      logical: before!.logical + 1,
      versions: before!.versions + 1,
      edges: before!.edges + 1,
      acknowledgements: before!.acknowledgements + 1,
    });
    const events =
      await sql`select overrode_stale_check, feedback from approval_event where artifact_version_id = ${v}`;
    expect(events).toEqual([
      { overrode_stale_check: true, feedback: 'Reviewed the superseded requirement' },
    ]);
    expect(
      (await impact.getWarnings(f.projectId)).find((row) => row.subjectId === adr!.item_version_id)
        ?.acknowledged,
    ).toBe(true);
  });

  it('T9/INV-006: refuses a reference outside recorded source membership', async () => {
    const f = await setup();
    const v = await draft(f.artifactId, f.requirementsVersionId);
    const later = await fx.createLogicalItemWithVersion(sql, {
      projectId: f.projectId,
      artifactId: f.requirementsId,
      itemType: 'requirement',
      displayKey: 'R-02',
    });
    const reqV2 = await fx.createDraftArtifactVersion(sql, f.requirementsId, { versionNumber: 2 });
    await fx.createMembership(sql, {
      artifactVersionId: reqV2,
      artifactId: f.requirementsId,
      ...later,
    });
    await lifecycle.approveVersion(reqV2, f.userId);
    const [selected] = await architecture.createOptions(v, [
      option(['bad ref'], ['R-02']),
      option(['unused']),
    ]);
    const before = await counts(f.projectId);
    await expect(architecture.approveVersion(v, f.userId, selected!.id)).rejects.toThrow(
      'Unresolved upstream reference: R-02',
    );
    expect(await counts(f.projectId)).toEqual(before);
    expect(await members(v)).toEqual([]);
  });
});
