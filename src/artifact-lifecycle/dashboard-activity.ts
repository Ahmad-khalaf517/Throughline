import type { ItemType, ProjectItemCreation } from '@/lineage/identity';
import type { ImpactRow } from '@/lineage/impact';
import type { ArtifactType } from '@/lib/serialize';
import type { ArtifactVersionRecord } from './versions';
import type { DashboardActivity } from './dashboard';

type Version = ArtifactVersionRecord;

const ARTIFACT_BY_ITEM_TYPE: Record<ItemType, ArtifactType> = {
  requirement: 'requirements',
  architecture_decision: 'architecture',
  ui_requirement: 'ui_requirements',
  epic: 'backlog',
  story: 'backlog',
};

/** Keep impact visibly current; it has no historical event timestamp (INV-020/025). */
export function buildDashboardActivity(
  versions: Version[],
  events: { id: string; artifactVersionId: string; action: string; createdAt: Date }[],
  items: ProjectItemCreation[],
  warnings: ImpactRow[],
): { activity: DashboardActivity[]; flaggedItemCount: number } {
  const byVersion = new Map(versions.map((version) => [version.id, version]));
  const byItem = new Map(items.map((item) => [item.itemVersionId, item]));
  const activity: DashboardActivity[] = [];

  for (const version of versions) {
    activity.push({
      id: `version-created-${version.id}`,
      kind: 'version_status',
      at: version.createdAt,
      artifactType: version.artifactType,
      versionId: version.id,
      versionNumber: version.versionNumber,
      itemVersionId: null,
      displayKey: null,
      revisionNumber: null,
      status: version.statusReason === 'stale_generation_context' ? 'rejected' : 'draft',
      acknowledged: null,
      causeDisplayKey: null,
      rootItemVersionId: null,
      summaryTitle: null,
      summaryNarrative: null,
    });
  }

  for (const event of events) {
    const version = byVersion.get(event.artifactVersionId);
    if (!version) continue;
    const status = event.action === 'approved' ? 'approved' : 'rejected';
    activity.push({
      id: `status-${event.id}`,
      kind: 'version_status',
      at: event.createdAt,
      artifactType: version.artifactType,
      versionId: version.id,
      versionNumber: version.versionNumber,
      itemVersionId: null,
      displayKey: null,
      revisionNumber: null,
      status,
      acknowledged: null,
      causeDisplayKey: null,
      rootItemVersionId: null,
      summaryTitle: null,
      summaryNarrative: null,
    });
    if (status === 'approved' && version.baseApprovedVersionId) {
      const previous = byVersion.get(version.baseApprovedVersionId);
      if (previous) {
        activity.push({
          id: `superseded-${event.id}`,
          kind: 'version_status',
          at: event.createdAt,
          artifactType: previous.artifactType,
          versionId: previous.id,
          versionNumber: previous.versionNumber,
          itemVersionId: null,
          displayKey: null,
          revisionNumber: null,
          status: 'superseded',
          acknowledged: null,
          causeDisplayKey: null,
          rootItemVersionId: null,
          summaryTitle: null,
          summaryNarrative: null,
        });
      }
    }
  }

  for (const item of items) {
    const version = item.versionIds
      .map((id) => byVersion.get(id))
      .filter((value): value is Version => Boolean(value))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    activity.push({
      id: `item-${item.itemVersionId}`,
      kind: 'item_created',
      at: item.createdAt,
      artifactType: version?.artifactType ?? ARTIFACT_BY_ITEM_TYPE[item.itemType as ItemType],
      versionId: version?.id ?? null,
      versionNumber: version?.versionNumber ?? null,
      itemVersionId: item.itemVersionId,
      displayKey: item.displayKey,
      revisionNumber: item.revisionNumber,
      status: null,
      acknowledged: null,
      causeDisplayKey: null,
      rootItemVersionId: null,
      summaryTitle: item.summaryTitle ?? null,
      summaryNarrative: item.summaryNarrative ?? null,
    });
  }

  const flagged = new Set<string>();
  for (const warning of warnings) {
    if (warning.subjectKind !== 'item_version') continue;
    const item = byItem.get(warning.subjectId);
    if (!item) continue;
    const version = item.versionIds
      .map((id) => byVersion.get(id))
      .find((value) => value?.status === 'approved');
    if (!version) continue;
    flagged.add(item.itemVersionId);
    activity.push({
      id: `impact-${warning.subjectId}-${warning.rootItemVersionId}`,
      kind: 'current_impact',
      at: null,
      artifactType: version.artifactType,
      versionId: version.id,
      versionNumber: version.versionNumber,
      itemVersionId: item.itemVersionId,
      displayKey: item.displayKey,
      revisionNumber: item.revisionNumber,
      status: 'approved',
      acknowledged: warning.acknowledged,
      causeDisplayKey: byItem.get(warning.rootItemVersionId)?.displayKey ?? null,
      rootItemVersionId: warning.rootItemVersionId,
      summaryTitle: item.summaryTitle ?? null,
      summaryNarrative: item.summaryNarrative ?? null,
    });
  }

  activity.sort((a, b) => {
    if (a.at === null || b.at === null)
      return a.at === null ? (b.at === null ? a.id.localeCompare(b.id) : -1) : 1;
    return b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id);
  });
  const currentImpacts = activity.filter((entry) => entry.kind === 'current_impact').slice(0, 5);
  const dated = activity
    .filter((entry) => entry.kind !== 'current_impact')
    .slice(0, 20 - currentImpacts.length);
  return { activity: [...currentImpacts, ...dated], flaggedItemCount: flagged.size };
}
