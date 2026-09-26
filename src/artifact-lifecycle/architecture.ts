import { eq } from 'drizzle-orm';
import { db, schema, withProjectLock, type Tx } from '@/db';
import { bindUpstreamRefs } from '@/lineage/dependency-binding';
import { getSourceVersionMembers } from '@/lineage/identity';

export interface ArchitectureDraftContext {
  draftVersionId: string;
  artifactId: string;
  projectId: string;
  type: string;
  status: string;
  baseVersionId: string | null;
  baseSelectedOptionId: string | null;
  bindUpstreamRefs: (candidates: { upstreamRefs: string[] }[]) => Map<string, string>;
}

/** Lifecycle supplies authoritative metadata and the recorded generation context under its lock. */
export async function loadArchitectureDraftContext(
  tx: Tx,
  draftVersionId: string,
): Promise<ArchitectureDraftContext> {
  const [draft] = await tx
    .select({
      artifactId: schema.artifact.id,
      projectId: schema.artifact.projectId,
      type: schema.artifact.type,
      status: schema.artifactVersion.status,
      baseVersionId: schema.artifactVersion.baseApprovedVersionId,
    })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, draftVersionId));
  if (!draft || draft.type !== 'architecture' || draft.status !== 'draft') {
    throw new Error('Architecture options require an architecture draft');
  }
  const [base] = draft.baseVersionId
    ? await tx
        .select({ selectedOptionId: schema.artifactVersion.selectedArchitectureOptionId })
        .from(schema.artifactVersion)
        .where(eq(schema.artifactVersion.id, draft.baseVersionId))
    : [];
  const refs = await tx
    .select({ sourceVersionId: schema.generationContextRef.sourceArtifactVersionId })
    .from(schema.generationContextRef)
    .where(eq(schema.generationContextRef.targetArtifactVersionId, draftVersionId));
  const members = await getSourceVersionMembers(
    tx,
    refs.map((ref) => ref.sourceVersionId),
  );
  if (members.some((member) => member.projectId !== draft.projectId)) {
    throw new Error('Architecture generation context must belong to the draft project');
  }
  return {
    ...draft,
    draftVersionId,
    baseSelectedOptionId: base?.selectedOptionId ?? null,
    bindUpstreamRefs: (candidates) => bindUpstreamRefs({ members, candidates }),
  };
}

/** Compose option writes above layer 2 without letting a peer module take the project lock. */
export async function withArchitectureDraft<T>(
  draftVersionId: string,
  write: (tx: Tx, context: ArchitectureDraftContext) => Promise<T>,
): Promise<T> {
  const [target] = await db
    .select({ projectId: schema.artifact.projectId })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, draftVersionId));
  if (!target) throw new Error(`artifact_version ${draftVersionId} not found`);
  return withProjectLock(target.projectId, async (tx) =>
    write(tx, await loadArchitectureDraftContext(tx, draftVersionId)),
  );
}
