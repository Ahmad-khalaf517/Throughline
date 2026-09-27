import { describe, expect, it } from 'vitest';
import { buildDashboardActivity } from '@/artifact-lifecycle/dashboard-activity';
import type { ArtifactVersionRecord } from '@/artifact-lifecycle';

const createdAt = new Date('2026-09-01T10:00:00.000Z');
const approvedAt = new Date('2026-09-01T11:00:00.000Z');

function version(
  id: string,
  status: 'approved' | 'superseded',
  baseApprovedVersionId: string | null = null,
): ArtifactVersionRecord {
  return {
    id,
    artifactId: 'artifact-1',
    artifactType: 'requirements',
    versionNumber: id === 'version-1' ? 1 : 2,
    status,
    schemaVersion: 1,
    baseApprovedVersionId,
    selectedArchitectureOptionId: null,
    payload: {},
    rawOutput: null,
    statusReason: null,
    createdAt,
    updatedAt: approvedAt,
  };
}

describe('project dashboard activity (FR-003)', () => {
  it('records creation and approval transitions, plus current impact separately from status', () => {
    const result = buildDashboardActivity(
      [version('version-1', 'superseded'), version('version-2', 'approved', 'version-1')],
      [
        {
          id: 'event-1',
          artifactVersionId: 'version-2',
          action: 'approved',
          createdAt: approvedAt,
        },
      ],
      [
        {
          itemVersionId: 'item-1',
          displayKey: 'R-01',
          itemType: 'requirement',
          revisionNumber: 1,
          createdAt,
          versionIds: ['version-1'],
        },
        {
          itemVersionId: 'item-2',
          displayKey: 'R-02',
          itemType: 'requirement',
          revisionNumber: 1,
          createdAt,
          versionIds: ['version-2'],
          summaryTitle: 'Supports offline edits',
          summaryNarrative: 'Changes remain available after reconnecting.',
        },
      ],
      [
        {
          subjectKind: 'item_version',
          subjectId: 'item-2',
          rootItemVersionId: 'item-1',
          depth: 1,
          path: ['item-1', 'item-2'],
          acknowledged: false,
        },
      ],
    );
    expect(result.flaggedItemCount).toBe(1);
    expect(result.activity[0]).toMatchObject({
      kind: 'current_impact',
      displayKey: 'R-02',
      status: 'approved',
      causeDisplayKey: 'R-01',
      summaryTitle: 'Supports offline edits',
      summaryNarrative: 'Changes remain available after reconnecting.',
      at: null,
    });
    expect(result.activity).toContainEqual(
      expect.objectContaining({
        kind: 'version_status',
        versionId: 'version-1',
        status: 'superseded',
        at: approvedAt,
      }),
    );
    expect(result.activity).toContainEqual(
      expect.objectContaining({
        kind: 'version_status',
        versionId: 'version-2',
        status: 'approved',
        at: approvedAt,
      }),
    );
    expect(result.activity).toContainEqual(
      expect.objectContaining({
        kind: 'item_created',
        itemVersionId: 'item-2',
        versionId: 'version-2',
      }),
    );
  });

  it('reports no current impact when the impact engine returns no warnings', () => {
    const result = buildDashboardActivity([version('version-2', 'approved')], [], [], []);
    expect(result.flaggedItemCount).toBe(0);
    expect(result.activity.every((entry) => entry.kind !== 'current_impact')).toBe(true);
  });

  it('keeps a creation event when an edited draft item version has no membership', () => {
    const result = buildDashboardActivity(
      [],
      [],
      [
        {
          itemVersionId: 'orphan-item',
          displayKey: 'S-08',
          itemType: 'story',
          revisionNumber: 2,
          createdAt,
          versionIds: [],
        },
      ],
      [],
    );
    expect(result.activity).toContainEqual(
      expect.objectContaining({
        kind: 'item_created',
        itemVersionId: 'orphan-item',
        artifactType: 'backlog',
        versionId: null,
        versionNumber: null,
      }),
    );
  });

  it('retains separate current causes and their acknowledgement states', () => {
    const result = buildDashboardActivity(
      [version('version-2', 'approved')],
      [],
      [
        {
          itemVersionId: 'item-2',
          displayKey: 'R-02',
          itemType: 'requirement',
          revisionNumber: 1,
          createdAt,
          versionIds: ['version-2'],
        },
      ],
      [
        {
          subjectKind: 'item_version',
          subjectId: 'item-2',
          rootItemVersionId: 'root-1',
          depth: 1,
          path: ['root-1', 'item-2'],
          acknowledged: true,
        },
        {
          subjectKind: 'item_version',
          subjectId: 'item-2',
          rootItemVersionId: 'root-2',
          depth: 2,
          path: ['root-2', 'item-2'],
          acknowledged: false,
        },
      ],
    );
    expect(result.flaggedItemCount).toBe(1);
    expect(result.activity.filter((entry) => entry.kind === 'current_impact')).toEqual([
      expect.objectContaining({ rootItemVersionId: 'root-1', acknowledged: true }),
      expect.objectContaining({ rootItemVersionId: 'root-2', acknowledged: false }),
    ]);
  });

  it('reserves room for dated lineage activity when more than 20 causes are current', () => {
    const result = buildDashboardActivity(
      [version('version-2', 'approved')],
      [],
      [
        {
          itemVersionId: 'item-2',
          displayKey: 'R-02',
          itemType: 'requirement',
          revisionNumber: 1,
          createdAt,
          versionIds: ['version-2'],
        },
      ],
      Array.from({ length: 25 }, (_, index) => ({
        subjectKind: 'item_version' as const,
        subjectId: 'item-2',
        rootItemVersionId: `root-${index}`,
        depth: 1,
        path: [`root-${index}`, 'item-2'],
        acknowledged: false,
      })),
    );
    expect(result.activity.filter((entry) => entry.kind === 'current_impact')).toHaveLength(5);
    expect(result.activity).toContainEqual(
      expect.objectContaining({ kind: 'item_created', itemVersionId: 'item-2' }),
    );
    expect(result.activity).toContainEqual(
      expect.objectContaining({ kind: 'version_status', versionId: 'version-2' }),
    );
  });
});
