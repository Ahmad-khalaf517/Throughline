// Module 12: artifact-types/backlog
// Owns: epic, story items - payload shape + prompt only
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// Jira E3-S9 (SCRUM-44) scope: buildPrompt/outputSchema/toCandidates/
// qualityGate (Module Boundaries 4.4's full ArtifactTypeModule shape),
// Epic/Story parent resolution, and wiring `generate` past the FR-080 check
// E2-S9 (SCRUM-35) left in place. Reference implementations followed:
// requirements/index.ts (buildPrompt/outputSchema/toCandidates shape and the
// exact regeneration-stability technique - base items shown verbatim, model
// asked to return them unchanged) and ui-requirements/index.ts (the FR-080
// prerequisite-check pattern, kept verbatim below).
//
// `artifact-type modules never import each other` (Module Boundaries 4.4's
// own closing rule) applies here just as it does to `ui-requirements`'s own
// documented `jira`/`github` pairing: this module never imports
// requirements/architecture/ui-requirements' code, even though it reads
// their approved items' `payload` for prompt context. Those payloads are
// read as `unknown` and picked apart defensively by field name (ERD 5.4's
// own projection field list for each type), the same pattern
// ui-requirements/index.ts's `UiRequirementItemForPrompt.payload: unknown`
// already established for the same reason.
//
// --- The Epic+Story two-item-type minting design decision -----------------
//
// FR-060 requires one Backlog generation to produce BOTH Epics and Stories,
// and ERD 3.3 step 5 is explicit that they are minted into the SAME draft
// `artifact_version` in the SAME persist transaction ("insert membership -
// Epic rows before their Stories, the parent FK is not deferrable"). But
// `artifact-lifecycle.createDraftFromGeneration` (Module Boundaries 4.3, an
// already-implemented earlier story) takes exactly one `itemType` per call,
// and calls `identity.matchAndPersistItems` exactly once with it. `generate()`
// (the LLM part) runs entirely OUTSIDE any open transaction (ERD 3.3 step 3),
// so this module cannot work around the limit by calling
// `identity.matchAndPersistItems` itself either once or twice - only
// `artifact-lifecycle` may open the locked transaction that call needs
// (Module Boundaries principle 3), and layer-3 modules never call
// `withProjectLock`. The one-itemType-per-call contract genuinely cannot
// express "this one draft mints both epic and story items" - a real
// frozen-doc contradiction, not just an awkward fit.
//
// Resolved as a narrow, additive change in the two lowest-risk places
// (documented in full where each change lives):
//   - `identity.Candidate` (src/lineage/identity/matcher.ts) gained an
//     optional `itemType` field, read by nothing inside that file.
//   - `artifact-lifecycle.createDraftFromGeneration` (generation.ts) now
//     groups `candidates` by their own `itemType` (falling back to its own
//     `itemType` option, unchanged for every other artifact type) and calls
//     `identity.matchAndPersistItems` once per group, in a fixed
//     epic-before-story order, inside the ONE already-open transaction and
//     against the ONE draft `artifact_version` row it inserts.
// This module's own `toCandidates` (below) is what actually exercises it:
// every Epic candidate carries `itemType: 'epic'`, every Story candidate
// carries `itemType: 'story'`.
//
// Epic/Story parent resolution. A Story's `parentDisplayKey` is the model's
// own OUTPUT-LOCAL Epic label - the `displayKey` some Epic in that same
// response carries - NOT a real `logical_item.display_key`: `identity` always
// allocates a new item's real key itself (project-wide max suffix + 1,
// counting replaced/removed items), so label and real key coincide only in a
// fresh project's first generation and drift apart on any regeneration
// (Module Boundaries principle 4: a model-supplied key is never trusted as a
// real identity - and here an unchecked one could silently resolve a Story
// to the WRONG Epic, not just fail). So:
//   - `outputSchema` (below) guarantees, deterministically and with no DB,
//     that Epic labels are unique within the output and every Story's
//     `parentDisplayKey` equals one of them - the model-facing contract.
//   - `toCandidates` sets `outputKey` (the Epic's label) on every Epic
//     candidate, and leaves each Story's `parentDisplayKey` as that label.
//   - `artifact-lifecycle.createDraftFromGeneration` then persists the Epic
//     group, maps each `outputKey` label to the real display key of the Epic
//     that carried it, and rewrites each Story candidate's `parentDisplayKey`
//     to that real key (on a copy) before persisting the Story group, in the
//     same transaction. This is where Module Boundaries 4.4's "toCandidates
//     resolves it ... via identity.resolveDisplayKeys before calling
//     matchAndPersistItems" actually happens - after the Epics exist, since
//     their real keys cannot be known before then, not inside the pure
//     `toCandidates` function.
//
// Wiring `generate()` all the way through `createDraftFromGeneration` itself
// (resolving this project's Backlog `artifactId`, supplying a real
// `actorUserId`) is NOT done here: `generate(ctx: { projectId })`'s own
// return shape must stay exactly `{ payload, candidates, runId }` - the
// shape `createDraftFromGeneration`'s own `generate` callback expects
// (Module Boundaries 4.3) - because that is how `ui-requirements.generate`
// is already used (see tests/integration/appendix-c.test.ts's T43 test:
// `generate: () => backlogType.generate({ projectId })`, passed AS that
// callback). Composing the outer `createDraftFromGeneration({ artifactId,
// actorUserId, generate: (ctx) => backlogType.generate({ projectId }), ... })`
// call is the API route's job (E3-S10) - it owns resolving `artifactId` from
// `:type` and `actorUserId` from the authenticated user, neither of which
// this module has access to via its own `ctx: { projectId }`.
import { z } from 'zod';
import { generateStructured } from '@/ai-client';
import { getProjectById } from '@/artifact-lifecycle';
import { withTx, type Tx } from '@/db';
import {
  getSourceVersionMembers,
  getUpstreamDependencies,
  type Candidate,
} from '@/lineage/identity';

// --- Schema (TR FR-060/061/062; ERD 5.4's projection field list) ----------
//
// Field names are exactly the ones src/lineage/identity/projection.ts's
// semanticProjection('epic'|'story', ...) reads, so nothing here can drift
// from what actually gets hashed: epic = title, scopeStatement; story =
// userValueStatement, acceptanceCriteria, structuredBehavior (+ upstream
// ids, added by toCandidates/matchAndPersistItems, never by the model).
//
// `acceptanceCriteria` is deliberately NOT `.min(1)`: FR-063's own quality
// gate check is "Story has no acceptance criteria" - a schema that already
// forbade the empty case would make that check permanently unreachable.
const EpicItemSchema = z.object({
  kind: z.literal('epic'),
  // An OUTPUT-LOCAL label (see this file's header comment on parent
  // resolution): unique within one response (enforced by outputSchema's
  // superRefine below) and what each Story's `parentDisplayKey` names. On a
  // regeneration the model is told to keep a reused Epic's label equal to
  // the base display key shown to it, but nothing downstream relies on a
  // label matching any real `logical_item.display_key`.
  displayKey: z
    .string()
    .regex(/^E-\d{2,}$/, 'display key must look like E-01 (logical_item display-key format)'),
  previousDisplayKey: z.string().nullable(),
  title: z.string().min(1),
  scopeStatement: z.string().min(1),
  explanation: z.string().min(1),
});

const StoryItemSchema = z.object({
  kind: z.literal('story'),
  displayKey: z
    .string()
    .regex(/^S-\d{2,}$/, 'display key must look like S-12 (logical_item display-key format)'),
  previousDisplayKey: z.string().nullable(),
  // Module Boundaries 4.4: "Candidates carry parentDisplayKey for Stories" -
  // every Story belongs to exactly one Epic (ERD 4.9 "[APP] parent is an
  // epic, child is a story; only stories have parents"). This is the Epic's
  // output-local label (the `displayKey` of an Epic in THIS same response),
  // which outputSchema's superRefine below checks resolves to one - not a
  // real logical_item.display_key.
  parentDisplayKey: z.string().regex(/^E-\d{2,}$/, 'parent display key must look like E-01'),
  userValueStatement: z.string().min(1),
  acceptanceCriteria: z.array(z.string()),
  structuredBehavior: z.string().min(1),
  // FR-061 "priority when needed" - excluded from ERD 5.4's story
  // projection ("epic parent (structural), priority display" is explicitly
  // listed as excluded from the hash), so it is display-only metadata.
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  // FR-062: display keys among the approved Requirements/Architecture
  // Decisions/UI Requirements shown in the prompt. Code (toCandidates ->
  // identity.matchAndPersistItems) validates these resolve to real,
  // in-context ItemVersions before persisting anything - the model's own
  // list is a hint only (Module Boundaries principle 4).
  upstreamRefs: z.array(z.string()),
  explanation: z.string().min(1),
});

const BacklogItemSchema = z.discriminatedUnion('kind', [EpicItemSchema, StoryItemSchema]);
export type EpicItem = z.infer<typeof EpicItemSchema>;
export type StoryItem = z.infer<typeof StoryItemSchema>;
export type BacklogItem = z.infer<typeof BacklogItemSchema>;

// Module Boundaries 4.4: `outputSchema: ZodSchema<{ payload: TPayload; items: TItem[] }>`.
// FR-060 requires both Epics and Stories out of one generation - enforced
// here (structurally, before any persistence work) rather than left as a
// downstream surprise, the same way requirements/index.ts's `.min(1).max(8)`
// bounds its own item count.
//
// The superRefine is this module's model-facing "Epic/Story parent
// resolution" contract, deterministic and DB-free: Epic `displayKey` labels
// are unique within the output, and every Story's `parentDisplayKey` equals
// one of them. Failing here rejects a malformed generation before any
// persistence work, instead of surfacing later as a throw inside
// createDraftFromGeneration's transaction (see this file's header comment
// for why a label is never a real display key).
export const outputSchema = z
  .object({
    payload: z.object({ summary: z.string().min(1) }),
    items: z.array(BacklogItemSchema).min(2),
  })
  .superRefine((data, ctx) => {
    const epicLabels = new Set<string>();
    for (const item of data.items) {
      if (item.kind !== 'epic') continue;
      if (epicLabels.has(item.displayKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate Epic displayKey ${item.displayKey} - Epic labels must be unique within one output`,
        });
      }
      epicLabels.add(item.displayKey);
    }

    if (!epicLabels.size || !data.items.some((item) => item.kind === 'story')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Backlog generation must include at least one Epic and one Story (TR FR-060)',
      });
    }

    for (const item of data.items) {
      if (item.kind === 'story' && !epicLabels.has(item.parentDisplayKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Story ${item.displayKey} has parentDisplayKey ${item.parentDisplayKey}, which matches no Epic displayKey in this output`,
        });
      }
    }
  });
export type BacklogOutput = z.infer<typeof outputSchema>;

// --- Prompt context (loaded by generate(), below) --------------------------

export interface UpstreamContextItem {
  displayKey: string;
  itemType: 'requirement' | 'architecture_decision' | 'ui_requirement';
  summary: string;
}

// The subset buildPrompt needs to show existing Epics/Stories verbatim on a
// regenerate call - deliberately not the full EpicItem/StoryItem
// (explanation/previousDisplayKey aren't part of what has to come back
// unchanged), same reasoning as requirements/index.ts's own
// BaseRequirementItem.
export interface BaseEpicItem {
  displayKey: string;
  title: string;
  scopeStatement: string;
}

export interface BaseStoryItem {
  displayKey: string;
  parentDisplayKey: string;
  userValueStatement: string;
  acceptanceCriteria: string[];
  structuredBehavior: string;
  priority: string | null;
  upstreamRefs: string[];
}

export interface BacklogGenerationContext {
  brief: string;
  requirements: UpstreamContextItem[];
  architectureDecisions: UpstreamContextItem[];
  uiRequirements: UpstreamContextItem[];
  // [] on a first-ever generation (baseVersionId is null); the artifact's
  // current approved items, verbatim, on a regenerate call.
  baseEpics: BaseEpicItem[];
  baseStories: BaseStoryItem[];
}

const RULES = `You are an agile delivery lead for a software project. Given the project's approved
Requirements, Architecture Decisions and UI Requirements, produce an implementation backlog of
Epics and Stories as structured JSON matching the provided schema. Rules:
- Every item has "kind": "epic" or "story".
- Produce 2-5 Epics. Each Epic's displayKey looks like "E-01", "E-02", ... in the order you list
  them. title is one short phrase; scopeStatement is 1-2 plain sentences describing what the Epic
  covers. Epics never reference Requirements/Architecture/UI Requirements directly.
- Epic displayKey values are labels local to this output: each must be unique within your
  response.
- Produce 1-4 Stories per Epic. Each Story's displayKey looks like "S-01", "S-02", ... numbered
  across the whole backlog (not restarted per Epic), and parentDisplayKey must equal the
  displayKey of one of the Epics in your own response (the Epic it belongs to).
- userValueStatement is one sentence, ideally "As a <actor>, I want <behavior>, so that <value>".
- acceptanceCriteria is a list of short, testable, single-clause conditions - it may be empty if
  none are clear yet; do not invent filler criteria just to have some.
- structuredBehavior is 1-2 plain sentences describing the concrete behavior the Story implements.
- priority is "low", "medium", or "high" when the brief/requirements suggest one, otherwise null.
- upstreamRefs lists the display keys (from the Requirements/Architecture Decisions/UI
  Requirements shown below) that this Story is a direct implementation of - only the ones that
  actually drove this Story, not every item that is loosely related. It may be empty.
- explanation is one sentence of free-form prose; wording here may vary between calls.
- Be terse and deterministic: given the same inputs (and the same existing items below, if any),
  produce the same title/scopeStatement/userValueStatement/acceptanceCriteria/structuredBehavior/
  priority/upstreamRefs/parentDisplayKey every time, so the backlog can be regenerated
  identically.`;

function formatContextList(items: UpstreamContextItem[]): string {
  return items.length
    ? items.map((item) => `${item.displayKey}: ${item.summary}`).join('\n')
    : '(none)';
}

/**
 * ERD 5.4's regeneration-stability technique, followed exactly (this is what
 * T21 depends on - throughline-lineage-invariants point 9), extended to
 * Backlog's two item types: on a first-ever generation, ask for a fresh
 * backlog; on a regenerate call, supply every existing Epic and Story
 * verbatim, keyed by display key (Stories additionally keyed by their Epic's
 * display key and their own upstreamRefs, both of which are part of what
 * must come back unchanged - upstreamRefs is inside the semantic hash via
 * the sorted upstream ItemVersion ids, INV-016), and ask for the SAME items
 * back unchanged.
 */
export function buildPrompt(ctx: BacklogGenerationContext): string {
  const header = `${RULES}

Project brief: ${ctx.brief}

Approved Requirements:
${formatContextList(ctx.requirements)}

Approved Architecture Decisions:
${formatContextList(ctx.architectureDecisions)}

Approved UI Requirements:
${formatContextList(ctx.uiRequirements)}`;

  if (!ctx.baseEpics.length && !ctx.baseStories.length) {
    return `${header}

Return a fresh backlog. Set every item's previousDisplayKey to null.`;
  }

  const existingEpics = ctx.baseEpics
    .map(
      (epic) =>
        `${epic.displayKey}\n  title: ${epic.title}\n  scopeStatement: ${epic.scopeStatement}`,
    )
    .join('\n');
  // A base Story's stored upstream edges can point at an item that is no
  // longer in the CAPTURED context above (e.g. a Requirement removed since
  // that Story was generated). Rendering such a key verbatim would tell the
  // model to return a reference dependency-binding cannot resolve
  // (`bindUpstreamRefs` throws "Unresolved upstream reference" inside the
  // persist transaction), turning regeneration - the repair path for exactly
  // that situation - into a hard failure. So only refs whose display key is
  // present in the context lists shown to the model are rendered; a dropped
  // ref changes that Story's sorted upstream ItemVersion ids (INV-016), so it
  // correctly comes back as a new revision rather than a reuse.
  const knownUpstreamKeys = new Set(
    [...ctx.requirements, ...ctx.architectureDecisions, ...ctx.uiRequirements].map(
      (item) => item.displayKey,
    ),
  );
  const existingStories = ctx.baseStories
    .map(
      (story) =>
        `${story.displayKey} (parent ${story.parentDisplayKey})\n` +
        `  userValueStatement: ${story.userValueStatement}\n` +
        `  acceptanceCriteria: ${JSON.stringify(story.acceptanceCriteria)}\n` +
        `  structuredBehavior: ${story.structuredBehavior}\n` +
        `  priority: ${JSON.stringify(story.priority)}\n` +
        `  upstreamRefs: ${JSON.stringify(story.upstreamRefs.filter((key) => knownUpstreamKeys.has(key)))}`,
    )
    .join('\n');

  return `${header}

Nothing about the brief or its approved sources has changed since the last generation. The Epics
and Stories below already exist from that previous generation:

Epics:
${existingEpics}

Stories:
${existingStories}

Return the SAME items, unchanged and verbatim: identical title, scopeStatement,
userValueStatement, acceptanceCriteria, structuredBehavior, priority, upstreamRefs (exactly the
list shown for that Story) and parentDisplayKey for each one (do not rephrase, reorder, add, or
remove any of them). Only the
free-text "explanation" field may be reworded if you want. Keep each item's displayKey the same
as shown above, set previousDisplayKey to that same display key, and keep each Story's
parentDisplayKey pointing at the same Epic.`;
}

/**
 * Model output -> identity.Candidate[] (Module Boundaries 4.4). Epics never
 * carry `parentDisplayKey`/`upstreamRefs` (matcher.ts throws if a
 * non-Story candidate has a parent - src/lineage/identity/matcher.ts line
 * ~154; ERD 5.4 "epic ... has no upstream edges"). Every candidate's
 * `itemType` is set explicitly - see this file's header comment for why
 * that is what lets one draft mint both item types.
 *
 * Every Epic candidate also carries `outputKey: item.displayKey` - the
 * Epic's output-local label. A Story's `parentDisplayKey` is passed through
 * as that same label (NOT resolved to a real display key here - real keys
 * don't exist until the Epics are persisted); createDraftFromGeneration
 * rewrites it label -> real key between the epic and story groups. See this
 * file's header comment.
 */
export function toCandidates(items: BacklogItem[]): Candidate[] {
  return items.map((item): Candidate => {
    if (item.kind === 'epic') {
      return {
        itemType: 'epic',
        outputKey: item.displayKey,
        previousDisplayKey: item.previousDisplayKey,
        payload: {
          title: item.title,
          scopeStatement: item.scopeStatement,
          explanation: item.explanation,
        },
        upstreamRefs: [],
      };
    }
    return {
      itemType: 'story',
      previousDisplayKey: item.previousDisplayKey,
      parentDisplayKey: item.parentDisplayKey,
      payload: {
        userValueStatement: item.userValueStatement,
        acceptanceCriteria: item.acceptanceCriteria,
        structuredBehavior: item.structuredBehavior,
        priority: item.priority,
        explanation: item.explanation,
      },
      upstreamRefs: item.upstreamRefs,
    };
  });
}

// --- generate() --------------------------------------------------------

/**
 * TR FR-080: "Backlog | Requires approved: Requirements, Architecture, UI
 * Requirements". Same mechanics as ui-requirements.generate - see that
 * file's doc comment. Kept verbatim from E2-S9 (SCRUM-35): only the trailing
 * not-implemented throw is replaced below.
 *
 * Once prerequisites pass, this loads the real generation context (this
 * project's approved Requirements/Architecture Decisions/UI Requirements
 * content, plus the Backlog's own current approved Epics/Stories for
 * regeneration stability), builds the prompt, calls the LLM, and returns
 * `{ payload, candidates, runId }` - the exact shape
 * `artifact-lifecycle.createDraftFromGeneration`'s own `generate` callback
 * expects (Module Boundaries 4.3), and the shape this function is called
 * with in tests/integration/appendix-c.test.ts's T43 test
 * (`generate: () => backlogType.generate({ projectId })`). This function
 * does not itself call `createDraftFromGeneration` - see this file's header
 * comment for why that composition is the API route's job (E3-S10), not
 * this one's: `ctx: { projectId }` alone has no `artifactId`/`actorUserId`
 * to supply it with.
 */
export async function generate(ctx: {
  projectId: string;
}): Promise<{ payload: unknown; candidates: Candidate[]; runId: string }> {
  const project = await getProjectById(ctx.projectId);
  if (!project) {
    throw new Error(`Project ${ctx.projectId} does not exist`);
  }

  const missing: string[] = [];
  if (!project.artifacts.requirements.approvedVersionId) missing.push('Requirements');
  if (!project.artifacts.architecture.approvedVersionId) missing.push('Architecture');
  if (!project.artifacts.ui_requirements.approvedVersionId) missing.push('UI Requirements');
  if (missing.length) {
    throw new Error(`Backlog generation requires approved ${missing.join(', ')} first (TR FR-080)`);
  }

  const contextSourceVersionIds = [
    project.artifacts.requirements.approvedVersionId!,
    project.artifacts.architecture.approvedVersionId!,
    project.artifacts.ui_requirements.approvedVersionId!,
  ];
  const baseVersionId = project.artifacts.backlog.approvedVersionId;

  const generationContext = await withTx((tx) =>
    loadGenerationContext(tx, { brief: project.brief, contextSourceVersionIds, baseVersionId }),
  );
  const prompt = buildPrompt(generationContext);
  const { data, runId } = await generateStructured({
    projectId: ctx.projectId,
    purpose: 'generation',
    prompt,
    schema: outputSchema,
  });

  return { payload: data.payload, candidates: toCandidates(data.items), runId };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

// Defensive, cross-artifact-type-module-import-free read of a Requirement/
// Architecture Decision/UI Requirement item's own payload, for prompt
// display only - see this file's header comment for why this can't import
// requirements/architecture/ui-requirements' own schemas. Field names are
// ERD 5.4's projection field list for each type.
function summarizeUpstreamPayload(
  itemType: 'requirement' | 'architecture_decision' | 'ui_requirement',
  payload: unknown,
): string {
  const p = asRecord(payload);
  switch (itemType) {
    case 'requirement':
      return `[${asString(p.type) || 'requirement'}] ${asString(p.actor)} ${asString(p.behavior)}`.trim();
    case 'architecture_decision':
      return `${asString(p.decision)} (${asString(p.technologyOrApproach)})`.trim();
    case 'ui_requirement':
      return `${asString(p.screenOrFlow)}: ${asString(p.interactionRequirement)}`.trim();
  }
}

/**
 * Loads everything buildPrompt needs: the approved context sources' own
 * items (for upstreamRefs display) and, on a regenerate call, the Backlog's
 * own current approved Epics/Stories (for the verbatim-regeneration
 * technique) including each Story's Epic parent (via
 * `artifact_version_item_membership.parent_logical_item_id`, ERD 4.9) and
 * upstream display keys (via `identity.getUpstreamDependencies`, added by
 * this story - see that function's own doc comment).
 */
async function loadGenerationContext(
  tx: Tx,
  args: { brief: string; contextSourceVersionIds: string[]; baseVersionId: string | null },
): Promise<BacklogGenerationContext> {
  const versionIds = args.baseVersionId
    ? [...args.contextSourceVersionIds, args.baseVersionId]
    : args.contextSourceVersionIds;
  const members = await getSourceVersionMembers(tx, versionIds);
  const baseMembers = args.baseVersionId
    ? members.filter((member) => member.sourceVersionId === args.baseVersionId)
    : [];
  const contextMembers = members.filter((member) => member.sourceVersionId !== args.baseVersionId);

  const upstreamContext = (
    itemType: 'requirement' | 'architecture_decision' | 'ui_requirement',
  ): UpstreamContextItem[] =>
    contextMembers
      .filter((member) => member.itemType === itemType && member.displayKey)
      .map((member) => ({
        displayKey: member.displayKey!,
        itemType,
        summary: summarizeUpstreamPayload(itemType, member.payload),
      }));

  const baseEpicMembers = baseMembers.filter(
    (member) => member.itemType === 'epic' && member.logicalItemId && member.displayKey,
  );
  const baseStoryMembers = baseMembers.filter(
    (member) =>
      member.itemType === 'story' &&
      member.logicalItemId &&
      member.itemVersionId &&
      member.displayKey,
  );

  const epicDisplayKeyByLogicalItemId = new Map(
    baseEpicMembers.map((member) => [member.logicalItemId as string, member.displayKey as string]),
  );

  const storyItemVersionIds = baseStoryMembers.map((member) => member.itemVersionId as string);
  const dependencies = storyItemVersionIds.length
    ? await getUpstreamDependencies(tx, storyItemVersionIds)
    : [];
  const upstreamKeysByDownstream = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!dep.upstreamDisplayKey) continue;
    const list = upstreamKeysByDownstream.get(dep.downstreamItemVersionId) ?? [];
    list.push(dep.upstreamDisplayKey);
    upstreamKeysByDownstream.set(dep.downstreamItemVersionId, list);
  }

  const baseEpics: BaseEpicItem[] = baseEpicMembers.map((member) => {
    const payload = asRecord(member.payload);
    return {
      displayKey: member.displayKey as string,
      title: asString(payload.title),
      scopeStatement: asString(payload.scopeStatement),
    };
  });

  const baseStories: BaseStoryItem[] = baseStoryMembers.map((member) => {
    const payload = asRecord(member.payload);
    return {
      displayKey: member.displayKey as string,
      parentDisplayKey:
        (member.parentLogicalItemId &&
          epicDisplayKeyByLogicalItemId.get(member.parentLogicalItemId)) ||
        '',
      userValueStatement: asString(payload.userValueStatement),
      acceptanceCriteria: asStringArray(payload.acceptanceCriteria),
      structuredBehavior: asString(payload.structuredBehavior),
      priority: typeof payload.priority === 'string' ? payload.priority : null,
      upstreamRefs: (upstreamKeysByDownstream.get(member.itemVersionId as string) ?? []).sort(),
    };
  });

  return {
    brief: args.brief,
    requirements: upstreamContext('requirement'),
    architectureDecisions: upstreamContext('architecture_decision'),
    uiRequirements: upstreamContext('ui_requirement'),
    baseEpics,
    baseStories,
  };
}

// --- qualityGate (FR-063) --------------------------------------------------

// Module Boundaries 4.4's abstract signature is `qualityGate(versionId):
// Promise<QualityIssue[]>` - a local, structural type here, not an import of
// src/lib/serialize.ts's QualityIssueDTO (layer 3 may import `lib`
// per eslint.config.mjs, but the DTO mapping itself is the API route
// layer's job, E3-S10 - this module has no reason to depend on it). Kept
// field-for-field identical to QualityIssueDTO on purpose so that mapping is
// a no-op.
export interface QualityIssue {
  code: string;
  message: string;
  logicalItemId: string | null;
}

/**
 * FR-063's five checks, all deterministic, read-only, no lock. Reads
 * `identity.getSourceVersionMembers` (this Backlog version's own Epic/Story
 * members) and `identity.getUpstreamDependencies` (their `semantic_dependency`
 * edges, added by this story), plus `artifact-lifecycle.getProjectById` to
 * find the project's currently approved Requirements version for the
 * "Requirement has no implementation Story" direction (Module Boundaries
 * principle 1: this module never queries `artifact`/`artifact_version`
 * itself).
 */
export async function qualityGate(versionId: string): Promise<QualityIssue[]> {
  return withTx(async (tx) => {
    const members = await getSourceVersionMembers(tx, [versionId]);
    const [first] = members;
    if (!first) {
      throw new Error(`backlog artifact_version ${versionId} has no members`);
    }
    const projectId = first.projectId;

    const stories = members.filter(
      (
        member,
      ): member is typeof member & {
        logicalItemId: string;
        itemVersionId: string;
        displayKey: string;
      } =>
        member.itemType === 'story' &&
        !!member.logicalItemId &&
        !!member.itemVersionId &&
        !!member.displayKey,
    );

    const issues: QualityIssue[] = [];

    // "Story has no acceptance criteria".
    for (const story of stories) {
      const payload = asRecord(story.payload);
      if (asStringArray(payload.acceptanceCriteria).length === 0) {
        issues.push({
          code: 'story_no_acceptance_criteria',
          message: `${story.displayKey} has no acceptance criteria`,
          logicalItemId: story.logicalItemId,
        });
      }
    }

    const storyItemVersionIds = stories.map((story) => story.itemVersionId);
    const dependencies = storyItemVersionIds.length
      ? await getUpstreamDependencies(tx, storyItemVersionIds)
      : [];
    const dependenciesByStory = new Map<string, typeof dependencies>();
    for (const dep of dependencies) {
      const list = dependenciesByStory.get(dep.downstreamItemVersionId) ?? [];
      list.push(dep);
      dependenciesByStory.set(dep.downstreamItemVersionId, list);
    }

    // "Story has no source Requirement", "source item does not exist",
    // "source reference points to an invalid project/version". The latter
    // two are read defensively (see getUpstreamDependencies's own doc
    // comment) - matchAndPersistItems and semantic_dependency's own
    // composite FKs already structurally prevent both, so in practice
    // neither ever fires; the read still checks for it, per FR-063.
    for (const story of stories) {
      const deps = dependenciesByStory.get(story.itemVersionId) ?? [];
      const hasSourceRequirement = deps.some((dep) => dep.upstreamItemType === 'requirement');
      if (!hasSourceRequirement) {
        issues.push({
          code: 'story_no_source_requirement',
          message: `${story.displayKey} has no source Requirement`,
          logicalItemId: story.logicalItemId,
        });
      }
      for (const dep of deps) {
        if (!dep.upstreamLogicalItemId || !dep.upstreamProjectId) {
          issues.push({
            code: 'source_item_missing',
            message: `${story.displayKey} references an upstream item that no longer resolves`,
            logicalItemId: story.logicalItemId,
          });
        } else if (dep.upstreamProjectId !== projectId || dep.dependencyProjectId !== projectId) {
          issues.push({
            code: 'source_item_invalid_project',
            message: `${story.displayKey} references an upstream item from a different project`,
            logicalItemId: story.logicalItemId,
          });
        }
      }
    }

    // "Requirement has no implementation Story": every CURRENT Requirement
    // (a member of the project's approved Requirements version) that no
    // Story in *this* Backlog version depends on.
    //
    // Compared by LOGICAL item, not by ItemVersion id. A Story reused from
    // the base (e.g. a manual-revision draft, FR-081) stays bound to the
    // ItemVersion of the Requirement it was written against (R-07@A) even
    // after the approved Requirements version moved on to R-07@D - comparing
    // ItemVersion ids would then report "R-07 has no Story" while
    // `story_no_source_requirement` (above) correctly does not fire for that
    // same Story: two checks of one gate contradicting each other. Whether
    // that Story's binding is now OBSOLETE is a staleness question, and
    // staleness belongs solely to the impact engine (INV-025, ERD 6.3 -
    // "nothing else may compute staleness"); this gate only answers "does any
    // Story here trace to this Requirement at all", i.e. per LogicalItem.
    const project = await getProjectById(projectId);
    const requirementsApprovedVersionId = project?.artifacts.requirements.approvedVersionId ?? null;
    if (requirementsApprovedVersionId) {
      const requirementMembers = await getSourceVersionMembers(tx, [requirementsApprovedVersionId]);
      const referencedRequirementLogicalItemIds = new Set(
        dependencies
          .filter((dep) => dep.upstreamItemType === 'requirement' && dep.upstreamLogicalItemId)
          .map((dep) => dep.upstreamLogicalItemId as string),
      );
      for (const requirement of requirementMembers) {
        if (
          requirement.itemType !== 'requirement' ||
          !requirement.logicalItemId ||
          !requirement.itemVersionId ||
          !requirement.displayKey
        ) {
          continue;
        }
        // JUDGMENT CALL on FR-063's wording ("Requirement has no
        // implementation Story"), flagged for the product owner: Requirements
        // of `type: 'constraint'` (FR-010; ERD 5.6 - deadline, expected
        // scale, team skills, ...) are exempt from this one flag. They are
        // architecture-driving inputs (roughly 6-8 per project, one per
        // dimension), not deliverables a Story implements, and this module's
        // own Story prompt (RULES above) asks the model to cite an upstream
        // item only when the Story is a direct implementation of it - so
        // flagging every constraint would be permanent alert-fatigue noise,
        // the failure mode this product exists to prevent. A Story MAY still
        // cite a constraint (it is a legal upstream, and counts as a source
        // for that Story); only the missing-Story flag is skipped.
        if (asRecord(requirement.payload).type === 'constraint') continue;
        if (!referencedRequirementLogicalItemIds.has(requirement.logicalItemId)) {
          issues.push({
            code: 'requirement_no_implementation_story',
            message: `${requirement.displayKey} has no implementation Story in this Backlog version`,
            logicalItemId: requirement.logicalItemId,
          });
        }
      }
    }

    return issues;
  });
}

// `getBacklogVersionMembers` below is E4-S3's (SCRUM-52) own narrow addition
// - `jira.previewExport`/`exportBacklog` (Module Boundaries 4.6) need the
// Epic/Story LogicalItem/ItemVersion membership rows of one captured Backlog
// version, but `jira` (layer 5) cannot import `lineage/identity` (layer 1)
// directly (eslint.config.mjs's layer5-external-provider allow-list has no
// entry for layer1-identity - unlike `architecture-materialization`, which
// is layer 2 and the ONE documented cross-layer exception, Module Boundaries
// section 2). `backlog` (layer 3) CAN import `identity` directly (the
// layer3-artifact-types eslint rule allows layer1-identity) - this is the
// same "compose-above re-export" pattern `architecture.getArchitectureDecisionItems`
// established in E4-S2 for `github`, mirrored here for `jira`'s own paired
// layer-3 module. A pure read, no lock needed. Signature preserved exactly
// (this story does not touch it) - `jira` imports it.
export type BacklogVersionMember = Awaited<ReturnType<typeof getSourceVersionMembers>>[number];

export async function getBacklogVersionMembers(
  backlogVersionId: string,
): Promise<BacklogVersionMember[]> {
  return withTx((tx) => getSourceVersionMembers(tx, [backlogVersionId]));
}
