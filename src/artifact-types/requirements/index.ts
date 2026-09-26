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
// Jira E2-S9 (SCRUM-35) scope: buildPrompt/outputSchema/toCandidates only -
// `qualityGate` (FR-012, missing acceptance criteria / duplicate reference /
// malformed item / unresolved assumption / required field missing) is not
// built here. No T## or FR id in this story's citation list (ERD 14 slice 2;
// Jira Plan E2-S9 row) covers it, and this story's own instructions list only
// buildPrompt/outputSchema/toCandidates as in scope - left out rather than
// invented, not silently dropped (see the story's final report).
//
// Requirements is the root artifact (TR FR-080: "Requirements | - (the
// project brief)") - buildPrompt never receives another artifact's approved
// items, and toCandidates never sets upstreamRefs to anything but `[]`
// (Module Boundaries 4.4's allowedUpstream table backs this: identity's own
// matcher throws if a `requirement` candidate is ever given an upstream ref -
// see src/lineage/identity/projection.ts's semanticProjection closing
// "cannot have upstream dependencies" guard).
import { z } from 'zod';
import type { Candidate } from '@/lineage/identity';

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

// Module Boundaries 4.4: `outputSchema: ZodSchema<{ payload: TPayload; items: TItem[] }>`.
// `payload` is a small free-form summary for the artifact_version row's own
// display - not read by semanticProjection, so its shape is not
// hash-sensitive the way the item fields are.
export const outputSchema = z.object({
  payload: z.object({ summary: z.string().min(1) }),
  items: z.array(RequirementItemSchema).min(1).max(8),
});
export type RequirementsOutput = z.infer<typeof outputSchema>;

export interface RequirementsGenerationContext {
  brief: string;
  // [] on a first-ever generation (baseVersionId is null); the artifact's
  // current approved items, verbatim, on a regenerate call.
  baseItems: BaseRequirementItem[];
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
export function buildPrompt(ctx: RequirementsGenerationContext): string {
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
