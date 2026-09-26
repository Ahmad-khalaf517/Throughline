// artifact-lifecycle: read-only accessor for one artifact_version's own
// `payload` column (Jira E3-S6 / SCRUM-41 - the artifact-type modules'
// qualityGate(versionId) needs the version-level payload, and artifact_version
// belongs to this module, Module Boundaries section 5). No lock, no write.
//
// Nothing outside src/artifact-lifecycle may import this file directly - it
// is re-exported through ./index.ts (Module Boundaries section 7).
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

/**
 * `null` only when no such version exists; wrapped so a version whose stored
 * payload is itself a JSON `null` is not mistaken for a missing version.
 */
export async function getArtifactVersionPayload(
  versionId: string,
): Promise<{ payload: unknown } | null> {
  const [row] = await db
    .select({ payload: schema.artifactVersion.payload })
    .from(schema.artifactVersion)
    .where(eq(schema.artifactVersion.id, versionId));
  return row ?? null;
}
