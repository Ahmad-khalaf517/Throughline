import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import type { BacklogItem, EpicItem, StoryItem } from '@/artifact-types/backlog';
import { connect } from './support/connection';
import * as fx from './support/fixtures';

// artifact-lifecycle.createDraftFromGeneration x backlog.toCandidates - the
// Epic+Story two-item-type minting design decision (generation.ts's
// groupCandidatesByType/ITEM_TYPE_MINT_ORDER, matcher.ts's Candidate.itemType)
// and the Epic/Story PARENT RESOLUTION it carries (matcher.ts's
// Candidate.outputKey; generation.ts's resolveEpicLabels/rewriteStoryParents),
// exercised end to end for real: the actual `createDraftFromGeneration` (not
// a raw membership insert) and the actual `identity.matchAndPersistItems`,
// called twice (epic group, then story group) inside ONE persist transaction
// against ONE draft `artifact_version` row - not a re-implementation of
// either.
//
// Same fake-`generate`-callback technique
// tests/integration/appendix-c.test.ts's own `generateRequirements` helper
// uses for its real T1-T5/T21/T31/T32/T43 assertions (a deterministic,
// in-process candidate set instead of a real LLM call - only
// scripts/verify-real-generation-t21.ts spends a real OpenAI completion).
//
// tests/integration/backlog-quality-gate.test.ts (a sibling file) instead
// builds Backlog membership directly via fx.createLogicalItem/
// createItemVersion/createMembership - deliberately, since qualityGate only
// needs realistic *persisted rows*, not a real mint. THIS file is the one
// that proves the mint itself.
//
// Why parent resolution needs its own tests: a Story's `parentDisplayKey`
// out of `backlog.toCandidates` is the model's own OUTPUT-LOCAL Epic label
// (the `displayKey` of an Epic in that same response), not a real
// `logical_item.display_key`. matcher.ts allocates every new item's real key
// itself (project-wide max suffix + 1, counting replaced/removed items too),
// so label and real key coincide only in a fresh project's first generation.
// Tests below cover both the coinciding case (first test) and the two ways
// they drift apart: a replaced draft (A) and a regeneration against an
// approved base with a new Epic inserted mid-list (B) - including the
// silent-wrong-parent variant, where a Story's label equals a DIFFERENT
// Epic's real key.

type LifecycleModule = typeof import('@/artifact-lifecycle');
type BacklogModule = typeof import('@/artifact-types/backlog');

let sql: postgres.Sql;
let lifecycle: LifecycleModule;
let backlog: BacklogModule;

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
  backlog = await import('@/artifact-types/backlog');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// --- Item builders. Epic content is a pure function of its title and Story
// content a pure function of its statement, so "the same item regenerated
// unchanged" is expressible by reusing the same title/statement under a
// different label - which is exactly the label-drift case under test.

function epic(label: string, title: string, previousDisplayKey: string | null = null): EpicItem {
  return {
    kind: 'epic',
    displayKey: label,
    previousDisplayKey,
    title,
    scopeStatement: `Scope of ${title}`,
    explanation: `Explains ${title}`,
  };
}

function story(
  label: string,
  parentLabel: string,
  statement: string,
  previousDisplayKey: string | null = null,
): StoryItem {
  return {
    kind: 'story',
    displayKey: label,
    previousDisplayKey,
    parentDisplayKey: parentLabel,
    userValueStatement: statement,
    acceptanceCriteria: ['Works'],
    structuredBehavior: `Behavior of ${statement}`,
    priority: 'medium',
    upstreamRefs: ['R-01'],
    explanation: `Explains ${statement}`,
  };
}

// --- Scenario setup: approved Requirements (R-01) + Architecture (ADR-01) +
// UI Requirements (UI-01) via fixtures (same as backlog-quality-gate.test.ts)
// - realistic FR-080 prerequisites, even though createDraftFromGeneration
// itself never checks generation order (that's each artifact-type module's
// own generate(), see backlog/index.ts's header comment) - plus a Backlog
// artifact with no version yet.

async function setupProject() {
  const { userId, projectId } = await fx.createProjectWithOwner(sql);

  const requirementsId = await fx.createArtifact(sql, projectId, 'requirements');
  const requirementsVersionId = await fx.createDraftArtifactVersion(sql, requirementsId);
  const r1 = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: requirementsId,
    itemType: 'requirement',
    displayKey: 'R-01',
  });
  await fx.createMembership(sql, {
    artifactVersionId: requirementsVersionId,
    artifactId: requirementsId,
    logicalItemId: r1.logicalItemId,
    itemVersionId: r1.itemVersionId,
  });
  await fx.approveArtifactVersion(sql, requirementsVersionId);

  const architectureId = await fx.createArtifact(sql, projectId, 'architecture');
  const architectureVersionId = await fx.createDraftArtifactVersion(sql, architectureId);
  const adr1 = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: architectureId,
    itemType: 'architecture_decision',
    displayKey: 'ADR-01',
  });
  await fx.createMembership(sql, {
    artifactVersionId: architectureVersionId,
    artifactId: architectureId,
    logicalItemId: adr1.logicalItemId,
    itemVersionId: adr1.itemVersionId,
  });
  const optionA = await fx.createArchitectureOption(sql, {
    artifactVersionId: architectureVersionId,
    optionKey: 'A',
  });
  await fx.createArchitectureOption(sql, {
    artifactVersionId: architectureVersionId,
    optionKey: 'B',
  });
  await fx.approveArtifactVersion(sql, architectureVersionId, {
    selectedArchitectureOptionId: optionA,
  });

  const uiRequirementsId = await fx.createArtifact(sql, projectId, 'ui_requirements');
  const uiRequirementsVersionId = await fx.createDraftArtifactVersion(sql, uiRequirementsId);
  const ui1 = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId: uiRequirementsId,
    itemType: 'ui_requirement',
    displayKey: 'UI-01',
  });
  await fx.createMembership(sql, {
    artifactVersionId: uiRequirementsVersionId,
    artifactId: uiRequirementsId,
    logicalItemId: ui1.logicalItemId,
    itemVersionId: ui1.itemVersionId,
  });
  await fx.approveArtifactVersion(sql, uiRequirementsVersionId);

  const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

  return {
    userId,
    projectId,
    r1,
    backlogArtifactId,
    contextSourceVersionIds: [
      requirementsVersionId,
      architectureVersionId,
      uiRequirementsVersionId,
    ],
  };
}

type Scenario = Awaited<ReturnType<typeof setupProject>>;

// Runs the REAL createDraftFromGeneration with the REAL backlog.toCandidates
// over a deterministic item list. No `itemType` option - every candidate
// carries its own (generation.ts's own doc comment on that option).
async function generateBacklog(s: Scenario, items: BacklogItem[]) {
  return lifecycle.createDraftFromGeneration({
    projectId: s.projectId,
    artifactId: s.backlogArtifactId,
    contextSourceVersionIds: s.contextSourceVersionIds,
    actorUserId: s.userId,
    generate: async () => {
      const runId = await fx.createAiGenerationRun(sql, { projectId: s.projectId });
      return {
        payload: { summary: 'generated' },
        candidates: backlog.toCandidates(items),
        runId,
      };
    },
  });
}

type DraftItemRow = {
  logical_item_id: string;
  item_version_id: string;
  parent_logical_item_id: string | null;
  item_type: string;
  display_key: string;
  payload: Record<string, unknown>;
};

async function draftItems(versionId: string): Promise<DraftItemRow[]> {
  return sql<DraftItemRow[]>`
    SELECT m.logical_item_id, m.item_version_id, m.parent_logical_item_id,
           li.item_type, li.display_key, iv.payload
    FROM artifact_version_item_membership m
    JOIN logical_item li ON li.id = m.logical_item_id
    JOIN item_version iv ON iv.id = m.item_version_id
    WHERE m.artifact_version_id = ${versionId}
  `;
}

function epicByTitle(rows: DraftItemRow[], title: string): DraftItemRow {
  const row = rows.find((r) => r.item_type === 'epic' && r.payload.title === title);
  if (!row) throw new Error(`no Epic titled "${title}" in this version`);
  return row;
}

function storyByStatement(rows: DraftItemRow[], statement: string): DraftItemRow {
  const row = rows.find(
    (r) => r.item_type === 'story' && r.payload.userValueStatement === statement,
  );
  if (!row) throw new Error(`no Story "${statement}" in this version`);
  return row;
}

// The title of the Epic a Story's membership row actually points at.
function parentEpicTitle(rows: DraftItemRow[], statement: string): unknown {
  const parentId = storyByStatement(rows, statement).parent_logical_item_id;
  return rows.find((r) => r.logical_item_id === parentId)?.payload.title;
}

async function semanticDependencyRows(downstreamItemVersionId: string) {
  return sql<{ upstream_item_version_id: string; proposed_by: string }[]>`
    SELECT upstream_item_version_id, proposed_by FROM semantic_dependency
    WHERE downstream_item_version_id = ${downstreamItemVersionId}
  `;
}

describe('createDraftFromGeneration x backlog.toCandidates: one draft mints both Epics and Stories', () => {
  it('fresh project: mints an Epic and a Story into the same draft, resolves the Story parent, and binds a real upstream Requirement', async () => {
    const s = await setupProject();

    const result = await generateBacklog(s, [
      epic('E-01', 'Article search'),
      story('S-01', 'E-01', 'As a reader, I want to search articles.'),
    ]);
    expect(result.stale).toBe(false);
    const draftVersionId = result.version.id;

    // Both item types actually got minted, against the same draft version.
    const logicalItems = await sql<{ id: string; item_type: string; display_key: string }[]>`
      SELECT id, item_type, display_key FROM logical_item
      WHERE artifact_id = ${s.backlogArtifactId} ORDER BY display_key
    `;
    expect(logicalItems).toHaveLength(2);
    expect(logicalItems.map((row) => [row.item_type, row.display_key])).toEqual([
      ['epic', 'E-01'],
      ['story', 'S-01'],
    ]);

    const rows = await draftItems(draftVersionId);
    expect(rows).toHaveLength(2);
    const epicRow = epicByTitle(rows, 'Article search');
    const storyRow = storyByStatement(rows, 'As a reader, I want to search articles.');
    expect(epicRow.parent_logical_item_id).toBeNull();

    // The Story's parent_logical_item_id resolves to the Epic's real
    // logical_item_id - this would fail if the epic group and story group
    // were persisted out of order, or against two different draft rows.
    expect(storyRow.parent_logical_item_id).toBe(epicRow.logical_item_id);

    // The Story's upstreamRefs bound against the real approved R-01: a
    // genuine semantic_dependency row, proposed_by 'ai'.
    expect(await semanticDependencyRows(storyRow.item_version_id)).toEqual([
      { upstream_item_version_id: s.r1.itemVersionId, proposed_by: 'ai' },
    ]);
  });

  it('A: Story parents follow the Epic that carried the label after a replaced draft, even though allocated keys drifted (E-03/E-04)', async () => {
    const s = await setupProject();

    // First generation leaves a draft holding E-01/E-02 and S-01/S-02 ...
    const first = await generateBacklog(s, [
      epic('E-01', 'Alpha'),
      epic('E-02', 'Beta'),
      story('S-01', 'E-01', 'Alpha story'),
      story('S-02', 'E-02', 'Beta story'),
    ]);
    expect(first.stale).toBe(false);

    // ... the second replaces it. The allocator never reuses keys (max
    // suffix over ALL of the project's Epics/Stories, including the replaced
    // draft's), so these Epics are really E-03/E-04 - but the model labelled
    // them E-01/E-02 again, and its Stories' parentDisplayKey uses THOSE
    // labels. Without label -> real-key rewriting, matchAndPersistItems
    // would look up real keys 'E-01'/'E-02' among the new draft's Epics and
    // throw "Story parent must be an Epic in this draft".
    const second = await generateBacklog(s, [
      epic('E-01', 'Gamma'),
      epic('E-02', 'Delta'),
      story('S-01', 'E-01', 'Gamma story'),
      story('S-02', 'E-02', 'Delta story'),
    ]);
    expect(second.stale).toBe(false);

    const [replaced] = await sql<{ status: string; status_reason: string | null }[]>`
      SELECT status, status_reason FROM artifact_version WHERE id = ${first.version.id}
    `;
    expect(replaced).toEqual({ status: 'rejected', status_reason: 'replaced_by_regeneration' });

    const rows = await draftItems(second.version.id);
    // Real keys drifted from the labels ...
    expect(
      rows
        .filter((r) => r.item_type === 'epic')
        .map((r) => r.display_key)
        .sort(),
    ).toEqual(['E-03', 'E-04']);
    expect(
      rows
        .filter((r) => r.item_type === 'story')
        .map((r) => r.display_key)
        .sort(),
    ).toEqual(['S-03', 'S-04']);
    // ... yet each Story sits under the Epic that carried its label.
    expect(parentEpicTitle(rows, 'Gamma story')).toBe('Gamma');
    expect(parentEpicTitle(rows, 'Delta story')).toBe('Delta');
  });

  it('B: regenerating against an approved base with a new Epic inserted mid-list and shifted labels never resolves a Story to the wrong Epic, and reuses unchanged ItemVersions', async () => {
    const s = await setupProject();

    // v1: Search = E-01, Auth = E-02 (real keys, first generation); Stories
    // S-01 (Search) and S-02 (Auth). Approved, so it becomes the base.
    const v1 = await generateBacklog(s, [
      epic('E-01', 'Search'),
      epic('E-02', 'Auth'),
      story('S-01', 'E-01', 'Search story'),
      story('S-02', 'E-02', 'Auth story'),
    ]);
    expect(v1.stale).toBe(false);
    await fx.approveArtifactVersion(sql, v1.version.id);
    const v1Rows = await draftItems(v1.version.id);
    const v1Search = epicByTitle(v1Rows, 'Search');
    const v1Auth = epicByTitle(v1Rows, 'Auth');
    const v1SearchStory = storyByStatement(v1Rows, 'Search story');
    const v1AuthStory = storyByStatement(v1Rows, 'Auth story');
    expect(v1Search.display_key).toBe('E-01');
    expect(v1Auth.display_key).toBe('E-02');

    // v2 regenerates against v1: previousDisplayKey values are v1's REAL keys
    // (what the prompt showed the model), while the model's own output labels
    // shifted - a new "Billing" Epic sits in the middle, so Auth is now
    // labelled E-03. The allocator gives Billing the next real key, E-03 -
    // exactly Auth's LABEL. A Story whose parentDisplayKey is 'E-03' (meant:
    // Auth) must therefore NOT resolve to Billing, and 'E-02' (meant:
    // Billing) must NOT resolve to Auth (Auth's real key, reused from v1).
    const v2 = await generateBacklog(s, [
      epic('E-01', 'Search', 'E-01'),
      epic('E-02', 'Billing'),
      epic('E-03', 'Auth', 'E-02'),
      story('S-01', 'E-01', 'Search story', 'S-01'),
      story('S-02', 'E-02', 'Billing story'),
      story('S-03', 'E-03', 'Auth story', 'S-02'),
    ]);
    expect(v2.stale).toBe(false);
    expect(v2.version.baseApprovedVersionId).toBe(v1.version.id);

    const v2Rows = await draftItems(v2.version.id);
    expect(v2Rows.filter((r) => r.item_type === 'epic')).toHaveLength(3);
    expect(v2Rows.filter((r) => r.item_type === 'story')).toHaveLength(3);

    // Parents: each Story under the Epic with the right title.
    expect(parentEpicTitle(v2Rows, 'Search story')).toBe('Search');
    expect(parentEpicTitle(v2Rows, 'Billing story')).toBe('Billing');
    expect(parentEpicTitle(v2Rows, 'Auth story')).toBe('Auth');

    // Reuse: unchanged Epics/Stories keep their LogicalItem AND ItemVersion.
    const v2Search = epicByTitle(v2Rows, 'Search');
    const v2Auth = epicByTitle(v2Rows, 'Auth');
    expect(v2Search.logical_item_id).toBe(v1Search.logical_item_id);
    expect(v2Search.item_version_id).toBe(v1Search.item_version_id);
    expect(v2Auth.logical_item_id).toBe(v1Auth.logical_item_id);
    expect(v2Auth.item_version_id).toBe(v1Auth.item_version_id);
    const v2SearchStory = storyByStatement(v2Rows, 'Search story');
    const v2AuthStory = storyByStatement(v2Rows, 'Auth story');
    expect(v2SearchStory.item_version_id).toBe(v1SearchStory.item_version_id);
    expect(v2AuthStory.item_version_id).toBe(v1AuthStory.item_version_id);
    // The reused Auth Story now points at the reused Auth Epic.
    expect(v2AuthStory.parent_logical_item_id).toBe(v1Auth.logical_item_id);

    // The new Epic and its Story are brand new LogicalItems (not in v1), and
    // the Epic really did take the next real key, E-03.
    const v2Billing = epicByTitle(v2Rows, 'Billing');
    const v1LogicalIds = new Set(v1Rows.map((r) => r.logical_item_id));
    expect(v1LogicalIds.has(v2Billing.logical_item_id)).toBe(false);
    expect(v2Billing.display_key).toBe('E-03');
    const v2BillingStory = storyByStatement(v2Rows, 'Billing story');
    expect(v1LogicalIds.has(v2BillingStory.logical_item_id)).toBe(false);
    expect(v2BillingStory.parent_logical_item_id).toBe(v2Billing.logical_item_id);
  });

  it('a Story whose parentDisplayKey matches no Epic outputKey in the batch fails with a clear error and writes nothing', async () => {
    const s = await setupProject();

    await expect(
      lifecycle.createDraftFromGeneration({
        projectId: s.projectId,
        artifactId: s.backlogArtifactId,
        contextSourceVersionIds: s.contextSourceVersionIds,
        actorUserId: s.userId,
        generate: async () => {
          const runId = await fx.createAiGenerationRun(sql, { projectId: s.projectId });
          return {
            payload: { summary: 'malformed' },
            // Hand-built (bypassing outputSchema, which would reject this
            // earlier): the Epic carries an outputKey, so label rewriting is
            // active, and the Story names a label no Epic carries.
            candidates: [
              {
                itemType: 'epic',
                outputKey: 'E-01',
                payload: { title: 'Only epic', scopeStatement: 'Scope' },
                upstreamRefs: [],
              },
              {
                itemType: 'story',
                parentDisplayKey: 'E-09',
                payload: {
                  userValueStatement: 'Orphan story',
                  acceptanceCriteria: ['Works'],
                  structuredBehavior: 'Behavior',
                },
                upstreamRefs: ['R-01'],
              },
            ],
            runId,
          };
        },
      }),
    ).rejects.toThrow('matches no Epic output label');

    // The whole persist transaction rolled back: no version, no items.
    const [versions] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${s.backlogArtifactId}
    `;
    const [items] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE artifact_id = ${s.backlogArtifactId}
    `;
    expect(versions?.count).toBe(0);
    expect(items?.count).toBe(0);
  });

  it('backwards compatible: Epic candidates with no outputKey leave a Story parentDisplayKey untouched (already a real key)', async () => {
    const s = await setupProject();

    // Hand-built candidates that pass the REAL allocated key directly, the
    // way callers written before outputKey existed do - the fresh project's
    // first Epic is E-01, so 'E-01' resolves by real key with no rewrite.
    const result = await lifecycle.createDraftFromGeneration({
      projectId: s.projectId,
      artifactId: s.backlogArtifactId,
      contextSourceVersionIds: s.contextSourceVersionIds,
      actorUserId: s.userId,
      generate: async () => {
        const runId = await fx.createAiGenerationRun(sql, { projectId: s.projectId });
        return {
          payload: { summary: 'real keys' },
          candidates: [
            {
              itemType: 'epic',
              payload: { title: 'Real-key epic', scopeStatement: 'Scope' },
              upstreamRefs: [],
            },
            {
              itemType: 'story',
              parentDisplayKey: 'E-01',
              payload: {
                userValueStatement: 'Real-key story',
                acceptanceCriteria: ['Works'],
                structuredBehavior: 'Behavior',
              },
              upstreamRefs: ['R-01'],
            },
          ],
          runId,
        };
      },
    });
    expect(result.stale).toBe(false);

    const rows = await draftItems(result.version.id);
    expect(parentEpicTitle(rows, 'Real-key story')).toBe('Real-key epic');
  });
});

describe('createDraftFromGeneration x backlog.toCandidates: stale results and rejected candidate types', () => {
  it('c: a stale (base_changed) mixed epic+story generation is recorded as rejected/stale_generation_context, keeping BOTH candidate kinds in raw_output and minting nothing', async () => {
    const s = await setupProject();

    // An approved Backlog v1 exists, so the generation captures it as its base.
    const backlogV1 = await fx.createDraftArtifactVersion(sql, s.backlogArtifactId, {
      versionNumber: 1,
    });
    await fx.approveArtifactVersion(sql, backlogV1);

    const items = [epic('E-01', 'Racing epic'), story('S-01', 'E-01', 'Racing story')];
    let racedVersionId = '';
    const result = await lifecycle.createDraftFromGeneration({
      projectId: s.projectId,
      artifactId: s.backlogArtifactId,
      contextSourceVersionIds: s.contextSourceVersionIds,
      actorUserId: s.userId,
      generate: async () => {
        // Same technique as artifact-lifecycle-generation.test.ts's T7: a
        // concurrent regeneration-and-approval lands between the base
        // capture (already done) and the persist transaction (about to open).
        racedVersionId = await fx.createDraftArtifactVersion(sql, s.backlogArtifactId, {
          versionNumber: 2,
        });
        await sql.begin(async (tx) => {
          await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${backlogV1}`;
          await fx.approveArtifactVersion(tx, racedVersionId);
        });
        const runId = await fx.createAiGenerationRun(sql, { projectId: s.projectId });
        return { payload: { summary: 'raced' }, candidates: backlog.toCandidates(items), runId };
      },
    });

    expect(result.stale).toBe(true);
    if (!result.stale) throw new Error('unreachable');
    expect(result.reason).toBe('base_changed');

    const [row] = await sql<
      {
        status: string;
        status_reason: string | null;
        base_approved_version_id: string | null;
        raw_output: { payload: unknown; candidates: { itemType?: string }[] };
        payload: unknown;
      }[]
    >`SELECT status, status_reason, base_approved_version_id, raw_output, payload
      FROM artifact_version WHERE id = ${result.version.id}`;
    expect(row?.status).toBe('rejected');
    expect(row?.status_reason).toBe('stale_generation_context');
    expect(row?.base_approved_version_id).toBe(backlogV1);
    expect(row?.payload).toEqual({});
    // The audit copy holds the model output exactly as proposed: BOTH kinds.
    expect(row?.raw_output.payload).toEqual({ summary: 'raced' });
    expect(row?.raw_output.candidates.map((c) => c.itemType)).toEqual(['epic', 'story']);

    // Nothing was minted for that version: no items, no membership.
    const [logicalItems] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE artifact_id = ${s.backlogArtifactId}
    `;
    const [membership] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM artifact_version_item_membership
      WHERE artifact_version_id = ${result.version.id}
    `;
    expect(logicalItems?.count).toBe(0);
    expect(membership?.count).toBe(0);
  });

  it('d: a candidate carrying its own architecture_decision itemType is rejected by the ADR guard, and a candidate of an unknown itemType is rejected too - both before any row is written', async () => {
    const s = await setupProject();

    const attempt = (itemType: string) =>
      lifecycle.createDraftFromGeneration({
        projectId: s.projectId,
        artifactId: s.backlogArtifactId,
        contextSourceVersionIds: s.contextSourceVersionIds,
        actorUserId: s.userId,
        generate: async () => {
          const runId = await fx.createAiGenerationRun(sql, { projectId: s.projectId });
          return {
            payload: { summary: 'bad candidate type' },
            candidates: [
              {
                // Deliberately outside the ItemType union for the unknown
                // case - a hand-built candidate bypassing toCandidates.
                itemType: itemType as 'epic',
                payload: { title: 'Bad', scopeStatement: 'Scope' },
                upstreamRefs: [],
              },
            ],
            runId,
          };
        },
      });

    await expect(attempt('architecture_decision')).rejects.toThrow(
      'must not mint architecture_decision items directly',
    );
    await expect(attempt('bogus')).rejects.toThrow('unknown itemType "bogus"');

    const [versions] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${s.backlogArtifactId}
    `;
    const [logicalItems] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE artifact_id = ${s.backlogArtifactId}
    `;
    expect(versions?.count).toBe(0);
    expect(logicalItems?.count).toBe(0);
  });
});
