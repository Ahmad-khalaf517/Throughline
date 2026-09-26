import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Tx } from '@/db';
import { getSourceVersionMembers, matchAndPersistItems } from '@/lineage/identity';

// Stored candidates follow ERD 4.9. No database identifier supplied by the model is consumed.
const decisionSchema = z.object({
  previousDisplayKey: z.string().nullable().optional(),
  title: z.string(),
  decision: z.string(),
  technologyOrApproach: z.string(),
  constraints: z.array(z.string()),
  significantTradeoffs: z.array(z.string()),
  upstreamRefs: z.array(z.string()),
});

const optionSchema = z.object({
  title: z.string(),
  summary: z.string(),
  stack: z.record(z.unknown()),
  candidateDecisions: z.array(decisionSchema),
  tradeoffs: z.array(z.object({ factor: z.string(), assessment: z.string() })),
});

export type OptionInput = z.infer<typeof optionSchema>;
export type ArchitectureApprovalCode =
  'OPTION_NOT_SELECTED' | 'OPTION_COUNT_INVALID' | 'STACK_UNCHANGED_DECISIONS';

export class ArchitectureOptionError extends Error {
  constructor(readonly code: ArchitectureApprovalCode) {
    super(code);
    this.name = 'ArchitectureOptionError';
  }
}

// Structural callback contract: lifecycle owns and loads this metadata while locked;
// neither layer-2 module imports its peer (Module Boundaries section 2).
interface DraftContext {
  draftVersionId: string;
  artifactId: string;
  projectId: string;
  type: string;
  status: string;
  baseVersionId: string | null;
  baseSelectedOptionId: string | null;
  bindUpstreamRefs: (candidates: { upstreamRefs: string[] }[]) => Map<string, string>;
}

function assertDraft(context: DraftContext): void {
  if (context.type !== 'architecture' || context.status !== 'draft') {
    throw new Error('Architecture options require an architecture draft');
  }
}

/** Called by the architecture facade inside lifecycle.withArchitectureDraft. Options are write-once. */
export async function createOptions(
  tx: Tx,
  context: DraftContext,
  options: [OptionInput, OptionInput],
) {
  assertDraft(context);
  if (options.length !== 2) throw new ArchitectureOptionError('OPTION_COUNT_INVALID');
  const existing = await tx
    .select({ id: schema.architectureOption.id })
    .from(schema.architectureOption)
    .where(eq(schema.architectureOption.artifactVersionId, context.draftVersionId));
  if (existing.length) throw new ArchitectureOptionError('OPTION_COUNT_INVALID');
  const parsed = options.map((option) => optionSchema.parse(option));
  return tx
    .insert(schema.architectureOption)
    .values(
      parsed.map((option, index) => ({
        ...option,
        artifactVersionId: context.draftVersionId,
        optionKey: index === 0 ? 'A' : 'B',
      })),
    )
    .returning();
}

/** Validate the request's selection only; no draft field or process-global selection is written. */
export async function selectOption(tx: Tx, draftVersionId: string, optionId: string) {
  const options = await tx
    .select()
    .from(schema.architectureOption)
    .where(eq(schema.architectureOption.artifactVersionId, draftVersionId));
  if (options.length !== 2) throw new ArchitectureOptionError('OPTION_COUNT_INVALID');
  const selected = options.find((option) => option.id === optionId);
  if (!selected) throw new ArchitectureOptionError('OPTION_NOT_SELECTED');
  return selected;
}

/** ERD 3.4/5.5: runs only as lifecycle's pre-gate callback, within its project transaction. */
export async function materialize(
  tx: Tx,
  opts: DraftContext & { selectedOptionId: string },
): Promise<{ ok: true } | { ok: false; code: ArchitectureApprovalCode }> {
  assertDraft(opts);
  let selected;
  try {
    selected = await selectOption(tx, opts.draftVersionId, opts.selectedOptionId);
  } catch (error) {
    if (error instanceof ArchitectureOptionError) return { ok: false, code: error.code };
    throw error;
  }
  const candidates = z
    .array(decisionSchema)
    .parse(selected.candidateDecisions)
    .map((decision, position) => {
      const { previousDisplayKey, upstreamRefs, ...payload } = decision;
      return { previousDisplayKey: previousDisplayKey ?? null, upstreamRefs, payload, position };
    });
  const baseMembers = opts.baseVersionId
    ? await getSourceVersionMembers(tx, [opts.baseVersionId])
    : [];
  const baseIds = new Set(baseMembers.map((member) => member.itemVersionId));
  const materialized = await matchAndPersistItems(tx, {
    draftVersionId: opts.draftVersionId,
    artifactId: opts.artifactId,
    projectId: opts.projectId,
    baseVersionId: opts.baseVersionId,
    itemType: 'architecture_decision',
    candidates,
    boundUpstream: opts.bindUpstreamRefs(candidates),
  });
  if (opts.baseVersionId && materialized.every((item) => baseIds.has(item.itemVersionId))) {
    const [baseOption] = opts.baseSelectedOptionId
      ? await tx
          .select()
          .from(schema.architectureOption)
          .where(eq(schema.architectureOption.id, opts.baseSelectedOptionId))
      : [];
    if (!baseOption || baseOption.artifactVersionId !== opts.baseVersionId) {
      throw new Error('Architecture comparison base has no selected option');
    }
    if (!isDeepStrictEqual(selected.stack, baseOption.stack)) {
      return { ok: false, code: 'STACK_UNCHANGED_DECISIONS' };
    }
  }
  return { ok: true };
}
