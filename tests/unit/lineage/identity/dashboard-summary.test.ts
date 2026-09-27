import { describe, expect, it } from 'vitest';
import { dashboardItemSummary } from '@/lineage/identity/dashboard-summary';

describe('dashboard item summary (FR-003)', () => {
  it.each([
    ['requirement', { behavior: '  Supports offline edits  ' }, 'Supports offline edits', null],
    [
      'architecture_decision',
      { title: 'Local storage', decision: 'Use SQLite' },
      'Local storage',
      'Use SQLite',
    ],
    [
      'ui_requirement',
      { screenOrFlow: 'Project overview', interactionRequirement: 'Shows current status' },
      'Project overview',
      'Shows current status',
    ],
    [
      'epic',
      { title: 'Review artifacts', scopeStatement: 'Four review screens' },
      'Review artifacts',
      'Four review screens',
    ],
    [
      'story',
      {
        userValueStatement: 'As a planner, I can review changes',
        structuredBehavior: 'Compare revisions',
      },
      'As a planner, I can review changes',
      'Compare revisions',
    ],
  ])('uses stored %s content', (itemType, payload, title, narrative) => {
    expect(dashboardItemSummary(itemType as string, payload)).toEqual({ title, narrative });
  });

  it('returns no invented copy for missing or malformed fields', () => {
    expect(
      dashboardItemSummary('story', { userValueStatement: ' ', structuredBehavior: 42 }),
    ).toEqual({ title: null, narrative: null });
    expect(dashboardItemSummary('requirement', '<script>')).toEqual({
      title: null,
      narrative: null,
    });
    expect(dashboardItemSummary('unknown', { title: 'Do not show' })).toEqual({
      title: null,
      narrative: null,
    });
  });
});
