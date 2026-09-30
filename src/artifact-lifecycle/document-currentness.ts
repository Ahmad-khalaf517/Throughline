// FR-088: document source-currentness is separate from item impact.
import { eq, inArray } from 'drizzle-orm';
import { db, schema, type Tx } from '@/db';

export class DocumentSourceChangedError extends Error {
  constructor() {
    super('The approved source versions changed. Regenerate this document before approval.');
    this.name = 'DocumentSourceChangedError';
  }
}

/** Null for the original four artifact types, boolean for BRD/ERD. */
export async function getDocumentSourceCurrentness(
  versionId: string,
  executor: Tx | typeof db = db,
): Promise<boolean | null> {
  const [target] = await executor
    .select({ type: schema.artifact.type })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, versionId))
    .limit(1);
  if (!target || (target.type !== 'brd' && target.type !== 'erd')) return null;

  const expected = target.type === 'brd' ? ['requirements'] : ['requirements', 'architecture'];
  const refs = await executor
    .select({ sourceVersionId: schema.generationContextRef.sourceArtifactVersionId })
    .from(schema.generationContextRef)
    .where(eq(schema.generationContextRef.targetArtifactVersionId, versionId));
  if (refs.length !== expected.length) return false;

  const sources = await executor
    .select({ type: schema.artifact.type, status: schema.artifactVersion.status })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(
      inArray(
        schema.artifactVersion.id,
        refs.map((ref) => ref.sourceVersionId),
      ),
    );
  return (
    sources.length === expected.length &&
    expected.every((type) =>
      sources.some((source) => source.type === type && source.status === 'approved'),
    )
  );
}
