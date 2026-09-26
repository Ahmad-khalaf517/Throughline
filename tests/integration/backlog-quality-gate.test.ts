import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';
import type { JsonValue } from './support/types';

// backlog.qualityGate (TR FR-063; Module Boundaries 4.4's backlog
// subsection) - a real-DB integration test rather than a pure unit test
// (tests/unit/artifact-types/backlog.test.ts covers outputSchema/
// toCandidates/buildPrompt) because this function's whole job is reading
// already-persisted `semantic_dependency`/`item_version`/
// `artifact_version_item_membership` rows, per this story's own
// instructions. Follows tests/integration/artifact-lifecycle-item-edit.test.ts's
// scaffolding (fixture helpers only - no shortcut around the real triggers/
// CHECKs/FKs).
//
// Two of FR-063's five checks - "source item does not exist" and "source
// reference points to an invalid project/version" - are not exercised here:
// both are DB-enforced structurally impossible to construct through the
// real fixtures (`semantic_dependency`'s own composite FKs force both ends
// into the same project and a real, existing `item_version` row - ERD
// 4.11/`throughline-lineage-invariants`), so a test that tried to build
// either scenario would just fail on a foreign-key violation before ever
// reaching `qualityGate`. `identity.getUpstreamDependencies`'s own doc
// comment (src/lineage/identity/references.ts) explains why those two
// checks are implemented as genuinely defensive reads anyway.

let sql: postgres.Sql;
let backlog: typeof import('@/artifact-types/backlog');
let identity: typeof import('@/lineage/identity');

beforeAll(async () => {
  sql = connect();
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  backlog = await import('@/artifact-types/backlog');
  identity = await import('@/lineage/identity');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('backlog.qualityGate (TR FR-063)', () => {
  it('flags a Story with no acceptance criteria, a Story with no source Requirement, and a Requirement with no implementation Story - and leaves a well-formed pair unflagged', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);

    // R-01 will have an implementing Story; R-02 will not.
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
    const requirementsVersionId = await fx.createDraftArtifactVersion(sql, requirementsId);
    const r1 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: requirementsId,
      itemType: 'requirement',
      displayKey: 'R-01',
    });
    const r2 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: requirementsId,
      itemType: 'requirement',
      displayKey: 'R-02',
    });
    for (const r of [r1, r2]) {
      await fx.createMembership(sql, {
        artifactVersionId: requirementsVersionId,
        artifactId: requirementsId,
        logicalItemId: r.logicalItemId,
        itemVersionId: r.itemVersionId,
      });
    }
    await fx.approveArtifactVersion(sql, requirementsVersionId);

    const backlogId = await fx.createArtifact(sql, projectId, 'backlog');
    const backlogVersionId = await fx.createDraftArtifactVersion(sql, backlogId, {
      payload: { summary: 'v1' },
    });

    const epic = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogId,
      itemType: 'epic',
    });
    await fx.createMembership(sql, {
      artifactVersionId: backlogVersionId,
      artifactId: backlogId,
      logicalItemId: epic.logicalItemId,
      itemVersionId: epic.itemVersionId,
    });

    // S-01: has acceptance criteria and a source Requirement (R-01) - no issues.
    const storyOk = await fx.createLogicalItem(sql, {
      projectId,
      artifactId: backlogId,
      itemType: 'story',
    });
    const storyOkPayload = {
      userValueStatement: 'As a reader, I want search, so that I can find articles.',
      acceptanceCriteria: ['Loads within 2s'],
      structuredBehavior: 'Typing a query filters the list.',
    };
    const storyOkItemVersionId = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: storyOk.id,
      payload: storyOkPayload,
      semanticHash: identity.semanticHash('story', storyOkPayload, [r1.itemVersionId]),
    });
    await fx.createMembership(sql, {
      artifactVersionId: backlogVersionId,
      artifactId: backlogId,
      logicalItemId: storyOk.id,
      itemVersionId: storyOkItemVersionId,
      parentLogicalItemId: epic.logicalItemId,
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: storyOkItemVersionId,
      upstreamItemVersionId: r1.itemVersionId,
    });

    // S-02: no acceptance criteria and no upstream Requirement at all - both
    // "Story has no acceptance criteria" and "Story has no source Requirement"
    // should fire.
    const storyBad = await fx.createLogicalItem(sql, {
      projectId,
      artifactId: backlogId,
      itemType: 'story',
    });
    const storyBadPayload = {
      userValueStatement: 'As a reader, I want something else.',
      acceptanceCriteria: [] as string[],
      structuredBehavior: 'Undecided.',
    };
    const storyBadItemVersionId = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: storyBad.id,
      payload: storyBadPayload,
      semanticHash: identity.semanticHash('story', storyBadPayload, []),
    });
    await fx.createMembership(sql, {
      artifactVersionId: backlogVersionId,
      artifactId: backlogId,
      logicalItemId: storyBad.id,
      itemVersionId: storyBadItemVersionId,
      parentLogicalItemId: epic.logicalItemId,
    });

    const issues = await backlog.qualityGate(backlogVersionId);

    expect(issues).toEqual(
      expect.arrayContaining([
        {
          code: 'story_no_acceptance_criteria',
          message: `${storyBad.displayKey} has no acceptance criteria`,
          logicalItemId: storyBad.id,
        },
        {
          code: 'story_no_source_requirement',
          message: `${storyBad.displayKey} has no source Requirement`,
          logicalItemId: storyBad.id,
        },
        {
          code: 'requirement_no_implementation_story',
          message: `${r2.displayKey} has no implementation Story in this Backlog version`,
          logicalItemId: r2.logicalItemId,
        },
      ]),
    );
    // Exactly those three - the well-formed Story and its Requirement (R-01)
    // are not flagged by any check.
    expect(issues).toHaveLength(3);
    expect(issues.some((issue) => issue.logicalItemId === storyOk.id)).toBe(false);
    expect(
      issues.some(
        (issue) =>
          issue.code === 'requirement_no_implementation_story' &&
          issue.logicalItemId === r1.logicalItemId,
      ),
    ).toBe(false);
  });
});

// --- "Requirement has no implementation Story" semantics (E3-S9 review
// fixes): compared by LOGICAL item, and constraint Requirements exempt. ------

async function createRequirement(
  projectId: string,
  artifactId: string,
  displayKey: string,
  payload: JsonValue,
) {
  const logical = await fx.createLogicalItem(sql, {
    projectId,
    artifactId,
    itemType: 'requirement',
    displayKey,
  });
  const itemVersionId = await fx.createItemVersion(sql, {
    projectId,
    logicalItemId: logical.id,
    payload,
  });
  return { logicalItemId: logical.id, displayKey, itemVersionId };
}

async function approveRequirementsVersion(
  requirementsId: string,
  versionNumber: number,
  members: { logicalItemId: string; itemVersionId: string }[],
): Promise<string> {
  const versionId = await fx.createDraftArtifactVersion(sql, requirementsId, { versionNumber });
  for (const member of members) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId: requirementsId,
      logicalItemId: member.logicalItemId,
      itemVersionId: member.itemVersionId,
    });
  }
  await fx.approveArtifactVersion(sql, versionId);
  return versionId;
}

// A Backlog draft holding one Epic and one well-formed Story (has acceptance
// criteria) whose only upstream edge is to `boundRequirementItemVersionId`.
async function backlogWithStoryBoundTo(projectId: string, boundRequirementItemVersionId: string) {
  const backlogId = await fx.createArtifact(sql, projectId, 'backlog');
  const backlogVersionId = await fx.createDraftArtifactVersion(sql, backlogId, {
    payload: { summary: 'v1' },
  });
  const epic = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: backlogId,
    itemType: 'epic',
  });
  await fx.createMembership(sql, {
    artifactVersionId: backlogVersionId,
    artifactId: backlogId,
    logicalItemId: epic.logicalItemId,
    itemVersionId: epic.itemVersionId,
  });
  const story = await fx.createLogicalItem(sql, {
    projectId,
    artifactId: backlogId,
    itemType: 'story',
  });
  const storyItemVersionId = await fx.createItemVersion(sql, {
    projectId,
    logicalItemId: story.id,
    payload: {
      userValueStatement: 'As a reader, I want search.',
      acceptanceCriteria: ['Loads within 2s'],
      structuredBehavior: 'Typing a query filters the list.',
    },
  });
  await fx.createMembership(sql, {
    artifactVersionId: backlogVersionId,
    artifactId: backlogId,
    logicalItemId: story.id,
    itemVersionId: storyItemVersionId,
    parentLogicalItemId: epic.logicalItemId,
  });
  await fx.createSemanticDependency(sql, {
    projectId,
    downstreamItemVersionId: storyItemVersionId,
    upstreamItemVersionId: boundRequirementItemVersionId,
  });
  return { backlogVersionId, story };
}

describe('backlog.qualityGate: "Requirement has no implementation Story" semantics (FR-063)', () => {
  it("compares by LogicalItem: a Story bound to an OLDER ItemVersion of a still-current Requirement is not reported (staleness is the impact engine's job, INV-025)", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');

    // R-01@A (revision 1), approved as Requirements v1 ...
    const r1 = await createRequirement(projectId, requirementsId, 'R-01', { type: 'functional' });
    const requirementsV1 = await approveRequirementsVersion(requirementsId, 1, [r1]);

    // ... the Story is written against R-01@A ...
    const { backlogVersionId } = await backlogWithStoryBoundTo(projectId, r1.itemVersionId);

    // ... then Requirements moves on: v2 holds a NEW ItemVersion (revision 2)
    // of the SAME LogicalItem, and v1 is superseded.
    await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${requirementsV1}`;
    const r1Newer = await fx.createItemVersion(sql, {
      projectId,
      logicalItemId: r1.logicalItemId,
      revisionNumber: 2,
      payload: { type: 'functional' },
    });
    await approveRequirementsVersion(requirementsId, 2, [
      { logicalItemId: r1.logicalItemId, itemVersionId: r1Newer },
    ]);

    // By ItemVersion id this would wrongly say R-01 has no Story, while
    // story_no_source_requirement (which sees the edge to a requirement-typed
    // upstream) correctly stays quiet - an internally inconsistent gate.
    expect(await backlog.qualityGate(backlogVersionId)).toEqual([]);
  });

  it('exempts constraint-type Requirements from the missing-Story flag, but still flags an unreferenced functional one', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');

    const referenced = await createRequirement(projectId, requirementsId, 'R-01', {
      type: 'functional',
    });
    const constraint = await createRequirement(projectId, requirementsId, 'R-02', {
      type: 'constraint',
      dimension: 'deadline',
      value: '2026-12-01',
    });
    const unreferencedFunctional = await createRequirement(projectId, requirementsId, 'R-03', {
      type: 'functional',
    });
    await approveRequirementsVersion(requirementsId, 1, [
      referenced,
      constraint,
      unreferencedFunctional,
    ]);

    const { backlogVersionId } = await backlogWithStoryBoundTo(projectId, referenced.itemVersionId);

    expect(await backlog.qualityGate(backlogVersionId)).toEqual([
      {
        code: 'requirement_no_implementation_story',
        message: 'R-03 has no implementation Story in this Backlog version',
        logicalItemId: unreferencedFunctional.logicalItemId,
      },
    ]);
  });
});
