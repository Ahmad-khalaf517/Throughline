// SCRUM-26 / Jira Plan E2-T1 - Spike A: structured LLM output round trip +
// no-change regeneration stability (TR section 42, "Spike A - Structured
// LLM Output").
//
// Proves, against the REAL OpenAI API and the REAL hosted DATABASE_URL:
//
//   LLM -> structured JSON -> schema validation -> persisted ArtifactVersion
//
// and that regenerating with an unchanged brief reproduces the same items:
// same semantic hashes, zero new ItemVersions (ERD 5.4).
//
// Explicit non-goals for this spike (E2-T1 is a Task, not the modules it
// precedes - see the Jira Plan row and TR section 42):
//   - src/ai-client (`generateStructured<T>()`, `ai_generation_run` logging)
//     is E2-S2's job, not this one. This script calls the `openai` package
//     directly - see the eslint.config.mjs override added for `scripts/**`
//     alongside this file, which scopes that exception to this directory
//     only (Module Boundaries 4.1 still governs everything under src/).
//   - src/lineage/identity (`matchAndPersistItems`, the real semantic
//     matcher) is E2-S3/S4's job. Matching here is spike-local: run-2 items
//     are matched back to run-1 items by displayKey / previousDisplayKey
//     only, with no claimed-key validation, no content-only fallback, and
//     no persistence of "new" or "removed" items - see ERD 5.3 for what the
//     real matcher must do that this script deliberately does not.
//
// Hashing follows ERD 5.4's `requirement` projection exactly: type, actor,
// behavior, constraints, normalized (sorted) acceptance criteria. Wording,
// explanation prose, timestamps and display metadata (displayKey,
// previousDisplayKey) are excluded from the hash on purpose.
//
// Cost discipline (E2-T1 brief): exactly 2 real completions budgeted - one
// generate call, one regenerate call. A transport/API error may be retried
// at most once per call. A completed-but-invalid response (fails zod
// validation, refusal, or a truncated/filtered finish_reason) is NOT
// retried - that call already happened and is itself a reportable finding,
// not a transient failure to paper over.
//
// Temperature caveat (post-first-run correction, orchestrator-authorized):
// the first real run against this worktree's configured OPENAI_MODEL failed
// twice (1 try + 1 retry, per budget) with a 400 on `temperature: 0` -
// "Only the default (1) value is supported" (a reasoning-tier model).
// requestOnce() now omits `temperature` entirely rather than hardcoding 0,
// so the API uses that model's real default. ERD 5.4's "keep generation
// temperature low" guidance for regeneration-hash stability is NOT exercised
// by this run as a result - see requestOnce()'s comment. Treat any stability
// result from this run as a weaker signal than a low-temperature run would
// give, and report that plainly rather than presenting it as the full T21
// proof.
//
// Persistence: this script inserts real rows through real FK/CHECK/trigger
// constraints (project, artifact, artifact_version, logical_item,
// item_version, artifact_version_item_membership), verifies them with an
// independent SELECT inside the same transaction, and then intentionally
// rolls the transaction back instead of issuing DELETEs. This is a
// deliberate deviation from a literal insert-then-DELETE cleanup - see the
// long comment above `main()` for why: item_version's append-only trigger
// (ERD Appendix A.2 T1) makes a real DELETE-based cleanup of item_version,
// and transitively logical_item/artifact/project (FK RESTRICT), structurally
// impossible without disabling that trigger, which this script does not do
// on the shared hosted dev database. Every constraint is still validated
// synchronously by Postgres at INSERT time regardless of the eventual
// rollback - only durability past the end of the script is what's skipped.
//
// Run (exactly like `db:migrate` loads env - see package.json):
//   pnpm dotenv -e .env.local -- tsx scripts/spike-structured-output.ts
//
// Do not add a package.json script for this and do not wire it into
// vitest - re-running it bills 2 more real OpenAI completions every time
// (see the brief's cost-discipline section).

import { createHash } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { TransactionRollbackError } from 'drizzle-orm';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { db, schema, type Tx } from '../src/db';
import { env } from '../src/lib/env';

// ---------------------------------------------------------------------------
// 1. Zod schema for the structured output (spike-local `requirement` shape).
//
// Simplification, disclosed: only `functional` / `non_functional` types are
// generated. ERD 5.4 also allows `constraint` (with a `dimension` and a
// structured value like teamSkills[]/deadline/expectedScale) but that shape
// isn't pinned down further in the frozen docs at this granularity, and
// inventing it would be scope the spike doesn't need - the boundary this
// spike exists to prove (round trip + hash stability) doesn't depend on
// which requirement sub-type is used.
// ---------------------------------------------------------------------------

const RequirementItemSchema = z.object({
  displayKey: z
    .string()
    .regex(/^R-\d{2,}$/, 'display key must look like R-01 (logical_item display-key format)'),
  type: z.enum(['functional', 'non_functional']),
  actor: z.string().min(1),
  behavior: z.string().min(1),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()).min(1),
  // Free prose - explicitly EXCLUDED from the semantic hash (ERD 5.4).
  explanation: z.string().min(1),
  // Regeneration-matching hint (a display key, never a database id - Module
  // Boundaries principle 4 / lineage invariant 3). Required-but-nullable
  // because OpenAI structured-output strict mode requires every declared
  // property to be present.
  previousDisplayKey: z.string().nullable(),
});
type RequirementItem = z.infer<typeof RequirementItemSchema>;

const RequirementSetSchema = z.object({
  items: z.array(RequirementItemSchema).length(3),
});
type RequirementSet = z.infer<typeof RequirementSetSchema>;

// ---------------------------------------------------------------------------
// 2. Fixed, deterministic brief + prompts.
// ---------------------------------------------------------------------------

const PROJECT_BRIEF =
  'A personal todo list app for a single user to track daily tasks, mark them ' +
  'complete, and organize them into a small number of named lists.';

const SYSTEM_PROMPT = `You are a requirements analyst for a software project. Given a short \
product brief, produce exactly 3 software requirements as structured JSON matching the \
provided schema. Rules:
- displayKey values must be exactly "R-01", "R-02", "R-03", in that order.
- type is "functional" or "non_functional".
- actor and behavior are each one short, plain sentence - no filler, no markdown.
- constraints is a short list of plain-text constraint notes (can be empty).
- acceptanceCriteria has 2-3 short, testable, single-clause items.
- explanation is one sentence of free-form prose explaining the requirement; wording here \
may vary between calls and is not something you need to keep stable.
- Be terse and deterministic: given the same brief, produce the same actor/behavior/\
constraints/acceptanceCriteria wording every time so the requirements can be regenerated \
identically.
- previousDisplayKey: set to null unless told otherwise below.`;

const GENERATE_USER_PROMPT = `Brief: ${PROJECT_BRIEF}\n\nReturn exactly 3 requirement items.`;

function buildRegeneratePrompt(baseItems: RequirementItem[]): string {
  const existing = baseItems
    .map(
      (item) =>
        `${item.displayKey} [${item.type}]\n` +
        `  actor: ${item.actor}\n` +
        `  behavior: ${item.behavior}\n` +
        `  constraints: ${JSON.stringify(item.constraints)}\n` +
        `  acceptanceCriteria: ${JSON.stringify(item.acceptanceCriteria)}`,
    )
    .join('\n');

  return `Brief: ${PROJECT_BRIEF}

Nothing about the brief has changed since the last generation. The requirements below already
exist from that previous generation:

${existing}

Return the SAME 3 items, unchanged and verbatim: identical actor, behavior, constraints array,
and acceptanceCriteria array for each one (do not rephrase, reorder, add, or remove any of
them). Only the free-text "explanation" field may be reworded if you want. Keep each item's
displayKey the same as shown above, and set previousDisplayKey to that same display key.`;
}

// ---------------------------------------------------------------------------
// 3. Canonical JSON + semantic hash, per ERD 5.4.
//
// canonicalJSON = sorted keys, normalized whitespace/Unicode, sorted arrays
// where order isn't meaningful. "Normalize aggressively (case, whitespace,
// punctuation, sorted criteria)" per ERD 5.4's regeneration-stability
// paragraph - applied to every text field that feeds the hash.
// ---------------------------------------------------------------------------

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedEntries = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedEntries) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }
  return value;
}

function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[.!?]+$/g, '');
}

/** ERD 5.4 `requirement` projection: type, actor, behavior, constraints,
 * normalized acceptance criteria. Excludes explanation/displayKey/
 * previousDisplayKey (wording/explanation prose and display metadata). */
function requirementProjection(item: RequirementItem) {
  return {
    type: item.type,
    actor: normalizeText(item.actor),
    behavior: normalizeText(item.behavior),
    constraints: [...item.constraints].map(normalizeText).sort(),
    acceptanceCriteria: [...item.acceptanceCriteria].map(normalizeText).sort(),
  };
}

function semanticHash(item: RequirementItem): string {
  return createHash('sha256')
    .update(canonicalJSON(requirementProjection(item)), 'utf8')
    .digest('hex');
}

const SEMANTIC_HASH_VERSION = 1; // frozen (ERD 5.4)

// ---------------------------------------------------------------------------
// 4. OpenAI call wrapper: exactly one completion per call, at most one retry
//    on a transport/API error, no retry on a completed-but-invalid response.
// ---------------------------------------------------------------------------

type CallOutcome =
  | { outcome: 'ok'; parsed: RequirementSet; raw: unknown }
  | { outcome: 'schema_invalid'; error: z.ZodError; raw: unknown }
  | { outcome: 'refused'; refusal: string }
  | { outcome: 'incomplete'; reason: string }
  | { outcome: 'api_error'; error: unknown };

async function requestOnce(
  client: OpenAI,
  model: string,
  userPrompt: string,
): Promise<CallOutcome> {
  let completion;
  try {
    completion = await client.chat.completions.parse({
      model,
      // ERD 5.4 prefers low temperature for regeneration-hash stability, but
      // the configured OPENAI_MODEL is reasoning-tier and rejects any
      // non-default value (confirmed: 400 unsupported_value on
      // `temperature: 0` - "Only the default (1) value is supported").
      // Omitting the param (rather than passing `temperature: 1` explicitly)
      // lets the API use whatever its real default is, and keeps this
      // correct if the model is swapped later. This means this run tests
      // regeneration stability WITHOUT the low-temperature lever ERD 5.4
      // recommends - a genuine caveat on how strong a stability signal this
      // particular result is, not a substitute for testing it properly
      // against a model that honors low temperature.
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: zodResponseFormat(RequirementSetSchema, 'requirement_set'),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { outcome: 'schema_invalid', error: err, raw: undefined };
    }
    // LengthFinishReasonError / ContentFilterFinishReasonError aren't
    // re-exported from the package's public `openai` entrypoint (only from
    // the internal core/error module) - branch on constructor name instead
    // of a deep, unexported import.
    const name = (err as { constructor?: { name?: string } } | undefined)?.constructor?.name;
    if (name === 'LengthFinishReasonError' || name === 'ContentFilterFinishReasonError') {
      return { outcome: 'incomplete', reason: `${name}: ${(err as Error).message}` };
    }
    return { outcome: 'api_error', error: err };
  }

  const choice = completion.choices[0];
  if (!choice) {
    return { outcome: 'api_error', error: new Error('OpenAI response had no choices') };
  }
  if (choice.message.refusal) {
    return { outcome: 'refused', refusal: choice.message.refusal };
  }
  if (!choice.message.parsed) {
    // Shouldn't happen if parse() didn't throw, but guard anyway.
    return { outcome: 'schema_invalid', error: new z.ZodError([]), raw: choice.message.content };
  }
  return {
    outcome: 'ok',
    parsed: choice.message.parsed,
    raw: JSON.parse(choice.message.content ?? '{}'),
  };
}

async function callWithBudget(
  client: OpenAI,
  model: string,
  label: string,
  userPrompt: string,
): Promise<CallOutcome> {
  console.log(
    `\n[spike] -> calling OpenAI (${label}), model=${model}, temperature=<model default - see requestOnce()> ...`,
  );
  const first = await requestOnce(client, model, userPrompt);
  if (first.outcome !== 'api_error') {
    console.log(`[spike] <- ${label}: outcome=${first.outcome}`);
    return first;
  }
  console.error(`[spike] ${label}: transport/API error on first attempt:`, first.error);
  console.error(
    `[spike] ${label}: retrying once (cost budget allows at most one retry per call)...`,
  );
  const second = await requestOnce(client, model, userPrompt);
  console.log(`[spike] <- ${label} (retry): outcome=${second.outcome}`);
  return second;
}

// ---------------------------------------------------------------------------
// 5. Spike-local matching (NOT src/lineage/identity - see header comment).
// ---------------------------------------------------------------------------

interface ItemComparison {
  displayKey: string;
  run1Hash: string;
  run2Hash: string | null;
  matchMethod: 'previousDisplayKey' | 'displayKey' | 'none';
  status: 'MATCH' | 'CHANGED' | 'UNMATCHED';
}

function compareRuns(run1Items: RequirementItem[], run2Items: RequirementItem[]): ItemComparison[] {
  return run1Items.map((r1): ItemComparison => {
    const r1Hash = semanticHash(r1);
    const byHint = r1.displayKey
      ? run2Items.find((r2) => r2.previousDisplayKey === r1.displayKey)
      : undefined;
    const byKey = run2Items.find((r2) => r2.displayKey === r1.displayKey);
    const match = byHint ?? byKey;
    const matchMethod: ItemComparison['matchMethod'] = byHint
      ? 'previousDisplayKey'
      : byKey
        ? 'displayKey'
        : 'none';

    if (!match) {
      return {
        displayKey: r1.displayKey,
        run1Hash: r1Hash,
        run2Hash: null,
        matchMethod,
        status: 'UNMATCHED',
      };
    }
    const r2Hash = semanticHash(match);
    return {
      displayKey: r1.displayKey,
      run1Hash: r1Hash,
      run2Hash: r2Hash,
      matchMethod,
      status: r1Hash === r2Hash ? 'MATCH' : 'CHANGED',
    };
  });
}

// ---------------------------------------------------------------------------
// 6. Persistence: real inserts against real constraints, verified via an
//    independent SELECT, then intentionally rolled back (see header).
// ---------------------------------------------------------------------------

interface PersistResult {
  projectId: string;
  artifactId: string;
  artifactVersionId: string;
  items: Array<{
    displayKey: string;
    logicalItemId: string;
    run1ItemVersionId: string;
    run2ItemVersionId: string | null; // set only when a new revision was minted
  }>;
  verified: {
    project: boolean;
    artifact: boolean;
    artifactVersion: boolean;
    logicalItems: boolean;
    itemVersionsRun1: boolean;
    itemVersionsRun2: boolean;
    memberships: boolean;
  };
}

async function persistAndVerify(
  tx: Tx,
  ownerUserId: string,
  run1Items: RequirementItem[],
  comparisons: ItemComparison[],
  run2ByDisplayKey: Map<string, RequirementItem>,
): Promise<PersistResult> {
  const [project] = await tx
    .insert(schema.project)
    .values({
      ownerUserId,
      name: 'E2-T1 spike - personal todo list app',
      brief: PROJECT_BRIEF,
    })
    .returning();
  if (!project) throw new Error('project insert returned no row');

  const [artifact] = await tx
    .insert(schema.artifact)
    .values({ projectId: project.id, type: 'requirements' })
    .returning();
  if (!artifact) throw new Error('artifact insert returned no row');

  const [artifactVersion] = await tx
    .insert(schema.artifactVersion)
    .values({
      artifactId: artifact.id,
      versionNumber: 1,
      status: 'draft',
      schemaVersion: 1,
    })
    .returning();
  if (!artifactVersion) throw new Error('artifact_version insert returned no row');

  const items: PersistResult['items'] = [];

  for (let position = 0; position < run1Items.length; position++) {
    const run1Item = run1Items[position]!;
    const comparison = comparisons.find((c) => c.displayKey === run1Item.displayKey);

    const [logicalItem] = await tx
      .insert(schema.logicalItem)
      .values({
        projectId: project.id,
        artifactId: artifact.id,
        itemType: 'requirement',
        displayKey: run1Item.displayKey,
      })
      .returning();
    if (!logicalItem)
      throw new Error(`logical_item insert returned no row for ${run1Item.displayKey}`);

    const [run1ItemVersion] = await tx
      .insert(schema.itemVersion)
      .values({
        projectId: project.id,
        logicalItemId: logicalItem.id,
        revisionNumber: 1,
        payload: run1Item,
        semanticHash: semanticHash(run1Item),
        semanticHashVersion: SEMANTIC_HASH_VERSION,
      })
      .returning();
    if (!run1ItemVersion)
      throw new Error(`item_version insert returned no row for ${run1Item.displayKey}`);

    await tx.insert(schema.artifactVersionItemMembership).values({
      artifactVersionId: artifactVersion.id,
      artifactId: artifact.id,
      logicalItemId: logicalItem.id,
      itemVersionId: run1ItemVersion.id,
      position,
    });

    let run2ItemVersionId: string | null = null;

    // ERD 5.3 rule 4: unchanged -> reuse the ItemVersion (no insert here).
    // Modified -> same LogicalItem, new ItemVersion revision, membership
    // swapped to point at it (legal only while the artifact_version is a
    // draft - membership_draft_only trigger, ERD Appendix A.2 T4).
    if (comparison?.status === 'CHANGED') {
      const run2Item = run2ByDisplayKey.get(run1Item.displayKey);
      if (!run2Item)
        throw new Error(`comparison marked CHANGED but no run-2 item for ${run1Item.displayKey}`);

      const [run2ItemVersion] = await tx
        .insert(schema.itemVersion)
        .values({
          projectId: project.id,
          logicalItemId: logicalItem.id,
          revisionNumber: 2,
          payload: run2Item,
          semanticHash: semanticHash(run2Item),
          semanticHashVersion: SEMANTIC_HASH_VERSION,
        })
        .returning();
      if (!run2ItemVersion)
        throw new Error(
          `revision-2 item_version insert returned no row for ${run1Item.displayKey}`,
        );

      await tx
        .update(schema.artifactVersionItemMembership)
        .set({ itemVersionId: run2ItemVersion.id })
        .where(eq(schema.artifactVersionItemMembership.logicalItemId, logicalItem.id));

      run2ItemVersionId = run2ItemVersion.id;
    }

    items.push({
      displayKey: run1Item.displayKey,
      logicalItemId: logicalItem.id,
      run1ItemVersionId: run1ItemVersion.id,
      run2ItemVersionId,
    });
  }

  // Independent re-SELECT (not the insert's own .returning()) to prove the
  // writes really landed against real constraints, per the E2-T1 brief.
  const [selectedProject] = await tx
    .select()
    .from(schema.project)
    .where(eq(schema.project.id, project.id));
  const [selectedArtifact] = await tx
    .select()
    .from(schema.artifact)
    .where(eq(schema.artifact.id, artifact.id));
  const [selectedArtifactVersion] = await tx
    .select()
    .from(schema.artifactVersion)
    .where(eq(schema.artifactVersion.id, artifactVersion.id));
  const logicalItemIds = items.map((i) => i.logicalItemId);
  const selectedLogicalItems = await tx
    .select()
    .from(schema.logicalItem)
    .where(inArray(schema.logicalItem.id, logicalItemIds));
  const run1ItemVersionIds = items.map((i) => i.run1ItemVersionId);
  const selectedRun1ItemVersions = await tx
    .select()
    .from(schema.itemVersion)
    .where(inArray(schema.itemVersion.id, run1ItemVersionIds));
  const run2ItemVersionIds = items
    .map((i) => i.run2ItemVersionId)
    .filter((id): id is string => id !== null);
  const selectedRun2ItemVersions =
    run2ItemVersionIds.length > 0
      ? await tx
          .select()
          .from(schema.itemVersion)
          .where(inArray(schema.itemVersion.id, run2ItemVersionIds))
      : [];
  const selectedMemberships = await tx
    .select()
    .from(schema.artifactVersionItemMembership)
    .where(eq(schema.artifactVersionItemMembership.artifactVersionId, artifactVersion.id));

  return {
    projectId: project.id,
    artifactId: artifact.id,
    artifactVersionId: artifactVersion.id,
    items,
    verified: {
      project: !!selectedProject && selectedProject.brief === PROJECT_BRIEF,
      artifact: !!selectedArtifact && selectedArtifact.type === 'requirements',
      artifactVersion: !!selectedArtifactVersion && selectedArtifactVersion.status === 'draft',
      logicalItems: selectedLogicalItems.length === items.length,
      itemVersionsRun1: selectedRun1ItemVersions.length === items.length,
      itemVersionsRun2: selectedRun2ItemVersions.length === run2ItemVersionIds.length,
      memberships: selectedMemberships.length === items.length,
    },
  };
}

// ---------------------------------------------------------------------------
// 7. main()
// ---------------------------------------------------------------------------

async function main() {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
    console.error(
      '[spike] OPENAI_API_KEY and/or OPENAI_MODEL are not set in .env.local - stopping before ' +
        'spending any budget.',
    );
    process.exit(1);
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const model = env.OPENAI_MODEL;

  // --- Call 1: generate -----------------------------------------------------
  const run1 = await callWithBudget(client, model, 'generate', GENERATE_USER_PROMPT);
  if (run1.outcome !== 'ok') {
    console.error(
      '\n[spike] RESULT: generate call did not produce schema-valid structured output.',
    );
    console.error('[spike] outcome:', run1.outcome);
    if (run1.outcome === 'schema_invalid') console.error('[spike] zod error:', run1.error.format());
    if (run1.outcome === 'api_error') console.error('[spike] error:', run1.error);
    console.error(
      '\n[spike] Per TR 42, this IS a valid, reportable spike finding: the LLM -> structured ' +
        'JSON -> schema validation boundary did not hold on the first call. Stopping - no DB ' +
        'writes attempted, no further OpenAI calls made.',
    );
    process.exit(1);
  }
  const run1Items = run1.parsed.items;
  console.log(
    '[spike] generate: schema validation PASSED. Items:',
    run1Items.map((i) => i.displayKey),
  );

  // --- Call 2: regenerate with the same brief, unchanged ---------------------
  const run2 = await callWithBudget(
    client,
    model,
    'regenerate (no change)',
    buildRegeneratePrompt(run1Items),
  );

  let comparisons: ItemComparison[] = [];
  let run2ByDisplayKey = new Map<string, RequirementItem>();
  const run2Outcome = run2.outcome;

  if (run2.outcome === 'ok') {
    const run2Items = run2.parsed.items;
    console.log(
      '[spike] regenerate: schema validation PASSED. Items:',
      run2Items.map((i) => i.displayKey),
    );
    run2ByDisplayKey = new Map(run2Items.map((i) => [i.displayKey, i]));
    comparisons = compareRuns(run1Items, run2Items);
  } else {
    console.error('\n[spike] regenerate call did not produce schema-valid structured output.');
    console.error('[spike] outcome:', run2.outcome);
    if (run2.outcome === 'schema_invalid') console.error('[spike] zod error:', run2.error.format());
    if (run2.outcome === 'api_error') console.error('[spike] error:', run2.error);
    console.error(
      '[spike] Stability cannot be assessed - proceeding to persist run 1 only, to still prove ' +
        'the persistence leg of the boundary.',
    );
    // No comparisons -> persistAndVerify will insert only revision-1 rows.
    comparisons = run1Items.map((r1) => ({
      displayKey: r1.displayKey,
      run1Hash: semanticHash(r1),
      run2Hash: null,
      matchMethod: 'none' as const,
      status: 'UNMATCHED' as const,
    }));
  }

  // --- Persist (real inserts, real constraints, verified, then rolled back) --
  const [ownerUser] = await db.select().from(schema.appUser).limit(1);
  if (!ownerUser) {
    console.error('[spike] No app_user row exists to use as project.owner_user_id - stopping.');
    process.exit(1);
  }

  let persistResult: PersistResult | undefined;
  let persistError: unknown;
  try {
    await db.transaction(async (tx) => {
      persistResult = await persistAndVerify(
        tx,
        ownerUser.id,
        run1Items,
        comparisons,
        run2ByDisplayKey,
      );
      console.log('\n[spike] DB writes verified via independent SELECT inside the transaction:');
      console.log(persistResult.verified);
      console.log(
        '[spike] Rolling back intentionally (item_version is append-only by trigger - ERD ' +
          'Appendix A.2 T1 - so a real DELETE-based cleanup of item_version, and transitively ' +
          'logical_item/artifact/project via FK RESTRICT, is not possible without disabling that ' +
          'trigger; rollback proves every constraint synchronously without leaving permanent rows).',
      );
      tx.rollback();
    });
  } catch (err) {
    if (err instanceof TransactionRollbackError) {
      // Expected: our own intentional tx.rollback() signal, not a failure.
    } else {
      persistError = err;
    }
  }

  if (persistError) {
    console.error('\n[spike] RESULT: a DB write failed against a real constraint:', persistError);
    process.exit(1);
  }
  if (!persistResult) {
    console.error(
      '\n[spike] RESULT: transaction rolled back before producing a result - unexpected.',
    );
    process.exit(1);
  }

  // --- Report ------------------------------------------------------------
  const unchanged = comparisons.filter((c) => c.status === 'MATCH').length;
  const changed = comparisons.filter((c) => c.status === 'CHANGED').length;
  const unmatched = comparisons.filter((c) => c.status === 'UNMATCHED').length;
  const newItemVersions = persistResult.items.filter((i) => i.run2ItemVersionId !== null).length;
  const stable = run2Outcome === 'ok' && changed === 0 && unmatched === 0;

  console.log('\n================= E2-T1 SPIKE A RESULT =================');
  console.log('Schema validation - generate call: PASSED');
  console.log(
    `Schema validation - regenerate call: ${run2Outcome === 'ok' ? 'PASSED' : `FAILED (${run2Outcome})`}`,
  );
  console.log('\nPer-item comparison:');
  for (const c of comparisons) {
    console.log(
      `  ${c.displayKey}: run1=${c.run1Hash.slice(0, 12)}... run2=${c.run2Hash ? c.run2Hash.slice(0, 12) + '...' : 'n/a'} ` +
        `[${c.matchMethod}] -> ${c.status}`,
    );
  }
  console.log(
    '\nPersistence (verified via independent SELECT, then rolled back):',
    persistResult.verified,
  );
  if (stable) {
    console.log(
      `\nregeneration stable: ${unchanged}/${run1Items.length} items unchanged, 0 new ItemVersions.`,
    );
  } else {
    console.log(
      `\nregeneration NOT stable: ${unchanged}/${run1Items.length} unchanged, ${changed} changed, ` +
        `${unmatched} unmatched, ${newItemVersions} new ItemVersion(s) would have been minted.`,
    );
  }
  console.log('==========================================================\n');

  process.exit(stable ? 0 : 1);
}

main().catch((err) => {
  console.error('[spike] unhandled error:', err);
  process.exit(1);
});
