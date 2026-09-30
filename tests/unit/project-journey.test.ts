import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectJourney } from '@/components/projects/project-journey';

describe('project journey document progress (FR-003)', () => {
  it('counts an approved BRD even when later item artifacts remain drafts', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectJourney, {
        projectId: 'project-1',
        tiles: [
          { type: 'requirements', status: 'approved' },
          { type: 'architecture', status: 'draft' },
          { type: 'ui_requirements', status: null },
          { type: 'backlog', status: null },
          { type: 'brd', status: 'approved' },
          { type: 'erd', status: null },
        ],
      }),
    );

    expect(html).toContain('3 / 7 milestones');
    expect(html).toContain('BRD: approved. Open BRD.');
  });
});
