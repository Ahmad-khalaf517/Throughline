// Module 11: artifact-types/ui-requirements
// Owns: ui_requirement items - payload shape + prompt only
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// Jira E2-S9 (SCRUM-35) scope: the FR-080 generation-prerequisite refusal
// (T43 - "Try to generate UI Requirements before Architecture is approved...
// refused"). `generate` below is still exactly that: it throws either the
// prerequisite error or, once prerequisites are met, a plain not-implemented
// error (its message is matched verbatim by tests/integration/appendix-c.test.ts's
// T43 case, so it is deliberately left as-is here).
//
// Jira E3-S8 (SCRUM-43) scope: `outputSchema` / `buildPrompt` / `toCandidates`
// (Module Boundaries 4.4's ArtifactTypeModule shape, TR FR-040) - pure, no
// database and no model call, exactly like the sibling `requirements`
// module's. `qualityGate` is not built: Module Boundaries 4.4 lists "none
// specified for P0" for this artifact type (a QualityIssue type would belong
// to E3-S6/S10 anyway). Wiring these into `generate` (loading the approved
// Requirements/Architecture items, calling ai-client, returning
// `toCandidates(...)` to createDraftFromGeneration) is E3-S10's job - not
// done here.
//
// `getUiRequirementsForPrompt` below is E4-S4's (SCRUM-53) own narrow
// addition - `stitch.previewPrompt`/`generate` (Module Boundaries 4.6) need
// this UI Requirements version's own item content (the ui_requirement
// payload fields FR-050's "generated structured UI prompt" is built from),
// but `stitch` (layer 5) cannot import `lineage/identity` (layer 1) directly
// (eslint.config.mjs's layer5-external-provider allow-list has no entry for
// layer1-identity, only layer3-artifact-types - the same reasoning
// `backlog.getBacklogVersionMembers`'s own header comment gives for `jira`).
//
// `identity.getSourceVersionMembers` now also selects `item_version.payload`
// (added for this story) - so, exactly like `backlog.getBacklogVersionMembers`
// does for `jira`, this function is a thin "compose-above re-export" that
// delegates entirely to that shared read (Module Boundaries principle 1:
// `identity`/`artifact-lifecycle` own `logical_item` / `item_version` /
// `artifact_version_item_membership` / `artifact_version` / `artifact`, this
// module queries none of them directly). Rows are filtered to
// `itemType === 'ui_requirement'` defensively, even though a UI Requirements
// artifact_version's members are, by construction, only ever that type (an
// artifact only ever holds items of its own type), and to rows with a
// non-null `logicalItemId`/`itemVersionId`/`displayKey` - mirroring the same
// LEFT JOIN null-guard style `jira`'s `resolveDecisionNeed`/`exportOneItem`
// already use, since a version with zero real members returns one row with
// nulls throughout (`getSourceVersionMembers`'s own contract).
import { z } from 'zod';
import { getProjectById } from '@/artifact-lifecycle';
import { withTx } from '@/db';
import { getSourceVersionMembers, type Candidate } from '@/lineage/identity';

// TR FR-040's UI Requirements fields, split by what is dependable (ERD 5.6:
// "If something downstream should be flagged when it changes, it must be a
// `logical_item`"). Screens, user flows and key components are items - one
// item per screen/flow, its user-flow steps and key components described in
// `interactionRequirement` (there is no separate field for either, so no
// non-hashed field can drift from what is stored). Target users, navigation
// expectations, RTL/localization requirements and UX priorities are
// cross-cutting rather than per-screen, so they live in the artifact-level
// `payload` below and are not dependable.
//
// Item fields are restricted to exactly what src/lineage/identity/
// projection.ts's semanticProjection('ui_requirement', ...) reads
// (screenOrFlow, interactionRequirement, responsiveConstraints,
// accessibilityConstraints; ERD 5.4) plus `explanation` - the one deliberate
// exception, free prose that is hash-excluded (ERD 5.4's "Explicitly
// excluded" column). Any other item-level field would not be hashed, so it
// could silently diverge from the stored payload the moment an ItemVersion is
// reused.
//
// previousDisplayKey is nullable rather than optional for the same reason
// given in ../requirements: OpenAI structured-output strict mode requires
// every declared property to be present on every response, so "no previous
// key" has to be an explicit null.
// displayKey/previousDisplayKey are matching-hint metadata only - never
// trusted as a database id (Module Boundaries principle 4 / throughline-
// lineage-invariants point 3).
//
// responsiveConstraints/accessibilityConstraints are order-sensitive in the
// hash (projection.ts only sorts specific keys - acceptanceCriteria,
// significantTradeoffs, constraints, upstream ids - and these two are not
// among them), which is why buildPrompt below asks for them back element for
// element, in order, on a regenerate call.
//
// upstreamRefs: display keys of the Requirements/Architecture items that
// actually drove this screen or flow (identity's allowedUpstream for
// `ui_requirement` is exactly requirement | architecture_decision). ERD 5.5's
// "`upstreamRefs` discipline" is the rule here: list only what drove the
// item, because listing everything would make one changed requirement flag
// every screen (the alert-fatigue failure this product exists to prevent).
// That paragraph asks for "a deterministic warning when a candidate
// references more than a handful of items"; this schema enforces the
// "handful" as a hard `.max(5)` so an over-listing output is rejected at
// parse time (re-run/regenerate) rather than silently persisted. No `.min(1)`:
// no document requires a UI item to have an upstream (ERD 5.5's edge rules
// only say which types MAY be depended on, FR-040 says nothing about it), so
// a legitimately upstream-free screen must stay expressible instead of
// failing the whole generation.
const UiRequirementItemSchema = z.object({
  displayKey: z
    .string()
    .regex(/^UI-\d{2,}$/, 'display key must look like UI-01 (logical_item display-key format)'),
  previousDisplayKey: z.string().nullable(),
  screenOrFlow: z.string().min(1),
  interactionRequirement: z.string().min(1),
  responsiveConstraints: z.array(z.string()),
  accessibilityConstraints: z.array(z.string()),
  upstreamRefs: z
    .array(
      z.string().regex(/^(R|ADR)-\d{2,}$/, 'upstream ref must be a Requirement or ADR display key'),
    )
    .max(5),
  explanation: z.string().min(1),
});
export type UiRequirementItem = z.infer<typeof UiRequirementItemSchema>;

// The subset buildPrompt needs to show "existing items" verbatim on a
// regenerate call - deliberately NOT the full UiRequirementItem
// (explanation/previousDisplayKey aren't part of what has to come back
// unchanged). A UiRequirementItem satisfies this structurally, so a caller
// holding the previous run's parsed items can pass them straight through with
// no mapping step (same pattern as requirements' BaseRequirementItem).
export type BaseUiRequirementItem = Pick<
  UiRequirementItem,
  | 'displayKey'
  | 'screenOrFlow'
  | 'interactionRequirement'
  | 'responsiveConstraints'
  | 'accessibilityConstraints'
  | 'upstreamRefs'
>;

// Module Boundaries 4.4: `outputSchema: ZodSchema<{ payload: TPayload; items: TItem[] }>`.
// `payload` is ERD 5.6's cross-cutting, NON-dependable UI Requirements content
// (nothing downstream may be flagged by it, so nothing in it is an item and
// nothing in it is read by semanticProjection). List fields that must not be
// empty carry `.min(1)` on the array and on its entries - an array holding one
// blank string would satisfy the former vacuously. `rtlLocalizationRequirements`
// may be empty: a project can legitimately have none.
export const outputSchema = z.object({
  payload: z.object({
    targetUsers: z.array(z.string().min(1)).min(1),
    navigationExpectations: z.string().min(1),
    rtlLocalizationRequirements: z.array(z.string().min(1)),
    uxPriorities: z.array(z.string().min(1)).min(1),
  }),
  items: z.array(UiRequirementItemSchema).min(1).max(8),
});
export type UiRequirementsOutput = z.infer<typeof outputSchema>;

// Approved upstream items as buildPrompt shows them to the model, keyed by
// display key (never a database id - Module Boundaries principle 4). Each is
// deliberately only the fields the model needs to decide which items drove a
// screen or flow, not the full persisted payload (no explanation, no
// constraints, no dimension/value). Both are structurally compatible with the
// persisted item payloads of the Requirements and Architecture artifact types
// (a `requirement` payload and an `architecture_decision` payload plus their
// display keys), defined locally because layer-3 peers may not import each
// other (Module Boundaries section 2).
export interface UpstreamRequirementForPrompt {
  displayKey: string;
  type: 'functional' | 'non_functional' | 'constraint';
  actor: string;
  behavior: string;
  acceptanceCriteria: string[];
}

export interface UpstreamArchitectureDecisionForPrompt {
  displayKey: string;
  decision: string;
  technologyOrApproach: string;
}

export interface UiRequirementsGenerationContext {
  // The approved Requirements and Architecture items this generation may
  // depend on (TR FR-080: UI Requirements requires both approved). Only display
  // keys from these two lists are valid `upstreamRefs` values.
  requirements: UpstreamRequirementForPrompt[];
  architectureDecisions: UpstreamArchitectureDecisionForPrompt[];
  // [] on a first-ever generation (baseVersionId is null); the artifact's
  // current approved items, verbatim, on a regenerate call.
  baseItems: BaseUiRequirementItem[];
}

const RULES = `You are a UI/UX analyst for a software project. Given the project's approved
requirements and architecture decisions, produce between 3 and 6 screens or user flows (one item
each) plus a few cross-cutting UI notes, as structured JSON matching the provided schema. Rules:
- screenOrFlow names exactly one screen or one user flow in a few plain words (e.g. "Project
  dashboard").
- interactionRequirement is one to three short, plain sentences describing that screen's or flow's
  user flow steps and key components - no filler, no markdown.
- responsiveConstraints and accessibilityConstraints are each a short list of plain,
  single-clause constraint strings (can be empty).
- upstreamRefs lists ONLY the display keys (e.g. "R-02", "ADR-01") of the requirements and
  architecture decisions listed below that actually drove that screen or flow - at most 5, copied
  exactly as written below, never invented, never anything not listed. Do not list an item that is
  merely loosely related: over-listing makes one unrelated change flag every screen.
- explanation is one sentence of free-form prose explaining the screen or flow; wording here may
  vary between calls and is not something you need to keep stable.
- payload holds the cross-cutting notes no single screen owns: targetUsers (one or more short
  user groups), navigationExpectations (one or two sentences on how users move between the
  screens), rtlLocalizationRequirements (short list; empty if there are none) and uxPriorities
  (one or more short priorities).
- displayKey values must look like "UI-01", "UI-02", ... in the order you list them.
- Be terse and deterministic: given the same requirements and architecture decisions (and the
  same existing items below, if any), produce the same screenOrFlow/interactionRequirement/
  responsiveConstraints/accessibilityConstraints/upstreamRefs every time, so the UI requirements
  can be regenerated identically.`;

function listUpstream(
  requirements: UpstreamRequirementForPrompt[],
  architectureDecisions: UpstreamArchitectureDecisionForPrompt[],
): string {
  const requirementLines = requirements.map(
    (item) =>
      `${item.displayKey} [${item.type}]\n` +
      `  actor: ${item.actor}\n` +
      `  behavior: ${item.behavior}\n` +
      `  acceptanceCriteria: ${JSON.stringify(item.acceptanceCriteria)}`,
  );
  const decisionLines = architectureDecisions.map(
    (item) =>
      `${item.displayKey}\n` +
      `  decision: ${item.decision}\n` +
      `  technologyOrApproach: ${item.technologyOrApproach}`,
  );
  return (
    `Approved requirements:\n${requirementLines.length ? requirementLines.join('\n') : '(none)'}\n\n` +
    `Approved architecture decisions:\n${decisionLines.length ? decisionLines.join('\n') : '(none)'}`
  );
}

/**
 * ERD 5.4's regeneration-stability technique, followed exactly (throughline-
 * lineage-invariants point 9), same shape as requirements.buildPrompt:
 * aggressive normalization is the model's job per RULES above; the actual hash
 * normalization lives in src/lineage/identity/projection.ts. This function's
 * only job is to (a) ask for a fresh set when there's nothing to compare
 * against, or (b) supply the base items verbatim, keyed by display key, and
 * ask for the SAME items back unchanged when there is. In both cases the
 * approved upstream items are listed by display key so the model can only
 * cite keys that exist.
 */
export function buildPrompt(ctx: UiRequirementsGenerationContext): string {
  const upstream = listUpstream(ctx.requirements, ctx.architectureDecisions);

  if (!ctx.baseItems.length) {
    return `${RULES}\n\n${upstream}\n\nReturn a fresh set of screens and flows. Set every item's previousDisplayKey to null.`;
  }

  const existing = ctx.baseItems
    .map(
      (item) =>
        `${item.displayKey}\n` +
        `  screenOrFlow: ${item.screenOrFlow}\n` +
        `  interactionRequirement: ${item.interactionRequirement}\n` +
        `  responsiveConstraints: ${JSON.stringify(item.responsiveConstraints)}\n` +
        `  accessibilityConstraints: ${JSON.stringify(item.accessibilityConstraints)}\n` +
        `  upstreamRefs: ${JSON.stringify(item.upstreamRefs)}`,
    )
    .join('\n');

  return `${RULES}

${upstream}

Nothing about the requirements or architecture decisions above has changed since the last
generation. The screens and flows below already exist from that previous generation:

${existing}

Return the SAME items, unchanged and verbatim: identical screenOrFlow, interactionRequirement,
responsiveConstraints array, accessibilityConstraints array and upstreamRefs for each one (do not
rephrase, reorder, add, or remove any of them, including the entries inside the two constraint
arrays - keep each array's elements in exactly the order shown). Only the free-text "explanation"
field may be reworded if you want. Keep each item's displayKey the same as shown above, and set
previousDisplayKey to that same display key.`;
}

/**
 * Model output -> identity.Candidate[] (Module Boundaries 4.4). `payload`
 * carries every field semanticProjection('ui_requirement', ...) reads plus
 * `explanation` (display-only, hash-excluded); `displayKey` is deliberately
 * NOT copied in - it is a matching hint, and identity allocates the real one.
 * `upstreamRefs` are the model's display keys, passed straight through:
 * artifact-lifecycle's bindUpstreamRefs resolves them against exactly the
 * context source versions the model was shown (INV-006), never against
 * whatever is current now. `previousDisplayKey` is passed through as-is:
 * identity is the one place that validates it against the real comparison
 * base (throughline-lineage-invariants point 3) - this function never
 * resolves or trusts it itself.
 */
export function toCandidates(items: UiRequirementItem[]): Candidate[] {
  return items.map((item) => ({
    previousDisplayKey: item.previousDisplayKey,
    payload: {
      screenOrFlow: item.screenOrFlow,
      interactionRequirement: item.interactionRequirement,
      responsiveConstraints: item.responsiveConstraints,
      accessibilityConstraints: item.accessibilityConstraints,
      explanation: item.explanation,
    },
    upstreamRefs: item.upstreamRefs,
  }));
}

/**
 * TR FR-080: "UI Requirements | Requires approved: Requirements,
 * Architecture". Checked via artifact-lifecycle.getProjectById - the real
 * exported read for "does this project have an approved version of artifact
 * type X" (Module Boundaries principle 1: ui-requirements does not own
 * `artifact`/`artifact_version` and must not query them directly).
 *
 * Called as the `generate` callback createDraftFromGeneration expects
 * (Module Boundaries 4.3): thrown BEFORE any OpenAI call and before the
 * project lock is taken, so a failed prerequisite check never opens a
 * transaction and never writes a row (generation.ts's own header comment -
 * "if it throws, the exception propagates as-is: no lock, no transaction, no
 * row written").
 */
export async function generate(ctx: { projectId: string }): Promise<never> {
  const project = await getProjectById(ctx.projectId);
  if (!project) {
    throw new Error(`Project ${ctx.projectId} does not exist`);
  }

  const missing: string[] = [];
  if (!project.artifacts.requirements.approvedVersionId) missing.push('Requirements');
  if (!project.artifacts.architecture.approvedVersionId) missing.push('Architecture');
  if (missing.length) {
    throw new Error(
      `UI Requirements generation requires approved ${missing.join(' and ')} first (TR FR-080)`,
    );
  }

  throw new Error(
    'ui-requirements.generate: buildPrompt/outputSchema/toCandidates are out of scope for ' +
      'E2-S9 (SCRUM-35) - only the FR-080 prerequisite refusal (T43) is implemented here.',
  );
}

export interface UiRequirementItemForPrompt {
  logicalItemId: string;
  itemVersionId: string;
  displayKey: string;
  // jsonb, shape not yet structurally validated anywhere (no
  // outputSchema/toCandidates exists for this artifact type - E2-S9's own
  // stub scope) - `stitch`'s own prompt builder reads the ERD 5.4 projection
  // fields (screenOrFlow, interactionRequirement, responsiveConstraints,
  // accessibilityConstraints; src/lineage/identity/projection.ts's
  // `semanticProjection('ui_requirement', ...)` field list) out of this
  // defensively.
  payload: unknown;
}

export interface UiRequirementsVersionForPrompt {
  projectId: string;
  status: string;
  items: UiRequirementItemForPrompt[];
}

/**
 * One UI Requirements `artifact_version`'s own status/projectId plus its
 * `ui_requirement` members' exact content (`item_version.payload`) -
 * delegates entirely to `identity.getSourceVersionMembers` (this file's
 * header comment explains why). Throws if the version itself does not exist
 * (`getSourceVersionMembers`'s own "Unknown context source version" check);
 * returns `items: []` (never throws) for a version that exists but
 * genuinely has no `ui_requirement` members yet (e.g. a freshly-created
 * draft before generation has run) - callers decide what that means for
 * them (`stitch.previewPrompt`/`generate` both check `status` before ever
 * looking at `items`).
 */
export async function getUiRequirementsForPrompt(
  uiRequirementsVersionId: string,
): Promise<UiRequirementsVersionForPrompt> {
  const members = await withTx((tx) => getSourceVersionMembers(tx, [uiRequirementsVersionId]));
  const [first] = members;
  if (!first) {
    // getSourceVersionMembers throws its own "Unknown context source
    // version" when the id doesn't exist at all - reaching here with zero
    // rows would mean a real artifact_version with literally no members,
    // which callers never construct in practice.
    throw new Error(`ui_requirements artifact_version ${uiRequirementsVersionId} has no members`);
  }

  const items: UiRequirementItemForPrompt[] = members.flatMap((member) => {
    if (
      member.itemType !== 'ui_requirement' ||
      !member.logicalItemId ||
      !member.itemVersionId ||
      !member.displayKey
    ) {
      return [];
    }
    return [
      {
        logicalItemId: member.logicalItemId,
        itemVersionId: member.itemVersionId,
        displayKey: member.displayKey,
        payload: member.payload,
      },
    ];
  });

  return { projectId: first.projectId, status: first.status, items };
}
