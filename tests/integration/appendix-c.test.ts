import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type postgres from 'postgres';
import { connect } from './support/connection';
import * as fx from './support/fixtures';
import { asAnon } from './support/roles';
import { expectDeniedAsAnon } from './support/assertions';

// ERD Appendix C ("Verification suite", docs/Throughline_ERD.md ~line 1641)
// ported into tests/integration/, per Project Setup section 10 step 9 and
// Jira Plan E1-S5 / SCRUM-21: "Port ERD Appendix C (T1-T43) into
// tests/integration as executable stubs - T14, T27, T28, T34 pass in this
// slice, the rest turn green as their owning slice lands (E2-S9, E3-T1,
// E4-T3 each re-run this same suite, not a copy of it)."
//
// Every T1-T43 acceptance test from ERD section 10 (the canonical table;
// Appendix C's own "rejected writes"/"accepted writes" paragraphs restate
// several of the same ids with slightly different framing - section 10's
// wording is treated as authoritative here) has a real test id below.
// T14/T27/T28/T34 have real, passing assertions - this slice's Definition
// of Done. Everything else is `it.todo`, named with its T## id and the ERD
// scenario/expected result, and cites the future slice whose gate task
// (E2-S9 / E3-T1 / E4-T3) is expected to turn it green - per the mapping
// derived from docs/Throughline_Jira_Plan.md's Epic 2/3/4 tables. T33 and
// T35 cite neither: they belong to E1-S8 and (roughly) E1-S6 respectively,
// not to one of the three lineage/approval/external gates (see their own
// comments below) - naming that plainly rather than force-fitting a
// citation that isn't there.
//
// Harness: one Testcontainers postgres:15-alpine for the whole `integration`
// vitest project (tests/integration/support/global-setup.ts), migrated with
// the frozen drizzle/migrations/0000-0007 in order. Fixture rows use only
// the support/fixtures.ts helpers so every test exercises the real triggers/
// CHECKs, not a shortcut around them (Appendix C's own suite ran the
// canonical flow through the real triggers for the same reason).

// E2-S9 (SCRUM-35) addendum: T1, T1b, T1c, T2, T3, T4, T5, T15, T21, T31,
// T32, T43 below are now real, passing assertions - ERD 14 slice 2's gate
// ("T21 before anything else, then T1-T5, T8, T15, T31, T32, T40, T43"; T8/
// T40 stay `it.todo`, deferred to E3-T1 per the Jira Plan's own E2-S9 row -
// approveVersion/materialize don't exist yet). Every Requirements leg below
// goes through the real `artifact-lifecycle.createDraftFromGeneration` (not
// a raw membership insert) per this story's own instructions; ADR/Story legs
// that can't be produced by generation yet (Architecture materialization is
// E3-S1) keep using the `fx.*` fixtures, exactly like
// tests/integration/lineage/impact.test.ts already does for the same
// limitation. T31 and T32 did not exist as `it.todo` stubs here (E1-S5
// didn't port them into this file - see tests/integration/
// identity-matching.test.ts, which already covers both directly against
// `identity.matchAndPersistItems`); they're added fresh below, each proving
// the same mechanism one layer up, through the full
// `createDraftFromGeneration` pipeline.
//
// T21 here is a DETERMINISTIC in-process fake `generate` callback, not a
// real OpenAI call - it exercises the exact same pipeline code
// (createDraftFromGeneration -> identity.matchAndPersistItems) to prove the
// zero-new-ItemVersions / zero-new-warnings behavior deterministically, so
// CI never bills a real API call. The genuine "real LLM call, not a mock"
// proof this epic's own Definition of Done requires (Jira Plan line 148;
// throughline-lineage-invariants point 9) lives in
// scripts/verify-real-generation-t21.ts, which drives this SAME pipeline
// through src/artifact-types/requirements + src/ai-client for real.

let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');
let impact: typeof import('@/lineage/impact');
let uiRequirementsType: typeof import('@/artifact-types/ui-requirements');
let backlogType: typeof import('@/artifact-types/backlog');
let withTx: typeof import('@/db').withTx;

beforeAll(async () => {
  sql = connect();
  // Same gotcha as tests/integration/lineage/impact.test.ts and
  // tests/integration/artifact-lifecycle-generation.test.ts: the real
  // modules below go through the @/db Drizzle singleton, which reads
  // DATABASE_URL from @/lib/env at MODULE-IMPORT time - point env vars at
  // the Testcontainers connection BEFORE dynamically importing any of them.
  const databaseUrl = inject('pgConnectionUri');
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_DATABASE_URL = databaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  lifecycle = await import('@/artifact-lifecycle');
  impact = await import('@/lineage/impact');
  uiRequirementsType = await import('@/artifact-types/ui-requirements');
  backlogType = await import('@/artifact-types/backlog');
  withTx = (await import('@/db')).withTx;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// --- Shared helpers for the E2-S9 additions below --------------------------
//
// Requirements generation, driven through the real
// artifact-lifecycle.createDraftFromGeneration with a deterministic
// in-process fake `generate` (Requirements has no generation prerequisite
// and no upstream refs - Module Boundaries 4.4 - so a bare Candidate[] is
// enough; no need to route through src/artifact-types/requirements's
// buildPrompt/outputSchema for these fixture-driven scenarios).
type RequirementCandidateInput = {
  previousDisplayKey?: string | null;
  payload: Record<string, unknown>;
};

async function generateRequirements(
  projectId: string,
  requirementsArtifactId: string,
  userId: string,
  candidates: RequirementCandidateInput[],
): Promise<{ versionId: string; stale: boolean }> {
  const result = await lifecycle.createDraftFromGeneration({
    projectId,
    artifactId: requirementsArtifactId,
    itemType: 'requirement',
    contextSourceVersionIds: [],
    actorUserId: userId,
    generate: async () => {
      const runId = await fx.createAiGenerationRun(sql, { projectId });
      return {
        payload: { modelNote: 'appendix-c fixture generation' },
        candidates: candidates.map((c) => ({
          previousDisplayKey: c.previousDisplayKey ?? null,
          payload: c.payload,
          upstreamRefs: [],
        })),
        runId,
      };
    },
  });
  return { versionId: result.version.id, stale: result.stale };
}

async function supersede(versionId: string): Promise<void> {
  await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${versionId}`;
}

// Approves `versionId`, superseding whatever is currently approved for the
// same artifact first (the one_approved_version partial unique index
// requires it) - the raw-SQL equivalent of the future artifact-lifecycle.
// approveVersion, same approach tests/integration/lineage/impact.test.ts
// already takes (its own approveVersionWithItems helper).
async function approveSupersedingCurrent(artifactId: string, versionId: string): Promise<void> {
  const [current] = await sql<{ id: string }[]>`
    SELECT id FROM artifact_version WHERE artifact_id = ${artifactId} AND status = 'approved'
  `;
  if (current) await supersede(current.id);
  await fx.approveArtifactVersion(sql, versionId);
}

async function currentMembership(artifactId: string, versionId: string) {
  return sql<{ logical_item_id: string; item_version_id: string; display_key: string }[]>`
    SELECT m.logical_item_id, m.item_version_id, li.display_key
    FROM artifact_version_item_membership m
    JOIN logical_item li ON li.id = m.logical_item_id
    WHERE m.artifact_version_id = ${versionId} AND m.artifact_id = ${artifactId}
    ORDER BY li.display_key
  `;
}

async function membershipWithPayload(artifactId: string, versionId: string) {
  return sql<
    { logical_item_id: string; item_version_id: string; display_key: string; payload: unknown }[]
  >`
    SELECT m.logical_item_id, m.item_version_id, li.display_key, iv.payload
    FROM artifact_version_item_membership m
    JOIN logical_item li ON li.id = m.logical_item_id
    JOIN item_version iv ON iv.id = m.item_version_id
    WHERE m.artifact_version_id = ${versionId} AND m.artifact_id = ${artifactId}
  `;
}

// Same shape as tests/integration/lineage/impact.test.ts's own
// approveVersionWithItems (ADR/Story legs can't go through generation yet -
// see this file's own header addendum) - reproduced locally rather than
// imported, since that file exports nothing (every integration test file in
// this repo builds its own fixture composition, per Appendix C's original
// "exercise the real triggers, not a shortcut" precedent).
async function approveItemsVersion(
  artifactId: string,
  items: { logicalItemId: string; itemVersionId: string }[],
  opts: { architecture?: boolean } = {},
): Promise<string> {
  const [latest] = await sql<{ version_number: number | null }[]>`
    SELECT MAX(version_number) AS version_number FROM artifact_version WHERE artifact_id = ${artifactId}
  `;
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, {
    versionNumber: (latest?.version_number ?? 0) + 1,
  });
  for (const item of items) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId: item.logicalItemId,
      itemVersionId: item.itemVersionId,
    });
  }
  const [current] = await sql<{ id: string }[]>`
    SELECT id FROM artifact_version WHERE artifact_id = ${artifactId} AND status = 'approved'
  `;
  if (current) await supersede(current.id);
  if (opts.architecture) {
    const optionAId = await fx.createArchitectureOption(sql, {
      artifactVersionId: versionId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: versionId, optionKey: 'B' });
    await fx.approveArtifactVersion(sql, versionId, { selectedArchitectureOptionId: optionAId });
  } else {
    await fx.approveArtifactVersion(sql, versionId);
  }
  return versionId;
}

describe('ERD Appendix C acceptance suite (T1-T43)', () => {
  // T1 / T1b / T1c - core promise, and the same narrative's two follow-on
  // scenarios (ERD section 10). Each is self-contained (its own project),
  // matching this suite's existing convention (T14/T27/T28/T34 above,
  // tests/integration/lineage/impact.test.ts) rather than chaining shared
  // mutable state across `it`s.
  describe('T1 / T1b / T1c - R-07@A -> ADR-03@B -> S-12@C -> Jira THR-42', () => {
    it('T1: ADR-03 direct, S-12 transitive, THR-42 impacted via S-12, after Requirements v(n+1) changes R-07 to D', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T1',
      });
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const rPayloadA = {
        type: 'functional',
        actor: 'Analyst',
        behavior: 'View the quarterly report',
        constraints: [],
        acceptanceCriteria: ['Report renders within 2s'],
        dimension: null,
        value: null,
      };
      const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: rPayloadA },
      ]);
      expect(v1.stale).toBe(false);
      await fx.approveArtifactVersion(sql, v1.versionId);
      const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
      if (!r) throw new Error('R-07 membership missing after v1 approval');

      // ADR-03@B, generated (via fixture - Architecture generation is out of
      // scope, ERD 5.5) while R-07@A is still current.
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr.itemVersionId,
        upstreamItemVersionId: r.item_version_id,
      });
      await approveItemsVersion(
        architectureArtifactId,
        [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
        { architecture: true },
      );

      // S-12@C, depends on ADR-03@B.
      const s = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: s.itemVersionId,
        upstreamItemVersionId: adr.itemVersionId,
      });
      const backlogVersionId = await approveItemsVersion(backlogArtifactId, [
        { logicalItemId: s.logicalItemId, itemVersionId: s.itemVersionId },
      ]);

      // Jira THR-42, sourced from S-12@C.
      const opId = await fx.createExternalOperation(sql, {
        projectId,
        provider: 'jira',
        sourceArtifactVersionId: backlogVersionId,
        sourceItemVersionId: s.itemVersionId,
      });
      const refId = await fx.createExternalRef(sql, {
        projectId,
        provider: 'jira',
        externalOperationId: opId,
        sourceArtifactVersionId: backlogVersionId,
        sourceItemVersionId: s.itemVersionId,
      });

      // Requirements regenerated: R-07 changes A -> D (real generation
      // pipeline, previousDisplayKey round-tripped so the matcher reuses
      // R's LogicalItem and mints a new revision, not a new item).
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r.display_key,
          payload: { ...rPayloadA, behavior: 'View the quarterly report in the new layout' },
        },
      ]);
      expect(v2.stale).toBe(false);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
      const [rD] = await currentMembership(requirementsArtifactId, v2.versionId);
      if (!rD) throw new Error('R-07@D membership missing after v2 approval');
      expect(rD.logical_item_id).toBe(r.logical_item_id);
      expect(rD.item_version_id).not.toBe(r.item_version_id); // D is a new revision, not A

      const warnings = await impact.getWarnings(projectId);
      const adrRow = warnings.find((w) => w.subjectId === adr.itemVersionId);
      const sRow = warnings.find((w) => w.subjectId === s.itemVersionId);
      expect(adrRow).toMatchObject({ rootItemVersionId: r.item_version_id, depth: 0 });
      expect(sRow).toMatchObject({ rootItemVersionId: r.item_version_id, depth: 1 });
      expect(sRow!.path).toEqual([r.item_version_id, adr.itemVersionId, s.itemVersionId]);

      const drift = await impact.getExternalDrift(projectId, refId);
      expect(drift).toMatchObject({
        subjectKind: 'external_ref',
        rootItemVersionId: r.item_version_id,
      });
    });

    it('T1b: same warnings remain after a later regeneration changes only an unrelated Requirement', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T1b',
      });
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const rPayloadA = {
        type: 'functional',
        actor: 'Analyst',
        behavior: 'View the quarterly report',
        constraints: [],
        acceptanceCriteria: ['Report renders within 2s'],
        dimension: null,
        value: null,
      };
      const rOtherPayload = {
        type: 'functional',
        actor: 'Manager',
        behavior: 'Export the quarterly report',
        constraints: [],
        acceptanceCriteria: ['CSV download available'],
        dimension: null,
        value: null,
      };
      const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: rPayloadA },
        { payload: rOtherPayload },
      ]);
      expect(v1.stale).toBe(false);
      await fx.approveArtifactVersion(sql, v1.versionId);
      const v1Members = await membershipWithPayload(requirementsArtifactId, v1.versionId);
      const r = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Analyst');
      const rOther = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Manager');
      if (!r || !rOther) throw new Error('expected both R-07 and R-20 memberships after v1');

      const s = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: s.itemVersionId,
        upstreamItemVersionId: r.item_version_id,
      });
      await approveItemsVersion(backlogArtifactId, [
        { logicalItemId: s.logicalItemId, itemVersionId: s.itemVersionId },
      ]);

      // v2: R-07 -> D (as T1).
      const rPayloadD = { ...rPayloadA, behavior: 'View the quarterly report in the new layout' };
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { previousDisplayKey: r.display_key, payload: rPayloadD },
        { previousDisplayKey: rOther.display_key, payload: rOtherPayload }, // verbatim
      ]);
      expect(v2.stale).toBe(false);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
      const v2Members = await currentMembership(requirementsArtifactId, v2.versionId);
      const rD = v2Members.find((m) => m.logical_item_id === r.logical_item_id);
      if (!rD) throw new Error('R-07@D membership missing after v2 approval');
      expect(rD.item_version_id).not.toBe(r.item_version_id); // D is a new revision, not A

      const before = await impact.getWarnings(projectId);
      const sBefore = before.find((w) => w.subjectId === s.itemVersionId);
      expect(sBefore).toMatchObject({ rootItemVersionId: r.item_version_id, depth: 0 });

      // v3 ("v4" in the ERD's own numbering, which includes a v2 draft-then-
      // reject step T5 exercises separately): change ONLY R-20 - R-07 comes
      // back byte-for-byte identical, so the matcher must reuse D rather
      // than minting yet another revision (ERD 5.4's hash-stability rule -
      // this is T1b's actual point).
      const v3 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { previousDisplayKey: r.display_key, payload: rPayloadD },
        {
          previousDisplayKey: rOther.display_key,
          payload: {
            ...rOtherPayload,
            acceptanceCriteria: ['CSV download available', 'XLSX download available'],
          },
        },
      ]);
      expect(v3.stale).toBe(false);
      await approveSupersedingCurrent(requirementsArtifactId, v3.versionId);
      const v3Members = await currentMembership(requirementsArtifactId, v3.versionId);
      const rNow = v3Members.find((m) => m.logical_item_id === r.logical_item_id);
      const rOtherNow = v3Members.find((m) => m.logical_item_id === rOther.logical_item_id);
      // R-07 stayed at D (no new revision minted for an item that came back
      // byte-for-byte unchanged).
      expect(rNow?.item_version_id).toBe(rD.item_version_id);
      expect(rOtherNow?.item_version_id).not.toBe(rOther.item_version_id); // R-20 DID get a new revision

      const after = await impact.getWarnings(projectId);
      const sAfter = after.find((w) => w.subjectId === s.itemVersionId);
      expect(sAfter).toEqual(sBefore); // unchanged: same root, same depth, same path, same ack state
    });

    it('T1c: regenerating downstream Architecture/Backlog against the current Requirement clears their own flags; the old Jira ref stays flagged as created from a superseded Story version', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T1c',
      });
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const rPayloadA = {
        type: 'functional',
        actor: 'Analyst',
        behavior: 'View the quarterly report',
        constraints: [],
        acceptanceCriteria: ['Report renders within 2s'],
        dimension: null,
        value: null,
      };
      const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: rPayloadA },
      ]);
      await fx.approveArtifactVersion(sql, v1.versionId);
      const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
      if (!r) throw new Error('R-07 membership missing after v1 approval');

      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr.itemVersionId,
        upstreamItemVersionId: r.item_version_id,
      });
      await approveItemsVersion(
        architectureArtifactId,
        [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
        { architecture: true },
      );

      const s = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: s.itemVersionId,
        upstreamItemVersionId: adr.itemVersionId,
      });
      const backlogVersionC = await approveItemsVersion(backlogArtifactId, [
        { logicalItemId: s.logicalItemId, itemVersionId: s.itemVersionId },
      ]);

      const opId = await fx.createExternalOperation(sql, {
        projectId,
        provider: 'jira',
        sourceArtifactVersionId: backlogVersionC,
        sourceItemVersionId: s.itemVersionId,
      });
      const refId = await fx.createExternalRef(sql, {
        projectId,
        provider: 'jira',
        externalOperationId: opId,
        sourceArtifactVersionId: backlogVersionC,
        sourceItemVersionId: s.itemVersionId,
      });

      // R-07 -> D.
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r.display_key,
          payload: { ...rPayloadA, behavior: 'View the quarterly report in the new layout' },
        },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
      const [rD] = await currentMembership(requirementsArtifactId, v2.versionId);
      if (!rD) throw new Error('R-07@D membership missing');

      // ADR-03 regenerated against the now-current R-07@D -> E (fixture: a
      // new revision under the SAME LogicalItem, same reasoning as T1/T1b -
      // Architecture generation itself is out of scope).
      const adrEId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: adr.logicalItemId,
        revisionNumber: 2,
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adrEId,
        upstreamItemVersionId: rD.item_version_id,
      });
      await approveItemsVersion(
        architectureArtifactId,
        [{ logicalItemId: adr.logicalItemId, itemVersionId: adrEId }],
        { architecture: true },
      );

      // Backlog regenerated against the now-current ADR-03@E -> F.
      const sFId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: s.logicalItemId,
        revisionNumber: 2,
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: sFId,
        upstreamItemVersionId: adrEId,
      });
      await approveItemsVersion(backlogArtifactId, [
        { logicalItemId: s.logicalItemId, itemVersionId: sFId },
      ]);

      const warnings = await impact.getWarnings(projectId);
      expect(warnings.find((w) => w.subjectId === adrEId)).toBeUndefined(); // E not flagged
      expect(warnings.find((w) => w.subjectId === sFId)).toBeUndefined(); // F not flagged

      // THR-42's source (S-12@C) is itself no longer current (F is) - impact()
      // flags the ref directly against C (depth 0), not against the deeper
      // R-07 chain: "created from a superseded Story version" (ERD section
      // 10 T1c; 0005_impact_function.sql's ref_raw first branch).
      const drift = await impact.getExternalDrift(projectId, refId);
      expect(drift).toMatchObject({
        subjectKind: 'external_ref',
        rootItemVersionId: s.itemVersionId, // S-12@C
        depth: 0,
        path: [s.itemVersionId],
      });
    });
  });

  // T2 - Requirements v3 changes only R-07; S-20 depends on R-15@C (reused).
  // Expected: S-20 not flagged.
  it('T2: a Story depending on an unchanged, reused Requirement is not flagged', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T2' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const rPayload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const r15Payload = {
      type: 'functional',
      actor: 'Manager',
      behavior: 'Approve the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Approval is logged'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: rPayload },
      { payload: r15Payload },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const v1Members = await membershipWithPayload(requirementsArtifactId, v1.versionId);
    const r = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Analyst');
    const r15 = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Manager');
    if (!r || !r15) throw new Error('expected both requirements after v1');

    const s20 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s20.itemVersionId,
      upstreamItemVersionId: r15.item_version_id,
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: s20.logicalItemId, itemVersionId: s20.itemVersionId },
    ]);

    // v(n+1): change only R-07 - R-15 comes back verbatim, so it stays
    // reused (same ItemVersion) and S-20's dependency is never obsolete.
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      {
        previousDisplayKey: r.display_key,
        payload: { ...rPayload, behavior: 'View the quarterly report, filtered' },
      },
      { previousDisplayKey: r15.display_key, payload: r15Payload },
    ]);
    await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
    const v2Members = await currentMembership(requirementsArtifactId, v2.versionId);
    const r15Now = v2Members.find((m) => m.logical_item_id === r15.logical_item_id);
    expect(r15Now?.item_version_id).toBe(r15.item_version_id); // reused, not a new revision

    const warnings = await impact.getWarnings(projectId);
    expect(warnings.find((w) => w.subjectId === s20.itemVersionId)).toBeUndefined();
  });

  // T3 - R-07 removed in v3.
  // Expected: ADR-03@B direct with root A (removed); no tombstone row
  // exists.
  it('T3: removing a Requirement leaves its downstream flagged, with no tombstone row', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T3' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');

    const rPayload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: rPayload },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
    if (!r) throw new Error('R-07 membership missing after v1 approval');

    const adr = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: architectureArtifactId,
      itemType: 'architecture_decision',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: adr.itemVersionId,
      upstreamItemVersionId: r.item_version_id,
    });
    await approveItemsVersion(
      architectureArtifactId,
      [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
      { architecture: true },
    );

    const logicalItemCountBefore = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE project_id = ${projectId} AND item_type = 'requirement'
    `;

    // v(n+1): R-07 omitted entirely - a genuinely new, unrelated item stands
    // in for it so the draft isn't empty (min(1) is only outputSchema's own
    // constraint for the real module, not matchAndPersistItems's).
    const otherPayload = { ...rPayload, actor: 'Support agent', behavior: 'Search past reports' };
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: otherPayload },
    ]);
    await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);

    const v2Members = await currentMembership(requirementsArtifactId, v2.versionId);
    expect(v2Members.some((m) => m.logical_item_id === r.logical_item_id)).toBe(false);

    // No tombstone row: r's own LogicalItem is untouched (append-only), and
    // no extra LogicalItem row was created to represent "removed".
    const logicalItemRow = await sql<{ id: string }[]>`
      SELECT id FROM logical_item WHERE id = ${r.logical_item_id}
    `;
    expect(logicalItemRow).toHaveLength(1);
    const logicalItemCountAfter = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE project_id = ${projectId} AND item_type = 'requirement'
    `;
    expect(Number(logicalItemCountAfter[0]!.count)).toBe(
      Number(logicalItemCountBefore[0]!.count) + 1, // only the new stand-in item, nothing for the removal
    );

    const warnings = await impact.getWarnings(projectId);
    const adrRow = warnings.find((w) => w.subjectId === adr.itemVersionId);
    expect(adrRow).toMatchObject({ rootItemVersionId: r.item_version_id, depth: 0 });
  });

  // T4 - Acknowledge S-12/A/against D; then R-07 D -> F. Separately:
  // acknowledge a removal (against NULL), then re-add the same content.
  // Expected: warning returns (acknowledgement no longer matches). The
  // re-added content is a new LogicalItem, so the removal acknowledgement
  // still matches (ERD section 4.12).
  describe('T4 - acknowledgements are cause-specific and stop matching once their root moves again', () => {
    it('T4a: acknowledging against a moved root stops matching once that root moves a second time', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T4a',
      });
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const rPayload = {
        type: 'functional',
        actor: 'Analyst',
        behavior: 'View the quarterly report',
        constraints: [],
        acceptanceCriteria: ['Report renders within 2s'],
        dimension: null,
        value: null,
      };
      const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: rPayload },
      ]);
      await fx.approveArtifactVersion(sql, v1.versionId);
      const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
      if (!r) throw new Error('R-07 membership missing after v1 approval');

      const s12 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: s12.itemVersionId,
        upstreamItemVersionId: r.item_version_id,
      });
      await approveItemsVersion(backlogArtifactId, [
        { logicalItemId: s12.logicalItemId, itemVersionId: s12.itemVersionId },
      ]);

      // R-07 A -> D.
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r.display_key,
          payload: { ...rPayload, behavior: 'View the quarterly report, v2' },
        },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);

      // Acknowledge S-12 against R-07/A (root_now resolves to D at ack time,
      // per acknowledge()'s own "re-read the root's current version" rule -
      // ERD 4.12).
      await withTx((tx) =>
        impact.acknowledge(tx, {
          projectId,
          subject: { itemVersionId: s12.itemVersionId },
          obsoleteUpstreamItemVersionId: r.item_version_id,
          userId,
          note: 'reviewed against R-07@D - text is still accurate',
        }),
      );
      const afterFirstAck = await impact.getWarnings(projectId);
      expect(afterFirstAck.find((w) => w.subjectId === s12.itemVersionId)).toMatchObject({
        rootItemVersionId: r.item_version_id,
        acknowledged: true,
      });

      // R-07 D -> F: the acknowledgement was resolved against D specifically
      // (acknowledged_against_upstream_item_version_id) - once D itself is
      // superseded the stored value no longer matches root_now, so the
      // acknowledgement stops applying (INV-026).
      const v3 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r.display_key,
          payload: { ...rPayload, behavior: 'View the quarterly report, v3' },
        },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v3.versionId);

      const afterSecondMove = await impact.getWarnings(projectId);
      expect(afterSecondMove.find((w) => w.subjectId === s12.itemVersionId)).toMatchObject({
        rootItemVersionId: r.item_version_id,
        acknowledged: false,
      });
    });

    it('T4b: acknowledging a removal (against NULL) still matches once the same content is re-added as a new LogicalItem', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T4b',
      });
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const rPayload = {
        type: 'functional',
        actor: 'Analyst',
        behavior: 'View the quarterly report',
        constraints: [],
        acceptanceCriteria: ['Report renders within 2s'],
        dimension: null,
        value: null,
      };
      const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: rPayload },
      ]);
      await fx.approveArtifactVersion(sql, v1.versionId);
      const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
      if (!r) throw new Error('R-07 membership missing after v1 approval');

      const s12 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: s12.itemVersionId,
        upstreamItemVersionId: r.item_version_id,
      });
      await approveItemsVersion(backlogArtifactId, [
        { logicalItemId: s12.logicalItemId, itemVersionId: s12.itemVersionId },
      ]);

      // R-07 removed entirely - a genuinely new, unrelated stand-in item
      // keeps the draft non-empty (same technique as T3).
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: { ...rPayload, actor: 'Support agent', behavior: 'Search past reports' } },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);

      await withTx((tx) =>
        impact.acknowledge(tx, {
          projectId,
          subject: { itemVersionId: s12.itemVersionId },
          obsoleteUpstreamItemVersionId: r.item_version_id,
          userId,
          note: 'R-07 was intentionally dropped - S-12 no longer needs it',
        }),
      );
      const ackRows = await sql<{ acknowledged_against_upstream_item_version_id: string | null }[]>`
        SELECT acknowledged_against_upstream_item_version_id FROM impact_acknowledgement
        WHERE subject_item_version_id = ${s12.itemVersionId}
          AND obsolete_upstream_item_version_id = ${r.item_version_id}
      `;
      expect(ackRows).toHaveLength(1);
      expect(ackRows[0]!.acknowledged_against_upstream_item_version_id).toBeNull(); // R-07 has no current version

      const afterAck = await impact.getWarnings(projectId);
      expect(afterAck.find((w) => w.subjectId === s12.itemVersionId)).toMatchObject({
        acknowledged: true,
      });

      // Re-add byte-for-byte the same content R-07 originally had. R-07's
      // LogicalItem is no longer part of the comparison base (it was removed
      // in v2), so content-only fallback matching (INV-014) cannot and must
      // not match it - this has to become a genuinely NEW LogicalItem.
      const v3 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        { payload: rPayload },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v3.versionId);
      const v3Members = await membershipWithPayload(requirementsArtifactId, v3.versionId);
      const rReAdded = v3Members.find(
        (m) => (m.payload as { behavior: string }).behavior === rPayload.behavior,
      );
      if (!rReAdded) throw new Error('re-added R-07 content missing from v3');
      expect(rReAdded.logical_item_id).not.toBe(r.logical_item_id); // a new LogicalItem, not a revival

      // The original acknowledgement still matches: r's ORIGINAL LogicalItem
      // still has no current membership (root_now stays NULL), regardless
      // of the new, unrelated LogicalItem that now happens to share its
      // content (INV-026 - never suppresses a different cause; this also
      // isn't the same cause, it just happens to look identical).
      const afterReAdd = await impact.getWarnings(projectId);
      expect(afterReAdd.find((w) => w.subjectId === s12.itemVersionId)).toMatchObject({
        rootItemVersionId: r.item_version_id,
        acknowledged: true,
      });
    });
  });

  // T5 - Requirements v3 draft holds R-07@D; then reject it.
  // Expected: no warnings while draft; none after rejection.
  it('T5: a draft never contributes to warnings, whether pending or rejected', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T5' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const rPayload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: rPayload },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
    if (!r) throw new Error('R-07 membership missing after v1 approval');

    const s12 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s12.itemVersionId,
      upstreamItemVersionId: r.item_version_id,
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: s12.logicalItemId, itemVersionId: s12.itemVersionId },
    ]);

    // A draft holding R-07@D sits alongside the still-approved R-07@A -
    // impact()'s current_m only ever considers approved memberships
    // (getWarnings always passes p_candidate_version_id = NULL), so a draft
    // contributes nothing regardless of what it contains.
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      {
        previousDisplayKey: r.display_key,
        payload: { ...rPayload, behavior: 'View the quarterly report, draft edit' },
      },
    ]);
    expect(v2.stale).toBe(false);
    const draftRow = await sql<{ status: string }[]>`
      SELECT status FROM artifact_version WHERE id = ${v2.versionId}
    `;
    expect(draftRow[0]?.status).toBe('draft');

    const whileDraft = await impact.getWarnings(projectId);
    expect(whileDraft.find((w) => w.subjectId === s12.itemVersionId)).toBeUndefined();

    // Reject it (raw update - artifact-lifecycle.rejectVersion doesn't exist
    // yet, same "fixture-style update" approach as approveArtifactVersion).
    await sql`
      UPDATE artifact_version SET status = 'rejected', status_reason = 'user_rejected'
      WHERE id = ${v2.versionId}
    `;

    const afterRejection = await impact.getWarnings(projectId);
    expect(afterRejection.find((w) => w.subjectId === s12.itemVersionId)).toBeUndefined();

    // R-07@A is still the current, approved version throughout - untouched.
    const stillCurrent = await currentMembership(requirementsArtifactId, v1.versionId);
    expect(stillCurrent[0]?.item_version_id).toBe(r.item_version_id);
  });

  // T6 - Backlog draft generated from Requirements v2; Requirements v3
  // changes R-07 before approval.
  // Expected: approval blocked with the blocking rows; override without a
  // note rejected by CHECK; override with a note approves, writes
  // acknowledgements + overrode_stale_check; regenerate passes without
  // override.
  // Turns green with E3-T1 (approval/architecture/generation gate - needs
  // approveVersion, which doesn't exist yet).
  it.todo('T6');

  // T7 - Context changes while generation is in flight.
  // Expected: persisted as rejected / stale_generation_context, no items
  // minted, tokens still recorded.
  // Turns green with E3-T1. (The pre-approval half of this scenario - that
  // a stale-context result never mints items - is exercisable once
  // generation persistence lands at E2-S9, but E3-T1 is where the Jira
  // Plan's own citation places it, so that's what this stub cites; not
  // splitting it into two tests to avoid inventing scope.)
  it.todo('T7');

  // T8 - Architecture v3 approval: ADR-01/02 unchanged, ADR-03 changed,
  // ADR-04 dropped.
  // Expected: ADR-01/02 reuse ItemVersions; ADR-03 gets a new revision
  // under the same LogicalItem; ADR-04 removed and its downstream flagged;
  // no ADR-05..08 minted.
  // Turns green with E3-T1 (needs approveVersion/materialize).
  it.todo('T8');

  // T9 - Select an option from another version; approve Architecture with
  // no selection; approve with 1 or 3 options.
  // Expected: all rejected by FK / guard trigger. Unselected option's ADRs
  // do not exist to be referenced.
  // Turns green with E3-T1.
  it.todo('T9');

  // T10 - Approve Requirements and Backlog concurrently; double-approve one
  // draft.
  // Expected: serialized by the project lock; exactly one approved version
  // per artifact; second gate sees first commit.
  // Turns green with E3-T1 (needs withProjectLock's caller, artifact-
  // lifecycle's approveVersion).
  it.todo('T10');

  // T11 - Lost response on repo/issue creation; unrelated repo with same
  // name; double-click; stale pending.
  // Expected: reconciliation_required; marker-verified adoption only;
  // conflict on foreign repo; one operation row; reconcile before any
  // resend.
  // Turns green with E4-T3 (external integrations gate).
  it.todo('T11');

  // T12 - S-12 changes after THR-42 exists, then export.
  // Expected: Skip / Create New prompt; no update, no silent duplicate.
  // Turns green with E4-T3.
  it.todo('T12');

  // T13 - Architecture re-approved with no ADR change; then with a changed
  // ADR.
  // Expected: repository not flagged; then flagged.
  // Turns green with E4-T3.
  it.todo('T13');

  // T14 - real, passing this slice (E1-S5's Definition of Done).
  describe('T14 - append-only tables / draft-only membership reject their forbidden writes', () => {
    it('T14a: UPDATE item_version raises (item_version_append_only)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const { itemVersionId } = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });

      await expect(
        sql`UPDATE item_version SET revision_number = revision_number + 1 WHERE id = ${itemVersionId}`,
      ).rejects.toThrow(/append-only/i);
    });

    it('T14b: UPDATE semantic_dependency raises (semantic_dependency_append_only)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const upstream = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });
      const downstream = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: downstream.itemVersionId,
        upstreamItemVersionId: upstream.itemVersionId,
      });

      await expect(
        sql`
          UPDATE semantic_dependency SET proposed_by = 'user'
          WHERE downstream_item_version_id = ${downstream.itemVersionId}
            AND upstream_item_version_id = ${upstream.itemVersionId}
        `,
      ).rejects.toThrow(/append-only/i);
    });

    it('T14c: adding membership to an approved (non-draft) artifact_version raises (membership_draft_only)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql);
      const artifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
      await fx.approveArtifactVersion(sql, versionId);
      const { logicalItemId, itemVersionId } = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId,
        itemType: 'requirement',
      });

      await expect(
        fx.createMembership(sql, {
          artifactVersionId: versionId,
          artifactId,
          logicalItemId,
          itemVersionId,
        }),
      ).rejects.toThrow(/frozen/i);
    });
  });

  // T15 - Revert R-07 A -> D -> E (E hash equals A).
  // Expected: E is a new revision; S-12@C (on A) stays flagged until
  // regenerated or acknowledged.
  it('T15: reverting to identical content still mints a new revision, and the old warning persists (no revert-reuse)', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T15' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const rPayloadA = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: rPayloadA },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
    if (!r) throw new Error('R-07 membership missing after v1 approval');

    const s12 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s12.itemVersionId,
      upstreamItemVersionId: r.item_version_id,
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: s12.logicalItemId, itemVersionId: s12.itemVersionId },
    ]);

    // R-07 A -> D.
    const rPayloadD = { ...rPayloadA, behavior: 'View the quarterly report, revised' };
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { previousDisplayKey: r.display_key, payload: rPayloadD },
    ]);
    await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
    const [rD] = await currentMembership(requirementsArtifactId, v2.versionId);
    if (!rD) throw new Error('R-07@D membership missing');
    expect(rD.item_version_id).not.toBe(r.item_version_id);

    // R-07 D -> E, where E's content is byte-for-byte identical to A's
    // (a revert). The matcher must still mint a brand new ItemVersion -
    // never reuse A's old row just because the hash happens to match again
    // (matcher.ts: "never reuse a non-base ItemVersion even on a hash
    // match" - A is not the comparison base for this generation, D is).
    const v3 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { previousDisplayKey: r.display_key, payload: rPayloadA },
    ]);
    await approveSupersedingCurrent(requirementsArtifactId, v3.versionId);
    const [rE] = await currentMembership(requirementsArtifactId, v3.versionId);
    if (!rE) throw new Error('R-07@E membership missing');
    expect(rE.logical_item_id).toBe(r.logical_item_id); // same LogicalItem
    expect(rE.item_version_id).not.toBe(r.item_version_id); // NOT reverted to A's row
    expect(rE.item_version_id).not.toBe(rD.item_version_id); // NOT D's row either - a real new revision
    const revisionRow = await sql<{ revision_number: number }[]>`
      SELECT revision_number FROM item_version WHERE id = ${rE.item_version_id}
    `;
    expect(revisionRow[0]?.revision_number).toBe(3); // A=1, D=2, E=3

    // S-12's dependency edge is immutable and still points at A specifically
    // (INV-015) - A is non-current no matter how many revisions came after
    // it, so S-12 stays flagged until it is itself regenerated or the
    // warning is acknowledged (neither happens in this test).
    const warnings = await impact.getWarnings(projectId);
    expect(warnings.find((w) => w.subjectId === s12.itemVersionId)).toMatchObject({
      rootItemVersionId: r.item_version_id,
      acknowledged: false,
    });
  });

  // T16 - Attempt each cross-project reference (edge, context ref, external
  // ref, operation, acknowledgement, Stitch output).
  // Expected: edge and ItemVersion rejected by the database; the rest
  // rejected by the service layer.
  // Turns green with E4-T3.
  it.todo('T16');

  // T17 - GitHub repo embeds ADR-01/02/03, all tracing to obsolete R-07@A.
  // Expected: one impact() row for the ref with root R-07@A (not one per
  // ADR); direct beats transitive.
  // Turns green with E2-S9.
  it.todo('T17');

  // T18 - Name collision on repo creation, then a different name.
  // Expected: first operation failed (name_taken_by_other); second is a new
  // operation with a new key; a second concurrent GitHub operation is
  // refused.
  // Turns green with E4-T3.
  it.todo('T18');

  // T19 - Change expectedScale (a constraint item) with ADRs citing it and
  // one that does not.
  // Expected: only the citing ADRs (and their descendants) are flagged.
  // Turns green with E2-S9.
  it.todo('T19');

  // T20 - Matcher meets a base ItemVersion with a different
  // semantic_hash_version.
  // Expected: throws; nothing is marked modified.
  // Turns green with E2-S9.
  it.todo('T20');

  // T21 - Regenerate an artifact with no user change (real LLM round trip).
  // Expected: zero new ItemVersions, zero new warnings - "the most
  // important test in the suite" per ERD section 10.
  //
  // This test uses a DETERMINISTIC in-process fake `generate` callback, not
  // a real OpenAI call (see this file's top-of-file E2-S9 addendum) - it
  // proves the createDraftFromGeneration -> identity.matchAndPersistItems
  // pipeline is stable under a verbatim re-submission. The genuine "real LLM
  // call, not a mock" proof this epic's Definition of Done requires (Jira
  // Plan line 148) is scripts/verify-real-generation-t21.ts, which drives
  // this SAME pipeline through the real src/artifact-types/requirements and
  // src/ai-client.
  it('T21: regenerating with no user change mints zero new ItemVersions and zero new warnings', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T21' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const rPayload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: ['Read-only'],
      acceptanceCriteria: ['Loads within 2s', 'Shows the latest quarter'],
      dimension: null,
      value: null,
    };

    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: rPayload },
    ]);
    expect(v1.stale).toBe(false);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
    if (!r) throw new Error('R-07 membership missing after v1 approval');

    // A downstream Story - "zero new warnings" needs something downstream
    // to actually observe (an empty array is meaningless on its own; it has
    // to still be empty for the RIGHT reason, after a real dependent item
    // exists).
    const s = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: s.itemVersionId,
      upstreamItemVersionId: r.item_version_id,
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: s.logicalItemId, itemVersionId: s.itemVersionId },
    ]);

    const before = await impact.getWarnings(projectId);
    expect(before).toHaveLength(0);

    // Regenerate: the exact same payload, verbatim, with previousDisplayKey
    // correctly round-tripped - ERD 5.4's regeneration-stability contract.
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { previousDisplayKey: r.display_key, payload: rPayload },
    ]);
    expect(v2.stale).toBe(false);
    const v2Members = await currentMembership(requirementsArtifactId, v2.versionId);
    expect(v2Members).toHaveLength(1);
    expect(v2Members[0]!.item_version_id).toBe(r.item_version_id); // reused - zero new ItemVersions
    expect(v2Members[0]!.logical_item_id).toBe(r.logical_item_id);
    await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);

    const itemVersionCount = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM item_version WHERE logical_item_id = ${r.logical_item_id}
    `;
    expect(Number(itemVersionCount[0]!.count)).toBe(1); // zero new ItemVersions, for real this time

    const dependencyCount = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM semantic_dependency WHERE project_id = ${projectId}
    `;
    expect(Number(dependencyCount[0]!.count)).toBe(1); // only S's original edge - zero new rows

    const after = await impact.getWarnings(projectId);
    expect(after).toHaveLength(0); // zero new warnings
  });

  // T22 - Approval gate for a Requirements candidate while an
  // acknowledgement exists whose root is an older Requirement version.
  // Expected: no error (regression test for the v1.1 runtime failure). Must
  // be a Requirements candidate - a Backlog candidate does not reproduce
  // it.
  // Turns green with E2-S9 (the gate query itself) and again with E3-T1
  // (the full approval workflow it's embedded in).
  it.todo('T22');

  // T23 - During that gate, an acknowledgement recorded against the
  // currently-approved version of the root.
  // Expected: acknowledged = false - the candidate supersedes that
  // version, so the acknowledgement stops matching.
  // Turns green with E2-S9 and E3-T1 (see T22).
  it.todo('T23');

  // T24 - Manually edit a draft Story that is bound to an obsolete upstream
  // version; confirm the shown rebinding.
  // Expected: new ItemVersion with proposed_by='user' edges to the current
  // upstream; no longer flagged; without confirmation, nothing is saved.
  // Turns green with E2-S9 (identity/rebinding mechanics) and E3-T1 (the
  // manual-revision workflow it's part of).
  it.todo('T24');

  // T25 - Insert a dependency cycle directly (bypassing the app) and call
  // impact().
  // Expected: terminates; each node reported once.
  // Turns green with E2-S9.
  it.todo('T25');

  // T26 - Export the same Backlog twice with a different configured Jira
  // project in between.
  // Expected: second export creates new operations (target-specific keys);
  // no completed operation is reused for the new target.
  // Turns green with E4-T3.
  it.todo('T26');

  // T27 - real, passing this slice (E1-S5's Definition of Done).
  it('T27: UPDATE architecture_option raises even after approval (architecture_option_append_only)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
    const optionAId = await fx.createArchitectureOption(sql, {
      artifactVersionId: versionId,
      optionKey: 'A',
    });
    await fx.createArchitectureOption(sql, { artifactVersionId: versionId, optionKey: 'B' });

    // The trigger fires on every UPDATE unconditionally, so approving first
    // isn't strictly required to prove the raise - done anyway, cheaply, to
    // match the ERD's stated scenario (section 10 T27).
    await fx.approveArtifactVersion(sql, versionId, {
      selectedArchitectureOptionId: optionAId,
    });

    await expect(
      sql`UPDATE architecture_option SET title = 'changed after approval' WHERE id = ${optionAId}`,
    ).rejects.toThrow(/append-only/i);
  });

  // T28 - real, passing this slice (E1-S5's Definition of Done).
  it('T28: INSERT an artifact_version with status=approved raises (artifact_version_insert_guard)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql);
    const artifactId = await fx.createArtifact(sql, projectId, 'requirements');

    await expect(
      sql`
        INSERT INTO artifact_version (artifact_id, version_number, status, schema_version)
        VALUES (${artifactId}, 1, 'approved', 1)
      `,
    ).rejects.toThrow(/must be created as draft or rejected/i);
  });

  // T29 - Move a Story to a different Epic in a new Backlog version.
  // Expected: no lineage signal - characterization of the accepted
  // limitation (ERD section 11).
  // Turns green with E4-T3.
  it.todo('T29');

  // T30 - Re-approve Architecture with every ADR reused but a different
  // stack.
  // Expected: approval refused by the stack guard.
  // Turns green with E3-T1.
  it.todo('T30');

  // T31 - Architecture regeneration where the model omits previousDisplayKey
  // on an unchanged ADR. Expected: content fallback matches it; the ADR
  // reuses its ItemVersion; no new key, nothing flagged.
  //
  // Adapted to Requirements, not Architecture: `architecture_decision`
  // candidates cannot go through createDraftFromGeneration at all (it
  // refuses them outright - ERD 5.5, ADRs mint only at approval via
  // architecture-materialization.materialize) so "the SAME scenario through
  // the full createDraftFromGeneration pipeline" this story asks for is
  // structurally impossible for the literal ADR case. This exercises the
  // identical mechanism (INV-014 content-only fallback matching an omitted
  // previousDisplayKey) on the one item type that story generation actually
  // owns. tests/integration/identity-matching.test.ts's own T31 covers the
  // literal Architecture/ADR scenario directly against
  // identity.matchAndPersistItems.
  it('T31 (adapted to Requirements): content-only fallback matches an unchanged item whose previousDisplayKey was omitted', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T31' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');

    const r1Payload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const r2Payload = {
      type: 'functional',
      actor: 'Manager',
      behavior: 'Approve the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Approval is logged'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: r1Payload },
      { payload: r2Payload },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const v1Members = await membershipWithPayload(requirementsArtifactId, v1.versionId);
    const r1 = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Analyst');
    const r2 = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Manager');
    if (!r1 || !r2) throw new Error('expected both requirements after v1');

    const logicalItemCountBefore = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE project_id = ${projectId} AND item_type = 'requirement'
    `;

    // r1 explicitly claims its key; r2 comes back with the SAME content but
    // no previousDisplayKey at all (the model "forgot" the hint) - content-
    // only fallback matching must still find it among the still-unclaimed
    // base members and reuse its ItemVersion.
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { previousDisplayKey: r1.display_key, payload: r1Payload },
      { payload: r2Payload }, // previousDisplayKey omitted on purpose
    ]);
    await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);

    const v2Members = await currentMembership(requirementsArtifactId, v2.versionId);
    expect(v2Members).toHaveLength(2);
    const r2Now = v2Members.find((m) => m.logical_item_id === r2.logical_item_id);
    expect(r2Now?.item_version_id).toBe(r2.item_version_id); // reused via content fallback

    const logicalItemCountAfter = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM logical_item WHERE project_id = ${projectId} AND item_type = 'requirement'
    `;
    expect(Number(logicalItemCountAfter[0]!.count)).toBe(Number(logicalItemCountBefore[0]!.count)); // no new key minted

    const warnings = await impact.getWarnings(projectId);
    expect(warnings).toHaveLength(0); // nothing flagged
  });

  // T32 - Two candidates claim the same previousDisplayKey.
  // Expected: Validation error before any insert.
  it('T32: two candidates claiming the same previousDisplayKey is a validation error before any insert', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T32' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');

    const rPayload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: rPayload },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const [r] = await currentMembership(requirementsArtifactId, v1.versionId);
    if (!r) throw new Error('R-07 membership missing after v1 approval');

    const versionCountBefore = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${requirementsArtifactId}
    `;
    const itemVersionCountBefore = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM item_version WHERE logical_item_id = ${r.logical_item_id}
    `;

    await expect(
      generateRequirements(projectId, requirementsArtifactId, userId, [
        { previousDisplayKey: r.display_key, payload: { ...rPayload, behavior: 'Claim A' } },
        { previousDisplayKey: r.display_key, payload: { ...rPayload, behavior: 'Claim B' } },
      ]),
    ).rejects.toThrow('Duplicate previousDisplayKey');

    // Nothing inserted, not even the draft artifact_version row - the whole
    // persist transaction rolls back when matchAndPersistItems throws (same
    // mechanism T20 proves in tests/integration/
    // artifact-lifecycle-generation.test.ts).
    const versionCountAfter = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${requirementsArtifactId}
    `;
    const itemVersionCountAfter = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM item_version WHERE logical_item_id = ${r.logical_item_id}
    `;
    expect(versionCountAfter).toEqual(versionCountBefore);
    expect(itemVersionCountAfter).toEqual(itemVersionCountBefore);
  });

  // T33 - Edit the project brief before and after the first Requirements
  // generation.
  // Expected: before: allowed. After: raises (project_seed_frozen).
  // Does NOT cite E2-S9/E3-T1/E4-T3 - the Jira Plan cites this one to
  // E1-S8, not one of the three lineage/approval/external gates. (The
  // project_seed_frozen trigger this exercises already exists as of E1-S4's
  // migrations, so this is technically passable today - left a stub anyway
  // because this ticket's explicit scope is T14/T27/T28/T34 only; not
  // widening it.)
  it.todo('T33');

  // T34 - real, passing this slice (E1-S5's Definition of Done).
  //
  // Role/ownership approach: migrations are applied as the container's
  // default user, a real Postgres superuser (the fallback Project Setup /
  // this ticket's brief explicitly allow for T14/T27/T28, which test
  // triggers/CHECKs that fire regardless of role). For T34 specifically,
  // every anon-role assertion runs with the session's role switched via
  // `SET LOCAL ROLE anon` inside its own transaction (tests/integration/
  // support/roles.ts `asAnon`, tests/integration/support/assertions.ts
  // `expectDeniedAsAnon`) - a superuser may SET
  // ROLE to any role without membership and, per the PostgreSQL docs, loses
  // its superuser/BYPASSRLS privileges for the duration, so this exercises
  // the real REVOKE+RLS hardening, not a superuser's (meaningless) view of
  // it. `createSupabaseRoles` (support/roles.ts) also reproduces Supabase's
  // default-privilege behaviour (`ALTER DEFAULT PRIVILEGES ... TO anon,
  // authenticated`) before the migrations run, so 0001/0006's REVOKE
  // statements have real grants to revoke on this vanilla container - see
  // that file's comment for why that matters (without it, the table-level
  // denials would pass locally for the wrong reason, since a vanilla
  // Postgres never grants PUBLIC/anon anything on a table by default in the
  // first place - unlike functions, where EXECUTE *is* granted to PUBLIC by
  // default, which is why the impact() denial below is the one sub-check
  // that's meaningful on this container without that reproduction, and the
  // accidental-grant sub-check is meaningful regardless).
  describe('T34 - Supabase anon is denied read/write/EXECUTE everywhere; RLS still blocks an accidental grant', () => {
    // Every table Appendix A.3 enables RLS on (drizzle/migrations/0001,
    // 0006) - the complete 16-table ERD model.
    const HARDENED_TABLES = [
      'app_user',
      'project',
      'artifact',
      'artifact_version',
      'architecture_option',
      'approval_event',
      'logical_item',
      'item_version',
      'artifact_version_item_membership',
      'generation_context_ref',
      'semantic_dependency',
      'external_operation',
      'external_ref',
      'impact_acknowledgement',
      'ai_generation_run',
      'stitch_output',
    ] as const;

    it('T34a: anon SELECT is denied on every one of the 16 hardened tables', async () => {
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`SELECT 1 FROM "${table}" LIMIT 1`));
      }
    });

    it('T34b: anon INSERT is denied on every one of the 16 hardened tables', async () => {
      // DEFAULT VALUES needs no knowledge of a table's columns and, because
      // Postgres checks table-level privileges before row constraints, a
      // denied INSERT never gets far enough to also trip a NOT NULL
      // violation - the error is permission denied, full stop, even for
      // tables with no nullable/defaulted columns at all.
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`INSERT INTO "${table}" DEFAULT VALUES`));
      }
    });

    it('T34c: anon DELETE is denied on every one of the 16 hardened tables', async () => {
      // WHERE false needs no knowledge of a table's columns either, and
      // privilege checks don't depend on how many rows would actually
      // match.
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`DELETE FROM "${table}" WHERE false`));
      }
    });

    it('T34d: anon UPDATE is denied (spot check: project, app_user)', async () => {
      await expectDeniedAsAnon(sql, (tx) =>
        tx.unsafe(`UPDATE project SET name = name WHERE false`),
      );
      await expectDeniedAsAnon(sql, (tx) =>
        tx.unsafe(`UPDATE app_user SET email = email WHERE false`),
      );
    });

    it('T34e: anon calling impact() is denied (EXECUTE revoked from PUBLIC/anon/authenticated)', async () => {
      // Any well-formed uuid does - EXECUTE is denied before the function
      // body (and therefore any lookup against p_project_id) ever runs.
      const someProjectId = randomUUID();
      await expectDeniedAsAnon(sql, (tx) =>
        tx.unsafe(`SELECT * FROM impact('${someProjectId}'::uuid)`),
      );
    });

    it('T34f: an accidental GRANT still yields zero rows under RLS (no policies)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'T34 accidental grant' });

      await sql.unsafe('GRANT SELECT ON project TO anon');
      try {
        const rows = await asAnon(
          sql,
          (tx) => tx<{ id: string }[]>`SELECT id FROM project WHERE id = ${projectId}`,
        );
        // No error this time (anon *can* read the table now) - but RLS is
        // enabled with no policies, so the row set is still empty. This is
        // the two-layer defense Appendix A.3's own comment describes: layer
        // 1 (REVOKE) stops the Data API outright; layer 2 (RLS, no
        // policies) means even a later accidental GRANT like this one still
        // exposes zero rows.
        expect(rows).toHaveLength(0);
      } finally {
        // Never let the accidental grant leak into a later test.
        await sql.unsafe('REVOKE SELECT ON project FROM anon');
      }

      // And the row genuinely exists (for the owner) - proving RLS hid it
      // from anon, rather than the table just being empty.
      const asOwner = await sql<{ id: string }[]>`SELECT id FROM project WHERE id = ${projectId}`;
      expect(asOwner).toHaveLength(1);
    });
  });

  // T35 - Delete a Supabase user and re-create them with the same email;
  // log in twice.
  // Expected: a new app_user row with the new id; the old row and its
  // history remain; the login upsert is idempotent.
  // Does NOT cite E2-S9/E3-T1/E4-T3 - it needs the `auth` module
  // (getVerifiedUser/upsertAppUser, roughly E1-S6) and a live Supabase Auth
  // user lifecycle, not a Postgres container. Project Setup section 10 step
  // 10 is where this actually gets verified.
  it.todo('T35');

  // T36 - Insert a version directly as rejected with a non-stale reason;
  // move a draft to rejected claiming stale_generation_context.
  // Expected: both raise.
  // Turns green with E4-T3.
  //
  // (Both sub-cases are actually exercisable against the trigger today -
  // artifact_version_insert_guard and artifact_version_guard both already
  // exist (E1-S4) - but the Jira Plan's own mapping places T36 at E4-T3, so
  // this stays a stub rather than force-passing it out of citation order.)
  it.todo('T36');

  // T37 - stitch_output with mode='manual_fallback' and a ref; with
  // mode='api' and none.
  // Expected: both raise.
  // Turns green with E4-T3.
  it.todo('T37');

  // T38 - Update an external_operation while writing an old updated_at.
  // Expected: the stored updated_at is the time of the update.
  // Turns green with E4-T3.
  it.todo('T38');

  // T39 - Create a Jira operation with no item, or with an item that is not
  // a member of its Backlog version; create any operation with no source
  // version.
  // Expected: all raise at step 1 - before any provider call.
  // Turns green with E4-T3.
  it.todo('T39');

  // T40 - Open a manual revision of approved Requirements, edit only R-07,
  // approve.
  // Expected: the draft initially shares every ItemVersion with the
  // approved version and has no context refs; after approval exactly one
  // new ItemVersion exists; only R-07's dependency chain is flagged.
  // Turns green with E3-T1 (needs the manual-revision path and
  // approveVersion, which don't exist yet).
  it.todo('T40');

  // T41 - Edit Epic E-01's title, re-approve the Backlog, re-export to
  // Jira; choose Skip for E-01.
  // Expected: the Skip / Create New prompt appears for the Epic; no second
  // Jira Epic is created; its Stories are parented to the existing Jira
  // Epic of E-01.
  // Turns green with E4-T3.
  it.todo('T41');

  // T42 - Preview a Jira export whose Stories include a flagged Story.
  // Expected: the preview lists the impact rows and requires an explicit
  // confirmation; the resulting ref is flagged immediately.
  // Turns green with E4-T3.
  it.todo('T42');

  // T43 - Try to generate UI Requirements before Architecture is approved,
  // and a Backlog before UI Requirements is approved.
  // Expected: both refused (TR FR-080).
  it('T43: generation order is enforced - UI Requirements needs approved Architecture; Backlog needs approved UI Requirements', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T43' });
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const uiRequirementsArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const attemptUiRequirements = () =>
      lifecycle.createDraftFromGeneration({
        projectId,
        artifactId: uiRequirementsArtifactId,
        itemType: 'ui_requirement',
        contextSourceVersionIds: [],
        actorUserId: userId,
        generate: () => uiRequirementsType.generate({ projectId }),
      });

    // Nothing approved yet - refused, citing both missing prerequisites.
    await expect(attemptUiRequirements()).rejects.toThrow(
      'UI Requirements generation requires approved Requirements and Architecture first (TR FR-080)',
    );
    const uiVersionsAfterFirstAttempt = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${uiRequirementsArtifactId}
    `;
    expect(Number(uiVersionsAfterFirstAttempt[0]!.count)).toBe(0); // refused before any row was written

    // Approve Requirements only - still refused, now citing only Architecture.
    const rV1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      {
        payload: {
          type: 'functional',
          actor: 'Analyst',
          behavior: 'View the quarterly report',
          constraints: [],
          acceptanceCriteria: ['Loads within 2s'],
          dimension: null,
          value: null,
        },
      },
    ]);
    await fx.approveArtifactVersion(sql, rV1.versionId);

    await expect(attemptUiRequirements()).rejects.toThrow(
      'UI Requirements generation requires approved Architecture first (TR FR-080)',
    );

    // Approve Architecture (fixture - Architecture generation itself is out
    // of scope for this story, ERD 5.5) - the FR-080 check now passes, so
    // `generate` reaches its own not-implemented error instead.
    const adr = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: architectureArtifactId,
      itemType: 'architecture_decision',
    });
    await approveItemsVersion(
      architectureArtifactId,
      [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
      { architecture: true },
    );

    await expect(attemptUiRequirements()).rejects.toThrow(
      'buildPrompt/outputSchema/toCandidates are out of scope for E2-S9',
    );

    // Backlog before UI Requirements is approved - refused, citing only the
    // still-missing UI Requirements (Requirements and Architecture are both
    // satisfied by this point).
    await expect(
      lifecycle.createDraftFromGeneration({
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'epic',
        contextSourceVersionIds: [],
        actorUserId: userId,
        generate: () => backlogType.generate({ projectId }),
      }),
    ).rejects.toThrow('Backlog generation requires approved UI Requirements first (TR FR-080)');
    const backlogVersionsAfterAttempt = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${backlogArtifactId}
    `;
    expect(Number(backlogVersionsAfterAttempt[0]!.count)).toBe(0);
  });
});
