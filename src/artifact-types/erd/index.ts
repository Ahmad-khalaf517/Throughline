// FR-094: terminal ERD design document. This does not execute generated DDL.
import { z } from 'zod';
import { generateStructured } from '@/ai-client';
import { getProjectById } from '@/artifact-lifecycle';
import { withTx } from '@/db';
import { getSourceVersionMembers } from '@/lineage/identity';

export const outputSchema = z.object({
  payload: z.object({
    overview: z.string().min(1),
    entities: z
      .array(
        z.object({
          name: z.string().min(1),
          purpose: z.string().min(1),
          attributes: z
            .array(
              z.object({
                name: z.string().min(1),
                dataType: z.string().min(1),
                nullable: z.boolean(),
                key: z.enum(['primary', 'foreign', 'none']),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
    relationships: z.array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        cardinality: z.string().min(1),
        explanation: z.string().min(1),
      }),
    ),
    mermaid: z.string().min(1),
    assumptions: z.array(z.string()),
  }),
});

export async function generate(ctx: {
  projectId: string;
  feedback?: string | undefined;
  contextSourceVersionIds?: string[] | undefined;
  baseVersionId?: string | null | undefined;
  onDelta?: (delta: string) => void;
}) {
  const project = await getProjectById(ctx.projectId);
  if (!project) throw new Error(`Project ${ctx.projectId} does not exist`);
  const requirementsId = project.artifacts.requirements.approvedVersionId;
  const architectureId = project.artifacts.architecture.approvedVersionId;
  if (!requirementsId || !architectureId) {
    throw new Error('ERD generation requires approved Requirements and Architecture (FR-080)');
  }
  const sources = ctx.contextSourceVersionIds ?? [requirementsId, architectureId];
  if (sources.length !== 2) throw new Error('ERD generation requires two source versions');
  const members = await withTx((tx) => getSourceVersionMembers(tx, sources));
  const sourceItems = members
    .filter(
      (member) => member.itemType === 'requirement' || member.itemType === 'architecture_decision',
    )
    .map((member) => ({
      type: member.itemType,
      displayKey: member.displayKey,
      payload: member.payload,
    }))
    .sort((a, b) =>
      (a.displayKey ?? '').localeCompare(b.displayKey ?? '', 'en', { numeric: true }),
    );
  const prompt = [
    'Design an Entity Relationship Diagram for this software project as structured JSON.',
    'Base entities and relationships on the approved Requirements and Architecture decisions.',
    'Include primary and foreign keys. Mermaid must be valid erDiagram syntax, without markdown fences.',
    'State uncertain modeling decisions as assumptions. This is a proposal, not an executable migration.',
    `Project brief: ${project.brief}`,
    `Approved source items: ${JSON.stringify(sourceItems)}`,
    ctx.feedback?.trim() ? `Reviewer feedback: ${ctx.feedback.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const { data, runId } = await generateStructured({
    projectId: ctx.projectId,
    purpose: 'generation',
    prompt,
    schema: outputSchema,
    ...(ctx.onDelta ? { onDelta: ctx.onDelta } : {}),
  });
  const entityNames = new Set(data.payload.entities.map((entity) => entity.name));
  for (const relation of data.payload.relationships) {
    if (!entityNames.has(relation.from) || !entityNames.has(relation.to)) {
      throw new Error('ERD relationship references an unknown entity');
    }
  }
  if (!data.payload.mermaid.trimStart().startsWith('erDiagram')) {
    throw new Error('ERD Mermaid output must start with erDiagram');
  }
  return { payload: data.payload, candidates: [], runId };
}
