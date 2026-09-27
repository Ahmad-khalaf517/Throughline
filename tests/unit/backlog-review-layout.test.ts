import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BacklogReviewLayout } from '@/components/review/backlog-review-layout';
import { getFixtureArtifactVersion } from '@/components/review/fixtures';

describe('Backlog review layout', () => {
  it('groups Stories under their Epic and reports references from real Stories', () => {
    const fixture = getFixtureArtifactVersion('backlog');
    if (!fixture) throw new Error('Missing backlog fixture');

    const html = renderToStaticMarkup(
      createElement(BacklogReviewLayout, {
        items: fixture.version.items,
        qualityIssues: fixture.qualityIssues,
        status: 'draft',
        onEdit: () => {},
      }),
    );

    expect(html).toContain('Hierarchical work breakdown');
    expect(html).toContain('4 Stories · 1 Epic');
    expect(html).toContain('3 of 4 Stories have source references');
    expect(html).toContain('S-03');
    expect(html).toContain('MISSING_SOURCE_REQUIREMENT');
    expect(html).toContain('R-04 → R-06 → S-02');
    expect(html.indexOf('E-01')).toBeLessThan(html.indexOf('S-01'));
  });

  it('keeps a Story with an unmatched parent visible', () => {
    const fixture = getFixtureArtifactVersion('backlog');
    if (!fixture) throw new Error('Missing backlog fixture');
    const orphan = {
      ...fixture.version.items.find((item) => item.displayKey === 'S-01')!,
      parentLogicalItemId: 'removed-epic',
    };

    const html = renderToStaticMarkup(
      createElement(BacklogReviewLayout, {
        items: [...fixture.version.items.filter((item) => item.displayKey !== 'S-01'), orphan],
        qualityIssues: fixture.qualityIssues,
        status: 'draft',
        onEdit: () => {},
      }),
    );

    expect(html).toContain('Items without a matching Epic');
    expect(html).toContain('Create a project from a name and a brief');
  });
});
