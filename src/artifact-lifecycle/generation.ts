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
  // The same ItemType `identity.matchAndPersistItems` expects for this
  // artifact (requirement / architecture_decision / ui_requirement / epic /
  // story - Architecture's own ADR items aren't minted here, section 3.3's
  // closing paragraph, but the option payload still flows through the same
  // draft-creation path with itemType supplied by the caller).
  itemType: ItemType;
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
  // can't mint them early by mistake.
  if (itemType === 'architecture_decision' && candidates.length > 0) {
    throw new Error(
      'createDraftFromGeneration must not mint architecture_decision items directly - ' +
        'ADRs are materialized only at approval via architecture-materialization.materialize (ERD 5.5)',
    );
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

    await matchAndPersistItems(tx, {
      draftVersionId: version.id,
      artifactId,
      projectId,
      baseVersionId,
      itemType,
      candidates,
      boundUpstream,
    });

    await insertGenerationContextRefs(tx, version.id, contextSourceVersionIds);

    return { version, stale: false };
  });
}
