// FR-093: terminal BRD document. The payload is versioned by artifact-lifecycle;
// no logical items or semantic dependencies are minted from document prose.
import { z } from 'zod';
import { generateStructured } from '@/ai-client';
import { getProjectById } from '@/artifact-lifecycle';
import { withTx } from '@/db';
import { getSourceVersionMembers } from '@/lineage/identity';

export const outputSchema = z.object({
  payload: z.object({
    problem: z.string().min(1),
    stakeholders: z.array(z.string().min(1)),
    goals: z.array(z.string().min(1)),
    scope: z.array(z.string().min(1)),
    outOfScope: z.array(z.string()),
    assumptions: z.array(z.string()),
    risks: z.array(z.string()),
    successMeasures: z.array(z.string().min(1)),
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
  const approved = project.artifacts.requirements.approvedVersionId;
  if (!approved) throw new Error('BRD generation requires approved Requirements (FR-080)');
  const sources = ctx.contextSourceVersionIds ?? [approved];
  if (sources.length !== 1) throw new Error('BRD generation requires one Requirements source');
  const members = await withTx((tx) => getSourceVersionMembers(tx, sources));
  const requirements = members
    .filter((member) => member.itemType === 'requirement')
    .map((member) => ({ displayKey: member.displayKey, payload: member.payload }))
    .sort((a, b) =>
      (a.displayKey ?? '').localeCompare(b.displayKey ?? '', 'en', { numeric: true }),
    );
  const prompt = [
    'Write a Business Requirements Document for this software project as structured JSON.',
    'Use the approved requirements as the source of truth. Distinguish confirmed facts from inferred assumptions.',
    'Every goal and success measure must be specific and testable. Do not invent commitments.',
    `Project brief: ${project.brief}`,
    `Approved requirements: ${JSON.stringify(requirements)}`,
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
  return { payload: data.payload, candidates: [], runId };
}
