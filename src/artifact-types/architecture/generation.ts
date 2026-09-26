// Module 10: artifact-types/architecture - generation surface (prompt, schema,
// option shaping). Pure: no `@/db`, no `@/artifact-lifecycle` at runtime - the
// two imports below are `import type` only and are erased, so a unit test can
// load this file without env or a database.
// See docs/Throughline_Module_Boundaries.md section 4.4 for the shared
// ArtifactTypeModule shape this deviates from on purpose (below).
//
// Nothing outside this folder may import this file directly - it is
// re-exported through ./index.ts (Module Boundaries section 7).
//
// Jira E3-S7 (SCRUM-42) scope: buildPrompt/outputSchema/toOptionInputs/
// toCandidates only.
// - No `qualityGate`: Module Boundaries 4.4 lists none for Architecture in P0
//   (semantic checks are P1, TR section 37) - left out, not silently dropped.
// - No manual revision: Architecture is revised by regeneration only (ERD 3.6),
//   because its decisions only become items at approval.
// - No `requiredSkills` anywhere: ERD removed `required_skills` from
//   architecture_option and FR-023 (team-skill warning) is P1 and OFF - the
//   schema is strict, so a model-supplied `requiredSkills` is rejected rather
//   than carried along.
//
// Architecture deviates from the shared `{ payload; items }` output shape:
// its decisions are NOT lineage while the version is a draft (TR FR-020's last
// line; ERD 5.5), so there is no `items` array to hand to identity. The model
// returns two named options instead, and they are persisted by
// architecture-materialization.createOptions (through the ./index.ts facade),
// not by createDraftFromGeneration. The generate -> createDraftFromGeneration
// -> createOptions orchestration is E3-S10's job, not built here.
//
// What E3-S10 must supply to buildPrompt on a regenerate call (this file only
// declares the inputs; the wiring that loads them is not built here):
// - `baseDecisions[].upstreamRefs`: the display keys of each approved ADR's
//   bound upstream items (its semantic_dependency targets). They are part of
//   the ADR semantic hash (INV-016), so the model must be shown them verbatim.
// - `baseStack`: the stack of the approved version's selected option (ERD 5.5's
//   stack guard compares it with a raw deep-equal), `null` on a first
//   generation.
import { z } from 'zod';
import type { Candidate } from '@/lineage/identity';
import type { OptionInput } from '@/architecture-materialization';

// One option's schema, built by a factory that is called once per option, so
// optionA and optionB are two distinct zod instances. Sharing one instance made
// `zodResponseFormat` emit `$ref`/`definitions` for optionB (and for every
// nested property) instead of an inline object - valid JSON Schema, but an
// avoidable risk under strict mode. Distinct instances keep the generated
// schema fully inline, like the sibling requirements module's.
function buildOptionSchema() {
  return z
    .object({
      title: z.string().min(1),
      summary: z.string().min(1),
      // TR FR-020/FR-031: the machine-readable stack descriptor.
      // src/external/github reads exactly these five fields (all five must
      // match the pinned reference stack for scaffold mode, else docs-only),
      // so the model-facing shape is a fixed five-field object, never an open
      // record - OpenAI strict structured-output mode rejects open objects
      // anyway.
      stack: z
        .object({
          frontend: z.string().min(1),
          backend: z.string().min(1),
          database: z.string().min(1),
          hosting: z.string().min(1),
          repositoryLayout: z.string().min(1),
        })
        .strict(),
      // ERD 4.9's `tradeoffs` element: `{ factor, assessment }` tied to the
      // project's stated constraints (FR-020). "Tied to the project" is a
      // prompt rule - a schema cannot tell generic text from project-specific
      // text.
      tradeoffs: z
        .array(
          z
            .object({
              factor: z.string().min(1),
              assessment: z.string().min(1),
            })
            .strict(),
        )
        .min(1),
      // ERD 4.9's candidate decision. Every declared property is present on
      // every response (OpenAI strict mode), so previousDisplayKey is
      // `.nullable()` rather than `.optional()` - the model emits null on a
      // first generation.
      //
      // previousDisplayKey/upstreamRefs are display-key hints only, never
      // database ids (Module Boundaries principle 4 / throughline-lineage-
      // invariants point 3): identity validates previousDisplayKey against the
      // comparison base at approval (FR-022; TR section 24) and
      // dependency-binding resolves upstreamRefs inside the recorded
      // generation context. upstreamRefs is `.min(1)` - FR-020: each decision
      // lists only the requirement/constraint items that actually drove it,
      // and a decision with no driver is not project-specific.
      candidateDecisions: z
        .array(
          z
            .object({
              previousDisplayKey: z.string().nullable(),
              title: z.string().min(1),
              decision: z.string().min(1),
              technologyOrApproach: z.string().min(1),
              constraints: z.array(z.string()),
              significantTradeoffs: z.array(z.string()),
              upstreamRefs: z
                .array(
                  z
                    .string()
                    .regex(
                      /^R-\d{2,}$/,
                      'upstream ref must be a requirement display key like R-01',
                    ),
                )
                .min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict();
}
export type ArchitectureOptionOutput = z.infer<ReturnType<typeof buildOptionSchema>>;
export type ArchitectureStackDescriptor = ArchitectureOptionOutput['stack'];
export type ArchitectureDecisionCandidate = ArchitectureOptionOutput['candidateDecisions'][number];

// "Exactly two options" (FR-020) is enforced structurally: two named fields,
// each an option schema, rather than a length-2 array. OpenAI strict mode has
// no tuple/prefixItems support and does not reliably honour array length, so
// two fields need no length reliance at all - and they map directly onto
// option_key 'A' / 'B' (FR-021). `.strict()` on every model-facing object
// means an extra key (a third `optionC`, a `requiredSkills`) is a validation
// error, not silently stripped.
//
// `payload` is a small free-form summary for the artifact_version row's own
// display, like the sibling requirements module's.
export const outputSchema = z
  .object({
    payload: z.object({ summary: z.string().min(1) }),
    optionA: buildOptionSchema(),
    optionB: buildOptionSchema(),
  })
  .strict();
export type ArchitectureOutput = z.infer<typeof outputSchema>;

// The approved Requirements items the model is shown - including
// `constraint` items (dimension/value), which are the trade-off drivers
// (TR FR-010/FR-020). Architecture's generation prerequisite is approved
// Requirements (Module Boundaries 4.4 / FR-080). Deliberately a local type
// rather than an import of the requirements module's: artifact-type modules
// never import each other (Module Boundaries 4.4).
export interface ApprovedRequirementItem {
  displayKey: string;
  type: 'functional' | 'non_functional' | 'constraint';
  actor: string;
  behavior: string;
  constraints: string[];
  acceptanceCriteria: string[];
  dimension: string | null;
  value: string | null;
}

// The previously approved ADRs, shown verbatim on a regenerate call. A stored
// candidate decision plus its ADR display key satisfies this structurally.
//
// `upstreamRefs` is REQUIRED, not optional: for an ADR the sorted upstream
// item-version ids are part of the semantic hash (INV-016; src/lineage/
// identity/projection.ts), so a model that re-derives the refs of an otherwise
// unchanged decision mints a spurious new ItemVersion and false-flags every
// downstream artifact. Leaving them out of the regenerate prompt would be that
// failure mode, silently. E3-S10 supplies them: the requirement display keys
// (e.g. "R-03") of the ADR's bound upstream items - not built here.
export interface BaseArchitectureDecision {
  displayKey: string;
  title: string;
  decision: string;
  technologyOrApproach: string;
  constraints: string[];
  significantTradeoffs: string[];
  upstreamRefs: string[];
}

export interface ArchitectureGenerationContext {
  requirements: ApprovedRequirementItem[];
  // [] on a first-ever generation (no approved Architecture yet); the current
  // approved ADRs, verbatim, on a regenerate call.
  baseDecisions: BaseArchitectureDecision[];
  // null on a first-ever generation; on a regenerate call, the stack of the
  // approved version's selected option (E3-S10 supplies it - not built here).
  // Required, not optional, because E3-S3's stack guard (materialize.ts) is a
  // raw deep-equal with no normalization: if every materialized decision is
  // reused but the stack differs even by case ("postgresql" -> "PostgreSQL"),
  // approval is refused (STACK_UNCHANGED_DECISIONS, ERD 5.5) and Architecture
  // has no manual-edit exit (ERD 3.6). The model must therefore see the exact
  // approved stack to reproduce it.
  baseStack: ArchitectureStackDescriptor | null;
}

const RULES = `You are a software architect for a software project. Given the project's approved
requirements (including its constraint items), produce exactly two architecture options as
structured JSON matching the provided schema: "optionA" and "optionB" - exactly two options, no
more, no fewer, and no other option keys. The two options must be genuinely different approaches,
not one stack with cosmetic changes. Rules for each option:
- title is a short name; summary is one short paragraph of plain text.
- stack has exactly five fields - frontend, backend, database, hosting, repositoryLayout - each one
  short plain phrase naming the concrete choice (no lists of alternatives, no markdown).
- tradeoffs is a list of { factor, assessment } entries. Each factor is one of: scale, team skills,
  delivery deadline, maintainability, cost, deployment complexity, security constraints,
  operational complexity. Each assessment must be specific to THIS project: tie it to a concrete
  stated constraint or requirement listed below (quote its value, e.g. the actual deadline or the
  team's stated skills). Generic technology-comparison text that is not connected to the project's
  stated constraints is not acceptable.
- candidateDecisions has 3-6 architecture decisions. For each: title is a short name; decision is
  one plain sentence; technologyOrApproach names the technology or approach chosen; constraints
  and significantTradeoffs are short lists of plain-text notes (either can be empty); upstreamRefs
  lists the display keys (e.g. "R-03") of ONLY the requirement or constraint items from the list
  below that actually drove this decision - at least one, never a key that does not appear in that
  list, and never every constraint on every decision.
- There is no required-skills field: do not add one, or any other field the schema does not
  declare. Reflect the team's stated skills in the tradeoffs and decisions instead.
- Be terse and deterministic: given the same requirements (and the same existing decisions below,
  if any), produce the same decisions every time, so the architecture can be regenerated
  identically.`;

function formatRequirements(requirements: ApprovedRequirementItem[]): string {
  return requirements
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
}

/**
 * Same regeneration-stability technique as the requirements module (ERD 5.4 /
 * throughline-lineage-invariants point 9): ask for a fresh pair of options when
 * there is nothing to compare against, or supply the previously approved ADRs
 * verbatim (including each decision's upstreamRefs) with the previously
 * approved stack, keyed by display key, and ask for unchanged decisions to come
 * back identical with previousDisplayKey set to that key. On a regenerate call
 * optionA continues the approved approach and optionB is the alternative. The
 * actual reuse decision is identity's, at approval (FR-022; TR section 24) -
 * never the model's.
 */
export function buildPrompt(ctx: ArchitectureGenerationContext): string {
  // Backstop for FR-080's generation prerequisite (enforced by the caller):
  // with nothing to reference, the schema's upstreamRefs `.min(1)` could never
  // be satisfied.
  if (!ctx.requirements.length) {
    throw new Error('Architecture generation requires approved requirements (FR-080)');
  }

  const requirements = formatRequirements(ctx.requirements);
  const shown = `Approved requirements (a decision's upstreamRefs may use ONLY these display keys):

${requirements}`;

  // First generation: nothing to compare against, so no base stack is shown
  // (a baseStack passed without any baseDecisions has no decision to guard and
  // is ignored).
  if (!ctx.baseDecisions.length) {
    return `${RULES}

${shown}

Return a fresh pair of options. Set every decision's previousDisplayKey to null.`;
  }

  // Backstop, like the empty-requirements guard above: an approved option
  // always has a stack, so base decisions without one are inconsistent input -
  // and the stack guard could then never be honoured.
  if (!ctx.baseStack) {
    throw new Error('Architecture regeneration requires the previously approved stack (baseStack)');
  }
  const stack = ctx.baseStack;

  const existing = ctx.baseDecisions
    .map(
      (decision) =>
        `${decision.displayKey}\n` +
        `  title: ${decision.title}\n` +
        `  decision: ${decision.decision}\n` +
        `  technologyOrApproach: ${decision.technologyOrApproach}\n` +
        `  constraints: ${JSON.stringify(decision.constraints)}\n` +
        `  significantTradeoffs: ${JSON.stringify(decision.significantTradeoffs)}\n` +
        `  upstreamRefs: ${JSON.stringify(decision.upstreamRefs)}`,
    )
    .join('\n');

  // One unambiguous rule for which option is which on a regenerate call:
  // optionA continues the approved approach, optionB is the alternative. That
  // keeps the "genuinely different approaches" rule in RULES consistent with
  // reusing base ADRs (only optionA inherits them) and makes the stack guard
  // (E3-S3, ERD 5.5) satisfiable: optionA's decisions can all be reused only
  // if its stack is the approved stack, character for character.
  return `${RULES}

${shown}

The previous Architecture version's approved option had exactly this stack (five fields, verbatim):
  frontend: ${stack.frontend}
  backend: ${stack.backend}
  database: ${stack.database}
  hosting: ${stack.hosting}
  repositoryLayout: ${stack.repositoryLayout}

These architecture decisions were approved in that option:

${existing}

This is a regenerate call, so the two options have fixed roles:
- optionA CONTINUES the previously approved approach. Wherever a decision above is still supported
  by the requirements, return the SAME decision, unchanged and verbatim: identical title, decision,
  technologyOrApproach, constraints array, significantTradeoffs array and upstreamRefs array (do not
  rephrase, reorder, add, or remove any of them; an upstreamRefs array changes only if a requirement
  it references is no longer among the requirements shown above), and set that decision's
  previousDisplayKey to the ADR display key shown above - use each ADR key at most once within one
  option. Only change or omit a previous decision when the requirements no longer support it; a
  decision that is genuinely new gets previousDisplayKey null. optionA's stack must be the
  previously approved stack shown above, field for field and character for character (do not
  reword, recase or reformat it); the only exception is a stack field that a decision you had to
  change genuinely requires a different value for.
- optionB is the ALTERNATIVE: a genuinely different approach with a genuinely different stack. Set
  previousDisplayKey to null on each of its decisions, unless a decision is exactly one of the
  decisions above carried over unchanged and verbatim (then use its ADR display key, still at most
  once within the option).
The option summaries and tradeoff assessments may be reworded.`;
}

function toOptionInput(option: ArchitectureOptionOutput): OptionInput {
  return {
    title: option.title,
    summary: option.summary,
    stack: { ...option.stack },
    tradeoffs: option.tradeoffs.map((tradeoff) => ({ ...tradeoff })),
    candidateDecisions: option.candidateDecisions.map((decision) => ({ ...decision })),
  };
}

/**
 * Model output -> the tuple architecture-materialization.createOptions takes,
 * in A, B order. FR-021's stable option identity comes from that position
 * (createOptions assigns option_key 'A' then 'B' by array index) - the model
 * supplies no id and none is read from it (Module Boundaries principle 4).
 * previousDisplayKey/upstreamRefs pass through as-is; identity and
 * dependency-binding validate them at approval.
 */
export function toOptionInputs(output: ArchitectureOutput): [OptionInput, OptionInput] {
  return [toOptionInput(output.optionA), toOptionInput(output.optionB)];
}

/**
 * Always `[]`. Architecture decisions are not lineage while the version is a
 * draft (TR FR-020's last line; ERD 5.5): they are materialized as ADR items
 * only at approval, by architecture-materialization.materialize. And
 * artifact-lifecycle.createDraftFromGeneration throws if an architecture
 * generation returns any candidates (src/artifact-lifecycle/generation.ts), so
 * this must stay empty - the options travel through toOptionInputs instead.
 */
export function toCandidates(_output: ArchitectureOutput): Candidate[] {
  return [];
}
