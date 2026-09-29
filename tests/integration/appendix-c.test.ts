import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { sql as drizzleSql } from 'drizzle-orm';
import type postgres from 'postgres';
import type { OptionInput } from '@/architecture-materialization';
import { connect } from './support/connection';
import * as fx from './support/fixtures';
import { asAnon } from './support/roles';
import { expectDeniedAsAnon } from './support/assertions';

// E4-T3's own seam (this story's instructions, "Auth" section): `getVerifiedUser`
// talks to Supabase and cannot work against this Testcontainers-only harness -
// replaced with a plain `vi.fn()`. `requireProjectOwner` (and everything else
// `@/auth` exports) stays REAL via `importOriginal` - it reads the real
// `project` table and is what enforces the 404-never-403 rule (API Contracts
// 1.4); mocking identity is a necessary seam, mocking authorization would
// hollow out every T11/T12/T13/T18/T26/T41/T42 route test below.
vi.mock('@/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth')>()),
  getVerifiedUser: vi.fn(),
}));

// E3-S10 (SCRUM-45): `ui-requirements.generate` no longer ends in E2-S9's
// not-implemented stub - once FR-080 passes it loads its context and calls the
// model. T43 below only proves the ORDER is enforced, so it must never spend a
// real completion or depend on OPENAI_* env: the one function that reaches the
// provider is replaced with a double that throws a recognizable error, and
// everything else `@/ai-client` exports (linkGenerationRun, used by every
// createDraftFromGeneration call in this file) stays REAL via `importOriginal`.
vi.mock('@/ai-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/ai-client')>()),
  generateStructured: vi.fn(async () => {
    throw new Error('generateStructured reached (test double - no real model call)');
  }),
}));

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
// the frozen drizzle/migrations/0000-0010 in order. Fixture rows use only
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

// E4-T3 (SCRUM-56) addendum: T11, T12, T13, T18, T26, T41, T42 below are now
// real, passing assertions - ERD 14 slice 4's gate ("T11-T13, T18, T26, T41,
// T42", docs/Throughline_Jira_Plan.md line ~189), all seven of the ids this
// story's own row cites. Each drives its ERD scenario through the real
// E4-S6 API route handlers (`src/app/api/projects/[projectId]/github/*`,
// `.../jira/*`, `.../external-refs/route.ts`) against this same
// Testcontainers Postgres, reusing the fake-provider-via-
// `globalThis.fetch`-swap technique tests/integration/external/github.test.ts
// and jira.test.ts already established (adapted, not imported - this file's
// own "every file builds its own fixture composition" convention, restated
// at the top of this file's header comment) - those two files already prove
// the same scenarios at the MODULE level (`github.initRepo`, `jira.
// exportBacklog`, ...); what's added here is the HTTP leg on top: a real
// `Request` into the route handler, asserted on both the documented response
// shape (API Contracts sections 7-9) and the resulting `external_operation`/
// `external_ref` rows.
//
// T13 was blocked by a real E4-S6 defect that this gate task found and
// fixed - not worked around. `src/app/api/_shared/external.ts`'s
// `getAllExternalRefsForProject` (used by both `GET .../github/ref` and
// `GET .../external-refs`) used to resolve every ref by first collecting
// `approvedVersionIds(project)` - literally the CURRENT `approvedVersionId`
// per artifact type - then merging `external-operations.
// getRefsForVersion(thatId)` over that list, an EXACT match on
// `external_ref.source_artifact_version_id`. A GitHub ref's own
// `source_artifact_version_id` is fixed forever at the one Architecture
// version approved when `initRepo` ran (ERD 4.15: one repository per
// project, ever - there is no second `initRepo` call to ever re-point it).
// T13's own scenario is "Architecture re-approved... then with a changed
// ADR" - i.e. it REQUIRES at least one re-approval AFTER the repo already
// exists, which mints a brand-new `artifact_version` id and supersedes the
// one the ref is still pinned to. The moment that happened - with or without
// an actual ADR change, so even T13's OWN "not flagged" first half broke the
// same way - `approvedVersionIds` no longer included the ref's origin
// version, `getRefsForVersion` returned nothing for it, and both
// `GET .../github/ref` (`{ ref: null }`) and `GET .../external-refs` (absent
// from `refs[]`) lost track of a repo that genuinely still existed, whose
// drift `github.checkDrift(refId)` would have correctly computed if either
// route had ever reached it.
//
// This was a production bug, not a test bug, and this gate task's own
// instructions are explicit that fixing a real defect the gate finds is
// exactly what a gate task is for - the thing it must never do is bend
// production code to make a test pass spuriously, which this is not: the
// fix makes `getAllExternalRefsForProject` match API Contracts section 7's
// own normative sentence ("All GitHub/Jira/Stitch references created from
// this project, each with its own drift flag") instead of the lossy
// per-approved-version merge that sentence's own parenthetical hinted at.
// The fix: `external-operations.getRefsForProject(projectId)` (added this
// story, `src/external/operations/index.ts`) reads `external_ref` directly
// by its own `project_id` column - a ref is discoverable for the life of the
// project regardless of how many times its source artifact has since been
// re-approved. `getAllExternalRefsForProject` now calls it directly;
// `approvedVersionIds` is deleted (nothing else used it). `GET .../
// external-refs` and `GET .../github/ref` no longer call
// `artifact-lifecycle.getProjectById` at all - `requireProjectOwner` already
// establishes the project exists and is owned, and neither route needs an
// approved-version id for anything else - which narrows `src/app/api/
// README.md`'s exception 3 from eight routes to six (reported, not edited
// here per this story's instructions). This is unrelated to T17 (already
// closable before this fix - see below): T17 never re-approves Architecture
// at all, only Requirements, so the ref's origin version stayed current
// throughout and the old bug never triggered for it.
//
// T17 is NOT in this story's cited set (docs/Throughline_Jira_Plan.md's
// E4-T3 row cites only T11-T13, T18, T26, T41, T42 - T17 belongs to E4-S2 per
// that story's own row) - its stub comment above (just below) says "E4-T3
// re-runs it through the real API routes," which is a real discrepancy
// between that comment and the Jira Plan, flagged rather than silently
// absorbed (this story's own instructions). It falls out naturally from the
// `GET .../external-refs`/`github/ref` route work this story already does
// (unlike T13, T17's Architecture version is never superseded, so the
// `_shared/external.ts` bug fixed above never applied to it either way) -
// closed here as a bonus, not a scope change: the Jira Plan row remains the
// authoritative Definition of Done for this story, and it lists seven ids
// (T11-T13, T18, T26, T41, T42), not eight.

let sql: postgres.Sql;
let lifecycle: typeof import('@/artifact-lifecycle');
let impact: typeof import('@/lineage/impact');
let uiRequirementsType: typeof import('@/artifact-types/ui-requirements');
let backlogType: typeof import('@/artifact-types/backlog');
let withTx: typeof import('@/db').withTx;
// E4-T3 additions: the `auth` module (for its now-mocked `getVerifiedUser`),
// `github` (for `normalizeRepoName` only - initRepo/checkDrift are reached
// through the routes below, never called directly), and the route handlers
// themselves.
let authModule: typeof import('@/auth');
let github: typeof import('@/external/github');
let githubInitRoute: typeof import('@/app/api/projects/[projectId]/github/init/route').POST;
let githubRefRoute: typeof import('@/app/api/projects/[projectId]/github/ref/route').GET;
let jiraExportRoute: typeof import('@/app/api/projects/[projectId]/jira/export/route').POST;
let jiraPreviewRoute: typeof import('@/app/api/projects/[projectId]/jira/preview/route').GET;
let externalRefsRoute: typeof import('@/app/api/projects/[projectId]/external-refs/route').GET;

// E3-T1 additions: the artifact-lifecycle workflow-transition routes (E3-S10/
// E3-S11) T6-T10/T22-T24/T30/T40 below drive for real, plus `architecture`
// (for `createOptions` - building an Architecture draft's two options has no
// route of its own, generation is the only writer and that path is blocked by
// the `@/ai-client` mock above, so this is setup, same status as the `fx.*`
// fixtures) and `dbModule` (for `withProjectLock` - T10's own external-hold
// probe, same technique tests/integration/db-lock.test.ts uses to force real
// lock contention rather than trust Node's scheduling).
let architecture: typeof import('@/artifact-types/architecture');
let dbModule: typeof import('@/db');
let reviseRoute: typeof import('@/app/api/projects/[projectId]/artifacts/[type]/revise/route').POST;
let approveRoute: typeof import('@/app/api/artifact-versions/[versionId]/approve/route').POST;
let itemEditPreviewRoute: typeof import('@/app/api/artifact-versions/[versionId]/items/[logicalItemId]/edit/preview/route').POST;
let commitItemEditRoute: typeof import('@/app/api/artifact-versions/[versionId]/items/[logicalItemId]/route').PUT;

// E4-T3 provider config constants - same shape as
// tests/integration/external/github.test.ts / jira.test.ts's own constants,
// duplicated here rather than imported (this file's own "every file builds
// its own fixture composition" convention, restated at the top of the file).
const FAKE_GITHUB_OWNER = 'thrln-e4t3-owner';
// Fixed (not random-per-run) - T11's own scenarios below reconcile ACROSS two
// separate route calls that must compute the IDENTICAL marker both times.
const TEST_MARKER_SECRET = 'e4-t3-test-fixture-marker-secret-do-not-use-in-prod';
const JIRA_BASE_URL = 'https://fake-jira-e4t3.example.test';
const JIRA_EMAIL = 'throughline-e4t3-test@example.test';
const JIRA_API_TOKEN = 'fake-jira-e4t3-token';
const DEFAULT_JIRA_PROJECT_KEY = 'THRE4T3';

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
  // E4-T3: github/jira provider config, same env vars
  // tests/integration/external/github.test.ts and jira.test.ts already set up
  // for the SAME modules, reached here through the route handlers instead of
  // directly. Must land before the first import below - `@/lib/env` is a
  // module-level singleton parsed once at import time (this file's own
  // gotcha comment above, restated for these vars too).
  process.env.GITHUB_OWNER = FAKE_GITHUB_OWNER;
  process.env.GITHUB_MARKER_SECRET = TEST_MARKER_SECRET;
  process.env.JIRA_BASE_URL = JIRA_BASE_URL;
  process.env.JIRA_EMAIL = JIRA_EMAIL;
  process.env.JIRA_API_TOKEN = JIRA_API_TOKEN;
  process.env.JIRA_PROJECT_KEY = DEFAULT_JIRA_PROJECT_KEY;
  lifecycle = await import('@/artifact-lifecycle');
  impact = await import('@/lineage/impact');
  uiRequirementsType = await import('@/artifact-types/ui-requirements');
  backlogType = await import('@/artifact-types/backlog');
  withTx = (await import('@/db')).withTx;
  authModule = await import('@/auth');
  github = await import('@/external/github');
  githubInitRoute = (await import('@/app/api/projects/[projectId]/github/init/route')).POST;
  githubRefRoute = (await import('@/app/api/projects/[projectId]/github/ref/route')).GET;
  jiraExportRoute = (await import('@/app/api/projects/[projectId]/jira/export/route')).POST;
  jiraPreviewRoute = (await import('@/app/api/projects/[projectId]/jira/preview/route')).GET;
  externalRefsRoute = (await import('@/app/api/projects/[projectId]/external-refs/route')).GET;
  architecture = await import('@/artifact-types/architecture');
  dbModule = await import('@/db');
  reviseRoute = (await import('@/app/api/projects/[projectId]/artifacts/[type]/revise/route')).POST;
  approveRoute = (await import('@/app/api/artifact-versions/[versionId]/approve/route')).POST;
  itemEditPreviewRoute = (
    await import('@/app/api/artifact-versions/[versionId]/items/[logicalItemId]/edit/preview/route')
  ).POST;
  commitItemEditRoute = (
    await import('@/app/api/artifact-versions/[versionId]/items/[logicalItemId]/route')
  ).PUT;
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

// --- Shared helpers for the E4-T3 additions below ---------------------------

// Backlog approval that supports `parentLogicalItemId` (Story -> Epic), which
// `approveItemsVersion` above does not - needed for T12/T26/T41/T42's
// Epic/Story fixtures. Same auto-incrementing-version-number convention as
// `approveItemsVersion`, mirrors jira.test.ts's own local
// `approveBacklogVersion` (reproduced, not imported - see this file's header).
async function approveBacklogVersionForJira(
  artifactId: string,
  members: { logicalItemId: string; itemVersionId: string; parentLogicalItemId?: string | null }[],
): Promise<string> {
  const [latest] = await sql<{ version_number: number | null }[]>`
    SELECT MAX(version_number) AS version_number FROM artifact_version WHERE artifact_id = ${artifactId}
  `;
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId, {
    versionNumber: (latest?.version_number ?? 0) + 1,
  });
  for (const member of members) {
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId: member.logicalItemId,
      itemVersionId: member.itemVersionId,
      parentLogicalItemId: member.parentLogicalItemId ?? null,
    });
  }
  const [current] = await sql<{ id: string }[]>`
    SELECT id FROM artifact_version WHERE artifact_id = ${artifactId} AND status = 'approved'
  `;
  if (current) await supersede(current.id);
  await fx.approveArtifactVersion(sql, versionId);
  return versionId;
}

async function githubOperationRows(projectId: string) {
  return sql<{ operation_key: string; status: string; error_message: string | null }[]>`
    SELECT operation_key, status, error_message FROM external_operation
    WHERE project_id = ${projectId} AND provider = 'github'
    ORDER BY created_at
  `;
}

async function githubRefRows(projectId: string) {
  return sql<{ id: string }[]>`
    SELECT id FROM external_ref WHERE project_id = ${projectId} AND provider = 'github'
  `;
}

async function jiraOperationRows(projectId: string) {
  return sql<{ operation_key: string; status: string }[]>`
    SELECT operation_key, status FROM external_operation
    WHERE project_id = ${projectId} AND provider = 'jira'
    ORDER BY created_at
  `;
}

async function jiraRefRowsForItem(itemVersionId: string) {
  return sql<{ id: string; external_key: string | null }[]>`
    SELECT id, external_key FROM external_ref
    WHERE provider = 'jira' AND source_item_version_id = ${itemVersionId}
  `;
}

// Mocks `getVerifiedUser` (the one seam this story's instructions authorize -
// see the `vi.mock('@/auth', ...)` call at the top of this file) as the given
// project's own owner - `requireProjectOwner` downstream of it stays real.
function mockAuthAsOwner(userId: string): void {
  vi.mocked(authModule.getVerifiedUser).mockResolvedValue({
    id: userId,
    email: `${userId}@example.test`,
    displayName: null,
  });
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string): Request {
  return new Request(url);
}

function routeParams(projectId: string): { params: Promise<{ projectId: string }> } {
  return { params: Promise.resolve({ projectId }) };
}

// --- E3-T1 additions: request/params builders for the version-scoped routes ---

function versionRouteParams(versionId: string): { params: Promise<{ versionId: string }> } {
  return { params: Promise.resolve({ versionId }) };
}

function artifactTypeRouteParams(
  projectId: string,
  type: string,
): { params: Promise<{ projectId: string; type: string }> } {
  return { params: Promise.resolve({ projectId, type }) };
}

function itemRouteParams(
  versionId: string,
  logicalItemId: string,
): { params: Promise<{ versionId: string; logicalItemId: string }> } {
  return { params: Promise.resolve({ versionId, logicalItemId }) };
}

function putJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function approveUrl(versionId: string): string {
  return `http://localhost/api/artifact-versions/${versionId}/approve`;
}

// --- E3-T1 additions: Architecture draft/option builders for T8/T9/T30 -----
//
// Building an Architecture draft's two options has no route of its own -
// generation is the only writer (architecture.generate -> createOptions,
// composed by the real POST .../generate route) and that path is blocked by
// the file-wide `@/ai-client` mock (T43's own reasoning, restated at the top
// of this file) - so a raw insert here (base_approved_version_id +
// generation_context_ref, same shape tests/integration/
// architecture-materialization.test.ts's own `draft()` helper builds) plus the
// REAL `architecture.createOptions` module call (not a raw architecture_option
// insert - createOptions is the real production write path, only its HTTP
// front door is unreachable under this file's mock) is the setup; approval
// itself - what T8/T9/T30 actually test - always goes through the real
// `POST .../approve` route below.
async function createArchitectureDraftVersion(
  artifactId: string,
  versionNumber: number,
  opts: { baseVersionId?: string | null; sourceVersionIds?: string[] } = {},
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO artifact_version
      (artifact_id, version_number, status, schema_version, payload, base_approved_version_id)
    VALUES (${artifactId}, ${versionNumber}, 'draft', 1, '{}', ${opts.baseVersionId ?? null})
    RETURNING id
  `;
  const id = row!.id;
  for (const sourceVersionId of opts.sourceVersionIds ?? []) {
    await sql`
      INSERT INTO generation_context_ref (target_artifact_version_id, source_artifact_version_id)
      VALUES (${id}, ${sourceVersionId})
    `;
  }
  return id;
}

function architectureOptionInput(
  decisions: { previousDisplayKey?: string | null; title: string; upstreamRefs?: string[] }[],
  stack: Record<string, unknown> = { database: 'postgres', frontend: 'react' },
): OptionInput {
  return {
    title: 'Architecture',
    summary: 'Project-specific approach',
    stack,
    tradeoffs: [{ factor: 'deadline', assessment: 'Use the existing team skills' }],
    candidateDecisions: decisions.map((d) => ({
      previousDisplayKey: d.previousDisplayKey ?? null,
      title: d.title,
      decision: d.title,
      technologyOrApproach: 'implementation',
      constraints: [],
      significantTradeoffs: [],
      upstreamRefs: d.upstreamRefs ?? [],
    })),
  };
}

// --- E3-T1 addition: Backlog Story generation for T6/T40 -------------------
//
// Same technique as `generateRequirements` above (a deterministic in-process
// fake `generate` through the real `createDraftFromGeneration`), for a Story
// depending on a given Requirements version's own current members -
// `upstreamRefs` are resolved by `identity.matchAndPersistItems`/`dependency-
// binding.bindUpstreamRefs` against `contextSourceVersionIds`' real membership,
// not a raw `fx.createSemanticDependency` edge - this is the real generation
// mechanism T6's own scenario is about ("Backlog draft generated from
// Requirements v2").
async function generateBacklogStory(
  projectId: string,
  backlogArtifactId: string,
  userId: string,
  contextSourceVersionIds: string[],
  candidates: {
    previousDisplayKey?: string | null;
    payload: Record<string, unknown>;
    upstreamRefs: string[];
  }[],
): Promise<{ versionId: string; stale: boolean }> {
  const result = await lifecycle.createDraftFromGeneration({
    projectId,
    artifactId: backlogArtifactId,
    itemType: 'story',
    contextSourceVersionIds,
    actorUserId: userId,
    generate: async () => {
      const runId = await fx.createAiGenerationRun(sql, { projectId });
      return {
        payload: { modelNote: 'appendix-c T6/T40 fixture' },
        candidates: candidates.map((c) => ({
          previousDisplayKey: c.previousDisplayKey ?? null,
          payload: c.payload,
          upstreamRefs: c.upstreamRefs,
        })),
        runId,
      };
    },
  });
  return { versionId: result.version.id, stale: result.stale };
}

// ---------------------------------------------------------------------------
// Fake GitHub - adapted from tests/integration/external/github.test.ts's own
// `createFakeGitHub`/`createResponseDropper` (same technique, condensed to
// exactly what T11/T17/T18 below exercise through the routes; not imported,
// per this file's own "every file builds its own fixture composition"
// convention).
// ---------------------------------------------------------------------------

interface FakeGithubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
}

// Module-level, not per-`createFakeGithubProvider()` call - keeps every fake
// repo's numeric id unique across the whole file's shared Testcontainers
// Postgres (external_ref has a real UNIQUE(provider, external_id)), same
// reasoning as github.test.ts's own `nextFakeGitHubId`.
let nextFakeGithubId = 700_000;

function createFakeGithubProvider(owner: string) {
  const repos = new Map<string, FakeGithubRepo>();
  const repoKey = (name: string): string => `${owner}/${name}`;
  const toApiShape = (repo: FakeGithubRepo) => ({
    id: repo.id,
    name: repo.name,
    full_name: repo.fullName,
    description: repo.description,
    html_url: repo.htmlUrl,
    private: true,
    owner: { login: owner },
  });
  const jsonResponse = (status: number, data: unknown): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  function seedForeignRepo(name: string, description: string): void {
    const fullName = repoKey(name);
    repos.set(fullName, {
      id: nextFakeGithubId++,
      name,
      fullName,
      description,
      htmlUrl: `https://github.com/${fullName}`,
    });
  }

  async function fetchImpl(url: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(url);

    if (method === 'POST' && pathname === '/user/repos') {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { name: string; description?: string })
        : { name: '' };
      const fullName = repoKey(body.name);
      if (repos.has(fullName)) {
        return jsonResponse(422, {
          message: 'Repository creation failed.',
          errors: [
            {
              resource: 'Repository',
              code: 'custom',
              field: 'name',
              message: 'name already exists on this account',
            },
          ],
        });
      }
      const created: FakeGithubRepo = {
        id: nextFakeGithubId++,
        name: body.name,
        fullName,
        description: body.description ?? '',
        htmlUrl: `https://github.com/${fullName}`,
      };
      repos.set(fullName, created);
      return jsonResponse(201, toApiShape(created));
    }

    const getMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && getMatch) {
      const [, matchedOwner, name] = getMatch;
      const found = matchedOwner === owner && name ? repos.get(repoKey(name)) : undefined;
      if (!found) return jsonResponse(404, { message: 'Not Found' });
      return jsonResponse(200, toApiShape(found));
    }

    const contentsMatch = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(pathname);
    if (method === 'PUT' && contentsMatch) {
      // initRepo's README/ADR/lineage.json writes (FR-033/034/035) - exact
      // content isn't asserted on here (same scope decision github.test.ts's
      // own fake makes), a minimal valid response shape is enough.
      return jsonResponse(201, {
        content: { path: contentsMatch[3] },
        commit: { sha: `fake-e4t3-${nextFakeGithubId++}` },
      });
    }

    throw new Error(`fake GitHub fetch (E4-T3): unhandled ${method} ${pathname}`);
  }

  return { fetch: fetchImpl, seedForeignRepo, repos };
}

// "Simulate a lost response" (ERD 7.2) on top of the fake GitHub above - same
// technique as github.test.ts's own `createResponseDropper`: the underlying
// call always runs to completion (the real fake repo genuinely gets created);
// only the caller's view of the response is dropped.
function createGithubResponseDropper(
  underlyingFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
) {
  const dropNextResponseFor = new Set<string>();

  function simulateLostResponseFor(repoName: string): void {
    dropNextResponseFor.add(repoName);
  }

  async function fetchWithDrop(url: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(url);
    let dropKey: string | undefined;
    if (method === 'POST' && pathname === '/user/repos' && init?.body) {
      const body = JSON.parse(String(init.body)) as { name?: string };
      if (body.name && dropNextResponseFor.has(body.name)) dropKey = body.name;
    }
    const response = await underlyingFetch(url, init);
    if (dropKey) {
      dropNextResponseFor.delete(dropKey);
      throw new TypeError(
        'test-simulated network fault: response lost before the client could observe it',
      );
    }
    return response;
  }

  return { fetch: fetchWithDrop, simulateLostResponseFor };
}

/** Advances the FAKE clock past github/jira's shared 90s RECONCILIATION_THRESHOLD_MS (src/external/operations/index.ts) - same technique github.test.ts/jira.test.ts already use. */
async function withClockAdvancedPastThreshold<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 95_000);
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

async function withFakeFetch<T>(
  fakeFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

// ---------------------------------------------------------------------------
// Fake Jira - adapted from tests/integration/external/jira.test.ts's own
// `createFakeJira` (condensed: T12/T26/T41/T42 below never simulate a lost
// response, so no dropper/description-text search path is needed here).
// ---------------------------------------------------------------------------

interface FakeJiraIssue {
  id: string;
  key: string;
  projectKey: string;
  labels: string[];
  parentKey: string | null;
}

let nextFakeJiraId = 800_000;

function createFakeJiraProvider() {
  const issuesByKey = new Map<string, FakeJiraIssue>();
  const issueNumberByProject = new Map<string, number>();

  const jsonResponse = (status: number, data: unknown): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

  async function fetchImpl(url: string | URL, init?: RequestInit): Promise<Response> {
    const { pathname } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && pathname === '/rest/api/3/issue') {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as {
            fields: {
              project: { key: string };
              labels?: string[];
              parent?: { key: string };
            };
          })
        : { fields: { project: { key: '' } } };
      const projectKey = body.fields.project.key;
      const nextNumber = (issueNumberByProject.get(projectKey) ?? 0) + 1;
      issueNumberByProject.set(projectKey, nextNumber);
      const key = `${projectKey}-${nextNumber}`;
      const id = String(nextFakeJiraId++);
      const issue: FakeJiraIssue = {
        id,
        key,
        projectKey,
        labels: body.fields.labels ?? [],
        parentKey: body.fields.parent?.key ?? null,
      };
      issuesByKey.set(key, issue);
      return jsonResponse(201, { id, key, self: `${JIRA_BASE_URL}/rest/api/3/issue/${id}` });
    }

    if (method === 'POST' && pathname === '/rest/api/3/search/jql') {
      const body = init?.body ? (JSON.parse(String(init.body)) as { jql: string }) : { jql: '' };
      const projectMatch = /project = "([^"]+)"/.exec(body.jql);
      const labelMatch = /labels = "([^"]+)"/.exec(body.jql);
      let matches = [...issuesByKey.values()];
      if (projectMatch) matches = matches.filter((issue) => issue.projectKey === projectMatch[1]);
      if (labelMatch) matches = matches.filter((issue) => issue.labels.includes(labelMatch[1]!));
      return jsonResponse(200, {
        issues: matches.map((issue) => ({ id: issue.id, key: issue.key })),
      });
    }

    throw new Error(`fake Jira fetch (E4-T3): unhandled ${method} ${pathname}`);
  }

  return { fetch: fetchImpl, issuesByKey };
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
  // E3-T1: real, driven through the real POST .../approve route (E3-S10/
  // E3-S11) - Requirements' own v1/v2/v3 setup stays on the raw-SQL
  // `approveSupersedingCurrent` helper (it isn't itself under test here); the
  // Backlog draft's approval - blocked, then blank-override-rejected, then
  // overridden, then a clean regeneration - is what this test proves, and it
  // goes through the real route every time.
  describe('T6 - Backlog draft generated from Requirements v2; Requirements v3 changes R-07 before approval', () => {
    it('approval is blocked with the blocking rows; a blank override note is rejected; a real note approves and records the override; a clean regeneration then approves without one', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T6',
      });
      mockAuthAsOwner(userId);
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

      // Requirements v2 (D) - the Backlog draft below is generated FROM this
      // version, per the ERD's own wording.
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r.display_key,
          payload: { ...rPayload, behavior: 'View the quarterly report, v2 text' },
        },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
      const [rD] = await currentMembership(requirementsArtifactId, v2.versionId);
      if (!rD) throw new Error('R-07@D membership missing');

      // Backlog draft generated from Requirements v2 - a Story depending on
      // R-07@D, through real generation (identity.matchAndPersistItems binds
      // the edge), not a raw fixture dependency.
      const storyPayload = { title: 'Story depending on R-07' };
      const backlogDraft = await generateBacklogStory(
        projectId,
        backlogArtifactId,
        userId,
        [v2.versionId],
        [{ payload: storyPayload, upstreamRefs: [rD.display_key] }],
      );
      expect(backlogDraft.stale).toBe(false);
      const [story] = await currentMembership(backlogArtifactId, backlogDraft.versionId);
      if (!story) throw new Error('Story membership missing from the Backlog draft');

      // Requirements v3 (F) - R-07 changes AGAIN, before the Backlog draft
      // above is ever approved.
      const v3 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r.display_key,
          payload: { ...rPayload, behavior: 'View the quarterly report, v3 text' },
        },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v3.versionId);

      // Approve the (now stale-dependent) Backlog draft through the real
      // route - blocked with the blocking rows.
      const blockedResponse = await approveRoute(
        jsonRequest(approveUrl(backlogDraft.versionId), {}),
        versionRouteParams(backlogDraft.versionId),
      );
      expect(blockedResponse.status).toBe(409);
      const blockedBody = await blockedResponse.json();
      expect(blockedBody.error.code).toBe('APPROVAL_BLOCKED');
      expect(blockedBody.error.details.blocking).toContainEqual(
        expect.objectContaining({
          subjectId: story.item_version_id,
          rootDisplayKey: r.display_key,
        }),
      );

      // Override without a note (blank/whitespace): the route's own zod
      // validation (approveSchema.overrideNote's refine) rejects it before
      // the DB CHECK (approval_event_override_requires_note) is ever reached
      // - the CHECK is only the backstop, so a 400 here is the right
      // assertion, not a 500 or a DB-level error.
      const blankOverride = await approveRoute(
        jsonRequest(approveUrl(backlogDraft.versionId), { overrideNote: '   ' }),
        versionRouteParams(backlogDraft.versionId),
      );
      expect(blankOverride.status).toBe(400);
      expect((await blankOverride.json()).error.code).toBe('VALIDATION_ERROR');

      // Override with a real note - approves.
      const overriddenResponse = await approveRoute(
        jsonRequest(approveUrl(backlogDraft.versionId), {
          overrideNote: 'Reviewed, text is still accurate',
        }),
        versionRouteParams(backlogDraft.versionId),
      );
      expect(overriddenResponse.status).toBe(200);

      const events = await sql<
        { action: string; overrode_stale_check: boolean; feedback: string | null }[]
      >`
        SELECT action, overrode_stale_check, feedback FROM approval_event
        WHERE artifact_version_id = ${backlogDraft.versionId}
      `;
      expect(events).toContainEqual({
        action: 'approved',
        overrode_stale_check: true,
        feedback: 'Reviewed, text is still accurate',
      });

      const acks = await sql<{ id: string }[]>`
        SELECT id FROM impact_acknowledgement
        WHERE subject_item_version_id = ${story.item_version_id}
          AND obsolete_upstream_item_version_id = ${rD.item_version_id}
      `;
      expect(acks.length).toBeGreaterThanOrEqual(1);

      // Regenerate: a fresh Backlog draft with the Story's dependency
      // rebuilt against the NEW current R-07 (F) - passes without an
      // override.
      const regenerated = await generateBacklogStory(
        projectId,
        backlogArtifactId,
        userId,
        [v3.versionId],
        [
          {
            previousDisplayKey: story.display_key,
            payload: storyPayload,
            upstreamRefs: [r.display_key],
          },
        ],
      );
      expect(regenerated.stale).toBe(false);
      const [restory] = await currentMembership(backlogArtifactId, regenerated.versionId);
      expect(restory?.item_version_id).not.toBe(story.item_version_id); // a real new revision (INV-016's hash change)

      const cleanResponse = await approveRoute(
        jsonRequest(approveUrl(regenerated.versionId), {}),
        versionRouteParams(regenerated.versionId),
      );
      expect(cleanResponse.status).toBe(200);
    });
  });

  // T7 - Context changes while generation is in flight.
  // Expected: persisted as rejected / stale_generation_context, no items
  // minted, tokens still recorded.
  // NOT drivable through the real POST .../generate ROUTE: `generate()` (the
  // route's dispatch -> the type module's own `generate` -> `ai-client.
  // generateStructured`, mocked to throw at the top of this file for T43's
  // sake) always runs BEFORE `createDraftFromGeneration` ever opens the
  // persist transaction or re-checks `baseVersionId` (src/artifact-lifecycle/
  // generation.ts's own doc comment: "Step 3 (LLM call): outside any
  // transaction... Left uncaught on purpose") - the mocked throw always fires
  // first, so the route genuinely cannot reach the stale path while that mock
  // is active. Exercised instead at the same layer
  // tests/integration/artifact-lifecycle-generation.test.ts's own "T7: stale
  // (base_changed)..." test already covers (a direct
  // `lifecycle.createDraftFromGeneration` call with a deterministic fake
  // `generate`, including its own `rawOutput` shape assertion, line ~241 of
  // that file) - reproduced here (this file cites T7 in its own right, per
  // the Jira Plan's E3-T1 row) with the one assertion that file's test does
  // not make: the `ai_generation_run` row's own tokens survive the
  // rejection.
  it('T7: a race that changes the artifact base mid-flight persists as rejected/stale_generation_context - no items minted, tokens still recorded', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T7' });
    const uiRequirementsArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const firstDraftId = await fx.createDraftArtifactVersion(sql, uiRequirementsArtifactId, {
      versionNumber: 1,
    });
    await fx.approveArtifactVersion(sql, firstDraftId);

    let capturedRunId = '';
    const rawCandidates = [
      {
        payload: {
          screenOrFlow: 'Dashboard',
          interactionRequirement: 'View metrics',
          responsiveConstraints: [],
          accessibilityConstraints: [],
        },
        upstreamRefs: [] as string[],
      },
    ];
    const result = await lifecycle.createDraftFromGeneration({
      projectId,
      artifactId: uiRequirementsArtifactId,
      itemType: 'ui_requirement',
      contextSourceVersionIds: [],
      actorUserId: userId,
      generate: async () => {
        // Simulate a concurrent regeneration-and-approval landing between
        // this function's base capture (already done, before `generate()`
        // was called) and its persist transaction (about to open) - ERD 3.3
        // step 4/5.
        const secondDraftId = await fx.createDraftArtifactVersion(sql, uiRequirementsArtifactId, {
          versionNumber: 2,
        });
        await sql.begin(async (tx) => {
          await tx`UPDATE artifact_version SET status = 'superseded' WHERE id = ${firstDraftId}`;
          await fx.approveArtifactVersion(tx, secondDraftId);
        });
        capturedRunId = await fx.createAiGenerationRun(sql, { projectId });
        // A real `generateStructured` call records token usage on the SAME
        // row before this function returns (`ai-client` owns
        // `ai_generation_run`) - simulated here via a direct UPDATE since the
        // fixture helper has no token fields of its own.
        await sql`
          UPDATE ai_generation_run SET input_tokens = 543, output_tokens = 210
          WHERE id = ${capturedRunId}
        `;
        return {
          payload: { modelNote: 'T7 in-flight race' },
          candidates: rawCandidates,
          runId: capturedRunId,
        };
      },
    });

    expect(result.stale).toBe(true);
    if (!result.stale) throw new Error('unreachable');
    expect(result.reason).toBe('base_changed');

    const row = await sql<
      { status: string; status_reason: string | null; raw_output: unknown; payload: unknown }[]
    >`
      SELECT status, status_reason, raw_output, payload FROM artifact_version WHERE id = ${result.version.id}
    `;
    expect(row[0]?.status).toBe('rejected');
    expect(row[0]?.status_reason).toBe('stale_generation_context');
    expect(row[0]?.raw_output).toEqual({
      payload: { modelNote: 'T7 in-flight race' },
      candidates: rawCandidates,
    });
    expect(row[0]?.payload).toEqual({});

    const items = await sql<{ id: string }[]>`
      SELECT id FROM logical_item WHERE artifact_id = ${uiRequirementsArtifactId}
    `;
    expect(items).toHaveLength(0); // no items minted

    const runRow = await sql<
      {
        artifact_version_id: string | null;
        input_tokens: number | null;
        output_tokens: number | null;
      }[]
    >`
      SELECT artifact_version_id, input_tokens, output_tokens FROM ai_generation_run WHERE id = ${capturedRunId}
    `;
    expect(runRow[0]?.artifact_version_id).toBe(result.version.id);
    expect(runRow[0]?.input_tokens).toBe(543); // tokens still recorded
    expect(runRow[0]?.output_tokens).toBe(210);
  });

  // T8 - Architecture v3 approval: ADR-01/02 unchanged, ADR-03 changed,
  // ADR-04 dropped.
  // Expected: ADR-01/02 reuse ItemVersions; ADR-03 gets a new revision
  // under the same LogicalItem; ADR-04 removed and its downstream flagged;
  // no ADR-05..08 minted.
  // E3-T1: real. Building the two drafts' OWN options has no route of its
  // own (generation is the only writer, and that path is blocked by the
  // file-wide `@/ai-client` mock) - `architecture.createOptions` (the real
  // module call, same technique tests/integration/
  // architecture-materialization.test.ts's own T8/T9 test uses) is the setup;
  // both approvals - what this test actually proves - go through the real
  // `POST .../approve` route.
  it('T8: Architecture v3 approval reuses ADR-01/02 verbatim, revises ADR-03, removes ADR-04 (flagging its downstream), and mints no ADR-05..08', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T8' });
    mockAuthAsOwner(userId);
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r01Payload = {
      type: 'functional',
      actor: 'Analyst',
      behavior: 'View the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Report renders within 2s'],
      dimension: null,
      value: null,
    };
    const rV1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: r01Payload },
    ]);
    await fx.approveArtifactVersion(sql, rV1.versionId);
    const [r01] = await currentMembership(requirementsArtifactId, rV1.versionId);
    if (!r01) throw new Error('R-01 membership missing');

    // Architecture v1: two options, the selected one with 4 ADRs, all
    // depending on R-01.
    const v1 = await createArchitectureDraftVersion(architectureArtifactId, 1, {
      sourceVersionIds: [rV1.versionId],
    });
    const [optionA] = await architecture.createOptions(v1, [
      architectureOptionInput([
        { title: 'one', upstreamRefs: [r01.display_key] },
        { title: 'two', upstreamRefs: [r01.display_key] },
        { title: 'three', upstreamRefs: [r01.display_key] },
        { title: 'four', upstreamRefs: [r01.display_key] },
      ]),
      architectureOptionInput([{ title: 'unused' }]),
    ]);
    const approveV1 = await approveRoute(
      jsonRequest(approveUrl(v1), { selectedArchitectureOptionId: optionA!.id }),
      versionRouteParams(v1),
    );
    expect(approveV1.status).toBe(200);
    const baseAdrs = await currentMembership(architectureArtifactId, v1);
    expect(baseAdrs.map((a) => a.display_key)).toEqual(['ADR-01', 'ADR-02', 'ADR-03', 'ADR-04']);
    const [adr01, adr02, adr03, adr04] = baseAdrs;

    // Downstream Backlog Story depends on ADR-04.
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: adr04!.item_version_id,
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: story.logicalItemId, itemVersionId: story.itemVersionId },
    ]);

    // Architecture v2: ADR-01/02 verbatim (reuse), ADR-03 changed, ADR-04
    // omitted entirely.
    const v2 = await createArchitectureDraftVersion(architectureArtifactId, 2, {
      baseVersionId: v1,
      sourceVersionIds: [rV1.versionId],
    });
    const [, selected] = await architecture.createOptions(v2, [
      architectureOptionInput([{ title: 'unused v2' }]),
      architectureOptionInput([
        { previousDisplayKey: 'ADR-01', title: 'one', upstreamRefs: [r01.display_key] },
        { previousDisplayKey: 'ADR-02', title: 'two', upstreamRefs: [r01.display_key] },
        {
          previousDisplayKey: 'ADR-03',
          title: 'three CHANGED',
          upstreamRefs: [r01.display_key],
        },
      ]),
    ]);
    const approveV2 = await approveRoute(
      jsonRequest(approveUrl(v2), { selectedArchitectureOptionId: selected!.id }),
      versionRouteParams(v2),
    );
    expect(approveV2.status).toBe(200);

    const v2Adrs = await currentMembership(architectureArtifactId, v2);
    expect(v2Adrs).toHaveLength(3); // ADR-04 removed, no ADR-05..08 minted
    const v2Adr01 = v2Adrs.find((a) => a.logical_item_id === adr01!.logical_item_id);
    const v2Adr02 = v2Adrs.find((a) => a.logical_item_id === adr02!.logical_item_id);
    const v2Adr03 = v2Adrs.find((a) => a.logical_item_id === adr03!.logical_item_id);
    expect(v2Adr01?.item_version_id).toBe(adr01!.item_version_id); // reused verbatim
    expect(v2Adr02?.item_version_id).toBe(adr02!.item_version_id); // reused verbatim
    expect(v2Adr03?.item_version_id).not.toBe(adr03!.item_version_id); // new revision, same LogicalItem
    expect(v2Adrs.some((a) => a.logical_item_id === adr04!.logical_item_id)).toBe(false); // removed

    const adrCount = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM logical_item
      WHERE artifact_id = ${architectureArtifactId} AND item_type = 'architecture_decision'
    `;
    expect(Number(adrCount[0]!.count)).toBe(4); // no ADR-05..08 minted

    const warnings = await impact.getWarnings(projectId);
    expect(warnings.find((w) => w.subjectId === story.itemVersionId)).toMatchObject({
      rootItemVersionId: adr04!.item_version_id,
    });
  });

  // T9 - Select an option from another version; approve Architecture with
  // no selection; approve with 1 or 3 options.
  // Expected: all rejected by FK / guard trigger. Unselected option's ADRs
  // do not exist to be referenced.
  // E3-T1: (a)/(b) real, through the real POST .../approve route. (c) is a
  // deliberate, explained narrowing (see its own comment below) - not
  // reachable through the API as documented.
  describe('T9 - select an option from another version; approve Architecture with no selection; approve with 1 or 3 options', () => {
    it('no selectedArchitectureOptionId at all is a 400 VALIDATION_ERROR', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T9a',
      });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const v = await createArchitectureDraftVersion(architectureArtifactId, 1);
      await architecture.createOptions(v, [
        architectureOptionInput([{ title: 'one' }]),
        architectureOptionInput([{ title: 'two' }]),
      ]);

      const response = await approveRoute(jsonRequest(approveUrl(v), {}), versionRouteParams(v));
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    });

    it('selecting an option that belongs to a DIFFERENT architecture draft is 422 OPTION_NOT_SELECTED', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T9b',
      });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const v = await createArchitectureDraftVersion(architectureArtifactId, 1);
      await architecture.createOptions(v, [
        architectureOptionInput([{ title: 'one' }]),
        architectureOptionInput([{ title: 'two' }]),
      ]);

      // A genuinely different architecture draft (a different project
      // entirely) whose option id is real - just not one of THIS draft's
      // own two.
      const foreign = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T9b-foreign' });
      const foreignArtifactId = await fx.createArtifact(sql, foreign.projectId, 'architecture');
      const foreignVersion = await createArchitectureDraftVersion(foreignArtifactId, 1);
      const [foreignOption] = await architecture.createOptions(foreignVersion, [
        architectureOptionInput([{ title: 'foreign' }]),
        architectureOptionInput([{ title: 'alternative' }]),
      ]);

      const response = await approveRoute(
        jsonRequest(approveUrl(v), { selectedArchitectureOptionId: foreignOption!.id }),
        versionRouteParams(v),
      );
      expect(response.status).toBe(422);
      expect((await response.json()).error.code).toBe('OPTION_NOT_SELECTED');
    });

    // "1 or 3 options" is a DB-level guard, not reachable through the normal
    // API flow: the real write path (`architecture.createOptions`/
    // `materialize`) only ever inserts exactly 2 rows, and
    // `architecture_option_option_key_check` (`option_key IN ('A','B')`,
    // `UNIQUE(artifact_version_id, option_key)`) makes a THIRD row for one
    // `artifact_version` structurally impossible to insert AT ALL - an even
    // stronger guarantee than the `artifact_version_guard` trigger's own
    // "<> 2" check, which a 3-option case could then never even reach. Only
    // the "1 option" half is exercisable, and only against the trigger
    // directly (raw SQL), the same way T27/T28 already do for their own
    // triggers in this file - a deliberate, explained scope narrowing of the
    // ERD's literal wording, not an oversight.
    it('an architecture_version with only 1 option raises from the guard trigger on approval (a 3rd option cannot be inserted at all)', async () => {
      const { projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T9c' });
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const v = await createArchitectureDraftVersion(architectureArtifactId, 1);
      const onlyOption = await fx.createArchitectureOption(sql, {
        artifactVersionId: v,
        optionKey: 'A',
      });

      await expect(
        sql`
          UPDATE artifact_version
          SET status = 'approved', selected_architecture_option_id = ${onlyOption}
          WHERE id = ${v}
        `,
      ).rejects.toThrow(/exactly 2 options/i);

      // A second row under a THIRD key is rejected before it could ever
      // reach that trigger.
      await expect(
        sql`
          INSERT INTO architecture_option
            (artifact_version_id, option_key, title, summary, stack, candidate_decisions, tradeoffs)
          VALUES (${v}, 'C', 'Option C', 'summary', '{}', '[]', '{}')
        `,
      ).rejects.toThrow();
    });
  });

  // T10 - Approve Requirements and Backlog concurrently; double-approve one
  // draft.
  // Expected: serialized by the project lock; exactly one approved version
  // per artifact; second gate sees first commit.
  // E3-T1: real, through the real POST .../approve route.
  describe('T10 - approve Requirements and Backlog concurrently; double-approve one draft', () => {
    it('two different artifacts in the same project both approve; approving the same already-approved draft again is refused', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T10a',
      });
      mockAuthAsOwner(userId);
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const requirementsDraftId = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 1,
      });
      const backlogDraftId = await fx.createDraftArtifactVersion(sql, backlogArtifactId, {
        versionNumber: 1,
      });

      const [reqResponse, backlogResponse] = await Promise.all([
        approveRoute(
          jsonRequest(approveUrl(requirementsDraftId), {}),
          versionRouteParams(requirementsDraftId),
        ),
        approveRoute(
          jsonRequest(approveUrl(backlogDraftId), {}),
          versionRouteParams(backlogDraftId),
        ),
      ]);
      expect(reqResponse.status).toBe(200); // different artifacts don't contend
      expect(backlogResponse.status).toBe(200);

      const reqApprovedCount = await sql<{ count: string }[]>`
        SELECT count(*)::int AS count FROM artifact_version
        WHERE artifact_id = ${requirementsArtifactId} AND status = 'approved'
      `;
      const backlogApprovedCount = await sql<{ count: string }[]>`
        SELECT count(*)::int AS count FROM artifact_version
        WHERE artifact_id = ${backlogArtifactId} AND status = 'approved'
      `;
      expect(Number(reqApprovedCount[0]!.count)).toBe(1);
      expect(Number(backlogApprovedCount[0]!.count)).toBe(1);

      const secondApproval = await approveRoute(
        jsonRequest(approveUrl(requirementsDraftId), {}),
        versionRouteParams(requirementsDraftId),
      );
      expect(secondApproval.status).toBe(409);
      expect((await secondApproval.json()).error.code).toBe('VERSION_NOT_DRAFT');
    });

    it("two concurrent approvals of the SAME draft are serialized by the project lock - exactly one 200, the other sees the first's commit (409 VERSION_NOT_DRAFT)", async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T10b',
      });
      mockAuthAsOwner(userId);
      const uiRequirementsArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
      const draftId = await fx.createDraftArtifactVersion(sql, uiRequirementsArtifactId, {
        versionNumber: 1,
      });

      // Hold the SAME project lock externally first, so both approve calls
      // below are FORCED to queue behind it and each other - without this,
      // two real HTTP calls fired via Promise.all could simply run
      // start-to-finish one after another purely by Node's own scheduling
      // (both are fast, no LLM/network call involved), which would look
      // identical (one 200, one 409) even if withProjectLock's own lock were
      // a no-op. Same probe tests/integration/db-lock.test.ts uses for the
      // Module Boundaries section 6 proof, reused here for the real
      // `approve` route.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let onLocked!: (pid: number) => void;
      const locked = new Promise<number>((resolve) => {
        onLocked = resolve;
      });
      const holderDone = dbModule.withProjectLock(projectId, async (tx) => {
        const rows = await tx.execute<{ pid: number }>(drizzleSql`select pg_backend_pid() as pid`);
        onLocked(rows[0]!.pid);
        await gate;
      });
      const holderPid = await locked;

      const approveOnce = () =>
        approveRoute(jsonRequest(approveUrl(draftId), {}), versionRouteParams(draftId));
      const firstCall = approveOnce();
      const secondCall = approveOnce();

      let queuedCount = 0;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [row] = await sql<{ waiting: number }[]>`
          select count(*)::int as waiting
          from pg_locks held
          join pg_locks queued
            on queued.locktype = held.locktype
           and queued.database is not distinct from held.database
           and queued.classid is not distinct from held.classid
           and queued.objid is not distinct from held.objid
           and queued.objsubid is not distinct from held.objsubid
          where held.pid = ${holderPid}
            and held.locktype = 'advisory'
            and held.granted
            and not queued.granted
        `;
        queuedCount = row!.waiting;
        if (queuedCount >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(queuedCount).toBeGreaterThanOrEqual(2); // both calls genuinely contended, not luck

      release();
      await holderDone;
      const [firstResponse, secondResponse] = await Promise.all([firstCall, secondCall]);

      const statuses = [firstResponse.status, secondResponse.status].sort();
      expect(statuses).toEqual([200, 409]); // never both 200
      const failed = firstResponse.status === 409 ? firstResponse : secondResponse;
      expect((await failed.json()).error.code).toBe('VERSION_NOT_DRAFT');

      const approvedCount = await sql<{ count: string }[]>`
        SELECT count(*)::int AS count FROM artifact_version
        WHERE artifact_id = ${uiRequirementsArtifactId} AND status = 'approved'
      `;
      expect(Number(approvedCount[0]!.count)).toBe(1); // never both committed
    });
  });

  // T11 - Lost response on repo/issue creation; unrelated repo with same
  // name; double-click; stale pending.
  // Expected: reconciliation_required; marker-verified adoption only;
  // conflict on foreign repo; one operation row; reconcile before any
  // resend.
  // E4-S2 (SCRUM-51) already proves this at the module level, against the
  // real `github.initRepo` + a fake-GitHub-via-custom-fetch - see
  // tests/integration/external/github.test.ts's own T11a-T11d. E4-T3 (this
  // slice's gate) closes it here for real, driving the SAME scenarios through
  // `POST /api/projects/:projectId/github/init` (API Contracts section 8).
  describe('T11 - lost response on repo creation; unrelated/foreign repo with the same name; double-click (through the real API route)', () => {
    it('a lost create response reconciles via marker match on the next POST - one operation row, marker-verified adoption, never a bare name match', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T11a' });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
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

      const repoName = `e4t3-t11a-${randomUUID().slice(0, 8)}`;
      const normalizedRepoName = github.normalizeRepoName(repoName);
      const fake = createFakeGithubProvider(FAKE_GITHUB_OWNER);
      const dropper = createGithubResponseDropper(fake.fetch);
      const url = `http://localhost/api/projects/${projectId}/github/init`;

      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(normalizedRepoName);
        const firstResponse = await githubInitRoute(
          jsonRequest(url, { repoName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        // API Contracts has no documented code for a raw ambiguous network
        // fault mid-`send()` - `errorResponse`'s generic 500 fallback fires;
        // the DB row below is the load-bearing assertion, not this status.
        expect(firstResponse.status).toBe(500);

        const afterLoss = await githubOperationRows(projectId);
        expect(afterLoss).toHaveLength(1);
        expect(afterLoss[0]!.status).toBe('pending'); // left exactly as-is (R6/R9)

        const secondResponse = await withClockAdvancedPastThreshold(() =>
          githubInitRoute(
            jsonRequest(url, { repoName, impactAcknowledged: true }),
            routeParams(projectId),
          ),
        );
        expect(secondResponse.status).toBe(200);
        const body = await secondResponse.json();
        expect(body).toMatchObject({ status: 'completed', ref: { provider: 'github' } });

        const afterAdopt = await githubOperationRows(projectId);
        expect(afterAdopt).toHaveLength(1); // one operation row throughout (ERD 7.1) - reconciled, never resent as a new operation
        expect(afterAdopt[0]!.status).toBe('completed');
        expect(await githubRefRows(projectId)).toHaveLength(1);

        // Marker-verified adoption, not a bare name match (ERD 7.3/30.1).
        const fakeRepo = fake.repos.get(`${FAKE_GITHUB_OWNER}/${normalizedRepoName}`);
        expect(fakeRepo?.description).toMatch(/^thrln-marker:[0-9a-f]{16}$/);
      });
    });

    it('a lost response over a pre-existing FOREIGN repo reconciles to failed (409 NAME_TAKEN_BY_OTHER), never adopted', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T11c' });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
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

      const repoName = `e4t3-t11c-${randomUUID().slice(0, 8)}`;
      const normalizedRepoName = github.normalizeRepoName(repoName);
      const fake = createFakeGithubProvider(FAKE_GITHUB_OWNER);
      // Pre-seeded before any attempt - a genuinely unrelated repo already
      // owns this deterministic name (unrelated repo with the same name).
      fake.seedForeignRepo(normalizedRepoName, 'thrln-marker:e4t3foreign00000');
      const dropper = createGithubResponseDropper(fake.fetch);
      const url = `http://localhost/api/projects/${projectId}/github/init`;

      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(normalizedRepoName);
        const firstResponse = await githubInitRoute(
          jsonRequest(url, { repoName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        expect(firstResponse.status).toBe(500);

        const secondResponse = await withClockAdvancedPastThreshold(() =>
          githubInitRoute(
            jsonRequest(url, { repoName, impactAcknowledged: true }),
            routeParams(projectId),
          ),
        );
        expect(secondResponse.status).toBe(409);
        expect((await secondResponse.json()).error.code).toBe('NAME_TAKEN_BY_OTHER');

        const rows = await githubOperationRows(projectId);
        expect(rows).toHaveLength(1); // one operation row throughout
        expect(rows[0]).toMatchObject({ status: 'failed', error_message: 'name_taken_by_other' });
        expect(await githubRefRows(projectId)).toHaveLength(0); // never adopted
      });
    });

    it('a concurrent double-click while the original is still within T is rejected as still in flight (202 pending) - reconcile before any resend', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T11d' });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
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

      const repoName = `e4t3-t11d-${randomUUID().slice(0, 8)}`;
      const fake = createFakeGithubProvider(FAKE_GITHUB_OWNER);
      const dropper = createGithubResponseDropper(fake.fetch);
      const url = `http://localhost/api/projects/${projectId}/github/init`;

      await withFakeFetch(dropper.fetch, async () => {
        dropper.simulateLostResponseFor(github.normalizeRepoName(repoName));
        const firstResponse = await githubInitRoute(
          jsonRequest(url, { repoName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        expect(firstResponse.status).toBe(500);

        // Still within T (no clock advance) - a double-click must be
        // rejected as still in flight, never resent (R5) - stale pending.
        const secondResponse = await githubInitRoute(
          jsonRequest(url, { repoName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        expect(secondResponse.status).toBe(202);
        const body = await secondResponse.json();
        expect(body.status).toBe('pending');
        expect(typeof body.operationId).toBe('string');

        const rows = await githubOperationRows(projectId);
        expect(rows).toHaveLength(1); // still exactly one row - never resent
        expect(rows[0]!.status).toBe('pending');
      });
    });
  });

  // T12 - S-12 changes after THR-42 exists, then export.
  // Expected: Skip / Create New prompt; no update, no silent duplicate.
  // E4-S3 (SCRUM-52) already proves this at the module level - see
  // tests/integration/external/jira.test.ts's own T12 describe block
  // (`jira.previewExport`/`exportBacklog` against a fake Jira). E4-T3 closes
  // it here for real, through `GET/POST /api/projects/:projectId/jira/
  // preview`/`export` (API Contracts section 9).
  describe('T12 - S-12 changes after its Jira issue exists, then export (through the real API routes)', () => {
    it('GET .../jira/preview surfaces the Skip/Create-New prompt; POST .../jira/export refuses without a decision (400), never a silent update or a silent duplicate', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T12' });
      mockAuthAsOwner(userId);
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'epic',
      });
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await approveBacklogVersionForJira(backlogArtifactId, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const exportUrl = `http://localhost/api/projects/${projectId}/jira/export`;
      const previewUrl = `http://localhost/api/projects/${projectId}/jira/preview`;
      const fake = createFakeJiraProvider();

      const v1Response = await withFakeFetch(fake.fetch, () =>
        jiraExportRoute(
          jsonRequest(exportUrl, { decisions: [], impactAcknowledged: true }),
          routeParams(projectId),
        ),
      );
      expect(v1Response.status).toBe(200);
      expect((await v1Response.json()).created).toHaveLength(2); // 1 Epic + 1 Story

      const originalStoryRef = (await jiraRefRowsForItem(story.itemVersionId))[0];
      const originalStoryKey = originalStoryRef!.external_key;
      expect(originalStoryKey).toBeTruthy();

      // S-12 changes: a new ItemVersion under the SAME LogicalItem.
      const storyV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: story.logicalItemId,
        revisionNumber: 2,
      });
      await approveBacklogVersionForJira(backlogArtifactId, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: storyV2ItemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const previewResponse = await jiraPreviewRoute(
        getRequest(previewUrl),
        routeParams(projectId),
      );
      expect(previewResponse.status).toBe(200);
      const previewBody = await previewResponse.json();
      expect(previewBody.needsDecision).toContainEqual(
        expect.objectContaining({
          logicalItemId: story.logicalItemId,
          displayKey: story.displayKey,
        }),
      );

      // No decision supplied for a needsDecision item -> 400 VALIDATION_ERROR
      // (API Contracts section 9) - never a silent skip, never a silent update.
      const missingDecisionResponse = await jiraExportRoute(
        jsonRequest(exportUrl, { decisions: [], impactAcknowledged: true }),
        routeParams(projectId),
      );
      expect(missingDecisionResponse.status).toBe(400);
      expect((await missingDecisionResponse.json()).error.code).toBe('VALIDATION_ERROR');

      // Skip -> the existing Jira issue (THR-42-equivalent) is untouched; no
      // new ref for the new ItemVersion.
      const skipResponse = await withFakeFetch(fake.fetch, () =>
        jiraExportRoute(
          jsonRequest(exportUrl, {
            decisions: [{ logicalItemId: story.logicalItemId, decision: 'skip' }],
            impactAcknowledged: true,
          }),
          routeParams(projectId),
        ),
      );
      expect(skipResponse.status).toBe(200);
      expect(await jiraRefRowsForItem(story.itemVersionId)).toHaveLength(1); // still just the original
      expect(await jiraRefRowsForItem(storyV2ItemVersionId)).toHaveLength(0); // nothing new

      // Create New -> a genuinely NEW Jira issue - never an update of the old
      // one, never a silent duplicate reusing the old key.
      const createNewResponse = await withFakeFetch(fake.fetch, () =>
        jiraExportRoute(
          jsonRequest(exportUrl, {
            decisions: [{ logicalItemId: story.logicalItemId, decision: 'create_new' }],
            impactAcknowledged: true,
          }),
          routeParams(projectId),
        ),
      );
      expect(createNewResponse.status).toBe(200);
      const createNewBody = await createNewResponse.json();
      const newStoryRef = createNewBody.created.find(
        (ref: { sourceItemVersionId: string }) => ref.sourceItemVersionId === storyV2ItemVersionId,
      );
      expect(newStoryRef).toBeDefined();
      expect(newStoryRef.externalKey).not.toBe(originalStoryKey);
      expect(await jiraRefRowsForItem(storyV2ItemVersionId)).toHaveLength(1);
      expect(await jiraRefRowsForItem(story.itemVersionId)).toHaveLength(1); // original untouched
    });
  });

  // T13 - Architecture re-approved with no ADR change; then with a changed
  // ADR.
  // Expected: repository not flagged; then flagged.
  // E4-S2 (SCRUM-51) proves this for real at the module level - see
  // tests/integration/external/github.test.ts's own T13 describe block
  // (`github.checkDrift`, no network mocking needed - it's a pure DB read).
  //
  // Closed by E4-T3 - but only after fixing a real E4-S6 defect the gate
  // found, not by working around it. This file's own top-of-file E4-T3
  // addendum comment records the full story: `src/app/api/_shared/
  // external.ts`'s `getAllExternalRefsForProject` (used by both `GET .../
  // github/ref` and `GET .../external-refs`) used to resolve every ref
  // through each artifact's CURRENT `approvedVersionId` only; a GitHub ref's
  // own `source_artifact_version_id` is pinned forever to whichever
  // Architecture version was approved when `initRepo` ran (there is no
  // second `initRepo` call, ever, to re-point it - ERD 4.15). T13's own
  // scenario requires at least one re-approval AFTER the repo exists, which
  // mints a new `artifact_version` and supersedes the one the ref is pinned
  // to - the old lookup lost track of a repo that still genuinely existed
  // (`{ ref: null }` / absent from `refs[]`) the instant that happened, even
  // before any ADR actually changed. Fixed by reading `external_ref` through
  // its own `project_id` column instead (`external-operations.
  // getRefsForProject`, added this story) - a repo now stays discoverable
  // for the life of the project regardless of how many times Architecture is
  // re-approved. This is exactly the exception to "a gate task must not edit
  // the thing it gates": the test was right and the production code was
  // wrong, so making the code correct is what closes this gate, not a
  // workaround around it.
  describe('T13 - GitHub repository is not flagged after a no-op Architecture re-approval; flagged once the ADR actually changes (through GET .../github/ref)', () => {
    it('repo stays discoverable and unflagged across a no-change re-approval, then flagged once the cited ADR changes', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T13' });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
      const adr = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });

      const v1 = await approveItemsVersion(
        architectureArtifactId,
        [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
        { architecture: true },
      );

      // A GitHub ref pinned to v1 - built directly via fixtures, same as
      // github.test.ts's own T13 (checkDrift is a pure DB read, no network
      // mocking needed for this scenario).
      const opId = await fx.createExternalOperation(sql, {
        projectId,
        provider: 'github',
        sourceArtifactVersionId: v1,
        sourceItemVersionId: null,
      });
      await fx.createExternalRef(sql, {
        projectId,
        provider: 'github',
        externalOperationId: opId,
        sourceArtifactVersionId: v1,
        sourceItemVersionId: null,
      });

      const fetchRef = async () => {
        const response = await githubRefRoute(
          getRequest(`http://localhost/api/projects/${projectId}/github/ref`),
          routeParams(projectId),
        );
        expect(response.status).toBe(200);
        return response.json();
      };

      const initialBody = await fetchRef();
      expect(initialBody.ref).not.toBeNull();
      expect(initialBody.ref.impact).toBeNull();

      // Re-approved with NO ADR change - mints a new (superseding)
      // Architecture artifact_version whose id is no longer the one this ref
      // is pinned to. Before the getRefsForProject fix, this alone made the
      // ref vanish from this route entirely (`{ ref: null }`) - the defect
      // this test exists to catch, independent of whether anything actually
      // changed.
      await approveItemsVersion(
        architectureArtifactId,
        [{ logicalItemId: adr.logicalItemId, itemVersionId: adr.itemVersionId }],
        { architecture: true },
      );

      const noOpBody = await fetchRef();
      expect(noOpBody.ref).not.toBeNull();
      expect(noOpBody.ref.id).toBe(initialBody.ref.id); // same ref row throughout
      expect(noOpBody.ref.impact).toBeNull(); // same item_version reused - not flagged

      // Re-approved with the ADR itself CHANGED: a new item_version under the
      // same LogicalItem.
      const adrV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: adr.logicalItemId,
        revisionNumber: 2,
      });
      await approveItemsVersion(
        architectureArtifactId,
        [{ logicalItemId: adr.logicalItemId, itemVersionId: adrV2ItemVersionId }],
        { architecture: true },
      );

      const flaggedBody = await fetchRef();
      expect(flaggedBody.ref).not.toBeNull();
      expect(flaggedBody.ref.id).toBe(initialBody.ref.id);
      // Rooted at the ADR's own obsolete v1 - depth 0 (the ref's own cited
      // item_version is itself the obsolete one), same shape as
      // github.test.ts's own T13 assertion, resolved to a display key here
      // since this is the route's serialized DTO, not the raw ImpactRow.
      expect(flaggedBody.ref.impact).toMatchObject({
        subjectKind: 'external_ref',
        rootDisplayKey: adr.displayKey,
        depth: 0,
      });
    });
  });

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
  // NOTE: this stub's previous comment ("Turns green with E2-S9") was
  // stale/incorrect - E2-S9 predates the `github` module entirely and could
  // not have exercised a real GitHub-shaped external_ref. E4-S2 (SCRUM-51)
  // proves this for real at the module level - see
  // tests/integration/external/github.test.ts's own T17 describe block.
  //
  // Not in this story's own cited set (docs/Throughline_Jira_Plan.md's E4-T3
  // row cites only T11-T13, T18, T26, T41, T42 - T17 belongs to E4-S2 per that
  // row) - this stub's OWN comment claiming "E4-T3 re-runs it through the
  // real API routes" is a real discrepancy with the Jira Plan, flagged rather
  // than silently absorbed (per this story's instructions). Closed here as a
  // bonus anyway: it falls out naturally from the `GET .../github/ref` route
  // work E4-T3 already does, and - unlike T13 just above - Architecture is
  // never re-approved in this scenario (only Requirements changes), so the
  // `_shared/external.ts` ref-discovery gap documented in T13's own comment
  // never triggers here.
  describe('T17 - one impact() row for a GitHub ref, not one per embedded ADR; direct beats transitive (through GET .../github/ref)', () => {
    it('three ADRs all tracing to the same obsolete Requirement collapse to a single flagged ref, one hop past its winning ADR', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T17' });
      mockAuthAsOwner(userId);
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');

      const r07 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: requirementsArtifactId,
        itemType: 'requirement',
      });
      const rVersion1 = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 1,
      });
      await fx.createMembership(sql, {
        artifactVersionId: rVersion1,
        artifactId: requirementsArtifactId,
        logicalItemId: r07.logicalItemId,
        itemVersionId: r07.itemVersionId,
      });
      await fx.approveArtifactVersion(sql, rVersion1);

      const adr1 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const adr2 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });
      const adr3 = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: architectureArtifactId,
        itemType: 'architecture_decision',
      });

      // adr1, adr3: DIRECT on R-07 (depth 0). adr2: TRANSITIVE, via adr1 (depth 1).
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr1.itemVersionId,
        upstreamItemVersionId: r07.itemVersionId,
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr2.itemVersionId,
        upstreamItemVersionId: adr1.itemVersionId,
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: adr3.itemVersionId,
        upstreamItemVersionId: r07.itemVersionId,
      });

      const architectureVersionId = await approveItemsVersion(
        architectureArtifactId,
        [adr1, adr2, adr3].map((adr) => ({
          logicalItemId: adr.logicalItemId,
          itemVersionId: adr.itemVersionId,
        })),
        { architecture: true },
      );

      const opId = await fx.createExternalOperation(sql, {
        projectId,
        provider: 'github',
        sourceArtifactVersionId: architectureVersionId,
        sourceItemVersionId: null,
      });
      await fx.createExternalRef(sql, {
        projectId,
        provider: 'github',
        externalOperationId: opId,
        sourceArtifactVersionId: architectureVersionId,
        sourceItemVersionId: null,
      });

      // R-07 changes A -> D (a new revision, approved) - Architecture itself
      // is NEVER re-approved, so the ref stays discoverable via its (still
      // current) architectureVersionId throughout.
      const rD = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: r07.logicalItemId,
        revisionNumber: 2,
      });
      const rVersion2 = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 2,
      });
      await fx.createMembership(sql, {
        artifactVersionId: rVersion2,
        artifactId: requirementsArtifactId,
        logicalItemId: r07.logicalItemId,
        itemVersionId: rD,
      });
      await sql`UPDATE artifact_version SET status = 'superseded' WHERE id = ${rVersion1}`;
      await fx.approveArtifactVersion(sql, rVersion2);

      const response = await githubRefRoute(
        getRequest(`http://localhost/api/projects/${projectId}/github/ref`),
        routeParams(projectId),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      // Exactly one ref, one impact row (not one per embedded ADR), rooted at
      // r07's obsolete v1 (A) - direct (adr1/adr3) beats transitive (adr2)
      // among the ADRs' own item-level depths, but the REF's own depth is one
      // hop further than whichever ADR it wins through (ERD section 6.3's own
      // results table: "T17 - one ref, three ADRs, one obsolete root | Exactly
      // one ref row, depth 1").
      expect(body.ref.impact).toMatchObject({
        subjectKind: 'external_ref',
        rootDisplayKey: r07.displayKey,
        depth: 1,
      });
    });
  });

  // T18 - Name collision on repo creation, then a different name.
  // Expected: first operation failed (name_taken_by_other); second is a new
  // operation with a new key; a second concurrent GitHub operation is
  // refused.
  // E4-S2 (SCRUM-51) already proves this at the module level, against the
  // real `github.initRepo` + a fake-GitHub-via-custom-fetch - see
  // tests/integration/external/github.test.ts's own T18 describe block.
  // E4-T3 closes it here for real, through `POST /api/projects/:projectId/
  // github/init` (API Contracts section 8).
  describe('T18 - name collision on repo creation, then a different name (through the real API route)', () => {
    it('first attempt ends 409 NAME_TAKEN_BY_OTHER; a different name starts a fresh operation (200); a second concurrent GitHub operation is refused (409)', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T18' });
      mockAuthAsOwner(userId);
      const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');
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

      const takenName = `e4t3-t18-taken-${randomUUID().slice(0, 8)}`;
      const normalizedTaken = github.normalizeRepoName(takenName);
      const fake = createFakeGithubProvider(FAKE_GITHUB_OWNER);
      fake.seedForeignRepo(normalizedTaken, 'thrln-marker:e4t3someoneelse0');
      const url = `http://localhost/api/projects/${projectId}/github/init`;

      await withFakeFetch(fake.fetch, async () => {
        const firstResponse = await githubInitRoute(
          jsonRequest(url, { repoName: takenName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        expect(firstResponse.status).toBe(409);
        expect((await firstResponse.json()).error.code).toBe('NAME_TAKEN_BY_OTHER');

        const differentName = `e4t3-t18-fresh-${randomUUID().slice(0, 8)}`;
        const secondResponse = await githubInitRoute(
          jsonRequest(url, { repoName: differentName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        expect(secondResponse.status).toBe(200);
        expect((await secondResponse.json()).status).toBe('completed');

        const rows = await githubOperationRows(projectId);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ status: 'failed', error_message: 'name_taken_by_other' });
        expect(rows[1]!.status).toBe('completed');
        expect(rows[0]!.operation_key).not.toBe(rows[1]!.operation_key); // a NEW key, never reused

        // A second concurrent GitHub operation for the same project is
        // refused (ERD 4.15) - the just-completed one still counts as active.
        const yetAnotherName = `e4t3-t18-third-${randomUUID().slice(0, 8)}`;
        const thirdResponse = await githubInitRoute(
          jsonRequest(url, { repoName: yetAnotherName, impactAcknowledged: true }),
          routeParams(projectId),
        );
        expect(thirdResponse.status).toBe(409);
        expect((await thirdResponse.json()).error.code).toBe('GITHUB_ALREADY_INITIALIZED');

        const rowsAfterRefusal = await githubOperationRows(projectId);
        expect(rowsAfterRefusal).toHaveLength(2); // the refused attempt never inserted a row
      });
    });
  });

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
  // E3-T1: real, driven through the real POST .../approve route (E2-S9
  // already fixed the gate query itself - `evaluateGate`/`impact()`'s
  // "Round-5 fix", ERD section 6.3 - this proves it end to end through the
  // full approval workflow that query is embedded in).
  //
  // The v1.1 bug needed TWO simultaneous "current" rows for the SAME
  // LogicalItem: the old approved version's own membership row, AND the
  // candidate's own membership row for that same item - which can only
  // happen when the item that depends on the changed root is ITSELF a
  // member of the CANDIDATE being approved (`evaluateGate`'s own filter:
  // "subject_id IN (draft members)", ERD 6.5) - i.e. the dependent item and
  // the root it depends on must belong to the SAME artifact as the
  // candidate. A Backlog candidate approving a Story that depends on a
  // changed Requirement does NOT reproduce it (the Story isn't a
  // Requirements-artifact member, so `evaluateGate`'s filter excludes its
  // row entirely, bug or no bug); two Requirements items depending on each
  // other does - unusual in practice, but syntactically legal
  // (`semantic_dependency` has no item-type ordering constraint) and exactly
  // what reproduces the v1.1 crash.
  describe('T22 / T23 - approval gate for a Requirements candidate with an acknowledgement whose root has since moved', () => {
    async function buildScenario() {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, {
        name: 'appendix-c: T22-T23',
      });
      mockAuthAsOwner(userId);
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');

      const r07Payload = {
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
        { payload: r07Payload },
        { payload: r15Payload },
      ]);
      await fx.approveArtifactVersion(sql, v1.versionId);
      const v1Members = await membershipWithPayload(requirementsArtifactId, v1.versionId);
      const r07 = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Analyst');
      const r15 = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Manager');
      if (!r07 || !r15) throw new Error('expected both requirements after v1');

      // R-15 depends on R-07@v1 - both Requirements items, in the SAME
      // artifact (the precondition the v1.1 bug needed).
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: r15.item_version_id,
        upstreamItemVersionId: r07.item_version_id,
      });

      // R-07 moves to v2 (approved, supersedes v1) - R-15 (reused
      // verbatim, unchanged) is NOW genuinely flagged: its dependency edge
      // still points at the now-obsolete v1.
      const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r07.display_key,
          payload: { ...r07Payload, behavior: 'View the quarterly report, v2' },
        },
        { previousDisplayKey: r15.display_key, payload: r15Payload },
      ]);
      await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
      const v2Members = await currentMembership(requirementsArtifactId, v2.versionId);
      const r15AtV2 = v2Members.find((m) => m.logical_item_id === r15.logical_item_id);
      expect(r15AtV2?.item_version_id).toBe(r15.item_version_id); // reused verbatim

      const sanityBeforeAck = await impact.getWarnings(projectId);
      expect(sanityBeforeAck.find((w) => w.subjectId === r15.item_version_id)).toMatchObject({
        rootItemVersionId: r07.item_version_id,
        acknowledged: false,
      });

      // Acknowledge NOW, with R-07's CURRENT approved version genuinely at
      // v2 (T23's own wording: "recorded against the currently-approved
      // version of the root") - `impact.acknowledge` re-reads the root's
      // CURRENT version at call time itself (src/lineage/impact/index.ts's
      // own doc comment; never accepted from the caller), so this resolves
      // to v2's own item_version_id, which is DISTINCT from the obsolete
      // v1 id being acknowledged - satisfying
      // `impact_acknowledgement_obsolete_not_against_check`. Acknowledging
      // while R-07 was STILL at v1 (this test's own first attempt) would
      // make "obsolete" and "current" the SAME id and violate that CHECK -
      // there is nothing to legitimately acknowledge until the root has
      // already moved at least once.
      await withTx((tx) =>
        impact.acknowledge(tx, {
          projectId,
          subject: { itemVersionId: r15.item_version_id },
          obsoleteUpstreamItemVersionId: r07.item_version_id, // v1, the obsolete root
          userId,
          note: 'reviewed against R-07@v2 - text is still accurate',
        }),
      );
      const sanityAfterAck = await impact.getWarnings(projectId);
      expect(sanityAfterAck.find((w) => w.subjectId === r15.item_version_id)).toMatchObject({
        acknowledged: true, // matches for now - R-07 is still at v2
      });

      // Requirements v3: R-07 changes AGAIN (v2 -> v3); R-15 comes back
      // verbatim (reused) - R-15's item_version_id (the subject the
      // acknowledgement names) is a MEMBER of THIS candidate, satisfying
      // `evaluateGate`'s own filter ("subject_id IN (draft members)", ERD
      // 6.5). The acknowledgement was recorded against v2 specifically -
      // once v3 replaces it, the ack no longer matches (T23).
      const v3 = await generateRequirements(projectId, requirementsArtifactId, userId, [
        {
          previousDisplayKey: r07.display_key,
          payload: { ...r07Payload, behavior: 'View the quarterly report, v3' },
        },
        { previousDisplayKey: r15.display_key, payload: r15Payload },
      ]);
      expect(v3.stale).toBe(false);
      const v3Members = await currentMembership(requirementsArtifactId, v3.versionId);
      const r15InCandidate = v3Members.find((m) => m.logical_item_id === r15.logical_item_id);
      expect(r15InCandidate?.item_version_id).toBe(r15.item_version_id); // still reused verbatim

      return { projectId, r07, r15, v3VersionId: v3.versionId };
    }

    it('T22: the gate does not crash (the v1.1 regression: "more than one row returned by a subquery")', async () => {
      const { v3VersionId } = await buildScenario();

      const response = await approveRoute(
        jsonRequest(approveUrl(v3VersionId), {}),
        versionRouteParams(v3VersionId),
      );
      expect(response.status).not.toBe(500);
    });

    it('T23: the acknowledgement no longer matches once R-07 moves again - the candidate is blocked, not silently approved', async () => {
      const { r07, r15, v3VersionId } = await buildScenario();

      const response = await approveRoute(
        jsonRequest(approveUrl(v3VersionId), {}),
        versionRouteParams(v3VersionId),
      );
      // The candidate (v3) replaces R-07's approved version (ERD 6.5) - the
      // acknowledgement was recorded against v2, which v3 now replaces, so
      // it no longer matches `root_now` and R-15 is (correctly) still
      // blocking rather than silently waved through.
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('APPROVAL_BLOCKED');
      expect(body.error.details.blocking).toContainEqual(
        expect.objectContaining({
          subjectId: r15.item_version_id,
          rootDisplayKey: r07.display_key,
        }),
      );
    });
  });

  // T24 - E3-S5 covers manual Story editing, rollback, confirmed user edges
  // to current upstream versions, and cleared candidate impact in
  // tests/integration/artifact-lifecycle-item-edit.test.ts.
  //
  // This duplicates that file's own proof one layer up, through the real API
  // routes - exactly this story's stated purpose (E3-T1 re-runs T6-T10, T22-
  // T24, T30, T40 "end to end through the API routes"). Not a
  // duplicate-maintained copy: that file stays the one place this mechanism's
  // full edge-case coverage lives (rollback, UPSTREAM_REMOVED, etc.); this is
  // just the one canonical path (preview -> refuse without confirmation ->
  // confirm) driven through `POST .../edit/preview` and `PUT .../items/
  // :logicalItemId` instead of `artifact-lifecycle.proposeItemEdit`/
  // `commitItemEdit` directly.
  it('T24: editing a draft Story bound to an obsolete upstream version rebinds to the current one on confirmation, and clears its own flag', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T24' });
    mockAuthAsOwner(userId);
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

    // R-07 moves on to a second, approved revision - the Story below is
    // bound (via a raw fixture edge, same technique T1-T5 use for
    // Architecture/Backlog dependency edges) to the now-OBSOLETE first
    // revision.
    const v2 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      {
        previousDisplayKey: r.display_key,
        payload: { ...rPayload, behavior: 'View the quarterly report, v2' },
      },
    ]);
    await approveSupersedingCurrent(requirementsArtifactId, v2.versionId);
    const [rCurrent] = await currentMembership(requirementsArtifactId, v2.versionId);
    if (!rCurrent) throw new Error('R-07@current membership missing');

    // The Story is approved into a REAL Backlog version (not just left in a
    // bespoke draft) so it is genuinely CURRENT - impact()'s `current_m` (and
    // therefore `impact.getWarnings`) only ever considers approved
    // memberships (T5's own point: "a draft never contributes to warnings,
    // whether pending or rejected"), so a story that only ever existed in an
    // unapproved draft could never show up as flagged here regardless of
    // whether its dependency is obsolete - the "before" assertion below would
    // be vacuous otherwise.
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: story.itemVersionId,
      upstreamItemVersionId: r.item_version_id, // the OBSOLETE first revision
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: story.logicalItemId, itemVersionId: story.itemVersionId },
    ]);

    const warningsBefore = await impact.getWarnings(projectId);
    expect(warningsBefore.find((w) => w.subjectId === story.itemVersionId)).toMatchObject({
      rootItemVersionId: r.item_version_id,
    });

    // A manual revision draft that reuses the Story's item_version unchanged
    // - the same shape `createManualRevisionDraft`/`identity.copyMembership`
    // (ERD 3.6) would produce - built directly via fixtures rather than the
    // real `POST .../artifacts/backlog/revise` route: that route's own
    // FR-080 gate (`missingPrerequisites`, `_shared/artifacts.ts`) requires
    // Requirements + Architecture + UI Requirements ALL approved before
    // Backlog can be revised, which is unrelated to what T24 tests (only
    // Requirements exists in this project) - standing up unrelated
    // Architecture/UI-Requirements artifacts and approvals just to get past
    // that check would widen this test's scope for no reason. T24's real
    // subject is the item-edit preview/commit routes below; this draft-
    // creation step is setup, same status as this file's other `fx.*`
    // fixtures for state that isn't itself under test (T1-T5/T8/T9's own
    // convention).
    const backlogDraftId = await fx.createDraftArtifactVersion(sql, backlogArtifactId, {
      versionNumber: 2, // version 1 is the approved one from approveItemsVersion above
    });
    await fx.createMembership(sql, {
      artifactVersionId: backlogDraftId,
      artifactId: backlogArtifactId,
      logicalItemId: story.logicalItemId,
      itemVersionId: story.itemVersionId,
    });

    const editedPayload = { title: 'Edited Story title' };
    const previewUrl = `http://localhost/api/artifact-versions/${backlogDraftId}/items/${story.logicalItemId}/edit/preview`;
    const previewResponse = await itemEditPreviewRoute(
      jsonRequest(previewUrl, { payload: editedPayload }),
      itemRouteParams(backlogDraftId, story.logicalItemId),
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = await previewResponse.json();
    expect(previewBody.changedRefs).toContainEqual(
      expect.objectContaining({
        logicalItemId: r.logical_item_id,
        from: r.item_version_id,
        to: rCurrent.item_version_id,
      }),
    );

    const commitUrl = `http://localhost/api/artifact-versions/${backlogDraftId}/items/${story.logicalItemId}`;
    const refusedCommit = await commitItemEditRoute(
      putJsonRequest(commitUrl, { payload: editedPayload, confirmed: false }),
      itemRouteParams(backlogDraftId, story.logicalItemId),
    );
    expect(refusedCommit.status).toBe(409);
    const refusedBody = await refusedCommit.json();
    expect(refusedBody.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(refusedBody.error.details.changedRefs).toContainEqual(
      expect.objectContaining({ logicalItemId: r.logical_item_id }),
    );

    const confirmedCommit = await commitItemEditRoute(
      putJsonRequest(commitUrl, { payload: editedPayload, confirmed: true }),
      itemRouteParams(backlogDraftId, story.logicalItemId),
    );
    expect(confirmedCommit.status).toBe(200);
    const confirmedBody = await confirmedCommit.json();
    expect(confirmedBody.item.itemVersionId).not.toBe(story.itemVersionId); // a new ItemVersion

    const newEdges = await sql<{ proposed_by: string; upstream_item_version_id: string }[]>`
      SELECT proposed_by, upstream_item_version_id FROM semantic_dependency
      WHERE downstream_item_version_id = ${confirmedBody.item.itemVersionId}
    `;
    expect(newEdges).toEqual([
      { proposed_by: 'user', upstream_item_version_id: rCurrent.item_version_id },
    ]);

    // `impact.getWarnings` is approved-state only (INV-025 - impact() is the
    // only source of truth, evaluated against CURRENT approved membership,
    // never a draft), so "no longer flagged" is only a meaningful assertion
    // once the edited ItemVersion is itself current - approve the draft
    // through the real route first.
    const approveResponse = await approveRoute(
      jsonRequest(approveUrl(backlogDraftId), {}),
      versionRouteParams(backlogDraftId),
    );
    expect(approveResponse.status).toBe(200);

    const warningsAfter = await impact.getWarnings(projectId);
    expect(
      warningsAfter.find((w) => w.subjectId === confirmedBody.item.itemVersionId),
    ).toBeUndefined();
  });

  // T25 - Insert a dependency cycle directly (bypassing the app) and call
  // impact().
  // Expected: terminates; each node reported once.
  // Turns green with E2-S9.
  it.todo('T25');

  // T26 - Export the same Backlog twice with a different configured Jira
  // project in between.
  // Expected: second export creates new operations (target-specific keys);
  // no completed operation is reused for the new target.
  // E4-S3 (SCRUM-52) already proves this at the module level - see
  // tests/integration/external/jira.test.ts's own T26 describe block. E4-T3
  // closes it here for real, through `POST /api/projects/:projectId/jira/
  // export`, reconfiguring `JIRA_PROJECT_KEY` + `vi.resetModules()` between
  // calls exactly as jira.test.ts's own T26 already does for its module-level
  // proof - the route handler (and its own transitive `@/auth`/`@/external/
  // jira`/`@/lib/env` imports) must be re-imported fresh too, since `@/lib/
  // env` is a module-level singleton captured once per module instance (this
  // file's own top-of-file gotcha comment).
  describe('T26 - export the same Backlog twice with a different configured Jira project in between (through the real API route)', () => {
    it('second export creates new, target-specific operations; no completed operation is reused for the new target', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T26' });
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'epic',
      });
      await approveBacklogVersionForJira(backlogArtifactId, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
      ]);

      const fake = createFakeJiraProvider();
      const exportUrl = `http://localhost/api/projects/${projectId}/jira/export`;

      async function freshExportRoute(jiraProjectKey: string): Promise<typeof jiraExportRoute> {
        process.env.JIRA_PROJECT_KEY = jiraProjectKey;
        vi.resetModules();
        const freshAuth = await import('@/auth');
        vi.mocked(freshAuth.getVerifiedUser).mockResolvedValue({
          id: userId,
          email: `${userId}@example.test`,
          displayName: null,
        });
        return (await import('@/app/api/projects/[projectId]/jira/export/route')).POST;
      }

      try {
        const exportAlpha = await freshExportRoute('E4T3ALPHA');
        const alphaResponse = await withFakeFetch(fake.fetch, () =>
          exportAlpha(
            jsonRequest(exportUrl, { decisions: [], impactAcknowledged: true }),
            routeParams(projectId),
          ),
        );
        expect(alphaResponse.status).toBe(200);
        expect((await alphaResponse.json()).created).toHaveLength(1);

        // Reconfigure to a DIFFERENT Jira project - switching the configured
        // project alone must not resurface an unnecessary Skip/Create-New
        // prompt (FR-074 is scoped to the CONFIGURED project); nothing has
        // been exported to BETA yet, so this is a plain, undecided-free export.
        const exportBeta = await freshExportRoute('E4T3BETA');
        const betaResponse = await withFakeFetch(fake.fetch, () =>
          exportBeta(
            jsonRequest(exportUrl, { decisions: [], impactAcknowledged: true }),
            routeParams(projectId),
          ),
        );
        expect(betaResponse.status).toBe(200);
        expect((await betaResponse.json()).created).toHaveLength(1);
      } finally {
        // Defensive cleanup - every OTHER test in this file uses the outer,
        // once-imported route handlers (closed over whatever JIRA_PROJECT_KEY
        // was current before this file's top-level beforeAll ran, frozen in
        // their own module instance regardless of what this test does to
        // process.env afterward) - this restore is hygiene, not correctness,
        // for them.
        process.env.JIRA_PROJECT_KEY = DEFAULT_JIRA_PROJECT_KEY;
      }

      const operations = await jiraOperationRows(projectId);
      expect(operations).toHaveLength(2); // target-specific keys, never one row reused
      expect(operations[0]!.operation_key).toBe(
        `jira:create_issue:E4T3ALPHA:${epic.itemVersionId}`,
      );
      expect(operations[1]!.operation_key).toBe(`jira:create_issue:E4T3BETA:${epic.itemVersionId}`);
      expect(operations[0]!.status).toBe('completed');
      expect(operations[1]!.status).toBe('completed');

      const refs = await jiraRefRowsForItem(epic.itemVersionId);
      expect(refs).toHaveLength(2); // one per target, no completed operation reused
      expect(new Set(refs.map((ref) => ref.external_key)).size).toBe(2); // genuinely different issues
    });
  });

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
  // E3-T1: real. Same setup convention as T8/T9 above (`architecture.
  // createOptions` for the two drafts' own options, no route of its own);
  // both approvals go through the real `POST .../approve` route.
  it('T30: re-approving Architecture with every decision reused but a different stack is refused by the stack guard', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T30' });
    mockAuthAsOwner(userId);
    const architectureArtifactId = await fx.createArtifact(sql, projectId, 'architecture');

    const v1 = await createArchitectureDraftVersion(architectureArtifactId, 1);
    const [chosen] = await architecture.createOptions(v1, [
      architectureOptionInput([{ title: 'one' }], { database: 'postgres', frontend: 'react' }),
      architectureOptionInput([{ title: 'unused' }]),
    ]);
    const approveV1 = await approveRoute(
      jsonRequest(approveUrl(v1), { selectedArchitectureOptionId: chosen!.id }),
      versionRouteParams(v1),
    );
    expect(approveV1.status).toBe(200);

    const v2 = await createArchitectureDraftVersion(architectureArtifactId, 2, {
      baseVersionId: v1,
    });
    const [changedStack] = await architecture.createOptions(v2, [
      architectureOptionInput(
        [{ previousDisplayKey: 'ADR-01', title: 'one' }],
        { database: 'mysql', frontend: 'react' }, // every decision reused, but the stack differs
      ),
      architectureOptionInput([{ title: 'also unused' }]),
    ]);

    const before = await currentMembership(architectureArtifactId, v2);
    expect(before).toEqual([]); // nothing materialized yet

    const blockedResponse = await approveRoute(
      jsonRequest(approveUrl(v2), { selectedArchitectureOptionId: changedStack!.id }),
      versionRouteParams(v2),
    );
    expect(blockedResponse.status).toBe(409);
    expect((await blockedResponse.json()).error.code).toBe('STACK_UNCHANGED_DECISIONS');

    // Refused, not silently materialized-then-rolled-back-looking: the
    // whole approval transaction rolled back, so v2 still has no members.
    const after = await currentMembership(architectureArtifactId, v2);
    expect(after).toEqual([]);
  });

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
    // 0006) - the complete 17-table ERD model (16 + provider_connection).
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
      'provider_connection', // #17, round 14 (migration 0010)
    ] as const;

    it('T34a: anon SELECT is denied on every one of the 17 hardened tables', async () => {
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`SELECT 1 FROM "${table}" LIMIT 1`));
      }
    });

    it('T34b: anon INSERT is denied on every one of the 17 hardened tables', async () => {
      // DEFAULT VALUES needs no knowledge of a table's columns and, because
      // Postgres checks table-level privileges before row constraints, a
      // denied INSERT never gets far enough to also trip a NOT NULL
      // violation - the error is permission denied, full stop, even for
      // tables with no nullable/defaulted columns at all.
      for (const table of HARDENED_TABLES) {
        await expectDeniedAsAnon(sql, (tx) => tx.unsafe(`INSERT INTO "${table}" DEFAULT VALUES`));
      }
    });

    it('T34c: anon DELETE is denied on every one of the 17 hardened tables', async () => {
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
  // E3-T1: real, through the real POST .../artifacts/requirements/revise
  // route, the real item-edit routes, and the real POST .../approve route.
  it("T40: a manual revision of approved Requirements starts identical, edits only R-07, and approval flags only R-07's dependents", async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T40' });
    mockAuthAsOwner(userId);
    const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
    const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

    const r07Payload = {
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
      behavior: 'Approve the quarterly report',
      constraints: [],
      acceptanceCriteria: ['Approval is logged'],
      dimension: null,
      value: null,
    };
    const v1 = await generateRequirements(projectId, requirementsArtifactId, userId, [
      { payload: r07Payload },
      { payload: rOtherPayload },
    ]);
    await fx.approveArtifactVersion(sql, v1.versionId);
    const v1Members = await membershipWithPayload(requirementsArtifactId, v1.versionId);
    const r07 = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Analyst');
    const rOther = v1Members.find((m) => (m.payload as { actor: string }).actor === 'Manager');
    if (!r07 || !rOther) throw new Error('expected both requirements after v1');

    // Two downstream Stories: one depends on R-07 (should end up flagged),
    // one depends on the unrelated Requirement (should not).
    const sDependsOnR07 = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: sDependsOnR07.itemVersionId,
      upstreamItemVersionId: r07.item_version_id,
    });
    const sDependsOnOther = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId: backlogArtifactId,
      itemType: 'story',
    });
    await fx.createSemanticDependency(sql, {
      projectId,
      downstreamItemVersionId: sDependsOnOther.itemVersionId,
      upstreamItemVersionId: rOther.item_version_id,
    });
    await approveItemsVersion(backlogArtifactId, [
      { logicalItemId: sDependsOnR07.logicalItemId, itemVersionId: sDependsOnR07.itemVersionId },
      {
        logicalItemId: sDependsOnOther.logicalItemId,
        itemVersionId: sDependsOnOther.itemVersionId,
      },
    ]);

    const itemVersionCountBefore = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM item_version WHERE project_id = ${projectId}
    `;

    // Real revise route: a manual revision draft.
    const reviseUrl = `http://localhost/api/projects/${projectId}/artifacts/requirements/revise`;
    const reviseResponse = await reviseRoute(
      new Request(reviseUrl, { method: 'POST' }),
      artifactTypeRouteParams(projectId, 'requirements'),
    );
    expect(reviseResponse.status).toBe(200);
    const reviseBody = await reviseResponse.json();
    const draftVersionId: string = reviseBody.version.id;

    const draftMembers = await currentMembership(requirementsArtifactId, draftVersionId);
    const approvedMembers = await currentMembership(requirementsArtifactId, v1.versionId);
    expect(draftMembers).toEqual(approvedMembers); // bit-for-bit identical, no model call

    // generation_context_ref has no `id` column of its own - its primary key
    // is the composite (target_artifact_version_id, source_artifact_version_id)
    // (src/db/schema/generation-context-ref.ts).
    const contextRefs = await sql<{ target_artifact_version_id: string }[]>`
      SELECT target_artifact_version_id FROM generation_context_ref
      WHERE target_artifact_version_id = ${draftVersionId}
    `;
    expect(contextRefs).toHaveLength(0); // no context refs

    // Edit ONLY R-07.
    const editedPayload = {
      ...r07Payload,
      behavior: 'View the quarterly report, edited in manual revision',
    };
    const previewUrl = `http://localhost/api/artifact-versions/${draftVersionId}/items/${r07.logical_item_id}/edit/preview`;
    const previewResponse = await itemEditPreviewRoute(
      jsonRequest(previewUrl, { payload: editedPayload }),
      itemRouteParams(draftVersionId, r07.logical_item_id),
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = await previewResponse.json();
    expect(previewBody.changedRefs).toEqual([]); // Requirements items have no upstream refs of their own

    const commitUrl = `http://localhost/api/artifact-versions/${draftVersionId}/items/${r07.logical_item_id}`;
    const commitResponse = await commitItemEditRoute(
      putJsonRequest(commitUrl, { payload: editedPayload, confirmed: false }),
      itemRouteParams(draftVersionId, r07.logical_item_id),
    );
    expect(commitResponse.status).toBe(200); // no upstream refs changed - no confirmation ever needed

    // Approve.
    const approveResponse = await approveRoute(
      jsonRequest(approveUrl(draftVersionId), {}),
      versionRouteParams(draftVersionId),
    );
    expect(approveResponse.status).toBe(200);

    const itemVersionCountAfter = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM item_version WHERE project_id = ${projectId}
    `;
    expect(Number(itemVersionCountAfter[0]!.count)).toBe(
      Number(itemVersionCountBefore[0]!.count) + 1, // exactly one new ItemVersion (R-07's edit)
    );

    const warnings = await impact.getWarnings(projectId);
    expect(warnings.find((w) => w.subjectId === sDependsOnR07.itemVersionId)).toMatchObject({
      rootItemVersionId: r07.item_version_id,
    });
    expect(warnings.find((w) => w.subjectId === sDependsOnOther.itemVersionId)).toBeUndefined();
  });

  // T41 - Edit Epic E-01's title, re-approve the Backlog, re-export to
  // Jira; choose Skip for E-01.
  // Expected: the Skip / Create New prompt appears for the Epic; no second
  // Jira Epic is created; its Stories are parented to the existing Jira
  // Epic of E-01.
  // E4-S3 (SCRUM-52) already proves this at the module level - see
  // tests/integration/external/jira.test.ts's own T41 describe block. E4-T3
  // closes it here for real, through `GET/POST /api/projects/:projectId/
  // jira/preview`/`export`.
  describe('T41 - edit Epic E-01, re-approve, re-export; choose Skip for E-01 (through the real API routes)', () => {
    it('GET .../jira/preview shows the Skip/Create-New prompt for the Epic; POST .../jira/export with skip creates no second Jira Epic; the Story is parented to the existing Jira Epic of E-01', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T41' });
      mockAuthAsOwner(userId);
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');
      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'epic',
      });
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await approveBacklogVersionForJira(backlogArtifactId, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const exportUrl = `http://localhost/api/projects/${projectId}/jira/export`;
      const previewUrl = `http://localhost/api/projects/${projectId}/jira/preview`;
      const fake = createFakeJiraProvider();

      await withFakeFetch(fake.fetch, () =>
        jiraExportRoute(
          jsonRequest(exportUrl, { decisions: [], impactAcknowledged: true }),
          routeParams(projectId),
        ),
      );
      const originalEpicRef = (await jiraRefRowsForItem(epic.itemVersionId))[0];
      const originalEpicKey = originalEpicRef!.external_key!;

      // Edit E-01's title: a new ItemVersion under the SAME Epic LogicalItem.
      // The Story is UNCHANGED (INV-010: unchanged items reuse their
      // ItemVersion) - the new Backlog version's own membership row for the
      // Story points at the SAME item_version_id as v1.
      const epicV2ItemVersionId = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: epic.logicalItemId,
        revisionNumber: 2,
      });
      await approveBacklogVersionForJira(backlogArtifactId, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epicV2ItemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      const previewResponse = await jiraPreviewRoute(
        getRequest(previewUrl),
        routeParams(projectId),
      );
      expect(previewResponse.status).toBe(200);
      const previewBody = await previewResponse.json();
      expect(previewBody.needsDecision).toContainEqual(
        expect.objectContaining({ logicalItemId: epic.logicalItemId, displayKey: epic.displayKey }),
      );

      // Choose Skip for E-01.
      const exportResponse = await withFakeFetch(fake.fetch, () =>
        jiraExportRoute(
          jsonRequest(exportUrl, {
            decisions: [{ logicalItemId: epic.logicalItemId, decision: 'skip' }],
            impactAcknowledged: true,
          }),
          routeParams(projectId),
        ),
      );
      expect(exportResponse.status).toBe(200);
      const exportBody = await exportResponse.json();
      expect(exportBody.skipped).toContainEqual({ logicalItemId: epic.logicalItemId });

      // No second Jira Epic is created.
      expect(await jiraRefRowsForItem(epicV2ItemVersionId)).toHaveLength(0);
      expect(await jiraRefRowsForItem(epic.itemVersionId)).toHaveLength(1); // still just the original

      // Its Story is parented to the EXISTING Jira Epic of E-01 - idempotent
      // reuse of the unchanged Story's already-completed operation still
      // resolves the SAME, original epic key as parent.
      const storyRef = exportBody.created.find(
        (ref: { sourceItemVersionId: string }) => ref.sourceItemVersionId === story.itemVersionId,
      );
      expect(storyRef).toBeDefined();
      const fakeStoryIssue = fake.issuesByKey.get(storyRef.externalKey);
      expect(fakeStoryIssue?.parentKey).toBe(originalEpicKey);
    });
  });

  // T42 - Preview a Jira export whose Stories include a flagged Story.
  // Expected: the preview lists the impact rows and requires an explicit
  // confirmation; the resulting ref is flagged immediately.
  // E4-T3 closes it here for real, through `GET /api/projects/:projectId/
  // jira/preview`, `POST .../jira/export` and `GET .../external-refs` (API
  // Contracts sections 7/9).
  describe('T42 - preview a Jira export whose Stories include a flagged Story (through the real API routes)', () => {
    it('GET .../jira/preview lists the impact row; POST .../jira/export requires impactAcknowledged (409 otherwise, 200 once acknowledged); the resulting ref is flagged immediately', async () => {
      const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'E4-T3 T42' });
      mockAuthAsOwner(userId);
      const requirementsArtifactId = await fx.createArtifact(sql, projectId, 'requirements');
      const backlogArtifactId = await fx.createArtifact(sql, projectId, 'backlog');

      const r = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: requirementsArtifactId,
        itemType: 'requirement',
      });
      const requirementsV1 = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 1,
      });
      await fx.createMembership(sql, {
        artifactVersionId: requirementsV1,
        artifactId: requirementsArtifactId,
        logicalItemId: r.logicalItemId,
        itemVersionId: r.itemVersionId,
      });
      await fx.approveArtifactVersion(sql, requirementsV1);

      const epic = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'epic',
      });
      const story = await fx.createLogicalItemWithVersion(sql, {
        projectId,
        artifactId: backlogArtifactId,
        itemType: 'story',
      });
      await fx.createSemanticDependency(sql, {
        projectId,
        downstreamItemVersionId: story.itemVersionId,
        upstreamItemVersionId: r.itemVersionId,
      });
      await approveBacklogVersionForJira(backlogArtifactId, [
        { logicalItemId: epic.logicalItemId, itemVersionId: epic.itemVersionId },
        {
          logicalItemId: story.logicalItemId,
          itemVersionId: story.itemVersionId,
          parentLogicalItemId: epic.logicalItemId,
        },
      ]);

      // R changes (a new revision, approved) - the Story's dependency edge is
      // immutable and still points at the now-obsolete OLD item_version
      // (INV-015), so the Story is flagged.
      const rNew = await fx.createItemVersion(sql, {
        projectId,
        logicalItemId: r.logicalItemId,
        revisionNumber: 2,
      });
      const requirementsV2 = await fx.createDraftArtifactVersion(sql, requirementsArtifactId, {
        versionNumber: 2,
      });
      await fx.createMembership(sql, {
        artifactVersionId: requirementsV2,
        artifactId: requirementsArtifactId,
        logicalItemId: r.logicalItemId,
        itemVersionId: rNew,
      });
      await supersede(requirementsV1);
      await fx.approveArtifactVersion(sql, requirementsV2);

      const previewUrl = `http://localhost/api/projects/${projectId}/jira/preview`;
      const exportUrl = `http://localhost/api/projects/${projectId}/jira/export`;

      const previewResponse = await jiraPreviewRoute(
        getRequest(previewUrl),
        routeParams(projectId),
      );
      expect(previewResponse.status).toBe(200);
      const previewBody = await previewResponse.json();
      expect(previewBody.impact).toContainEqual(
        expect.objectContaining({ subjectId: story.itemVersionId, rootDisplayKey: r.displayKey }),
      );

      // Not acknowledged -> 409 IMPACT_NOT_ACKNOWLEDGED with details.impact -
      // an explicit confirmation is required, never a silent export.
      const deniedResponse = await jiraExportRoute(
        jsonRequest(exportUrl, { decisions: [], impactAcknowledged: false }),
        routeParams(projectId),
      );
      expect(deniedResponse.status).toBe(409);
      const deniedBody = await deniedResponse.json();
      expect(deniedBody.error.code).toBe('IMPACT_NOT_ACKNOWLEDGED');
      expect(deniedBody.error.details.impact).toContainEqual(
        expect.objectContaining({ subjectId: story.itemVersionId }),
      );

      // Acknowledged -> the export proceeds.
      const fake = createFakeJiraProvider();
      const exportResponse = await withFakeFetch(fake.fetch, () =>
        jiraExportRoute(
          jsonRequest(exportUrl, { decisions: [], impactAcknowledged: true }),
          routeParams(projectId),
        ),
      );
      expect(exportResponse.status).toBe(200);
      const exportBody = await exportResponse.json();
      expect(exportBody.created).toHaveLength(2); // 1 Epic + 1 Story

      // The resulting ref is flagged immediately.
      const refsResponse = await externalRefsRoute(
        getRequest(`http://localhost/api/projects/${projectId}/external-refs`),
        routeParams(projectId),
      );
      expect(refsResponse.status).toBe(200);
      const refsBody = await refsResponse.json();
      const storyRefDTO = refsBody.refs.find(
        (ref: { sourceItemVersionId: string }) => ref.sourceItemVersionId === story.itemVersionId,
      );
      expect(storyRefDTO).toBeDefined();
      expect(storyRefDTO.impact).toMatchObject({
        subjectKind: 'external_ref',
        rootDisplayKey: r.displayKey,
      });
    });
  });

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
    // `generate` proceeds to the model call (E3-S10; it used to stop at E2-S9's
    // not-implemented stub here). The `@/ai-client` double at the top of this
    // file throws there, so still nothing is written.
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
      'generateStructured reached (test double - no real model call)',
    );
    const uiVersionsAfterPassingFr080 = await sql<{ count: string }[]>`
      SELECT count(*)::int AS count FROM artifact_version WHERE artifact_id = ${uiRequirementsArtifactId}
    `;
    expect(Number(uiVersionsAfterPassingFr080[0]!.count)).toBe(0);

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

  // ---------------------------------------------------------------------
  // Round 14 (per-user provider connections, SCRUM-95 / UC-S3): T45-T50 SQL
  // halves (ERD Appendix C.2); T51/T52 are application tests. NOT EXECUTED
  // when written - Docker/Testcontainers was unavailable on the authoring
  // machine; the assertions mirror the C.2 SQL statement for statement.
  // ---------------------------------------------------------------------
  const CIPHERTEXT = 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:Y2lwaGVydGV4dA';

  async function insertConnection(
    userId: string,
    provider: 'github' | 'jira' | 'stitch',
    overrides: {
      accessTokenEnc?: string;
      refreshTokenEnc?: string | null;
      status?: string;
      keyVersion?: number;
      providerMeta?: Record<string, string>;
    } = {},
  ): Promise<string> {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO provider_connection
        (user_id, provider, external_account_id, display_name, access_token_enc,
         refresh_token_enc, status, key_version, provider_meta)
      VALUES (
        ${userId}, ${provider}, ${`acct-${randomUUID()}`}, ${`name-${provider}`},
        ${overrides.accessTokenEnc ?? CIPHERTEXT},
        ${overrides.refreshTokenEnc ?? null},
        ${overrides.status ?? 'active'},
        ${overrides.keyVersion ?? 1},
        ${sql.json(overrides.providerMeta ?? {})}
      )
      RETURNING id
    `;
    return rows[0]!.id;
  }

  async function draftArtifactVersion(
    projectId: string,
    type: fx.ArtifactType = 'architecture',
  ): Promise<{ artifactId: string; versionId: string }> {
    const artifactId = await fx.createArtifact(sql, projectId, type);
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
    return { artifactId, versionId };
  }

  // T45 (SQL half) - a code path that forgot to encrypt fails at INSERT.
  it('T45: plaintext tokens, a mismatched key version, token-named meta keys and a non-tombstone revoked row are all refused; no plaintext marker lands in any column', async () => {
    const userId = await fx.createAppUser(sql);
    const otherUserId = await fx.createAppUser(sql);
    await insertConnection(userId, 'github', { providerMeta: { login: 'octo-a' } });

    await expect(
      insertConnection(otherUserId, 'github', { accessTokenEnc: 'ghp_PLAINTEXTTOKEN0123456789' }),
    ).rejects.toThrow(/violates check constraint/);
    await expect(
      insertConnection(otherUserId, 'jira', {
        accessTokenEnc: 'v1:AAAA:BBBB:CCCC',
        refreshTokenEnc: 'PLAINTEXTREFRESH0123',
      }),
    ).rejects.toThrow(/violates check constraint/);
    await expect(
      insertConnection(otherUserId, 'stitch', { accessTokenEnc: 'v2:AAAA:BBBB:CCCC' }),
    ).rejects.toThrow(/violates check constraint/);
    await expect(
      insertConnection(otherUserId, 'stitch', {
        accessTokenEnc: 'v1:AAAA:BBBB:CCCC',
        providerMeta: { access_token: 'PLAINTEXTTOKEN' },
      }),
    ).rejects.toThrow(/violates check constraint/);
    await expect(
      insertConnection(otherUserId, 'stitch', {
        accessTokenEnc: 'v1:AAAA:BBBB:CCCC',
        status: 'revoked',
      }),
    ).rejects.toThrow(/violates check constraint/);

    // Scan every text / jsonb / array column of every public base table.
    const columns = await sql<{ table_name: string; column_name: string }[]>`
      SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
         AND c.data_type IN ('text', 'jsonb', 'json', 'character varying', 'ARRAY')
    `;
    let hits = 0;
    for (const { table_name, column_name } of columns) {
      const rows = await sql.unsafe<{ n: string }[]>(
        `SELECT count(*)::text AS n FROM public."${table_name}" WHERE "${column_name}"::text LIKE '%PLAINTEXT%'`,
      );
      hits += Number(rows[0]!.n);
    }
    expect(hits).toBe(0);
  });

  // T45's flows / log / API-response scan is an application integration
  // test owned by UC-S2..UC-S8 (no connections module exists yet).
  it.todo(
    'T45 (application half): connect flows, logs and API responses never contain a sentinel token',
  );

  // T46
  it('T46: one connection per (user, provider); unknown provider/status/user refused; another user or all three providers are fine', async () => {
    const userId = await fx.createAppUser(sql);
    const otherUserId = await fx.createAppUser(sql);
    await insertConnection(userId, 'github');

    await expect(insertConnection(userId, 'github')).rejects.toThrow(/unique constraint/);
    await expect(
      sql`INSERT INTO provider_connection (user_id, provider, external_account_id, display_name, access_token_enc)
          VALUES (${otherUserId}, 'gitlab', '9', 'x', 'v1:AAAA:BBBB:CCCC')`,
    ).rejects.toThrow(/violates check constraint/);
    await expect(insertConnection(otherUserId, 'github', { status: 'expired' })).rejects.toThrow(
      /violates check constraint/,
    );
    await expect(
      sql`INSERT INTO provider_connection (user_id, provider, external_account_id, display_name, access_token_enc)
          VALUES (${randomUUID()}, 'github', '9', 'x', 'v1:AAAA:BBBB:CCCC')`,
    ).rejects.toThrow(/foreign key constraint/);

    await insertConnection(otherUserId, 'github');
    await insertConnection(userId, 'stitch');
    await insertConnection(userId, 'jira', {
      refreshTokenEnc: 'v1:DDDD:EEEE:FFFF',
      providerMeta: { cloudId: 'cloud-1', siteUrl: 'https://x.atlassian.net', siteName: 'x' },
    });
    const providers = await sql<{ n: number }[]>`
      SELECT count(DISTINCT provider)::int AS n FROM provider_connection WHERE user_id = ${userId}
    `;
    expect(providers[0]!.n).toBe(3);
  });

  // T47
  it('T47: composite (connection_id, provider) FK, legacy NULL, RESTRICT on delete, delete_project() leaves connections alone', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T47' });
    const other = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T47 other' });
    const a = await draftArtifactVersion(projectId);
    const b = await draftArtifactVersion(other.projectId);
    const githubConn = await insertConnection(userId, 'github');
    const stitchConn = await insertConnection(userId, 'stitch');

    const withConn = await sql<{ id: string }[]>`
      INSERT INTO external_operation
        (project_id, provider, operation_type, operation_key, status, request_hash,
         source_artifact_version_id, connection_id)
      VALUES (${projectId}, 'github', 'create_repo', ${`op-${randomUUID()}`}, 'pending', 'h1',
              ${a.versionId}, ${githubConn})
      RETURNING id
    `;
    const legacy = await fx.createExternalOperation(sql, {
      projectId: other.projectId,
      provider: 'github',
      status: 'pending',
      sourceArtifactVersionId: b.versionId,
    });

    // a github connection cannot back a stitch operation
    await expect(
      sql`INSERT INTO external_operation
            (project_id, provider, operation_type, operation_key, status, request_hash,
             source_artifact_version_id, connection_id)
          VALUES (${projectId}, 'stitch', 'generate_ui', ${`op-${randomUUID()}`}, 'pending', 'h3',
                  ${a.versionId}, ${githubConn})`,
    ).rejects.toThrow(/foreign key constraint/);
    // a referenced connection cannot be deleted
    await expect(sql`DELETE FROM provider_connection WHERE id = ${githubConn}`).rejects.toThrow(
      /foreign key constraint/,
    );

    const deleted = await sql<
      { deleted: boolean }[]
    >`SELECT delete_project(${projectId}::uuid) AS deleted`;
    expect(deleted[0]!.deleted).toBe(true);
    const conns = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM provider_connection WHERE id IN (${githubConn}, ${stitchConn})
    `;
    expect(conns[0]!.n).toBe(2);
    const gone = await sql`SELECT 1 FROM external_operation WHERE id = ${withConn[0]!.id}`;
    expect(gone).toHaveLength(0);
    const kept = await sql<{ connection_id: string | null }[]>`
      SELECT connection_id FROM external_operation WHERE id = ${legacy}
    `;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.connection_id).toBeNull();

    // now unreferenced: allowed
    await sql`DELETE FROM provider_connection WHERE id = ${githubConn}`;
  });

  // T48
  it('T48: project targets - Jira pair together, no blank target, targets stay editable after Requirements exist', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T48' });

    await sql`UPDATE project SET github_owner = 'octo-org' WHERE id = ${projectId}`;
    await sql`UPDATE project SET jira_cloud_id = 'cloud-1', jira_project_key = 'SCRUM' WHERE id = ${projectId}`;
    await sql`UPDATE project SET jira_cloud_id = NULL, jira_project_key = NULL WHERE id = ${projectId}`;
    await expect(
      sql`UPDATE project SET jira_cloud_id = 'cloud-1' WHERE id = ${projectId}`,
    ).rejects.toThrow(/project_jira_target_pair/);
    await expect(
      sql`UPDATE project SET jira_project_key = 'SCRUM' WHERE id = ${projectId}`,
    ).rejects.toThrow(/project_jira_target_pair/);
    await expect(
      sql`UPDATE project SET github_owner = '   ' WHERE id = ${projectId}`,
    ).rejects.toThrow(/project_target_not_blank/);

    // brief is frozen once a Requirements version exists; targets are not.
    await draftArtifactVersion(projectId, 'requirements');
    await sql`UPDATE project SET github_owner = 'octo-org-2' WHERE id = ${projectId}`;
    await expect(
      sql`UPDATE project SET brief = 'edited' WHERE id = ${projectId}`,
    ).rejects.toThrow();
  });

  // T49 (SQL half)
  it('T49: needs_reauth and the revoked tombstone leave operations, refs and impact() byte-identical; the only trigger is provider_connection_touch', async () => {
    const { userId, projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T49' });
    const { artifactId, versionId } = await draftArtifactVersion(projectId, 'backlog');
    const story = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'story',
    });
    await fx.createMembership(sql, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId: story.logicalItemId,
      itemVersionId: story.itemVersionId,
    });
    const jiraConn = await insertConnection(userId, 'jira', {
      refreshTokenEnc: 'v1:DDDD:EEEE:FFFF',
    });
    const stitchConn = await insertConnection(userId, 'stitch');

    const jiraOp = await sql<{ id: string }[]>`
      INSERT INTO external_operation
        (project_id, provider, operation_type, operation_key, status, external_id, request_hash,
         source_artifact_version_id, source_item_version_id, connection_id)
      VALUES (${projectId}, 'jira', 'create_issue', ${`op-${randomUUID()}`}, 'completed', 'SCRUM-1', 'h5',
              ${versionId}, ${story.itemVersionId}, ${jiraConn})
      RETURNING id
    `;
    await fx.createExternalRef(sql, {
      projectId,
      provider: 'jira',
      externalOperationId: jiraOp[0]!.id,
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: story.itemVersionId,
      externalId: 'SCRUM-1',
      externalKey: 'SCRUM-1',
    });
    for (const [status, externalId] of [
      ['completed', 'stitch-2'],
      ['pending', null],
    ] as const) {
      await sql`
        INSERT INTO external_operation
          (project_id, provider, operation_type, operation_key, status, external_id, request_hash,
           source_artifact_version_id, connection_id)
        VALUES (${projectId}, 'stitch', 'generate_ui', ${`op-${randomUUID()}`}, ${status}, ${externalId},
                ${`h-${randomUUID()}`}, ${versionId}, ${stitchConn})
      `;
    }

    const snapshot = async (): Promise<string> => {
      const rows = await sql<{ h: string }[]>`
        SELECT md5(
          coalesce((SELECT string_agg(row_to_json(o)::text, '|' ORDER BY o.id)
                      FROM external_operation o WHERE o.project_id = ${projectId}), '') || '#' ||
          coalesce((SELECT string_agg(row_to_json(r)::text, '|' ORDER BY r.id)
                      FROM external_ref r WHERE r.project_id = ${projectId}), '') || '#' ||
          coalesce((SELECT string_agg(row_to_json(i)::text, '|' ORDER BY i.subject_id, i.root_item_version_id)
                      FROM impact(${projectId}::uuid) i), '')
        ) AS h
      `;
      return rows[0]!.h;
    };

    const before = await snapshot();
    await sql`UPDATE provider_connection SET status = 'needs_reauth' WHERE id IN (${jiraConn}, ${stitchConn})`;
    expect(await snapshot()).toBe(before);
    await sql`
      UPDATE provider_connection
         SET status = 'revoked', access_token_enc = 'revoked', refresh_token_enc = NULL, expires_at = NULL
       WHERE id IN (${jiraConn}, ${stitchConn})
    `;
    expect(await snapshot()).toBe(before);

    const impactSource = await sql`
      SELECT 1 FROM pg_proc WHERE proname = 'impact' AND prosrc ILIKE '%provider_connection%'
    `;
    expect(impactSource).toHaveLength(0);
    const triggers = await sql<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
       WHERE tgrelid = 'provider_connection'::regclass AND NOT tgisinternal
       ORDER BY tgname
    `;
    expect(triggers.map((t) => t.tgname)).toEqual(['provider_connection_touch']);
  });
  it.todo(
    'T49 (application half): reconcile/retry/drift return reconnect-required, never failed, never a new warning',
  );

  // T50 (SQL half)
  it('T50: a legacy operation (connection_id NULL) keeps its state machine', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'appendix-c: T50' });
    const { versionId } = await draftArtifactVersion(projectId);
    const opId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'stitch',
      status: 'pending',
      sourceArtifactVersionId: versionId,
    });
    await sql`UPDATE external_operation SET status = 'reconciliation_required' WHERE id = ${opId}`;
    await sql`UPDATE external_operation SET status = 'completed', external_id = 'stitch-1' WHERE id = ${opId}`;
    const rows = await sql<{ connection_id: string | null; status: string }[]>`
      SELECT connection_id, status FROM external_operation WHERE id = ${opId}
    `;
    expect(rows[0]).toEqual({ connection_id: null, status: 'completed' });
  });
  it.todo(
    'T50 (application half): a NEW operation with no env credential and no user connection is refused with CONNECTION_REQUIRED and writes no row',
  );

  // T51 / T52 are application tests (connections + external-operations),
  // owned by UC-S2..UC-S8 - no module exists to drive yet.
  it.todo('T51');
  it.todo('T52');
});
