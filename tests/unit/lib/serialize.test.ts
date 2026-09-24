import { describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES, emptyArtifactSummaries, toProjectDTO } from '@/lib/serialize';

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
