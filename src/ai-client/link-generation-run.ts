import { eq } from 'drizzle-orm';
import { schema, type Tx } from '@/db';

// ERD line 60: `artifact_version_id` on `ai_generation_run` is nullable only
// for calls that failed before a version existed (`generateStructured`
// inserts every row with it null - the version doesn't exist yet at call
// time). A successful call's row must end up pointing at whatever version it
// produced (ERD 3.3 step 4: "...link the ai_generation_run rows, commit";
// 4.13: "One ArtifactVersion has many runs; cost = SUM").
//
// `ai_generation_run` is this module's exclusive write path (Module
// Boundaries section 5) - `artifact-lifecycle.createDraftFromGeneration`
// calls this instead of updating the table itself, passing its own
// already-open, lock-held transaction so the link commits atomically with
// the artifact_version row it points at (same shape as
// `identity.matchAndPersistItems(tx, opts)`: the owning module's own
// exported function runs inside the caller's transaction).
export async function linkGenerationRun(
  tx: Tx,
  runId: string,
  artifactVersionId: string,
): Promise<void> {
  await tx
    .update(schema.aiGenerationRun)
    .set({ artifactVersionId })
    .where(eq(schema.aiGenerationRun.id, runId));
}
