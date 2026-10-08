import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DependencyGraph } from '@/components/review/dependency-graph';
import type { ArtifactVersionDTO, ImpactRowDTO } from '@/lib/serialize';

const version: ArtifactVersionDTO = {
  id: 'requirements-v3',
  artifactId: 'requirements',
  artifactType: 'requirements',
  versionNumber: 3,
  status: 'approved',
  statusReason: null,
  schemaVersion: 1,
  baseApprovedVersionId: 'requirements-v2',
  payload: {},
  rawOutput: null,
  items: [],
  options: null,
  selectedArchitectureOptionId: null,
  createdAt: '2026-09-28T00:00:00Z',
  updatedAt: '2026-09-28T00:00:00Z',
};

function warning(
  rootDisplayKey: string,
  rootItemVersionId: string,
  subjectId: string,
  path: string[],
  depth: number,
  subjectKind: ImpactRowDTO['subjectKind'] = 'item_version',
): ImpactRowDTO {
  return {
    rootDisplayKey,
    rootItemVersionId,
    subjectId,
    subjectKind,
    path,
    depth,
    acknowledged: false,
  };
}

describe('DependencyGraph', () => {
  it('shows every warning path across multiple roots and branches, including distinct same-label subjects', () => {
    const acknowledged = warning('R-02', 'root-02', 'story-02', ['R-02', 'ADR-01', 'S-02'], 1);
    acknowledged.acknowledged = true;
    const warnings = [
      warning('R-04', 'root-04', 'adr-03', ['R-04', 'ADR-03'], 0),
      warning('R-04', 'root-04', 'story-07', ['R-04', 'ADR-03', 'S-07'], 1),
      warning('R-04', 'root-04', 'story-05-v1', ['R-04', 'S-05'], 0),
      warning('R-04', 'root-04', 'story-05-v2', ['R-04', 'S-05'], 1),
      warning('R-04', 'root-04', 'jira-15', ['R-04', 'S-05', 'Jira TAE-15'], 2, 'external_ref'),
      warning('R-02', 'root-02', 'adr-01', ['R-02', 'ADR-01'], 0),
      acknowledged,
    ];

    const html = renderToStaticMarkup(createElement(DependencyGraph, { version, warnings }));

    expect(html).toContain('Impact from R-04');
    expect(html).toContain('Impact from R-02');
    expect(html).toContain('R-04 → ADR-03 → S-07');
    expect(html).toContain('R-02 → ADR-01 → S-02');
    expect(html).toContain('R-04 → S-05 → Jira TAE-15');
    expect(html.match(/R-04 → S-05<\/p>/g)).toHaveLength(2);
    expect(html).toContain('story-05-v1');
    expect(html).toContain('story-05-v2');
    expect(html).toContain('External reference');
    expect(html).toContain('Acknowledged');
    expect(html).toContain('jira-15');
    expect(html.match(/Dependency chain starting from/g)).toHaveLength(warnings.length);
  });
});
