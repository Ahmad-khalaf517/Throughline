// Jira E2-S9 (SCRUM-35) - T21, the real-LLM leg (ERD section 10; ERD 14
// slice 2 gate: "T21 before anything else"; Jira Plan line 148's Definition
// of Done: "T21 passes against a real LLM call (not a mock) before any
// other test in this epic is considered meaningful").
//
// Modeled directly on scripts/spike-structured-output.ts's structure and
// header-comment conventions (E2-T1 / SCRUM-26), but where that spike used
// spike-LOCAL reimplementations of the OpenAI call, the hash, and the
// matcher (see its own header comment - src/ai-client and src/lineage/
// identity did not exist yet at E2-T1), this script calls the REAL modules
// this epic has since built:
//
//   src/artifact-types/requirements (buildPrompt/outputSchema/toCandidates)
//   src/ai-client (generateStructured, real OpenAI call, ai_generation_run)
//   src/artifact-lifecycle (createProject, createDraftFromGeneration)
//   src/lineage/identity (matchAndPersistItems, via createDraftFromGeneration)
//   src/lineage/impact (getWarnings)
//
// proving the actual T21 boundary end to end: a real LLM round trip, the
// real semantic matcher, and the real persist transaction - not a spike-
// local stand-in for any of them. tests/integration/appendix-c.test.ts's own
// T21 exercises the identical pipeline (createDraftFromGeneration ->
// identity.matchAndPersistItems) with a deterministic in-process fake
// `generate`, which is what CI actually runs; THIS script is the one place
// in the repo where T21's "real LLM call, not a mock" requirement is
// actually satisfied.
//
// Cost discipline (same brief as the spike): exactly 2 real completions
// budgeted - one generate call, one no-change regenerate call. A transport/
// API error may be retried at most once per call. A completed-but-invalid
// response (fails zod validation, refusal, or a truncated/filtered
// finish_reason) is NOT retried - that call already happened and is itself
// a reportable finding, not a transient failure to paper over.
//
// Persistence caveat (the one deliberate deviation from the spike): the
// spike wrapped its own inserts in a transaction it could roll back at the
// end, because it reimplemented persistence locally. This script instead
// calls the REAL artifact-lifecycle.createDraftFromGeneration, which opens
// and commits its own withProjectLock transaction internally (ERD 3.3) -
// there is no outer transaction for this script to roll back. Every row
// this script creates (app_user, project, artifact x4, artifact_version x2,
// logical_item, item_version, ai_generation_run) is therefore left
// permanently in the target database. Only run this against a scratch/dev
// database, never production data - same as any other real end-to-end
// exercise of createDraftFromGeneration.
//
// Requires a real .env.local with OPENAI_API_KEY/OPENAI_MODEL and a real
// DATABASE_URL/DIRECT_DATABASE_URL (plus the Supabase auth vars src/lib/
// env.ts's envSchema requires unconditionally - see .env.example). Run
// exactly like the spike:
//   pnpm dotenv -e .env.local -- tsx scripts/verify-real-generation-t21.ts
//
// Do not add a package.json script for this and do not wire it into
// vitest - re-running it bills 2 more real OpenAI completions every time,
// and permanently writes more rows (see the persistence caveat above).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../src/db';
import { env } from '../src/lib/env';
import { upsertAppUser } from '../src/auth';
import { createProject, createDraftFromGeneration } from '../src/artifact-lifecycle';
import { generateStructured } from '../src/ai-client';
import { getWarnings } from '../src/lineage/impact';
import * as requirements from '../src/artifact-types/requirements';
import type { RequirementItem, RequirementsOutput } from '../src/artifact-types/requirements';

// ---------------------------------------------------------------------------
// 1. Fixed, deterministic brief - same technique as the spike (a short,
//    unambiguous brief keeps the model's own wording variance low, which is
//    what the no-change-regeneration prompt (requirements.buildPrompt) then
//    has to hold steady across the two calls).
// ---------------------------------------------------------------------------

const PROJECT_BRIEF =
  'A personal todo list app for a single user to track daily tasks, mark them ' +
  'complete, and organize them into a small number of named lists.';

// ---------------------------------------------------------------------------
// 2. generateStructured call wrapper: exactly one completion per call, at
//    most one retry on a transport/API error, no retry on a completed-but-
//    invalid response - same budget discipline as scripts/spike-structured-
//    output.ts's requestOnce()/callWithBudget(), adapted to classify the
//    single Error generateStructured throws on every failure path (it does
//    not itself distinguish transport vs. validation failures).
// ---------------------------------------------------------------------------

type CallOutcome =
  | { outcome: 'ok'; data: RequirementsOutput; runId: string }
  | { outcome: 'schema_invalid_or_refused'; error: unknown }
  | { outcome: 'transport_error'; error: unknown };

async function attemptGenerate(projectId: string, prompt: string): Promise<CallOutcome> {
  try {
    const result = await generateStructured({
      projectId,
      purpose: 'generation',
      prompt,
      schema: requirements.outputSchema,
    });
    return { outcome: 'ok', data: result.data, runId: result.runId };
  } catch (err) {
    const name = (err as { constructor?: { name?: string } } | undefined)?.constructor?.name;
    const message = err instanceof Error ? err.message : String(err);
    const looksLikeValidationOrRefusal =
      name === 'LengthFinishReasonError' ||
      name === 'ContentFilterFinishReasonError' ||
      err instanceof z.ZodError ||
      message.includes('refused') ||
      message.includes('did not include parsed structured output') ||
      message.includes('no choices');
    if (looksLikeValidationOrRefusal) {
      return { outcome: 'schema_invalid_or_refused', error: err };
    }
    return { outcome: 'transport_error', error: err };
  }
}

async function callWithBudget(
  projectId: string,
  label: string,
  prompt: string,
): Promise<CallOutcome> {
  console.log(`\n[verify-t21] -> calling generateStructured (${label}) ...`);
  const first = await attemptGenerate(projectId, prompt);
  if (first.outcome !== 'transport_error') {
    console.log(`[verify-t21] <- ${label}: outcome=${first.outcome}`);
    return first;
  }
  console.error(`[verify-t21] ${label}: transport/API error on first attempt:`, first.error);
  console.error(
    `[verify-t21] ${label}: retrying once (cost budget allows at most one retry per call)...`,
  );
  const second = await attemptGenerate(projectId, prompt);
  console.log(`[verify-t21] <- ${label} (retry): outcome=${second.outcome}`);
  return second;
}

function reportBadOutcome(label: string, outcome: CallOutcome): never {
  console.error(
    `\n[verify-t21] RESULT: FAIL - the ${label} call did not produce usable structured output.`,
  );
  console.error('[verify-t21] outcome:', outcome.outcome);
  if (outcome.outcome !== 'ok') console.error('[verify-t21] error:', outcome.error);
  console.error(
    "\n[verify-t21] Per the E2-T1 spike's own precedent, this IS a valid, reportable finding: " +
      'the LLM -> structured JSON -> schema validation boundary did not hold. Stopping.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. main()
// ---------------------------------------------------------------------------

async function main() {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
    console.error(
      '[verify-t21] OPENAI_API_KEY and/or OPENAI_MODEL are not set in .env.local - stopping ' +
        'before spending any budget or writing any row.',
    );
    process.exit(1);
  }

  // --- Set up a real project + Requirements artifact ------------------------
  const ownerUserId = randomUUID();
  await upsertAppUser({
    id: ownerUserId,
    email: `verify-t21-${ownerUserId}@example.test`,
    displayName: 'T21 verification script',
  });
  const project = await createProject(
    ownerUserId,
    'E2-S9 T21 verification - todo list app',
    PROJECT_BRIEF,
  );

  // artifact-lifecycle.getProjectById returns approved/draft version ids per
  // type, not the artifact row id itself (no real exported reader for that
  // exists yet) - a direct, read-only lookup against `artifact` here is the
  // same kind of scoped exception scripts/spike-structured-output.ts itself
  // takes (this is tooling, not a src/ module - Module Boundaries' layering
  // rules govern src/ only, and eslint.config.mjs's `boundaries/include` is
  // scoped to 'src/**/*').
  const [requirementsArtifact] = await db
    .select({ id: schema.artifact.id })
    .from(schema.artifact)
    .where(
      and(eq(schema.artifact.projectId, project.id), eq(schema.artifact.type, 'requirements')),
    );
  if (!requirementsArtifact) {
    throw new Error('requirements artifact row missing after createProject');
  }

  // --- Call 1: generate -------------------------------------------------
  let firstRunItems: RequirementItem[] = [];
  const firstResult = await createDraftFromGeneration({
    projectId: project.id,
    artifactId: requirementsArtifact.id,
    itemType: 'requirement',
    contextSourceVersionIds: [],
    actorUserId: ownerUserId,
    generate: async () => {
      const prompt = requirements.buildPrompt({ brief: PROJECT_BRIEF, baseItems: [] });
      const outcome = await callWithBudget(project.id, 'generate', prompt);
      if (outcome.outcome !== 'ok') reportBadOutcome('generate', outcome);
      firstRunItems = outcome.data.items;
      console.log(
        '[verify-t21] generate: schema validation PASSED. Items:',
        firstRunItems.map((i) => i.displayKey),
      );
      return {
        payload: outcome.data.payload,
        candidates: requirements.toCandidates(outcome.data.items),
        runId: outcome.runId,
      };
    },
  });
  if (firstResult.stale) {
    console.error(
      '[verify-t21] RESULT: FAIL - first generation was unexpectedly stale:',
      firstResult.reason,
    );
    process.exit(1);
  }
  console.log(`[verify-t21] first draft persisted: artifact_version ${firstResult.version.id}`);

  // --- Approve the draft (raw fixture-style update - artifact-lifecycle.
  //     approveVersion doesn't exist yet; same approach as tests/
  //     integration/support/fixtures.ts's approveArtifactVersion) -----------
  await db
    .update(schema.artifactVersion)
    .set({ status: 'approved' })
    .where(eq(schema.artifactVersion.id, firstResult.version.id));

  const beforeMembership = await db
    .select({
      logicalItemId: schema.artifactVersionItemMembership.logicalItemId,
      itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
    })
    .from(schema.artifactVersionItemMembership)
    .where(eq(schema.artifactVersionItemMembership.artifactVersionId, firstResult.version.id));
  const beforeItemVersionIds = new Set(beforeMembership.map((m) => m.itemVersionId));
  const beforeLogicalItemIds = new Set(beforeMembership.map((m) => m.logicalItemId));
  const itemVersionCountBefore = (
    await db.select().from(schema.itemVersion).where(eq(schema.itemVersion.projectId, project.id))
  ).length;
  const semanticDependencyCountBefore = (
    await db
      .select()
      .from(schema.semanticDependency)
      .where(eq(schema.semanticDependency.projectId, project.id))
  ).length;
  // Caveat: this script builds only a Requirements artifact (no downstream
  // Architecture/UI Requirements/Backlog item exists to actually depend on
  // R-07), so warningsBefore/warningsAfter are both trivially `[]` here
  // regardless of stability - the meaningful "a real downstream item stays
  // unflagged" proof is tests/integration/appendix-c.test.ts's own T21 (and
  // its neighboring T1/T2 etc.), which build that chain. What THIS number
  // still proves is that regeneration itself never manufactures a warning
  // out of nothing (e.g. by wrongly minting a new ItemVersion that then
  // orphans a dependency edge).
  const warningsBefore = await getWarnings(project.id);

  // --- Call 2: regenerate with the same brief, unchanged --------------------
  const secondResult = await createDraftFromGeneration({
    projectId: project.id,
    artifactId: requirementsArtifact.id,
    itemType: 'requirement',
    contextSourceVersionIds: [],
    actorUserId: ownerUserId,
    generate: async () => {
      // Supply run 1's own items back verbatim, keyed by display key - ERD
      // 5.4's regeneration-stability technique (requirements.buildPrompt's
      // own doc comment). RequirementItem is a structural superset of
      // BaseRequirementItem, so no mapping step is needed.
      const prompt = requirements.buildPrompt({ brief: PROJECT_BRIEF, baseItems: firstRunItems });
      const outcome = await callWithBudget(project.id, 'regenerate (no change)', prompt);
      if (outcome.outcome !== 'ok') reportBadOutcome('regenerate (no change)', outcome);
      console.log(
        '[verify-t21] regenerate: schema validation PASSED. Items:',
        outcome.data.items.map((i) => i.displayKey),
      );
      return {
        payload: outcome.data.payload,
        candidates: requirements.toCandidates(outcome.data.items),
        runId: outcome.runId,
      };
    },
  });
  if (secondResult.stale) {
    console.error(
      '[verify-t21] RESULT: FAIL - regeneration was unexpectedly stale:',
      secondResult.reason,
    );
    process.exit(1);
  }
  console.log(`[verify-t21] second draft persisted: artifact_version ${secondResult.version.id}`);

  // --- Assert: zero new ItemVersions, zero new semantic_dependency rows,
  //     zero new warnings ----------------------------------------------------
  const afterMembership = await db
    .select({
      logicalItemId: schema.artifactVersionItemMembership.logicalItemId,
      itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
    })
    .from(schema.artifactVersionItemMembership)
    .where(eq(schema.artifactVersionItemMembership.artifactVersionId, secondResult.version.id));
  const afterItemVersionIds = new Set(afterMembership.map((m) => m.itemVersionId));
  const afterLogicalItemIds = new Set(afterMembership.map((m) => m.logicalItemId));
  const itemVersionCountAfter = (
    await db.select().from(schema.itemVersion).where(eq(schema.itemVersion.projectId, project.id))
  ).length;
  const semanticDependencyCountAfter = (
    await db
      .select()
      .from(schema.semanticDependency)
      .where(eq(schema.semanticDependency.projectId, project.id))
  ).length;
  const warningsAfter = await getWarnings(project.id);

  const sameItemVersionIds =
    afterItemVersionIds.size === beforeItemVersionIds.size &&
    [...afterItemVersionIds].every((id) => beforeItemVersionIds.has(id));
  const sameLogicalItemIds =
    afterLogicalItemIds.size === beforeLogicalItemIds.size &&
    [...afterLogicalItemIds].every((id) => beforeLogicalItemIds.has(id));
  const zeroNewItemVersions = itemVersionCountAfter === itemVersionCountBefore;
  const zeroNewSemanticDependencies =
    semanticDependencyCountAfter === semanticDependencyCountBefore;
  const zeroNewWarnings = warningsAfter.length === warningsBefore.length;

  const stable =
    sameItemVersionIds &&
    sameLogicalItemIds &&
    zeroNewItemVersions &&
    zeroNewSemanticDependencies &&
    zeroNewWarnings;

  console.log('\n================= T21 (real LLM) VERIFICATION RESULT =================');
  console.log('generate: schema validation PASSED');
  console.log('regenerate (no change): schema validation PASSED');
  console.log(`Same ItemVersion ids reused across both drafts: ${sameItemVersionIds}`);
  console.log(`Same LogicalItem ids across both drafts: ${sameLogicalItemIds}`);
  console.log(
    `item_version count for project: before=${itemVersionCountBefore} after=${itemVersionCountAfter} ` +
      `(zero new: ${zeroNewItemVersions})`,
  );
  console.log(
    `semantic_dependency count for project: before=${semanticDependencyCountBefore} ` +
      `after=${semanticDependencyCountAfter} (zero new: ${zeroNewSemanticDependencies})`,
  );
  console.log(
    `impact.getWarnings count: before=${warningsBefore.length} after=${warningsAfter.length} ` +
      `(zero new: ${zeroNewWarnings})`,
  );
  console.log(
    stable
      ? '\nPASS: T21 holds against a real OpenAI completion.'
      : '\nFAIL: T21 did not hold - see the counts above.',
  );
  console.log('========================================================================\n');

  process.exit(stable ? 0 : 1);
}

main().catch((err) => {
  console.error('[verify-t21] unhandled error:', err);
  process.exit(1);
});
