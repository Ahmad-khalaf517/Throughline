// Module 9: artifact-types/requirements
// Owns: requirement items - payload shape + prompt only (no table of its
// own - persistence goes through artifact-lifecycle + identity, Module
// Boundaries section 4.4's shared ArtifactTypeModule shape).
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and 4.4
// for this module's documented shape and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// Jira E2-S9 (SCRUM-35) built buildPrompt/outputSchema/toCandidates. Jira
// E3-S6 (SCRUM-41) adds `qualityGate` (FR-012) and widens `outputSchema.payload`
// from a placeholder summary to the FR-010 artifact-payload fields. The gate is
// deterministic and read-only - no model call (AI semantic checks are P1) and
// no write. The rules live in the pure `evaluateRequirementsQuality`;
// `qualityGate` only loads the version's members (identity) and payload
// (artifact-lifecycle) and calls it.
//
// Jira E3-S10 (SCRUM-45) adds `generate` (below) - the same
// `{ payload, candidates, runId }` callback shape `backlog.generate` already
// has - and the optional reviewer `feedback` on `RequirementsGenerationContext`.
// Composing it with `artifact-lifecycle.createDraftFromGeneration` (which needs
// an `artifactId`/`actorUserId` this module never sees) is the API route's job.
//
// Requirements is the root artifact (TR FR-080: "Requirements | - (the
// project brief)") - buildPrompt never receives another artifact's approved
// items, and toCandidates never sets upstreamRefs to anything but `[]`
// (Module Boundaries 4.4's allowedUpstream table backs this: identity's own
// matcher throws if a `requirement` candidate is ever given an upstream ref -
// see src/lineage/identity/projection.ts's semanticProjection closing
// "cannot have upstream dependencies" guard).
import { z } from 'zod';
import { generateStructured } from '@/ai-client';
import { getArtifactVersionPayload, getProjectById } from '@/artifact-lifecycle';
import { withTx, type Tx } from '@/db';
import { getSourceVersionMembers, type Candidate } from '@/lineage/identity';
import type { QualityIssueDTO } from '@/lib/serialize';

// TR FR-010's requirement shape, restricted to exactly the fields
// src/lineage/identity/projection.ts's semanticProjection('requirement', ...)
// reads: type, actor, behavior, constraints, acceptanceCriteria, plus
// dimension/value (only meaningful when type==='constraint', but always
// present - both nullable rather than optional, matching previousDisplayKey
// below: OpenAI structured-output strict mode requires every declared
// property to be present on every response, so a field that doesn't apply
// to every item still has to be there, just null).
//
// displayKey/previousDisplayKey are matching-hint metadata only - never
// trusted as a database id (Module Boundaries principle 4 / throughline-
// lineage-invariants point 3). explanation is free prose, deliberately
// outside the semantic-hash field list above; wording there may vary run to
// run without affecting reuse (ERD 5.4's regeneration-stability paragraph).
const RequirementItemSchema = z.object({
  displayKey: z
    .string()
    .regex(/^R-\d{2,}$/, 'display key must look like R-01 (logical_item display-key format)'),
  previousDisplayKey: z.string().nullable(),
  type: z.enum(['functional', 'non_functional', 'constraint']),
  actor: z.string().min(1),
  behavior: z.string().min(1),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()).min(1),
  dimension: z.string().nullable(),
  value: z.string().nullable(),
  explanation: z.string().min(1),
});
export type RequirementItem = z.infer<typeof RequirementItemSchema>;

// The subset buildPrompt needs to show "existing items" verbatim on a
// regenerate call - deliberately NOT the full RequirementItem (explanation/
// previousDisplayKey aren't part of what has to come back unchanged). A
// RequirementItem satisfies this structurally, so a caller holding the
// previous run's parsed items can pass them straight through with no mapping
// step (see scripts/verify-real-generation-t21.ts).
export type BaseRequirementItem = Pick<
  RequirementItem,
  | 'displayKey'
  | 'type'
  | 'actor'
  | 'behavior'
  | 'constraints'
  | 'acceptanceCriteria'
  | 'dimension'
  | 'value'
>;

// TR FR-010's "artifact payload (not dependable)" fields: not lineage-tracked
// and not read by semanticProjection, so nothing here is hash-sensitive the
// way the item fields are. Every property is required (empty arrays allowed)
// for the same OpenAI strict-mode reason as RequirementItemSchema above.
const RequirementsPayloadSchema = z.object({
  businessProblem: z.string().min(1),
  actors: z.array(z.string().min(1)),
  assumptions: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  userJourneys: z.array(z.string()),
});
export type RequirementsPayload = z.infer<typeof RequirementsPayloadSchema>;

// Module Boundaries 4.4: `outputSchema: ZodSchema<{ payload: TPayload; items: TItem[] }>`.
export const outputSchema = z.object({
  payload: RequirementsPayloadSchema,
  items: z.array(RequirementItemSchema).min(1).max(8),
});
export type RequirementsOutput = z.infer<typeof outputSchema>;

export interface RequirementsGenerationContext {
  brief: string;
  // [] on a first-ever generation (baseVersionId is null); the artifact's
  // current approved items, verbatim, on a regenerate call.
  baseItems: BaseRequirementItem[];
  // Reviewer feedback for an AI revision (API Contracts 4, `generate`'s
  // `feedback`). Absent or blank leaves the prompt byte-identical to what it
  // was before this field existed (T21's regeneration stability depends on it).
  feedback?: string | undefined;
}

const RULES = `You are a requirements analyst for a software project. Given a short product
brief, produce between 3 and 6 software requirements as structured JSON matching the provided
schema. Rules:
- type is "functional", "non_functional", or "constraint".
- actor and behavior are each one short, plain sentence - no filler, no markdown.
- constraints is a short list of plain-text constraint notes (can be empty).
- acceptanceCriteria has 2-3 short, testable, single-clause items.
- For type="constraint" items only: dimension names what is constrained (e.g. "deadline",
  "expectedScale", "teamSkills") and value is its concrete value as plain text. For every other
  type, set both dimension and value to null.
- explanation is one sentence of free-form prose explaining the requirement; wording here may
  vary between calls and is not something you need to keep stable.
- displayKey values must look like "R-01", "R-02", ... in the order you list them.
- payload.businessProblem is one or two plain sentences naming the problem the product solves.
- payload.actors lists the people or systems that use the product, as short plain names.
- payload.assumptions lists what you assumed to fill gaps in the brief, one short plain sentence
  each (can be empty). Never restate a constraint here (scale, deadline, budget, team size or
  skills, technology preference, security/performance/deployment expectation) - those belong only
  in constraint items.
- payload.unresolvedQuestions lists anything the brief leaves genuinely unconfirmed, one short
  plain question each (can be empty). Do not repeat an assumption here.
- payload.userJourneys lists the main end-to-end journeys, one short plain sentence each (can be
  empty).
- Be terse and deterministic: given the same brief (and the same existing items below, if any),
  produce the same type/actor/behavior/constraints/acceptanceCriteria/dimension/value every time,
  so the requirements can be regenerated identically.`;

/**
 * ERD 5.4's regeneration-stability technique, followed exactly (this is what
 * T21 depends on - throughline-lineage-invariants point 9): aggressive
 * normalization is the model's job per RULES above; the actual hash
 * normalization lives in src/lineage/identity/projection.ts. This function's
 * only job is to (a) ask for a fresh set when there's nothing to compare
 * against, or (b) supply the base items verbatim, keyed by display key, and
 * ask for the SAME items back unchanged when there is.
 */
function buildBasePrompt(ctx: RequirementsGenerationContext): string {
  if (!ctx.baseItems.length) {
    return `${RULES}\n\nBrief: ${ctx.brief}\n\nReturn a fresh set of requirements. Set every item's previousDisplayKey to null.`;
  }

  const existing = ctx.baseItems
    .map(
      (item) =>
        `${item.displayKey} [${item.type}]\n` +
        `  actor: ${item.actor}\n` +
        `  behavior: ${item.behavior}\n` +
        `  constraints: ${JSON.stringify(item.constraints)}\n` +
        `  acceptanceCriteria: ${JSON.stringify(item.acceptanceCriteria)}\n` +
        `  dimension: ${JSON.stringify(item.dimension)}\n` +
        `  value: ${JSON.stringify(item.value)}`,
    )
    .join('\n');

  return `${RULES}

Brief: ${ctx.brief}

Nothing about the brief has changed since the last generation. The requirements below already
exist from that previous generation:

${existing}

Return the SAME items, unchanged and verbatim: identical type, actor, behavior, constraints
array, acceptanceCriteria array, dimension and value for each one (do not rephrase, reorder, add,
or remove any of them). Only the free-text "explanation" field may be reworded if you want. Keep
each item's displayKey the same as shown above, and set previousDisplayKey to that same display
key.`;
}

// One wording across all four artifact-type modules (each carries its own
// copy: layer-3 peers cannot share a module, and `lib` is framework glue only).
function withReviewerFeedback(prompt: string, feedback: string | undefined): string {
  const trimmed = feedback?.trim();
  if (!trimmed) return prompt;
  return (
    `${prompt}\n\n` +
    'Reviewer feedback on the previous version - address it, even where that means changing an ' +
    'item you were told above to keep verbatim, and keep every unrelated item unchanged:\n' +
    trimmed
  );
}

/**
 * `buildBasePrompt` (the regeneration-stability prompt above), plus - only when
 * `ctx.feedback` is a non-blank string - one trailing reviewer-feedback
 * paragraph. With no feedback the result is exactly `buildBasePrompt`'s.
 */
export function buildPrompt(ctx: RequirementsGenerationContext): string {
  return withReviewerFeedback(buildBasePrompt(ctx), ctx.feedback);
}

/**
 * Model output -> identity.Candidate[] (Module Boundaries 4.4). `payload`
 * carries every field semanticProjection('requirement', ...) reads plus
 * `explanation` (display-only, hash-excluded); `upstreamRefs` is always `[]`
 * - Requirements is the root artifact and never depends on anything
 * upstream. `previousDisplayKey` is passed through as-is: identity is the
 * one place that validates it against the real comparison base (throughline-
 * lineage-invariants point 3) - this function never resolves or trusts it
 * itself.
 */
export function toCandidates(items: RequirementItem[]): Candidate[] {
  return items.map((item) => ({
    previousDisplayKey: item.previousDisplayKey,
    payload: {
      type: item.type,
      actor: item.actor,
      behavior: item.behavior,
      constraints: item.constraints,
      acceptanceCriteria: item.acceptanceCriteria,
      dimension: item.dimension,
      value: item.value,
      explanation: item.explanation,
    },
    upstreamRefs: [],
  }));
}

// API Contracts' `GET /api/artifact-versions/:versionId/quality-gate` shape -
// reused as-is rather than a parallel type. `code` is a plain string there;
// the values this module emits are MALFORMED_ITEM, REQUIRED_FIELD_MISSING,
// MISSING_ACCEPTANCE_CRITERIA, INVALID_REFERENCE, DUPLICATE_REFERENCE and
// UNRESOLVED_ASSUMPTION.
export type QualityIssue = QualityIssueDTO;

export interface RequirementsQualityInput {
  items: { logicalItemId: string; displayKey: string; payload: unknown }[];
  // artifact_version.payload. Rejected/stale versions store `{}`, so any
  // shape must be tolerated rather than assumed.
  payload: unknown;
}

// What semanticProjection('requirement', ...) reads, without the generation-
// time min(1) rules of RequirementItemSchema: a blank actor/behavior should
// surface as REQUIRED_FIELD_MISSING, and only a structurally wrong payload as
// MALFORMED_ITEM. Unknown keys (explanation) are stripped, not rejected.
const StoredRequirementSchema = z.object({
  type: z.enum(['functional', 'non_functional', 'constraint']),
  actor: z.string(),
  behavior: z.string(),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  dimension: z.string().nullish(),
  value: z.string().nullish(),
});
type StoredRequirement = z.infer<typeof StoredRequirementSchema>;

const DISPLAY_KEY_FORMAT = /^R-\d{2,}$/;
const DISPLAY_KEY_MENTION = /\bR-\d{2,}\b/g;

function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim() === '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// "R-04 (constraint: scale)" for a constraint that names its dimension, plain
// "R-04" otherwise.
function itemLabel(displayKey: string, stored: StoredRequirement): string {
  const dimension = stored.dimension?.trim();
  return stored.type === 'constraint' && dimension
    ? `${displayKey} (constraint: ${dimension})`
    : displayKey;
}

function compareItems(
  a: RequirementsQualityInput['items'][number],
  b: RequirementsQualityInput['items'][number],
): number {
  const byKey = a.displayKey.localeCompare(b.displayKey, 'en', { numeric: true });
  if (byKey !== 0) return byKey;
  return a.logicalItemId < b.logicalItemId ? -1 : a.logicalItemId > b.logicalItemId ? 1 : 0;
}

/**
 * FR-012's deterministic checks over one requirements version - pure, no I/O,
 * no model call. Order is stable across runs: per-item issues in display-key
 * order (numeric-aware, ties by logical id), then the cross-item
 * DUPLICATE_REFERENCE groups, then payload-level issues (`logicalItemId:
 * null`). A MALFORMED_ITEM item skips every check that reads its payload
 * (its display key still counts for the key-format and duplicate-key checks,
 * which don't).
 */
export function evaluateRequirementsQuality(input: RequirementsQualityInput): QualityIssue[] {
  const checked = [...input.items].sort(compareItems).map((item) => {
    const parsed = StoredRequirementSchema.safeParse(item.payload);
    return { item, parsed };
  });
  const knownKeys = new Set(checked.map(({ item }) => item.displayKey));
  const issues: QualityIssue[] = [];

  for (const { item, parsed } of checked) {
    const { logicalItemId, displayKey } = item;
    const report = (code: string, message: string) => issues.push({ code, message, logicalItemId });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const path = first?.path.length ? first.path.join('.') : 'payload';
      report(
        'MALFORMED_ITEM',
        `${displayKey} is malformed (${path}): ${first?.message ?? 'invalid'}.`,
      );
    } else {
      const stored = parsed.data;
      const label = itemLabel(displayKey, stored);

      const missing: string[] = [];
      if (isBlank(stored.actor)) missing.push('actor');
      if (isBlank(stored.behavior)) missing.push('behavior');
      if (stored.type === 'constraint') {
        if (isBlank(stored.dimension)) missing.push('dimension');
        if (isBlank(stored.value)) missing.push('value');
      }
      if (missing.length) {
        report(
          'REQUIRED_FIELD_MISSING',
          `${label} is missing required field(s): ${missing.join(', ')}.`,
        );
      }

      if (stored.acceptanceCriteria.every((criterion) => isBlank(criterion))) {
        report('MISSING_ACCEPTANCE_CRITERIA', `${label} has no acceptance criteria.`);
      }
    }

    if (!DISPLAY_KEY_FORMAT.test(displayKey)) {
      report(
        'INVALID_REFERENCE',
        `${displayKey} is not a valid display key (expected the form R-01).`,
      );
    }

    if (parsed.success) {
      const dangling = new Set<string>();
      const prose = [
        parsed.data.behavior,
        ...parsed.data.constraints,
        ...parsed.data.acceptanceCriteria,
      ];
      for (const text of prose) {
        for (const mention of text.match(DISPLAY_KEY_MENTION) ?? []) {
          if (!knownKeys.has(mention)) dangling.add(mention);
        }
      }
      for (const mention of dangling) {
        report(
          'INVALID_REFERENCE',
          `${itemLabel(displayKey, parsed.data)} refers to ${mention}, which is not an item in this version.`,
        );
      }
    }
  }

  // One issue per duplicate group, on its first member (FR-010: one constraint
  // item per dimension; display keys are unique per project).
  const byDisplayKey = new Map<string, typeof checked>();
  const byDimension = new Map<string, { dimension: string; keys: string[]; first: string }>();
  for (const entry of checked) {
    const group = byDisplayKey.get(entry.item.displayKey);
    if (group) group.push(entry);
    else byDisplayKey.set(entry.item.displayKey, [entry]);

    if (entry.parsed.success && entry.parsed.data.type === 'constraint') {
      const dimension = entry.parsed.data.dimension?.trim();
      if (!dimension) continue;
      const normalized = dimension.toLowerCase();
      const dimensionGroup = byDimension.get(normalized);
      if (dimensionGroup) dimensionGroup.keys.push(entry.item.displayKey);
      else
        byDimension.set(normalized, {
          dimension,
          keys: [entry.item.displayKey],
          first: entry.item.logicalItemId,
        });
    }
  }
  for (const [displayKey, group] of byDisplayKey) {
    if (group.length < 2) continue;
    issues.push({
      code: 'DUPLICATE_REFERENCE',
      message: `Display key ${displayKey} is used by ${group.length} items in this version.`,
      logicalItemId: group[0]!.item.logicalItemId,
    });
  }
  for (const { dimension, keys, first } of byDimension.values()) {
    if (keys.length < 2) continue;
    issues.push({
      code: 'DUPLICATE_REFERENCE',
      message: `Constraint items ${keys.join(', ')} share the dimension "${dimension}" (one constraint item per dimension).`,
      logicalItemId: first,
    });
  }

  const payload = isRecord(input.payload) ? input.payload : {};
  if (typeof payload.businessProblem !== 'string' || isBlank(payload.businessProblem)) {
    issues.push({
      code: 'REQUIRED_FIELD_MISSING',
      message: 'The requirements payload has no business problem.',
      logicalItemId: null,
    });
  }
  const questions = Array.isArray(payload.unresolvedQuestions) ? payload.unresolvedQuestions : [];
  for (const question of questions) {
    if (typeof question !== 'string' || isBlank(question)) continue;
    issues.push({
      code: 'UNRESOLVED_ASSUMPTION',
      message: `Unresolved question: "${question.trim()}"`,
      logicalItemId: null,
    });
  }

  return issues;
}

/**
 * FR-012 / Module Boundaries 4.4: loads one requirements version's members
 * (identity - artifact_version_item_membership/item_version are not read
 * directly here) and its payload (artifact-lifecycle), then hands both to
 * `evaluateRequirementsQuality`. Read-only. An unknown version id rejects
 * with identity's own "Unknown context source version".
 */
export async function qualityGate(versionId: string): Promise<QualityIssue[]> {
  const rows = await withTx((tx) => getSourceVersionMembers(tx, [versionId]));

  const items: RequirementsQualityInput['items'] = [];
  for (const row of rows) {
    // getSourceVersionMembers LEFT JOINs: a version with no members comes back
    // as one row whose membership/item columns are all null.
    if (row.logicalItemId === null || row.displayKey === null) continue;
    if (row.itemType !== 'requirement') {
      // A different artifact type routed here is a caller bug, not a quality issue.
      throw new Error(
        `requirements.qualityGate: version ${versionId} contains a ${row.itemType} item (${row.displayKey}), not a requirement`,
      );
    }
    items.push({
      logicalItemId: row.logicalItemId,
      displayKey: row.displayKey,
      payload: row.payload,
    });
  }

  const version = await getArtifactVersionPayload(versionId);
  if (!version) {
    throw new Error(`requirements.qualityGate: artifact version ${versionId} does not exist`);
  }
  return evaluateRequirementsQuality({ items, payload: version.payload });
}

// --- generate() (Jira E3-S10 / SCRUM-45) ------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * The comparison base as buildPrompt shows it: this artifact's currently
 * approved Requirements items, verbatim. `displayKey` is the item's REAL
 * `logical_item.display_key` - buildPrompt asks the model to keep it and to set
 * `previousDisplayKey` to the same value, and identity later validates that
 * hint against the same base (never trusted as an id). Ordered by display key
 * (numeric-aware) because `getSourceVersionMembers` has no ORDER BY and the
 * prompt must be a pure function of the stored items (T21).
 *
 * Read leniently, field by field, rather than through `StoredRequirementSchema`:
 * a stored payload that has drifted from the schema (`qualityGate` reports that
 * as MALFORMED_ITEM) must not make regeneration - the repair path - throw. A
 * bad field degrades to an empty value, so the model is shown something close
 * and its "unchanged" answer hashes differently and mints a corrected revision.
 */
async function loadBaseItems(tx: Tx, baseVersionId: string): Promise<BaseRequirementItem[]> {
  const members = await getSourceVersionMembers(tx, [baseVersionId]);
  return members
    .flatMap((member): BaseRequirementItem[] => {
      if (member.itemType !== 'requirement' || !member.displayKey) return [];
      const payload = isRecord(member.payload) ? member.payload : {};
      const type = payload.type;
      return [
        {
          displayKey: member.displayKey,
          type: type === 'non_functional' || type === 'constraint' ? type : 'functional',
          actor: asString(payload.actor),
          behavior: asString(payload.behavior),
          constraints: asStringArray(payload.constraints),
          acceptanceCriteria: asStringArray(payload.acceptanceCriteria),
          dimension: asStringOrNull(payload.dimension),
          value: asStringOrNull(payload.value),
        },
      ];
    })
    .sort((a, b) => a.displayKey.localeCompare(b.displayKey, 'en', { numeric: true }));
}

/**
 * Loads the project's brief and, on a regeneration, the approved Requirements
 * items; builds the prompt; calls the model; returns `{ payload, candidates,
 * runId }` - the exact shape `artifact-lifecycle.createDraftFromGeneration`'s
 * `generate` callback takes (Module Boundaries 4.3), same as
 * `backlog.generate`. This function does not call `createDraftFromGeneration`
 * itself: it has no `artifactId`/`actorUserId`, so that composition is the API
 * route's job (E3-S10).
 *
 * `baseVersionId` / `contextSourceVersionIds` are optional and are exactly what
 * `createDraftFromGeneration` hands its `generate` callback. When present they
 * replace this function's own read of the project's currently approved ids, so
 * the prompt, the recorded `generation_context_ref` rows and the captured base
 * all come from one snapshot (INV-006); absent (`generate({ projectId })`, the
 * T43 call), it reads the project as before.
 *
 * Requirements is the root artifact (TR FR-080: no prerequisite), so there is
 * no refusal branch. `baseVersionId` is this artifact's own approved version -
 * `null` on a first generation - the same base `createDraftFromGeneration`
 * captures for itself before calling this. No transaction is opened when there
 * is no base to read.
 */
export async function generate(ctx: {
  projectId: string;
  feedback?: string | undefined;
  contextSourceVersionIds?: string[] | undefined;
  baseVersionId?: string | null | undefined;
}): Promise<{ payload: unknown; candidates: Candidate[]; runId: string }> {
  const project = await getProjectById(ctx.projectId);
  if (!project) {
    throw new Error(`Project ${ctx.projectId} does not exist`);
  }

  // Requirements has no prerequisite artifacts (FR-080), so a caller that
  // threads `createDraftFromGeneration`'s captured `contextSourceVersionIds`
  // through must be passing `[]`; anything else is a wiring bug, not a context
  // to silently ignore.
  if (ctx.contextSourceVersionIds?.length) {
    throw new Error(
      `Requirements generate expects no context source version ids, got ${ctx.contextSourceVersionIds.length}`,
    );
  }

  // The base `createDraftFromGeneration` captured (INV-006) when it is handed
  // through - the prompt must show exactly the base the draft will be recorded
  // against, not whatever is approved by the time this read runs. `null` is a
  // real value here (a first generation), so test for `undefined`, not falsy.
  const baseVersionId =
    ctx.baseVersionId !== undefined
      ? ctx.baseVersionId
      : project.artifacts.requirements.approvedVersionId;
  const baseItems = baseVersionId ? await withTx((tx) => loadBaseItems(tx, baseVersionId)) : [];

  const prompt = buildPrompt({ brief: project.brief, baseItems, feedback: ctx.feedback });
  const { data, runId } = await generateStructured({
    projectId: ctx.projectId,
    purpose: 'generation',
    prompt,
    schema: outputSchema,
  });

  return { payload: data.payload, candidates: toCandidates(data.items), runId };
}
