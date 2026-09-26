import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_TYPES,
  emptyArtifactSummaries,
  toArchitectureOptionDTO,
  toArtifactVersionDTO,
  toArtifactVersionSummaryDTO,
  toItemVersionDTO,
  toProjectDTO,
  type ArchitectureOptionDTO,
  type ArtifactVersionInput,
  type ItemVersionDTO,
} from '@/lib/serialize';

describe('ARTIFACT_TYPES', () => {
  it('is exactly the artifact.type CHECK constraint values (API Contracts 1.7)', () => {
    expect(ARTIFACT_TYPES).toEqual(['requirements', 'architecture', 'ui_requirements', 'backlog']);
  });
});

describe('emptyArtifactSummaries', () => {
  it('has all 4 artifact types, each with no approved/draft version', () => {
    const summaries = emptyArtifactSummaries();
    expect(Object.keys(summaries).sort()).toEqual([...ARTIFACT_TYPES].sort());
    for (const type of ARTIFACT_TYPES) {
      expect(summaries[type]).toEqual({ approvedVersionId: null, draftVersionId: null });
    }
  });
});

describe('toProjectDTO', () => {
  it('serializes createdAt to an ISO string, per API Contracts 1.8', () => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    const dto = toProjectDTO({
      id: 'p1',
      name: 'My Project',
      brief: 'A brief.',
      inputContext: null,
      createdAt,
      artifacts: emptyArtifactSummaries(),
    });
    expect(dto.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(typeof dto.createdAt).toBe('string');
  });

  it('passes inputContext through unchanged when present', () => {
    const dto = toProjectDTO({
      id: 'p1',
      name: 'My Project',
      brief: 'A brief.',
      inputContext: { teamSize: 3 },
      createdAt: new Date(),
      artifacts: emptyArtifactSummaries(),
    });
    expect(dto.inputContext).toEqual({ teamSize: 3 });
  });

  it('normalizes a missing inputContext to null', () => {
    const dto = toProjectDTO({
      id: 'p1',
      name: 'My Project',
      brief: 'A brief.',
      inputContext: undefined,
      createdAt: new Date(),
      artifacts: emptyArtifactSummaries(),
    });
    expect(dto.inputContext).toBeNull();
  });

  it('passes the artifacts record through unchanged', () => {
    const artifacts = {
      ...emptyArtifactSummaries(),
      requirements: { approvedVersionId: 'v1', draftVersionId: null },
    };
    const dto = toProjectDTO({
      id: 'p1',
      name: 'My Project',
      brief: 'A brief.',
      inputContext: null,
      createdAt: new Date(),
      artifacts,
    });
    expect(dto.artifacts).toEqual(artifacts);
  });
});

// API Contracts 1.8 / E3-S10: the ArtifactVersionDTO builders the artifact/version
// routes share. Pure functions, no I/O.
const versionRow: ArtifactVersionInput = {
  id: 'v1',
  artifactId: 'a1',
  artifactType: 'requirements',
  versionNumber: 2,
  status: 'draft',
  statusReason: null,
  schemaVersion: 1,
  baseApprovedVersionId: 'v0',
  selectedArchitectureOptionId: null,
  payload: { businessProblem: 'p' },
  rawOutput: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-02-03T04:05:06.789Z'),
};

describe('toArtifactVersionSummaryDTO', () => {
  it('serializes both dates to ISO strings (milliseconds kept) and copies every scalar field', () => {
    expect(toArtifactVersionSummaryDTO(versionRow)).toEqual({
      id: 'v1',
      artifactId: 'a1',
      artifactType: 'requirements',
      versionNumber: 2,
      status: 'draft',
      statusReason: null,
      schemaVersion: 1,
      baseApprovedVersionId: 'v0',
      payload: { businessProblem: 'p' },
      rawOutput: null,
      selectedArchitectureOptionId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-02-03T04:05:06.789Z',
    });
  });

  it('has no items and no options - the summary shape is Omit<ArtifactVersionDTO, items | options>', () => {
    const dto = toArtifactVersionSummaryDTO(versionRow);

    expect(dto).not.toHaveProperty('items');
    expect(dto).not.toHaveProperty('options');
  });

  it("includes rawOutput ONLY when statusReason is 'stale_generation_context'", () => {
    const raw = { payload: { a: 1 }, candidates: [{ x: 1 }] };

    const stale = toArtifactVersionSummaryDTO({
      ...versionRow,
      status: 'rejected',
      statusReason: 'stale_generation_context',
      rawOutput: raw,
    });
    expect(stale.rawOutput).toEqual(raw);

    for (const statusReason of [
      'user_rejected',
      'revision_requested',
      'replaced_by_regeneration',
    ]) {
      const other = toArtifactVersionSummaryDTO({
        ...versionRow,
        status: 'rejected',
        statusReason,
        rawOutput: raw,
      });
      expect(other.rawOutput).toBeNull();
    }
    expect(toArtifactVersionSummaryDTO({ ...versionRow, rawOutput: raw }).rawOutput).toBeNull();
  });

  it("normalizes a stale version's missing raw output to null rather than undefined", () => {
    const dto = toArtifactVersionSummaryDTO({
      ...versionRow,
      status: 'rejected',
      statusReason: 'stale_generation_context',
      rawOutput: undefined,
    });

    expect(dto.rawOutput).toBeNull();
  });

  it('takes selectedArchitectureOptionId straight from the row', () => {
    const dto = toArtifactVersionSummaryDTO({
      ...versionRow,
      artifactType: 'architecture',
      status: 'approved',
      selectedArchitectureOptionId: 'option-B',
    });

    expect(dto.selectedArchitectureOptionId).toBe('option-B');
  });

  it("never copies a caller's extra columns onto the wire (e.g. projectId)", () => {
    const dto = toArtifactVersionSummaryDTO({
      ...versionRow,
      projectId: 'p1',
      somethingInternal: true,
    } as ArtifactVersionInput);

    expect(dto).not.toHaveProperty('projectId');
    expect(dto).not.toHaveProperty('somethingInternal');
  });
});

describe('toArtifactVersionDTO', () => {
  const item: ItemVersionDTO = {
    itemVersionId: 'iv-1',
    logicalItemId: 'li-1',
    displayKey: 'R-01',
    itemType: 'requirement',
    revisionNumber: 1,
    payload: {},
    parentLogicalItemId: null,
    impact: null,
  };
  const option: ArchitectureOptionDTO = {
    id: 'o-1',
    optionKey: 'A',
    title: 't',
    summary: 's',
    stack: {},
    candidateDecisions: [],
    tradeoffs: [],
  };

  it('is the summary plus items and options', () => {
    const dto = toArtifactVersionDTO(versionRow, [item], null);

    expect(dto).toEqual({
      ...toArtifactVersionSummaryDTO(versionRow),
      items: [item],
      options: null,
    });
  });

  it.each(['requirements', 'ui_requirements', 'backlog'] as const)(
    'has options: null for %s even if a caller passes options',
    (artifactType) => {
      expect(
        toArtifactVersionDTO({ ...versionRow, artifactType }, [], [option]).options,
      ).toBeNull();
      expect(toArtifactVersionDTO({ ...versionRow, artifactType }, [], null).options).toBeNull();
    },
  );

  it('passes the options through for an architecture version', () => {
    const dto = toArtifactVersionDTO({ ...versionRow, artifactType: 'architecture' }, [], [option]);

    expect(dto.options).toEqual([option]);
  });

  it('has options: [] (an array, not null) for an architecture version that has none', () => {
    expect(
      toArtifactVersionDTO({ ...versionRow, artifactType: 'architecture' }, [], null).options,
    ).toEqual([]);
    expect(
      toArtifactVersionDTO({ ...versionRow, artifactType: 'architecture' }, [], []).options,
    ).toEqual([]);
  });

  it('keeps rawOutput gated on the stale reason here too', () => {
    const dto = toArtifactVersionDTO(
      { ...versionRow, statusReason: 'user_rejected', status: 'rejected', rawOutput: { leak: 1 } },
      [],
      null,
    );

    expect(dto.rawOutput).toBeNull();
  });
});

describe('toItemVersionDTO', () => {
  const input = {
    itemVersionId: 'iv-1',
    logicalItemId: 'li-1',
    displayKey: 'S-03',
    itemType: 'story' as const,
    revisionNumber: 4,
    payload: { userValueStatement: 'u' },
    parentLogicalItemId: 'li-epic',
  };

  it('copies the item fields and attaches the already-resolved impact DTO', () => {
    const impact = {
      subjectKind: 'item_version' as const,
      subjectId: 'iv-1',
      rootItemVersionId: 'iv-root',
      rootDisplayKey: 'R-01',
      depth: 1,
      path: ['R-01', 'S-03'],
      acknowledged: false,
    };

    expect(toItemVersionDTO(input, impact)).toEqual({ ...input, impact });
    expect(toItemVersionDTO(input, null)).toEqual({ ...input, impact: null });
  });

  it('never leaks a raw id-based impact row a caller left on its input', () => {
    const dto = toItemVersionDTO(
      { ...input, impact: { subjectId: 'iv-1', path: ['iv-root'] } } as typeof input,
      null,
    );

    expect(dto.impact).toBeNull();
  });
});

describe('toArchitectureOptionDTO', () => {
  const row = {
    id: 'o-1',
    artifactVersionId: 'v1',
    optionKey: 'B',
    title: 'Serverless',
    summary: 'Managed everything',
    stack: { runtime: 'node' },
    candidateDecisions: [{ title: 'Use Postgres' }],
    tradeoffs: [{ factor: 'cost', assessment: 'low' }],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
  };

  it('picks exactly the ArchitectureOptionDTO fields (no artifactVersionId, no createdAt)', () => {
    expect(toArchitectureOptionDTO(row)).toEqual({
      id: 'o-1',
      optionKey: 'B',
      title: 'Serverless',
      summary: 'Managed everything',
      stack: { runtime: 'node' },
      candidateDecisions: [{ title: 'Use Postgres' }],
      tradeoffs: [{ factor: 'cost', assessment: 'low' }],
    });
  });

  it('degrades a non-array jsonb list to [] instead of inventing content', () => {
    const dto = toArchitectureOptionDTO({ ...row, candidateDecisions: null, tradeoffs: 'oops' });

    expect(dto.candidateDecisions).toEqual([]);
    expect(dto.tradeoffs).toEqual([]);
  });
});
