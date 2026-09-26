import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@/db';
import {
  contentOnlyProjection,
  semanticHash,
  SEMANTIC_HASH_VERSION,
  type ItemType,
} from './projection';

export type Candidate = {
  previousDisplayKey?: string | null;
  payload: Record<string, unknown>;
  upstreamRefs: string[];
  // What `matchAndPersistItems` itself accepts here is a REAL, already-
  // allocated `logical_item.display_key` of an Epic that is a member of the
  // draft it is persisting into (see the parent-resolution block below) - it
  // never sees, and never trusts, a model-supplied label (Module Boundaries
  // principle 4). A caller whose Story parent is instead the model's own
  // output-local Epic label (backlog) sets `outputKey` on its Epic
  // candidates (below) and lets artifact-lifecycle/generation.ts rewrite
  // this field from label to real key after the Epics are persisted.
  parentDisplayKey?: string | null;
  position?: number | null;
  // Added by E3-S9 (SCRUM-44), purely additive and optional: an OUTPUT-LOCAL
  // label for this candidate - the display key the model itself gave this
  // item in its own response (backlog's Epic `displayKey`), which is only
  // meaningful inside that one response (a Story's parentDisplayKey names
  // it). It is NOT the item's real `display_key`: this file always
  // allocates a new item's real key itself (project-wide max suffix + 1,
  // counting replaced/removed items too), so a label and the key eventually
  // allocated coincide only by luck (a fresh project's first generation) and
  // drift apart on any regeneration or replaced draft. Read ONLY by
  // artifact-lifecycle/generation.ts, which uses it to translate each Story's
  // label-valued `parentDisplayKey` into the real key of the Epic that carried
  // that label - never by this file, and never persisted anywhere.
  outputKey?: string;
  // Added by E3-S9 (SCRUM-44), purely additive and optional - every existing
  // caller (requirements/architecture/ui-requirements' own toCandidates)
  // never sets this, so `MatchOptions.itemType` (below) remains the only
  // item type for their calls, unchanged. `backlog` is the one artifact type
  // that mints two item types (`epic` and `story`) into the SAME draft
  // artifact_version in one generation (ERD 3.3 step 5: "insert membership -
  // Epic rows before their Stories, the parent FK is not deferrable"), and
  // `createDraftFromGeneration`'s own `itemType: ItemType` option is a single
  // value per call (Module Boundaries 4.3's documented shape, as already
  // implemented). This file is NOT the place that reads this field - it is
  // read only by artifact-lifecycle/generation.ts, which groups candidates
  // by it (falling back to the single `MatchOptions.itemType` when absent)
  // and calls this module's own `matchAndPersistItems` once per group, in a
  // fixed epic-before-story order, all inside the same already-open,
  // lock-held transaction/draftVersionId - see that file's own comment for
  // the full reasoning. Doing the split there, rather than teaching this
  // function to accept a mixed-type candidate batch, keeps every statement
  // below that assumes one `itemType` per call (the prefix/artifactType/
  // allowedUpstream lookups, the historicalKeys allocator, ...) correct
  // without restructuring this already-implemented, higher-risk module.
  itemType?: ItemType;
};

type MatchOptions = {
  draftVersionId: string;
  artifactId: string;
  projectId: string;
  baseVersionId: string | null;
  itemType: ItemType;
  candidates: Candidate[];
  boundUpstream: Map<string, string>;
};

const prefix: Record<ItemType, string> = {
  requirement: 'R',
  architecture_decision: 'ADR',
  ui_requirement: 'UI',
  epic: 'E',
  story: 'S',
};

const artifactType: Record<ItemType, string> = {
  requirement: 'requirements',
  architecture_decision: 'architecture',
  ui_requirement: 'ui_requirements',
  epic: 'backlog',
  story: 'backlog',
};

const allowedUpstream: Record<ItemType, ItemType[]> = {
  requirement: [],
  architecture_decision: ['requirement'],
  ui_requirement: ['requirement', 'architecture_decision'],
  epic: [],
  story: ['requirement', 'architecture_decision', 'ui_requirement'],
};

export async function matchAndPersistItems(
  tx: Tx,
  opts: MatchOptions,
): Promise<{ itemVersionId: string; logicalItemId: string; isNew: boolean }[]> {
  const {
    artifactId,
    projectId,
    draftVersionId,
    baseVersionId,
    itemType,
    candidates,
    boundUpstream,
  } = opts;
  const [artifact] = await tx
    .select({
      id: schema.artifact.id,
      projectId: schema.artifact.projectId,
      type: schema.artifact.type,
    })
    .from(schema.artifact)
    .where(eq(schema.artifact.id, artifactId));
  if (!artifact || artifact.projectId !== projectId || artifact.type !== artifactType[itemType]) {
    throw new Error(`Invalid artifact for ${itemType}`);
  }

  const [draft] = await tx
    .select({
      artifactId: schema.artifactVersion.artifactId,
      status: schema.artifactVersion.status,
      baseApprovedVersionId: schema.artifactVersion.baseApprovedVersionId,
    })
    .from(schema.artifactVersion)
    .where(eq(schema.artifactVersion.id, draftVersionId));
  if (
    !draft ||
    draft.artifactId !== artifactId ||
    draft.status !== 'draft' ||
    draft.baseApprovedVersionId !== baseVersionId
  ) {
    throw new Error('Draft version or captured comparison base is invalid');
  }

  if (baseVersionId) {
    const [base] = await tx
      .select({
        artifactId: schema.artifactVersion.artifactId,
        status: schema.artifactVersion.status,
      })
      .from(schema.artifactVersion)
      .where(eq(schema.artifactVersion.id, baseVersionId));
    if (!base || base.artifactId !== artifactId || base.status !== 'approved') {
      throw new Error('Comparison base must be the captured approved artifact version');
    }
  }

  const baseMembers = baseVersionId
    ? await tx
        .select({
          displayKey: schema.logicalItem.displayKey,
          logicalItemId: schema.logicalItem.id,
          itemVersionId: schema.itemVersion.id,
          payload: schema.itemVersion.payload,
          semanticHash: schema.itemVersion.semanticHash,
          semanticHashVersion: schema.itemVersion.semanticHashVersion,
        })
        .from(schema.artifactVersionItemMembership)
        .innerJoin(
          schema.logicalItem,
          eq(schema.artifactVersionItemMembership.logicalItemId, schema.logicalItem.id),
        )
        .innerJoin(
          schema.itemVersion,
          eq(schema.artifactVersionItemMembership.itemVersionId, schema.itemVersion.id),
        )
        .where(
          and(
            eq(schema.artifactVersionItemMembership.artifactVersionId, baseVersionId),
            eq(schema.logicalItem.itemType, itemType),
          ),
        )
    : [];
  const byKey = new Map(baseMembers.map((member) => [member.displayKey, member]));
  for (const member of baseMembers) {
    if (member.semanticHashVersion !== SEMANTIC_HASH_VERSION) {
      throw new Error(`Unsupported semantic hash version for ${member.displayKey}`);
    }
  }

  for (const candidate of candidates) {
    if (
      !candidate.payload ||
      typeof candidate.payload !== 'object' ||
      Array.isArray(candidate.payload)
    ) {
      throw new Error('Candidate payload must be an object');
    }
    if (
      !Array.isArray(candidate.upstreamRefs) ||
      !candidate.upstreamRefs.every((key) => typeof key === 'string')
    ) {
      throw new Error('Candidate upstreamRefs must be display keys');
    }
    if (itemType !== 'story' && candidate.parentDisplayKey) {
      throw new Error('Only stories may have an Epic parent');
    }
  }

  const claimed = new Set<string>();
  const matches = candidates.map((candidate) => {
    const member = candidate.previousDisplayKey
      ? byKey.get(candidate.previousDisplayKey)
      : undefined;
    if (member) {
      if (claimed.has(member.logicalItemId))
        throw new Error(`Duplicate previousDisplayKey: ${member.displayKey}`);
      claimed.add(member.logicalItemId);
    }
    return member;
  });
  const contentProjection = (payload: unknown) =>
    JSON.stringify(contentOnlyProjection(itemType, payload));
  const unclaimedByContent = new Map<string, typeof baseMembers>();
  for (const member of baseMembers) {
    if (claimed.has(member.logicalItemId)) continue;
    const content = contentProjection(member.payload);
    const matching = unclaimedByContent.get(content) ?? [];
    matching.push(member);
    unclaimedByContent.set(content, matching);
  }
  candidates.forEach((candidate, index) => {
    if (matches[index]) return;
    const content = contentProjection(candidate.payload);
    const matching = unclaimedByContent.get(content);
    if (matching?.length !== 1) return;
    const member = matching[0]!;
    matches[index] = member;
    claimed.add(member.logicalItemId);
    unclaimedByContent.delete(content);
  });

  const referencedIds = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.upstreamRefs.map((key) => {
          const id = boundUpstream.get(key);
          if (!id) throw new Error(`Unresolved upstream reference: ${key}`);
          return id;
        }),
      ),
    ),
  ];
  if (referencedIds.length) {
    const upstreamRows = await tx
      .select({
        id: schema.itemVersion.id,
        projectId: schema.itemVersion.projectId,
        itemType: schema.logicalItem.itemType,
      })
      .from(schema.itemVersion)
      .innerJoin(schema.logicalItem, eq(schema.itemVersion.logicalItemId, schema.logicalItem.id))
      .where(inArray(schema.itemVersion.id, referencedIds));
    const validIds = new Set(
      upstreamRows
        .filter(
          (row) =>
            row.projectId === projectId &&
            allowedUpstream[itemType].includes(row.itemType as ItemType),
        )
        .map((row) => row.id),
    );
    for (const id of referencedIds) {
      if (!validIds.has(id)) throw new Error(`Invalid upstream item version: ${id}`);
    }
  }

  const planned = candidates.map((candidate, index) => {
    const upstreamIds = [
      ...new Set(candidate.upstreamRefs.map((key) => boundUpstream.get(key)!)),
    ].sort();
    return {
      candidate,
      base: matches[index],
      upstreamIds,
      hash: semanticHash(itemType, candidate.payload, upstreamIds),
    };
  });

  const parentLogicalIds = new Map<string, string>();
  if (itemType === 'story') {
    const parentKeys = [
      ...new Set(
        planned
          .map(({ candidate }) => candidate.parentDisplayKey)
          .filter((key): key is string => !!key),
      ),
    ];
    if (parentKeys.length) {
      const parents = await tx
        .select({ id: schema.logicalItem.id, displayKey: schema.logicalItem.displayKey })
        .from(schema.artifactVersionItemMembership)
        .innerJoin(
          schema.logicalItem,
          eq(schema.artifactVersionItemMembership.logicalItemId, schema.logicalItem.id),
        )
        .where(
          and(
            eq(schema.artifactVersionItemMembership.artifactVersionId, draftVersionId),
            eq(schema.logicalItem.itemType, 'epic'),
            inArray(schema.logicalItem.displayKey, parentKeys),
          ),
        );
      if (parents.length !== parentKeys.length)
        throw new Error('Story parent must be an Epic in this draft');
      for (const parent of parents) parentLogicalIds.set(parent.displayKey, parent.id);
    }
  }

  const historicalKeys = await tx
    .select({ displayKey: schema.logicalItem.displayKey })
    .from(schema.logicalItem)
    .where(
      and(eq(schema.logicalItem.projectId, projectId), eq(schema.logicalItem.itemType, itemType)),
    );
  let nextSuffix = historicalKeys.reduce(
    (max, row) => Math.max(max, Number(row.displayKey.slice(prefix[itemType].length + 1))),
    0,
  );

  const matchedIds = [
    ...new Set(planned.flatMap(({ base }) => (base ? [base.logicalItemId] : []))),
  ];
  const revisions = matchedIds.length
    ? await tx
        .select({
          logicalItemId: schema.itemVersion.logicalItemId,
          revisionNumber: schema.itemVersion.revisionNumber,
        })
        .from(schema.itemVersion)
        .where(inArray(schema.itemVersion.logicalItemId, matchedIds))
    : [];
  const latestRevision = new Map<string, number>();
  for (const row of revisions) {
    latestRevision.set(
      row.logicalItemId,
      Math.max(latestRevision.get(row.logicalItemId) ?? 0, row.revisionNumber),
    );
  }

  const results: { itemVersionId: string; logicalItemId: string; isNew: boolean }[] = [];
  for (const { candidate, base, upstreamIds, hash } of planned) {
    let logicalItemId = base?.logicalItemId;
    let itemVersionId = base?.semanticHash === hash ? base.itemVersionId : undefined;
    const isNew = !base;

    if (!logicalItemId) {
      const displayKey = `${prefix[itemType]}-${String(++nextSuffix).padStart(2, '0')}`;
      const [created] = await tx
        .insert(schema.logicalItem)
        .values({ projectId, artifactId, itemType, displayKey })
        .returning({ id: schema.logicalItem.id });
      if (!created) throw new Error('Failed to create logical item');
      logicalItemId = created.id;
    }
    if (!itemVersionId) {
      const revisionNumber = base ? (latestRevision.get(logicalItemId) ?? 0) + 1 : 1;
      const [created] = await tx
        .insert(schema.itemVersion)
        .values({
          projectId,
          logicalItemId,
          revisionNumber,
          payload: candidate.payload,
          semanticHash: hash,
          semanticHashVersion: SEMANTIC_HASH_VERSION,
        })
        .returning({ id: schema.itemVersion.id });
      if (!created) throw new Error('Failed to create item version');
      itemVersionId = created.id;
      if (upstreamIds.length) {
        await tx.insert(schema.semanticDependency).values(
          upstreamIds.map((upstreamItemVersionId) => ({
            projectId,
            downstreamItemVersionId: itemVersionId!,
            upstreamItemVersionId,
            proposedBy: 'ai',
          })),
        );
      }
    }
    await tx.insert(schema.artifactVersionItemMembership).values({
      artifactVersionId: draftVersionId,
      artifactId,
      logicalItemId,
      itemVersionId,
      parentLogicalItemId: candidate.parentDisplayKey
        ? parentLogicalIds.get(candidate.parentDisplayKey)
        : null,
      position: candidate.position ?? null,
    });
    results.push({ itemVersionId, logicalItemId, isNew });
  }

  return results;
}
