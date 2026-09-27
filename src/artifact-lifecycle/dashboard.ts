import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import {
  countVersionItems,
  getProjectItemVersionDetail as readProjectItemVersionDetail,
  listProjectItemCreations,
} from '@/lineage/identity';
import { getWarnings } from '@/lineage/impact';
import { ARTIFACT_TYPES, type ArtifactType, type ArtifactVersionStatus } from '@/lib/serialize';
import type { ArtifactVersionRecord } from './versions';
import { buildDashboardActivity } from './dashboard-activity';
import { UUID_RE } from './shared';

export interface DashboardTile {
  type: ArtifactType;
  versionId: string | null;
  versionNumber: number | null;
  status: ArtifactVersionStatus | null;
  itemCount: number;
}

export interface DashboardActivity {
  id: string;
  kind: 'item_created' | 'version_status' | 'current_impact';
  at: Date | null;
  artifactType: ArtifactType;
  versionId: string | null;
  versionNumber: number | null;
  itemVersionId: string | null;
  displayKey: string | null;
  revisionNumber: number | null;
  status: ArtifactVersionStatus | null;
  acknowledged: boolean | null;
  causeDisplayKey: string | null;
  rootItemVersionId: string | null;
  summaryTitle: string | null;
  summaryNarrative: string | null;
}

export interface ProjectDashboard {
  tiles: DashboardTile[];
  activity: DashboardActivity[];
  flaggedItemCount: number;
}

type Version = ArtifactVersionRecord;

/** Read-only item inspection, including retained versions with no membership. */
export async function getProjectItemVersionDetail(projectId: string, itemVersionId: string) {
  if (!UUID_RE.test(itemVersionId)) return null;
  return readProjectItemVersionDetail(projectId, itemVersionId);
}

/** Read-only project overview. All item facts and impact come through their owning modules. */
export async function getProjectDashboard(projectId: string): Promise<ProjectDashboard> {
  const [versionRows, eventRows, items, warnings] = await Promise.all([
    db
      .select({ version: schema.artifactVersion, type: schema.artifact.type })
      .from(schema.artifactVersion)
      .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
      .where(eq(schema.artifact.projectId, projectId))
      .orderBy(desc(schema.artifactVersion.createdAt)),
    db
      .select({
        id: schema.approvalEvent.id,
        artifactVersionId: schema.approvalEvent.artifactVersionId,
        action: schema.approvalEvent.action,
        createdAt: schema.approvalEvent.createdAt,
      })
      .from(schema.approvalEvent)
      .innerJoin(
        schema.artifactVersion,
        eq(schema.artifactVersion.id, schema.approvalEvent.artifactVersionId),
      )
      .innerJoin(schema.artifact, eq(schema.artifact.id, schema.artifactVersion.artifactId))
      .where(eq(schema.artifact.projectId, projectId)),
    listProjectItemCreations(projectId),
    getWarnings(projectId),
  ]);
  const versions: Version[] = versionRows.map(({ version, type }) => ({
    ...version,
    status: version.status as ArtifactVersionStatus,
    artifactType: type as ArtifactType,
  }));
  const current = ARTIFACT_TYPES.map((type) => {
    const ofType = versions.filter((version) => version.artifactType === type);
    return {
      type,
      version:
        ofType.find((v) => v.status === 'draft') ??
        ofType.find((v) => v.status === 'approved') ??
        ofType[0] ??
        null,
    };
  });
  const counts = await countVersionItems(
    current.flatMap(({ version }) => (version ? [version.id] : [])),
  );
  const tiles = current.map(({ type, version }): DashboardTile => ({
    type,
    versionId: version?.id ?? null,
    versionNumber: version?.versionNumber ?? null,
    status: version?.status ?? null,
    itemCount: version ? (counts.get(version.id) ?? 0) : 0,
  }));
  return { tiles, ...buildDashboardActivity(versions, eventRows, items, warnings) };
}
