// artifact-lifecycle: helpers shared by the two ways a new draft gets
// created - AI generation (generation.ts, ERD 3.3) and manual revision
// (manual-revision.ts, ERD 3.6). Extracted rather than duplicated because
// both call sites need the exact same three pieces (Jira E2-S7).
//
// Nothing outside src/artifact-lifecycle may import this file directly - it
// is internal to the module, not re-exported through ./index.ts.
import { and, desc, eq } from 'drizzle-orm';
import { db, schema, type Tx } from '@/db';

// Shared by the pre-generate()/pre-lock capture (outside any transaction, or
// before this module's own lookups) and the re-check inside the persist
// transaction. `db` and an open `Tx` share the same query-builder shape for
// a plain read.
export async function getApprovedVersionId(
  executor: Tx | typeof db,
  artifactId: string,
): Promise<string | null> {
  const [approved] = await executor
    .select({ id: schema.artifactVersion.id })
    .from(schema.artifactVersion)
    .where(
      and(
        eq(schema.artifactVersion.artifactId, artifactId),
        eq(schema.artifactVersion.status, 'approved'),
      ),
    );
  return approved?.id ?? null;
}

export async function nextVersionNumber(tx: Tx, artifactId: string): Promise<number> {
  const [latest] = await tx
    .select({ versionNumber: schema.artifactVersion.versionNumber })
    .from(schema.artifactVersion)
    .where(eq(schema.artifactVersion.artifactId, artifactId))
    .orderBy(desc(schema.artifactVersion.versionNumber))
    .limit(1);
  return (latest?.versionNumber ?? 0) + 1;
}

/**
 * ERD 3.3 step 8 / ERD 3.6 step 1: replace an existing draft before
 * inserting a new one - the partial unique index (`one_draft_version`) only
 * allows one draft row per artifact at a time, so the old draft must be
 * demoted first. Writes the same `rejected` / `replaced_by_regeneration`
 * `approval_event(draft_replaced)` pair whether the replacement came from a
 * regeneration or a manual revision - "replaced by a newer draft" either
 * way, no new status value (ERD 3.6 step 1's own wording). No-op if there is
 * no existing draft.
 */
export async function replaceExistingDraft(
  tx: Tx,
  artifactId: string,
  // Not part of either call site's documented signature: needed to satisfy
  // approval_event.actor_user_id (NOT NULL) for the draft_replaced row this
  // writes - see generation.ts's and manual-revision.ts's own actorUserId
  // comments for the full explanation of the deviation.
  actorUserId: string,
): Promise<void> {
  const [existingDraft] = await tx
    .select({ id: schema.artifactVersion.id })
    .from(schema.artifactVersion)
    .where(
      and(
        eq(schema.artifactVersion.artifactId, artifactId),
        eq(schema.artifactVersion.status, 'draft'),
      ),
    );

  if (!existingDraft) return;

  await tx
    .update(schema.artifactVersion)
    .set({ status: 'rejected', statusReason: 'replaced_by_regeneration' })
    .where(eq(schema.artifactVersion.id, existingDraft.id));
  await tx.insert(schema.approvalEvent).values({
    artifactVersionId: existingDraft.id,
    actorUserId,
    action: 'draft_replaced',
  });
}
