import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Tx } from '@/db';

export async function resolveDisplayKeys(
  tx: Tx,
  artifactId: string,
  keys: string[],
): Promise<Map<string, string>> {
  const uniqueKeys = [...new Set(keys)];
  if (!uniqueKeys.length) return new Map();
  const rows = await tx
    .select({ displayKey: schema.logicalItem.displayKey, id: schema.logicalItem.id })
    .from(schema.logicalItem)
    .where(
      and(
        eq(schema.logicalItem.artifactId, artifactId),
        inArray(schema.logicalItem.displayKey, uniqueKeys),
      ),
    );
  const resolved = new Map(rows.map((row) => [row.displayKey, row.id]));
  for (const key of uniqueKeys) {
    if (!resolved.has(key)) throw new Error(`Unresolved display key: ${key}`);
  }
  return resolved;
}

// `itemType`/`parentLogicalItemId` were added by E4-S3 (SCRUM-52): `jira`
// (Module Boundaries 4.6) needs to tell Epics from Stories and resolve a
// Story's Epic parent within one captured Backlog version (ERD 7.4), and
// this shared read already joins `logical_item` and
// `artifact_version_item_membership` - the two columns' own owning tables.
// `payload` was added by E4-S4 (SCRUM-53): `stitch.previewPrompt`/`generate`
// need one context source version's own item content
// (`item_version.payload`), and this is the one place that content may be
// read from outside `identity` - see ui-requirements/index.ts's header
// comment for why `getUiRequirementsForPrompt` delegates here instead of
// running its own raw join. Requires a new `leftJoin` onto `item_version`
// itself (the query previously only carried `itemVersionId` as a plain FK
// value off `artifact_version_item_membership`, never joining the table it
// points to). Purely additive: every existing call site
// (artifact-lifecycle/approval.ts, artifact-lifecycle/generation.ts,
// architecture-materialization, backlog, jira, this module's own
// dependency-binding.bindUpstreamRefs) only ever destructures the fields it
// already used, so an extra column on the same rows changes nothing for
// them - confirmed by reading every call site before adding this one too.
//
// `revisionNumber` was added by E3-S10 (SCRUM-45) for the same reason and in
// the same additive way: `GET /api/artifact-versions/:versionId` (API
// Contracts 1.8's `ItemVersionDTO.revisionNumber`) is served by
// artifact-lifecycle's `getArtifactVersionDetail`, which builds its items from
// this one shared read rather than querying `item_version` itself (that table
// belongs to `identity`, Module Boundaries section 5). It rides the
// `item_version` LEFT JOIN `payload` already needed, so it is null exactly
// when the membership row (or the whole version) has no items.
export async function getSourceVersionMembers(tx: Tx, sourceVersionIds: string[]) {
  const uniqueSourceVersionIds = [...new Set(sourceVersionIds)];
  if (!uniqueSourceVersionIds.length) return [];
  const rows = await tx
    .select({
      sourceVersionId: schema.artifactVersion.id,
      artifactId: schema.artifactVersion.artifactId,
      projectId: schema.artifact.projectId,
      status: schema.artifactVersion.status,
      logicalItemId: schema.artifactVersionItemMembership.logicalItemId,
      itemVersionId: schema.artifactVersionItemMembership.itemVersionId,
      displayKey: schema.logicalItem.displayKey,
      itemType: schema.logicalItem.itemType,
      parentLogicalItemId: schema.artifactVersionItemMembership.parentLogicalItemId,
      payload: schema.itemVersion.payload,
      revisionNumber: schema.itemVersion.revisionNumber,
    })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifactVersion.artifactId, schema.artifact.id))
    .leftJoin(
      schema.artifactVersionItemMembership,
      eq(schema.artifactVersionItemMembership.artifactVersionId, schema.artifactVersion.id),
    )
    .leftJoin(
      schema.logicalItem,
      eq(schema.artifactVersionItemMembership.logicalItemId, schema.logicalItem.id),
    )
    .leftJoin(
      schema.itemVersion,
      eq(schema.itemVersion.id, schema.artifactVersionItemMembership.itemVersionId),
    )
    .where(inArray(schema.artifactVersion.id, uniqueSourceVersionIds));
  const foundVersionIds = new Set(rows.map((row) => row.sourceVersionId));
  if (foundVersionIds.size !== uniqueSourceVersionIds.length) {
    throw new Error('Unknown context source version');
  }
  return rows;
}

// Added by E3-S9 (SCRUM-44): `backlog`'s own quality gate (FR-063 - "Story
// has no source Requirement", "Requirement has no implementation Story",
// "source item does not exist", "source reference points to an invalid
// project/version") and its `generate()`'s regeneration-stability prompt
// (reconstructing a base Story's own `upstreamRefs` display keys) both need
// to read `semantic_dependency` edges by their downstream ItemVersion - no
// existing `identity` export does this (`getSourceVersionMembers` reads
// `artifact_version_item_membership`, not `semantic_dependency`). This is a
// narrow, additive, read-only export of `identity`'s own owned table
// (Module Boundaries 4.2: `identity` owns `semantic_dependency`), following
// the same "identity gains a read, callers compose above it" shape v1.5
// recorded for `getSourceVersionMembers`/`getCurrentItemVersionIds` and v1.8
// recorded for `external-operations`' six reads - see this story's own
// report for the matching Module Boundaries section 4.2 update.
//
// LEFT JOINs onto `item_version`/`logical_item` for the upstream side
// deliberately, even though both are DB-enforced to resolve today (item_version
// rows are never deleted - restrict-only FKs; semantic_dependency's own
// composite FKs already force both ends into the same project_id) - FR-063
// lists "source item does not exist" and "source reference points to an
// invalid project/version" as checks a quality gate must make, so the read
// here stays defensive (null upstream fields / a project_id mismatch) rather
// than assuming the invariant so hard it couldn't even be checked.
export async function getUpstreamDependencies(
  tx: Tx,
  downstreamItemVersionIds: string[],
): Promise<
  {
    downstreamItemVersionId: string;
    upstreamItemVersionId: string;
    dependencyProjectId: string;
    upstreamProjectId: string | null;
    upstreamLogicalItemId: string | null;
    upstreamItemType: string | null;
    upstreamDisplayKey: string | null;
  }[]
> {
  const uniqueIds = [...new Set(downstreamItemVersionIds)];
  if (!uniqueIds.length) return [];
  return tx
    .select({
      downstreamItemVersionId: schema.semanticDependency.downstreamItemVersionId,
      upstreamItemVersionId: schema.semanticDependency.upstreamItemVersionId,
      dependencyProjectId: schema.semanticDependency.projectId,
      upstreamProjectId: schema.itemVersion.projectId,
      upstreamLogicalItemId: schema.logicalItem.id,
      upstreamItemType: schema.logicalItem.itemType,
      upstreamDisplayKey: schema.logicalItem.displayKey,
    })
    .from(schema.semanticDependency)
    .leftJoin(
      schema.itemVersion,
      eq(schema.itemVersion.id, schema.semanticDependency.upstreamItemVersionId),
    )
    .leftJoin(schema.logicalItem, eq(schema.logicalItem.id, schema.itemVersion.logicalItemId))
    .where(inArray(schema.semanticDependency.downstreamItemVersionId, uniqueIds));
}

// Added by the E3-S10 (SCRUM-45) review-fix pass: `item_version.id ->
// logical_item.display_key`, read through the caller's OPEN transaction.
// `resolveDisplayKeys` above goes the other way (display key -> logical item id)
// so it cannot serve. artifact-lifecycle's approval transaction needs this one
// because a blocked Architecture approval rolls back the ADR ItemVersions
// `materialize` minted moments earlier (ERD 3.5, "Why ids never cross the
// API"), yet the blocking `ImpactRow`s still name those ids as their subject and
// last `path` entry. Once the transaction has rolled back, no read on `db` can
// resolve them any more, so the keys have to be captured here, inside the tx,
// while the rows still exist. `external-operations.getDisplayKeysForItemVersions`
// is the same join on the pool (`db`) for ids that are already committed.
// Read-only, additive, and on `identity`'s own two tables.
export async function getDisplayKeysByItemVersionId(
  tx: Tx,
  itemVersionIds: readonly string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(itemVersionIds)];
  if (!uniqueIds.length) return new Map();
  const rows = await tx
    .select({ id: schema.itemVersion.id, displayKey: schema.logicalItem.displayKey })
    .from(schema.itemVersion)
    .innerJoin(schema.logicalItem, eq(schema.logicalItem.id, schema.itemVersion.logicalItemId))
    .where(inArray(schema.itemVersion.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, row.displayKey]));
}

export async function getCurrentItemVersionIds(
  tx: Tx,
  projectId: string,
  itemVersionIds: string[],
): Promise<Set<string>> {
  if (!itemVersionIds.length) return new Set();
  const rows = await tx
    .select({ itemVersionId: schema.artifactVersionItemMembership.itemVersionId })
    .from(schema.artifactVersionItemMembership)
    .innerJoin(
      schema.artifactVersion,
      eq(schema.artifactVersionItemMembership.artifactVersionId, schema.artifactVersion.id),
    )
    .innerJoin(schema.artifact, eq(schema.artifactVersion.artifactId, schema.artifact.id))
    .where(
      and(
        eq(schema.artifact.projectId, projectId),
        eq(schema.artifactVersion.status, 'approved'),
        inArray(schema.artifactVersionItemMembership.itemVersionId, itemVersionIds),
      ),
    );
  return new Set(rows.map((row) => row.itemVersionId));
}
