import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';
// Type-only import: erased entirely at compile time, so this does not
// trigger `@/artifact-types/ui-requirements`'s real (env-dependent) module
// evaluation ahead of the `beforeAll` dynamic `import()` below - same
// gotcha this file's other modules avoid by importing dynamically at all.
import type { UiRequirementItem, UiRequirementsOutput } from '@/artifact-types/ui-requirements';

// artifact-types/ui-requirements.toCandidates through the real
// artifact-lifecycle.createDraftFromGeneration pipeline (TR FR-040, ERD 5.3-
// 5.4, Jira E3-S8/SCRUM-43) - proving toCandidates' output is actually a
// valid identity.Candidate[] end to end: real display-key allocation
// (UI-01..), real semantic_dependency edges to the bound upstream
// ItemVersions, and real ItemVersion reuse on an unchanged regeneration. The
// model call itself is a deterministic in-process fake (same technique
// tests/integration/artifact-lifecycle-generation.test.ts and appendix-c.test.ts's
// generateRequirements use) - this file is not proving buildPrompt produces a
// real LLM-shaped response, only that outputSchema-shaped data survives
// toCandidates -> matchAndPersistItems intact.

type LifecycleModule = typeof import('@/artifact-lifecycle');
type UiRequirementsModule = typeof import('@/artifact-types/ui-requirements');

let sql: postgres.Sql;
let lifecycle: LifecycleModule;
let uiRequirements: UiRequirementsModule;

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
  uiRequirements = await import('@/artifact-types/ui-requirements');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

async function membership(uiArtifactId: string, versionId: string) {
  return sql<{ logical_item_id: string; item_version_id: string; display_key: string }[]>`
    SELECT m.logical_item_id, m.item_version_id, li.display_key
    FROM artifact_version_item_membership m
    JOIN logical_item li ON li.id = m.logical_item_id
    WHERE m.artifact_version_id = ${versionId} AND m.artifact_id = ${uiArtifactId}
    ORDER BY li.display_key
  `;
}

async function dependencyEdges(downstreamItemVersionId: string) {
  return sql<{ upstream_item_version_id: string }[]>`
    SELECT upstream_item_version_id FROM semantic_dependency
    WHERE downstream_item_version_id = ${downstreamItemVersionId}
  `;
}

describe('ui-requirements.toCandidates through createDraftFromGeneration (TR FR-040, ERD 5.3-5.4)', () => {
  it('mints UI-.. items bound to R-01/ADR-01, then reuses ItemVersions on an unchanged regeneration', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql);

    // Seed an approved Requirements version with one item, R-01.
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirementsDraftId = await fx.createDraftArtifactVersion(sql, requirementsArtifactId);
    const requirement = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: requirementsArtifactId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    await fx.createMembership(sql, {
      artifactVersionId: requirementsDraftId,
      artifactId: requirementsArtifactId,
      logicalItemId: requirement.logicalItemId,
      itemVersionId: requirement.itemVersionId,
    });
    await fx.approveArtifactVersion(sql, requirementsDraftId);

    // Seed an approved Architecture version with one ADR, ADR-01 (materialized
    // at approval in the real system - src/architecture-materialization is
    // E3-S1's job, out of scope here; the fixture mints the ADR LogicalItem
    // directly, same shortcut tests/integration/lineage/impact.test.ts and
    // appendix-c.test.ts's approveItemsVersion already take).
    const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const architectureDraftId = await fx.createDraftArtifactVersion(sql, architectureArtifactId);
    const adr = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: architectureArtifactId,
      itemType: 'architecture_decision',
      displayKey: 'ADR-01',
    });
    await fx.createMembership(sql, {
      artifactVersionId: architectureDraftId,
      artifactId: architectureArtifactId,
      logicalItemId: adr.logicalItemId,
      itemVersionId: adr.itemVersionId,
    });
    const architectureOptionId = await fx.createArchitectureOption(sql, {
      artifactVersionId: architectureDraftId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, {
      artifactVersionId: architectureDraftId,
      optionKey: 'B',
    });
    await fx.approveArtifactVersion(sql, architectureDraftId, {
      selectedArchitectureOptionId: architectureOptionId,
    });

    const uiArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');

    // A hand-built, outputSchema-valid UI Requirements output whose items cite
    // R-01/ADR-01 - run through the real toCandidates, not a hand-rolled
    // Candidate[], so this test proves toCandidates' own field mapping too.
    function buildOutput(explanation: string): {
      payload: UiRequirementsOutput['payload'];
      items: UiRequirementItem[];
    } {
      const parsed = uiRequirements.outputSchema.parse({
        payload: {
          targetUsers: ['Project managers'],
          navigationExpectations: 'A persistent sidebar links every screen.',
          rtlLocalizationRequirements: [],
          uxPriorities: ['Clarity over density'],
        },
        items: [
          {
            displayKey: 'UI-01',
            previousDisplayKey: null,
            screenOrFlow: 'Dashboard',
            interactionRequirement: 'User views a summary of open items.',
            responsiveConstraints: ['Collapses to a single column below 768px'],
            accessibilityConstraints: ['All summary cards are keyboard-focusable'],
            upstreamRefs: ['R-01', 'ADR-01'],
            explanation,
          },
        ],
      });
      return parsed;
    }

    const firstResult = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiArtifactId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [requirementsDraftId, architectureDraftId],
      actorUserId: userId,
      generate: async (ctx) => {
        expect(ctx.baseVersionId).toBeNull();
        const output = buildOutput('First pass explanation.');
        const runId = await fx.createAiGenerationRun(sql, { projectId });
        return {
          payload: output.payload,
          candidates: uiRequirements.toCandidates(output.items),
          runId,
        };
      },
    });

    expect(firstResult.stale).toBe(false);
    expect(firstResult.version.status).toBe('draft');

    const firstMembers = await membership(uiArtifactId, firstResult.version.id);
    expect(firstMembers).toHaveLength(1);
    expect(firstMembers[0]?.display_key).toBe('UI-01');

    const firstItemVersionId = firstMembers[0]!.item_version_id;
    const edges = await dependencyEdges(firstItemVersionId);
    expect(edges.map((e) => e.upstream_item_version_id).sort()).toEqual(
      [requirement.itemVersionId, adr.itemVersionId].sort(),
    );

    // Approve the first draft, then regenerate with the SAME content (only
    // `explanation` differs, and `previousDisplayKey` now points at UI-01) -
    // ERD 5.4's regeneration-stability contract: the ItemVersion must be
    // reused, not re-minted.
    await fx.approveArtifactVersion(sql, firstResult.version.id);

    const secondResult = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiArtifactId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [requirementsDraftId, architectureDraftId],
      actorUserId: userId,
      generate: async (ctx) => {
        expect(ctx.baseVersionId).toBe(firstResult.version.id);
        const output = buildOutput('Reworded explanation, same content.');
        output.items[0]!.previousDisplayKey = 'UI-01';
        const runId = await fx.createAiGenerationRun(sql, { projectId });
        return {
          payload: output.payload,
          candidates: uiRequirements.toCandidates(output.items),
          runId,
        };
      },
    });

    expect(secondResult.stale).toBe(false);
    const secondMembers = await membership(uiArtifactId, secondResult.version.id);
    expect(secondMembers).toHaveLength(1);
    expect(secondMembers[0]?.display_key).toBe('UI-01');
    expect(secondMembers[0]?.logical_item_id).toBe(firstMembers[0]?.logical_item_id);
    expect(secondMembers[0]?.item_version_id).toBe(firstItemVersionId);
  });
});
