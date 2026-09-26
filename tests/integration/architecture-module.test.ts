import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

let sql: postgres.Sql;
let architecture: typeof import('@/artifact-types/architecture');

beforeAll(async () => {
  sql = connect();
  process.env.DATABASE_URL = inject('pgConnectionUri');
  process.env.DIRECT_DATABASE_URL = inject('pgConnectionUri');
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  architecture = await import('@/artifact-types/architecture');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// What a structured-output response looks like on the wire, before the module's
// own schema has seen it - deliberately `unknown`, not the inferred type.
function modelOutput(): unknown {
  const stack = (frontend: string, database: string) => ({
    frontend,
    backend: 'node service',
    database,
    hosting: 'managed cloud',
    repositoryLayout: 'single repo',
  });
  const decision = (title: string, technologyOrApproach: string, upstreamRefs: string[]) => ({
    previousDisplayKey: null,
    title,
    decision: `Use ${technologyOrApproach} for ${title.toLowerCase()}.`,
    technologyOrApproach,
    constraints: [],
    significantTradeoffs: ['Ties the team to one vendor'],
    upstreamRefs,
  });
  return {
    payload: { summary: 'A monolith and a split-service alternative' },
    optionA: {
      title: 'Monolith',
      summary: 'One deployable unit.',
      stack: stack('react', 'postgresql'),
      tradeoffs: [
        { factor: 'delivery deadline', assessment: 'One unit fits the deadline (R-01).' },
      ],
      candidateDecisions: [
        decision('Persistence', 'postgresql', ['R-01']),
        decision('Deployment', 'a single container', ['R-01']),
      ],
    },
    optionB: {
      title: 'Services',
      summary: 'Two services behind a gateway.',
      stack: stack('vue', 'mysql'),
      tradeoffs: [{ factor: 'scale', assessment: 'Independent scaling helps the load (R-01).' }],
      candidateDecisions: [decision('Persistence', 'mysql', ['R-01'])],
    },
  };
}

async function bindToRequirements(draftId: string, requirementsVersionId: string) {
  await sql`
    insert into generation_context_ref (target_artifact_version_id, source_artifact_version_id)
    values (${draftId}, ${requirementsVersionId})
  `;
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
  await fx.approveArtifactVersion(sql, requirementsVersionId);
  // The architecture draft as createDraftFromGeneration leaves it: a draft
  // bound to the approved Requirements version the model was shown.
  const draftId = await fx.createDraftArtifactVersion(sql, artifactId);
  await bindToRequirements(draftId, requirementsVersionId);
  return { projectId, userId, artifactId, requirementsVersionId, draftId };
}

async function selectedOptionId(versionId: string) {
  const [row] = await sql<{ selected_architecture_option_id: string | null }[]>`
    select selected_architecture_option_id from artifact_version where id = ${versionId}
  `;
  return row!.selected_architecture_option_id;
}

describe('architecture module: generated options end to end (FR-020, FR-021)', () => {
  it('FR-020/FR-021: schema-parsed model output persists exactly two options keyed A then B, with the stack descriptor', async () => {
    const { draftId } = await setup();
    const parsed = architecture.outputSchema.parse(modelOutput());
    // Decisions are not lineage while the version is a draft (FR-020 last line).
    expect(architecture.toCandidates(parsed)).toEqual([]);

    const created = await architecture.createOptions(draftId, architecture.toOptionInputs(parsed));
    expect(created.map((row) => row.optionKey)).toEqual(['A', 'B']);

    const rows = await sql<
      {
        option_key: string;
        title: string;
        stack: Record<string, string>;
        candidate_decisions: unknown;
        tradeoffs: unknown;
      }[]
    >`
      select option_key, title, stack, candidate_decisions, tradeoffs
      from architecture_option where artifact_version_id = ${draftId} order by option_key
    `;
    expect(rows.map((row) => [row.option_key, row.title])).toEqual([
      ['A', 'Monolith'],
      ['B', 'Services'],
    ]);
    for (const row of rows) {
      expect(Object.keys(row.stack).sort()).toEqual([
        'backend',
        'database',
        'frontend',
        'hosting',
        'repositoryLayout',
      ]);
    }
    expect(rows[0]!.stack).toEqual(parsed.optionA.stack);
    expect(rows[1]!.stack).toEqual(parsed.optionB.stack);
    expect(rows[0]!.candidate_decisions).toEqual(parsed.optionA.candidateDecisions);
    expect(rows[1]!.tradeoffs).toEqual(parsed.optionB.tradeoffs);
  });

  it('FR-021: selectOption resolves for a valid option id and writes nothing to the draft', async () => {
    const { draftId } = await setup();
    const [a, b] = await architecture.createOptions(
      draftId,
      architecture.toOptionInputs(architecture.outputSchema.parse(modelOutput())),
    );
    expect(await selectedOptionId(draftId)).toBeNull();

    await expect(architecture.selectOption(draftId, b!.id)).resolves.toBeUndefined();
    await expect(architecture.selectOption(draftId, a!.id)).resolves.toBeUndefined();
    // Selection is request-scoped until approval (ERD 3.4/5.5): nothing stored.
    expect(await selectedOptionId(draftId)).toBeNull();
    const [count] = await sql<
      { n: number }[]
    >`select count(*)::int as n from architecture_option where artifact_version_id = ${draftId}`;
    expect(count!.n).toBe(2);
  });

  it('FR-021: selectOption rejects an option id that belongs to a different version with OPTION_NOT_SELECTED', async () => {
    const mine = await setup();
    const other = await setup();
    await architecture.createOptions(
      mine.draftId,
      architecture.toOptionInputs(architecture.outputSchema.parse(modelOutput())),
    );
    const [foreign] = await architecture.createOptions(
      other.draftId,
      architecture.toOptionInputs(architecture.outputSchema.parse(modelOutput())),
    );

    for (const optionId of [foreign!.id, randomUUID()]) {
      const error = await architecture
        .selectOption(mine.draftId, optionId)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(architecture.ArchitectureOptionError);
      expect(error).toMatchObject({ code: 'OPTION_NOT_SELECTED' });
    }
    expect(await selectedOptionId(mine.draftId)).toBeNull();
  });

  it('FR-020/FR-022: only the selected option materializes ADR items; approval records the selection', async () => {
    const f = await setup();
    const parsed = architecture.outputSchema.parse(modelOutput());
    const [, b] = await architecture.createOptions(f.draftId, architecture.toOptionInputs(parsed));

    // Select optionB (a single "Persistence"/mysql decision) - optionA's two
    // decisions must never become items (FR-020's "only the selected option's
    // candidate decisions become ADR items").
    expect(await architecture.approveVersion(f.draftId, f.userId, b!.id)).toEqual({ ok: true });
    expect(await selectedOptionId(f.draftId)).toBe(b!.id);

    const items = await architecture.getArchitectureDecisionItems(f.draftId);
    expect(items).toHaveLength(parsed.optionB.candidateDecisions.length);
    // materialize.ts strips previousDisplayKey/upstreamRefs off the decision
    // before storing it as the ItemVersion payload (they are matching-hint
    // metadata, not part of the semantic projection payload).
    expect(items.map((item) => item.payload)).toEqual(
      parsed.optionB.candidateDecisions.map(
        ({ previousDisplayKey: _hint, upstreamRefs: _refs, ...payload }) => payload,
      ),
    );
    const [adrCount] = await sql<{ n: number }[]>`
      select count(*)::int as n from logical_item
      where artifact_id = ${f.artifactId} and item_type = 'architecture_decision'
    `;
    // Exactly optionB's decision count - none of optionA's ever materialized.
    expect(adrCount!.n).toBe(parsed.optionB.candidateDecisions.length);
  });

  it('FR-022/INV-016: an unchanged decision, resubmitted with previousDisplayKey and the same upstream and stack, reuses its ItemVersion on regeneration', async () => {
    const f = await setup();
    const v1 = architecture.outputSchema.parse(modelOutput());
    const [, selected1] = await architecture.createOptions(
      f.draftId,
      architecture.toOptionInputs(v1),
    );
    expect(await architecture.approveVersion(f.draftId, f.userId, selected1!.id)).toEqual({
      ok: true,
    });
    const [before] = await architecture.getArchitectureDecisionItems(f.draftId);
    expect(before!.displayKey).toBe('ADR-01');

    // A second draft, bound to the same approved Requirements version (context
    // unchanged) - the ERD 3.3 shape createDraftFromGeneration would leave.
    const [v2Row] = await sql<{ id: string }[]>`
      insert into artifact_version
        (artifact_id, version_number, status, schema_version, payload, base_approved_version_id)
      values (${f.artifactId}, 2, 'draft', 1, '{}', ${f.draftId})
      returning id
    `;
    const v2 = v2Row!.id;
    await bindToRequirements(v2, f.requirementsVersionId);

    // Resubmit optionB's decision verbatim (content, upstreamRefs and stack
    // all unchanged) with previousDisplayKey set to the ADR it was approved
    // as - exactly what buildPrompt's regenerate branch asks the model for.
    const regenerated = architecture.outputSchema.parse({
      ...v1,
      optionB: {
        ...v1.optionB,
        candidateDecisions: v1.optionB.candidateDecisions.map((decision) => ({
          ...decision,
          previousDisplayKey: 'ADR-01',
        })),
      },
    });
    const [, selected2] = await architecture.createOptions(
      v2,
      architecture.toOptionInputs(regenerated),
    );
    expect(await architecture.approveVersion(v2, f.userId, selected2!.id)).toEqual({ ok: true });

    const [after] = await architecture.getArchitectureDecisionItems(v2);
    expect(after!.itemVersionId).toBe(before!.itemVersionId);
    expect(after!.logicalItemId).toBe(before!.logicalItemId);
    expect(after!.displayKey).toBe('ADR-01');
  });
});
