// artifact-lifecycle: read-only accessors over `artifact` / `artifact_version`
// for the API layer (Jira E3-S10 / SCRUM-45, API Contracts sections 4-5).
// Layer 6 may not import `@/db`, `identity` or `impact` (Module Boundaries
// section 2), and `artifact` / `artifact_version` belong to this module
// (section 5), so every read a route needs to resolve `:versionId` / `:type`
// or to build `ArtifactVersionDTO` comes through here. No lock, no write.
//
// Nothing outside src/artifact-lifecycle may import this file directly - it
// is re-exported through ./index.ts (Module Boundaries section 7).
import { and, desc, eq } from 'drizzle-orm';
import { db, schema, withTx } from '@/db';
import { getSourceVersionMembers, type ItemType } from '@/lineage/identity';
import { getWarnings, type ImpactRow } from '@/lineage/impact';
import type { ArtifactType, ArtifactVersionStatus } from '@/lib/serialize';
import type { ArtifactVersion } from './generation';

// `impact` is layer 1 and layer 6 cannot import it, but `VersionItem.impact`
// (below) is its id-based row type - re-exported so a route can name it when
// it maps that row to `ImpactRowDTO` (display keys resolved server-side).
export type { ImpactRow };

// Same shape check `auth.requireProjectOwner` applies to `:projectId`: a
// version id never has any other legal shape (uuid primary key), so a
// malformed path param is answered here as "not found" instead of reaching
// Postgres and surfacing its raw 22P02 "invalid input syntax for type uuid"
// as a 500. Copied rather than imported: `auth` is layer 0 and could be
// imported, but its regex is a private constant and exporting it just for
// this would widen auth's surface for one line.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ArtifactVersionRef {
  versionId: string;
  artifactId: string;
  projectId: string;
  artifactType: ArtifactType;
}

/**
 * Resolves `:versionId` to the project/artifact it belongs to so a route can
 * run its ownership check before touching anything else. `null` when no such
 * version exists - including any string that is not a uuid, which never hits
 * the database.
 */
export async function getVersionRef(versionId: string): Promise<ArtifactVersionRef | null> {
  if (!UUID_RE.test(versionId)) return null;
  const [row] = await db
    .select({
      versionId: schema.artifactVersion.id,
      artifactId: schema.artifactVersion.artifactId,
      projectId: schema.artifact.projectId,
      artifactType: schema.artifact.type,
    })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, versionId))
    .limit(1);
  return row ? { ...row, artifactType: row.artifactType as ArtifactType } : null;
}

/** The project's `artifact` row id for one type (`createProject` always inserts all four), or `null`. */
export async function getArtifactId(projectId: string, type: ArtifactType): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.artifact.id })
    .from(schema.artifact)
    .where(and(eq(schema.artifact.projectId, projectId), eq(schema.artifact.type, type)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Every `artifact_version` column plus the owning artifact's type. Dates stay
 * `Date` - serializing to the wire's ISO strings is layer 6's job. `status` is
 * narrowed from the column's `text` to the union the DB's own CHECK
 * (`artifact_version_status_check`) already guarantees.
 */
export type ArtifactVersionRecord = Omit<ArtifactVersion, 'status'> & {
  status: ArtifactVersionStatus;
  artifactType: ArtifactType;
};

function toRecord(version: ArtifactVersion, artifactType: string): ArtifactVersionRecord {
  return {
    ...version,
    status: version.status as ArtifactVersionStatus,
    artifactType: artifactType as ArtifactType,
  };
}

/**
 * Every version of the project's artifact of that type, newest first
 * (`version_number` DESC) - `GET /api/projects/:projectId/artifacts/:type/versions`.
 * Rows only: items and options are not embedded (`ArtifactVersionDTO.items`
 * is served by `getArtifactVersionDetail`, `options` by
 * `architecture.getOptionsForVersion`). `[]` when the artifact has no
 * versions yet.
 */
export async function listArtifactVersions(
  projectId: string,
  type: ArtifactType,
): Promise<ArtifactVersionRecord[]> {
  const rows = await db
    .select({ version: schema.artifactVersion, artifactType: schema.artifact.type })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(and(eq(schema.artifact.projectId, projectId), eq(schema.artifact.type, type)))
    .orderBy(desc(schema.artifactVersion.versionNumber));
  return rows.map((row) => toRecord(row.version, row.artifactType));
}

export interface VersionItem {
  itemVersionId: string;
  logicalItemId: string;
  displayKey: string;
  itemType: ItemType;
  revisionNumber: number;
  payload: unknown;
  // Story -> Epic, from THIS version's own membership row only.
  parentLogicalItemId: string | null;
  // The one warning this item_version is the subject of today (see
  // `pickImpact`), `null` when it is current and clean.
  impact: ImpactRow | null;
}

export interface ArtifactVersionDetail {
  version: ArtifactVersionRecord & { projectId: string };
  items: VersionItem[];
}

// Same rule `impact.getExternalDrift` documents for choosing one row when a
// subject has several (one per obsolete root): an unacknowledged cause always
// beats an acknowledged one - showing the acknowledged one would hide a
// different, still-open cause from the badge (INV-026, INV-023) - and among
// equals the shallowest depth wins, i.e. direct over transitive (INV-022). Still
// tied (two open causes at the same depth): the lexicographically smaller root
// item_version id wins, so the badge never depends on the row order `impact()`
// happened to return - the same version always shows the same cause.
function isBetterImpact(candidate: ImpactRow, current: ImpactRow): boolean {
  if (candidate.acknowledged !== current.acknowledged) return !candidate.acknowledged;
  if (candidate.depth !== current.depth) return candidate.depth < current.depth;
  return candidate.rootItemVersionId < current.rootItemVersionId;
}

// Deterministic item order for the response: Epics before everything else (a
// Backlog version is the only one holding two item types, and its Epics are
// the parents its Stories point at), then display key with a numeric-aware
// compare so R-2 sorts before R-10 (a plain string compare would not), then
// logical item id as a last tie-break so the order never depends on the
// database's row order. Display keys are unique per project, so the id
// tie-break is defensive.
function compareItems(a: VersionItem, b: VersionItem): number {
  const rank = (item: VersionItem) => (item.itemType === 'epic' ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const byKey = a.displayKey.localeCompare(b.displayKey, 'en', { numeric: true });
  if (byKey !== 0) return byKey;
  return a.logicalItemId < b.logicalItemId ? -1 : a.logicalItemId > b.logicalItemId ? 1 : 0;
}

/**
 * One version's row plus its members as `VersionItem`s, each carrying its
 * current impact (`GET /api/artifact-versions/:versionId`, API Contracts section 4).
 * `null` when the version does not exist (or `versionId` is not a uuid).
 *
 * Items come from `identity.getSourceVersionMembers` - a version with zero
 * members (an Architecture draft, whose decisions are not lineage until
 * approval, or a stale-rejected version) comes back from that LEFT JOIN as one
 * row of nulls, which is skipped, so `items` is `[]`. Impact is computed ONCE
 * for the whole project (`impact.getWarnings`, INV-025: the only staleness
 * source) and matched to items by `item_version` id; the impact call is
 * skipped when there is nothing to attach it to.
 */
export async function getArtifactVersionDetail(
  versionId: string,
): Promise<ArtifactVersionDetail | null> {
  if (!UUID_RE.test(versionId)) return null;
  const [row] = await db
    .select({
      version: schema.artifactVersion,
      artifactType: schema.artifact.type,
      projectId: schema.artifact.projectId,
    })
    .from(schema.artifactVersion)
    .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
    .where(eq(schema.artifactVersion.id, versionId))
    .limit(1);
  if (!row) return null;

  const members = await withTx((tx) => getSourceVersionMembers(tx, [versionId]));
  const memberItems = members.flatMap((member) =>
    member.itemVersionId &&
    member.logicalItemId &&
    member.displayKey &&
    member.itemType &&
    member.revisionNumber !== null
      ? [
          {
            itemVersionId: member.itemVersionId,
            logicalItemId: member.logicalItemId,
            displayKey: member.displayKey,
            itemType: member.itemType as ItemType,
            revisionNumber: member.revisionNumber,
            payload: member.payload,
            parentLogicalItemId: member.parentLogicalItemId,
          },
        ]
      : [],
  );

  const impactByItemVersionId = new Map<string, ImpactRow>();
  if (memberItems.length) {
    const memberIds = new Set(memberItems.map((item) => item.itemVersionId));
    for (const warning of await getWarnings(row.projectId)) {
      if (warning.subjectKind !== 'item_version' || !memberIds.has(warning.subjectId)) continue;
      const current = impactByItemVersionId.get(warning.subjectId);
      if (!current || isBetterImpact(warning, current)) {
        impactByItemVersionId.set(warning.subjectId, warning);
      }
    }
  }

  const items = memberItems
    .map((item): VersionItem => ({
      ...item,
      impact: impactByItemVersionId.get(item.itemVersionId) ?? null,
    }))
    .sort(compareItems);

  return {
    version: { ...toRecord(row.version, row.artifactType), projectId: row.projectId },
    items,
  };
}
