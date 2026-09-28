// artifact-lifecycle: the impact/acknowledgement operations the API layer needs
// (Jira E3-S11 / SCRUM-46, API Contracts section 6). Layer 6 may not import
// `impact` or `identity` (Module Boundaries section 2), and an acknowledgement
// must be written inside the project lock - which only this module may take
// (section 6) - so `GET /api/projects/:projectId/impact` and
// `POST /api/impact/acknowledgements` reach `impact.getWarnings` /
// `impact.acknowledge` only through the three functions below.
//
// Table ownership does not move: `impact_acknowledgement` is still written by
// `impact.acknowledge` alone (section 5); this file only decides WHETHER that
// call may happen and holds the lock around it.
//
// Nothing outside src/artifact-lifecycle may import this file directly - it is
// re-exported through ./index.ts (Module Boundaries section 7).
import { withProjectLock, withTx } from '@/db';
import {
  getDisplayKeysByItemVersionId,
  getItemVersionProjectIds as readItemVersionProjectIds,
} from '@/lineage/identity';
import { acknowledge, getWarnings, type ImpactRow } from '@/lineage/impact';
import { toImpactRowDTO, type ImpactRowDTO } from '@/lib/serialize';
import { UUID_RE } from './shared';

// Code-unit order, not `localeCompare`: every value compared below is a
// lowercase uuid or one of two fixed ASCII strings, and the result must not
// depend on the process's locale.
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every warning the project reports right now (`GET /api/projects/:projectId/
 * impact`, API Contracts 6): `impact.getWarnings` - the one impact engine, no
 * candidate (INV-025) - passed through unchanged except for ORDER.
 * `getWarnings` has no `ORDER BY` (it returns whatever order Postgres
 * produced), and the warning panel must not reshuffle between two identical
 * reads. Rows are ordered by `depth` ascending (direct before transitive,
 * INV-022), then `rootItemVersionId`, then `subjectKind`, then `subjectId`. The
 * four keys are unique per row (`impact()` is one row per subject and root), so
 * the order is total. The rows are still raw and id-based - turning ids into
 * display keys is layer 6's job (`ImpactRowDTO`).
 */
export async function getImpactWarnings(projectId: string): Promise<ImpactRow[]> {
  const rows = await getWarnings(projectId);
  return [...rows].sort(
    (a, b) =>
      a.depth - b.depth ||
      compareStrings(a.rootItemVersionId, b.rootItemVersionId) ||
      compareStrings(a.subjectKind, b.subjectKind) ||
      compareStrings(a.subjectId, b.subjectId),
  );
}

/**
 * `getImpactWarnings` with every row's display keys resolved server-side
 * (`ImpactRowDTO`, API Contracts 1.8) - the shape the warnings/dependencies
 * pages need in one call. Same "compose above" shape `getCurrentItemImpactCauses`
 * already uses just above for its own narrower (item-scoped) case: this module
 * may reach `identity.getDisplayKeysByItemVersionId` (layer 1) to do the
 * resolution; a page calling this directly may not reach layer 1 itself.
 */
export async function getImpactWarningsResolved(projectId: string): Promise<ImpactRowDTO[]> {
  const warnings = await getImpactWarnings(projectId);
  if (!warnings.length) return [];
  const pathIds = [...new Set(warnings.flatMap((row) => [row.rootItemVersionId, ...row.path]))];
  const labels = await withTx((tx) => getDisplayKeysByItemVersionId(tx, pathIds));
  return warnings.map((row) => toImpactRowDTO(row, labels));
}

export interface ItemImpactCause {
  subjectItemVersionId: string;
  rootItemVersionId: string;
  acknowledged: boolean;
  depth: number;
  pathLabels: string[];
}

/** Every current cause for these items, preserving the impact engine's separate rows. */
export async function getCurrentItemImpactCauses(
  projectId: string,
  itemVersionIds: string[],
): Promise<ItemImpactCause[]> {
  if (!itemVersionIds.length) return [];
  const subjects = new Set(itemVersionIds);
  const warnings = (await getImpactWarnings(projectId)).filter(
    (row) => row.subjectKind === 'item_version' && subjects.has(row.subjectId),
  );
  if (!warnings.length) return [];
  const pathIds = [...new Set(warnings.flatMap((row) => row.path))];
  const labels = await withTx((tx) => getDisplayKeysByItemVersionId(tx, pathIds));
  return warnings.map((row) => ({
    subjectItemVersionId: row.subjectId,
    rootItemVersionId: row.rootItemVersionId,
    acknowledged: row.acknowledged,
    depth: row.depth,
    pathLabels: row.path.map((id) => labels.get(id) ?? id),
  }));
}

/**
 * `item_version.id -> item_version.project_id` for the ids that exist
 * (`identity.getItemVersionProjectIds`, in its own transaction). A route that
 * receives item-version ids in a request BODY resolves each one to its project
 * with this before `requireProjectOwner` (API Contracts 1.4) - an id that is
 * not in the returned map does not exist, exactly like an id that belongs to
 * someone else's project must look to the caller.
 *
 * An input that is not a uuid is dropped here without a query: a malformed
 * string must never reach Postgres, where it would be a 22P02 "invalid input
 * syntax for type uuid" and surface as a 500. The rest are lowercased here, so
 * a caller may pass any spelling of an id (`item_version.id` compares
 * case-insensitively in Postgres); the returned map is keyed by the LOWERCASE
 * ids - the form Postgres returns - so look results up by a lowercase id. (The
 * acknowledgements route's schema lowercases its ids before it does.)
 */
export async function getItemVersionProjectIds(
  itemVersionIds: string[],
): Promise<Map<string, string>> {
  const wellFormed = itemVersionIds.filter((id) => UUID_RE.test(id)).map((id) => id.toLowerCase());
  if (!wellFormed.length) return new Map();
  return withTx((tx) => readItemVersionProjectIds(tx, wellFormed));
}

export type AcknowledgeImpactWarningResult =
  | { status: 'acknowledged' }
  | { status: 'already_acknowledged' }
  | { status: 'not_currently_flagged' };

/**
 * `POST /api/impact/acknowledgements` (API Contracts 6): acknowledge ONE
 * warning directly from the panel, independent of approval (the approval-time
 * override is `acknowledgeGateBlockers` inside `approveWithOverride`, a
 * different path). The caller has already proven `subject` and
 * `obsoleteUpstreamItemVersionId` belong to `projectId` and that the user owns
 * it; this function proves the WARNING is real.
 *
 * Under `withProjectLock(projectId)` - so it is serialized with approvals, which
 * recompute the gate under the same lock - it re-reads the warnings from that
 * SAME transaction (`impact.getWarnings(projectId, tx)`, INV-025: one engine;
 * the server never trusts the client's belief that something is flagged) and
 * looks for the row with the same subject kind AND id AND the same
 * `rootItemVersionId`: an acknowledgement is specific to the subject AND the
 * change that triggered it (INV-026), so a row for the same subject with a
 * different root is a different warning.
 *
 * - no such row -> `not_currently_flagged`, nothing written. That includes a
 *   subject `impact()` never reports: a draft or otherwise non-current item
 *   (only current items are active subjects, INV-022), whose approval-time
 *   draft handling is `overrideNote`, not this route.
 * - the row is already `acknowledged` -> `already_acknowledged`, nothing
 *   written. Idempotent on purpose: `impact.acknowledge` lets the
 *   `ack_item_unique` / `ack_ref_unique` violation escape (a duplicate is a
 *   client bug there), so a double-click here must be answered before that
 *   call is ever made.
 * - otherwise `impact.acknowledge` writes the one `impact_acknowledgement` row
 *   (it computes `root_logical_item_id` and the root's current version itself)
 *   -> `acknowledged`.
 *
 * A pair whose earlier acknowledgement stopped matching because the root moved
 * again is a flagged, unacknowledged row again (ERD 4.12), so it is
 * acknowledged afresh - a new row against the root's newer current version.
 *
 * Every id in `opts` (project, subject, obsolete upstream) may be in any
 * spelling: they are lowercased here, the form Postgres returns and the
 * warnings' ids are compared in, so a mixed-case id can never produce a
 * spurious `not_currently_flagged` for a warning that is really flagged.
 * (`withProjectLock` canonicalizes its own key too, for the same reason.)
 */
export async function acknowledgeImpactWarning(opts: {
  projectId: string;
  userId: string;
  subject: { itemVersionId: string } | { externalRefId: string };
  obsoleteUpstreamItemVersionId: string;
  note?: string | undefined;
}): Promise<AcknowledgeImpactWarningResult> {
  const { userId, note } = opts;
  const projectId = opts.projectId.toLowerCase();
  const obsoleteUpstreamItemVersionId = opts.obsoleteUpstreamItemVersionId.toLowerCase();
  const subject =
    'itemVersionId' in opts.subject
      ? { itemVersionId: opts.subject.itemVersionId.toLowerCase() }
      : { externalRefId: opts.subject.externalRefId.toLowerCase() };
  const subjectKind = 'itemVersionId' in subject ? 'item_version' : 'external_ref';
  const subjectId = 'itemVersionId' in subject ? subject.itemVersionId : subject.externalRefId;

  return withProjectLock(projectId, async (tx): Promise<AcknowledgeImpactWarningResult> => {
    const warnings = await getWarnings(projectId, tx);
    const warning = warnings.find(
      (row) =>
        row.subjectKind === subjectKind &&
        row.subjectId === subjectId &&
        row.rootItemVersionId === obsoleteUpstreamItemVersionId,
    );
    if (!warning) return { status: 'not_currently_flagged' };
    if (warning.acknowledged) return { status: 'already_acknowledged' };

    await acknowledge(tx, {
      projectId,
      userId,
      subject,
      obsoleteUpstreamItemVersionId,
      ...(note === undefined ? {} : { note }),
    });
    return { status: 'acknowledged' };
  });
}
