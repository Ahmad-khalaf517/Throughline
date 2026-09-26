// artifact-lifecycle: createDraftFromGeneration (ERD 3.3; TR FR-080; T7, T20,
// T43). See docs/Throughline_Module_Boundaries.md section 4.3 for the
// documented signature/behavior this implements.
//
// Nothing outside src/artifact-lifecycle may import this file directly - it
// is re-exported through ./index.ts (Module Boundaries section 7).
import { db, schema, withProjectLock, type Tx } from '@/db';
import { linkGenerationRun } from '@/ai-client';
import { bindUpstreamRefs, checkFreshness } from '@/lineage/dependency-binding';
import {
  getCurrentItemVersionIds,
  getSourceVersionMembers,
  matchAndPersistItems,
  type Candidate,
  type ItemType,
} from '@/lineage/identity';
import { getApprovedVersionId, nextVersionNumber, replaceExistingDraft } from './shared';

export type ArtifactVersion = typeof schema.artifactVersion.$inferSelect;

// No artifact-type module exists yet to derive "which approved versions of
// other artifacts does this generation depend on" (that derivation is each
// artifact-type module's own FR-080 responsibility - Module Boundaries
// section 4.3's `generate` callback comment: "loads context per TR FR-080").
// This function accepts the already-resolved list instead of computing it,
// and never validates generation-order prerequisites itself (T43 belongs to
// the artifact-type module's `generate()`, which doesn't exist yet).
export interface CreateDraftFromGenerationOptions {
  projectId: string;
  artifactId: string;
  // The default ItemType `identity.matchAndPersistItems` is called with for
  // any candidate that doesn't carry its own `itemType` (requirement /
  // architecture_decision / ui_requirement / epic / story - Architecture's
  // own ADR items aren't minted here, section 3.3's closing paragraph, but
  // the option payload still flows through the same draft-creation path with
  // itemType supplied by the caller). Every artifact type except Backlog
  // mints exactly one item type and never sets `Candidate.itemType`, so this
  // remains the *only* type minted for them, unchanged from before this
  // field became optional.
  //
  // Backlog is the one artifact type that mints two item types - `epic` and
  // `story` - into the SAME draft artifact_version in one generation (ERD
  // 3.3 step 5: "insert membership - Epic rows before their Stories, the
  // parent FK is not deferrable"). Module Boundaries 4.3's documented shape
  // for this function has exactly one ItemType per call, and `generate()`
  // (the LLM part) runs entirely outside any open transaction (step 3
  // above), so it structurally cannot call `identity.matchAndPersistItems`
  // itself even once, let alone twice - only `artifact-lifecycle` may open
  // the locked persist transaction that call needs (Module Boundaries
  // principle 3), and layer-3 modules never call `withProjectLock`. That
  // makes the one-itemType-per-call contract genuinely unable to express a
  // two-item-type single-artifact draft, not just an awkward fit - a real
  // frozen-doc contradiction (throughline project's own doc-contradiction-
  // resolution-pattern), resolved here as a narrow additive change: instead
  // of widening this field to a list, `Candidate` itself grew an optional
  // `itemType` (matcher.ts) and this function groups `candidates` by their
  // own `itemType` (falling back to this field), calling
  // `identity.matchAndPersistItems` once per group, in a fixed
  // epic-before-story order, all inside the ONE already-open, lock-held
  // transaction and the ONE draft `artifact_version` row inserted below -
  // see `groupCandidatesByType`/`ITEM_TYPE_MINT_ORDER`. `backlog`'s own
  // `toCandidates` sets `itemType` on every candidate, so it omits this
  // field entirely rather than supplying an arbitrary single value that
  // would never actually be used as a fallback.
  itemType?: ItemType;
  // The approved versions of the *other* artifacts this generation depends on
  // (e.g. Architecture's context source is Requirements' approved version) -
  // resolved by the caller, not derived here.
  contextSourceVersionIds: string[];
  // Not part of Module Boundaries' documented signature: needed to satisfy
  // approval_event.actor_user_id (NOT NULL) for the draft_replaced row this
  // function writes when regeneration replaces an existing draft.
  actorUserId: string;
  generate: (ctx: {
    baseVersionId: string | null;
    contextSourceVersionIds: string[];
  }) => Promise<{ payload: unknown; candidates: Candidate[]; runId: string }>;
}

export type CreateDraftFromGenerationResult =
  | { version: ArtifactVersion; stale: false }
  | {
      version: ArtifactVersion;
      stale: true;
      // Additional field beyond Module Boundaries' documented return type -
      // exposes which ERD 3.3 step 2/4 stale case fired, for testability.
      // Every caller can still narrow on `stale: true` alone and ignore it.
      reason: 'base_changed' | 'dependency_superseded';
    };

// ERD 3.3 step 5's "Epic rows before their Stories - the parent FK is not
// deferrable": a fixed, deterministic mint order for the one case that has
// more than one group present at once (Backlog's epic+story). Every other
// artifact type only ever produces one group, so its position in this list
// is otherwise irrelevant.
const ITEM_TYPE_MINT_ORDER: readonly ItemType[] = [
  'requirement',
  'architecture_decision',
  'ui_requirement',
  'epic',
  'story',
];

// Groups candidates by their own `itemType` (matcher.ts's optional
// `Candidate.itemType`, added by E3-S9 alongside this function), falling
// back to `defaultItemType` for any candidate that doesn't set one - see
// `CreateDraftFromGenerationOptions.itemType`'s own doc comment for why this
// exists instead of widening `matchAndPersistItems` to accept a mixed-type
// batch. Throws rather than silently guessing if a candidate has no
// itemType of its own and no default was supplied.
function groupCandidatesByType(
  candidates: Candidate[],
  defaultItemType: ItemType | undefined,
): Map<ItemType, Candidate[]> {
  const groups = new Map<ItemType, Candidate[]>();
  for (const candidate of candidates) {
    const type = candidate.itemType ?? defaultItemType;
    if (!type) {
      throw new Error(
        'Candidate has no itemType and CreateDraftFromGenerationOptions.itemType was not provided',
      );
    }
    const group = groups.get(type);
    if (group) group.push(candidate);
    else groups.set(type, [candidate]);
  }
  return groups;
}

// Backlog Epic/Story parent resolution (E3-S9). A Story's `parentDisplayKey`
// out of `backlog.toCandidates` is the model's own OUTPUT-LOCAL Epic label
// (the Epic's `displayKey` inside that one response), not a real
// `logical_item.display_key` - `identity.matchAndPersistItems` allocates every
// new item's real key itself (project-wide max suffix + 1, counting replaced
// and removed items), so a label and the real key of the Epic that carried it
// coincide only in a fresh project's first generation. On a regeneration with
// a base version, or after a replaced draft, they drift apart - and the
// matcher's own parent lookup (a real display_key among this draft's Epics)
// would either throw or, worse, silently resolve a Story to a DIFFERENT Epic
// that happens to hold the label's number as its real key (Module Boundaries
// principle 4: a model-supplied key is never trusted as a real identity).
//
// The fix lives here, not in matcher.ts, for the same reason the itemType
// split does: this is the one place that sees the epic group's results
// (candidate order, each with its real logicalItemId) before the story group
// runs, inside the same lock-held transaction. Epic candidates that carry an
// `outputKey` (Candidate.outputKey, matcher.ts) get a label -> real display
// key map built from the draft's own membership rows; Story candidates are
// then COPIED with `parentDisplayKey` rewritten from label to that real key
// before `matchAndPersistItems` runs for the story group (the caller's own
// candidate objects are never mutated - a stale-generation rejection above
// stores them verbatim as `raw_output`).
//
// Backwards compatible on purpose: if NO Epic candidate carries an
// `outputKey`, this returns null and Story candidates are persisted exactly
// as before, `parentDisplayKey` already being a real key (callers/tests that
// pass real keys directly).
async function resolveEpicLabels(
  tx: Tx,
  draftVersionId: string,
  epicCandidates: Candidate[],
  epicResults: { logicalItemId: string }[],
): Promise<Map<string, string> | null> {
  if (!epicCandidates.some((candidate) => candidate.outputKey)) return null;

  const members = await getSourceVersionMembers(tx, [draftVersionId]);
  const realKeyByLogicalItemId = new Map<string, string>();
  for (const member of members) {
    if (member.logicalItemId && member.displayKey) {
      realKeyByLogicalItemId.set(member.logicalItemId, member.displayKey);
    }
  }

  const labelToRealKey = new Map<string, string>();
  epicCandidates.forEach((candidate, index) => {
    if (!candidate.outputKey) return;
    const logicalItemId = epicResults[index]?.logicalItemId;
    const realKey = logicalItemId ? realKeyByLogicalItemId.get(logicalItemId) : undefined;
    if (!realKey) {
      throw new Error(
        `Epic labelled ${candidate.outputKey} is not a member of draft ${draftVersionId}`,
      );
    }
    if (labelToRealKey.has(candidate.outputKey)) {
      throw new Error(`Two Epic candidates share the output label ${candidate.outputKey}`);
    }
    labelToRealKey.set(candidate.outputKey, realKey);
  });
  return labelToRealKey;
}

function rewriteStoryParents(
  storyCandidates: Candidate[],
  labelToRealKey: Map<string, string>,
): Candidate[] {
  return storyCandidates.map((candidate) => {
    if (!candidate.parentDisplayKey) return candidate;
    const realKey = labelToRealKey.get(candidate.parentDisplayKey);
    if (!realKey) {
      throw new Error(
        `Story parent "${candidate.parentDisplayKey}" matches no Epic output label in this generation`,
      );
    }
    return { ...candidate, parentDisplayKey: realKey };
  });
}

async function insertGenerationContextRefs(
  tx: Tx,
  targetArtifactVersionId: string,
  contextSourceVersionIds: string[],
): Promise<void> {
  const uniqueSourceIds = [...new Set(contextSourceVersionIds)];
  if (!uniqueSourceIds.length) return;
  await tx.insert(schema.generationContextRef).values(
    uniqueSourceIds.map((sourceArtifactVersionId) => ({
      targetArtifactVersionId,
      sourceArtifactVersionId,
    })),
  );
}

/**
 * ERD 3.3 in full. `generate()` (the LLM call) always runs before any
 * transaction opens and before the project lock is taken - if it throws, the
 * exception propagates as-is: no lock, no transaction, no row written
 * (that's the whole contract this layer owes FR-080's "generation
 * prerequisites" refusal, which is each artifact-type module's own check
 * inside its `generate()` callback).
 */
export async function createDraftFromGeneration(
  opts: CreateDraftFromGenerationOptions,
): Promise<CreateDraftFromGenerationResult> {
  const { projectId, artifactId, itemType, contextSourceVersionIds, actorUserId, generate } = opts;

  // Step 1: capture base_id - the artifact's current approved version, or
  // null - before the LLM call (ERD 3.3 preamble).
  const baseVersionId = await getApprovedVersionId(db, artifactId);

  // Step 3 (LLM call): outside any transaction, never holding the lock
  // across it (ERD 3.2's "never hold the lock across an LLM or provider
  // call"). Left uncaught on purpose - see the doc comment above.
  const { payload, candidates, runId } = await generate({ baseVersionId, contextSourceVersionIds });

  // Architecture drafts store architecture_option rows and their
  // candidate_decisions JSON only at this step - no ADR LogicalItems exist
  // until approval (ERD 3.3 closing paragraph; ERD 5.5). ADRs are minted
  // exclusively by architecture-materialization.materialize, called from
  // approveVersion (Module Boundaries 4.3's `**Rule:**`). Guard here, before
  // ever taking the lock, so a future architecture artifact-type module
  // can't mint them early by mistake. Checked against every candidate's
  // *effective* itemType (its own, or the default) rather than just
  // `itemType` itself, now that a candidate may carry its own - no caller
  // actually mixes architecture_decision with anything else, but the guard
  // should not quietly stop working if one ever tried.
  if (
    candidates.some((candidate) => (candidate.itemType ?? itemType) === 'architecture_decision')
  ) {
    throw new Error(
      'createDraftFromGeneration must not mint architecture_decision items directly - ' +
        'ADRs are materialized only at approval via architecture-materialization.materialize (ERD 5.5)',
    );
  }

  // Group candidates by effective itemType and reject anything the mint loop
  // below could not persist - done here, before the lock is taken and before
  // any row is written, rather than letting the loop silently skip a group
  // whose type is not in ITEM_TYPE_MINT_ORDER (which would drop those
  // candidates' items from the draft with no error). Also surfaces a
  // candidate with neither its own itemType nor a default up front.
  const candidateGroups = groupCandidatesByType(candidates, itemType);
  for (const type of candidateGroups.keys()) {
    if (!ITEM_TYPE_MINT_ORDER.includes(type)) {
      throw new Error(
        `createDraftFromGeneration cannot mint candidates of unknown itemType "${type}"`,
      );
    }
  }

  // Step 4: re-open the persist transaction under the project lock.
  return withProjectLock(projectId, async (tx) => {
    const versionNumber = await nextVersionNumber(tx, artifactId);

    // Step 5: reject as stale if base_id is no longer the artifact's
    // approved version (T7) - checked before doing any binding work.
    const currentApprovedVersionId = await getApprovedVersionId(tx, artifactId);
    let staleReason: 'base_changed' | 'dependency_superseded' | undefined;
    let boundUpstream = new Map<string, string>();

    if (currentApprovedVersionId !== baseVersionId) {
      staleReason = 'base_changed';
    } else {
      // Step 6: bind every proposed dependency inside the captured context
      // source versions' membership (INV-006 - never a newer version the
      // model did not see), then evaluate currentness of what was bound.
      const members = await getSourceVersionMembers(tx, contextSourceVersionIds);
      boundUpstream = bindUpstreamRefs({ members, candidates });
      const currentItemVersionIds = await getCurrentItemVersionIds(tx, projectId, [
        ...boundUpstream.values(),
      ]);
      const freshness = checkFreshness({
        approvedVersionId: baseVersionId,
        baseVersionId,
        boundUpstream,
        currentItemVersionIds,
      });
      if (freshness.stale) staleReason = freshness.reason;
    }

    if (staleReason) {
      // Step 7: persist the rejected/stale_generation_context version - raw
      // output kept for audit, payload stays `{}`, no items minted, but the
      // generation_context_ref rows are still recorded (they show exactly
      // what the stale call saw).
      const [version] = await tx
        .insert(schema.artifactVersion)
        .values({
          artifactId,
          versionNumber,
          status: 'rejected',
          statusReason: 'stale_generation_context',
          schemaVersion: 1,
          baseApprovedVersionId: baseVersionId,
          // ERD line 275: raw_output on a stale_generation_context rejection
          // is the model output exactly as returned - payload and candidates
          // together, not payload alone (candidates are the proposed items,
          // discarded from `payload` only to keep `payload` schema-parseable).
          rawOutput: { payload, candidates },
          payload: {},
        })
        .returning();
      if (!version) throw new Error('artifact_version insert returned no row');

      await linkGenerationRun(tx, runId, version.id);
      await insertGenerationContextRefs(tx, version.id, contextSourceVersionIds);

      return { version, stale: true, reason: staleReason };
    }

    // Step 8: not stale. Replace an existing draft first (the partial
    // unique index only allows one draft row per artifact at a time, so the
    // old draft must be demoted before the new one is inserted).
    await replaceExistingDraft(tx, artifactId, actorUserId);

    const [version] = await tx
      .insert(schema.artifactVersion)
      .values({
        artifactId,
        versionNumber,
        status: 'draft',
        schemaVersion: 1,
        baseApprovedVersionId: baseVersionId,
        payload,
      })
      .returning();
    if (!version) throw new Error('artifact_version insert returned no row');

    await linkGenerationRun(tx, runId, version.id);

    // Step 8 continued: mint/reuse items. One call to
    // `identity.matchAndPersistItems` per distinct effective itemType among
    // `candidates`, in `ITEM_TYPE_MINT_ORDER` (epic before story), all
    // against this SAME `version.id` inside this SAME transaction - see
    // `groupCandidatesByType`'s and `CreateDraftFromGenerationOptions.itemType`'s
    // own doc comments for why. Every artifact type except Backlog produces
    // exactly one group here (unchanged from a single direct call).
    //
    // Between the epic group and the story group, Story `parentDisplayKey`
    // values that are model-supplied Epic labels are rewritten to the real
    // display keys just allocated/reused for those Epics - see
    // `resolveEpicLabels`'s own comment. `epicLabelToRealKey` stays null
    // (no rewrite) unless an Epic candidate carried an `outputKey`.
    let epicLabelToRealKey: Map<string, string> | null = null;
    for (const type of ITEM_TYPE_MINT_ORDER) {
      const group = candidateGroups.get(type);
      if (!group?.length) continue;
      const results = await matchAndPersistItems(tx, {
        draftVersionId: version.id,
        artifactId,
        projectId,
        baseVersionId,
        itemType: type,
        candidates:
          type === 'story' && epicLabelToRealKey
            ? rewriteStoryParents(group, epicLabelToRealKey)
            : group,
        boundUpstream,
      });
      if (type === 'epic') {
        epicLabelToRealKey = await resolveEpicLabels(tx, version.id, group, results);
      }
    }

    await insertGenerationContextRefs(tx, version.id, contextSourceVersionIds);

    return { version, stale: false };
  });
}
