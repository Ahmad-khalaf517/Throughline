import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db/client', () => ({ db: {} }));
import { contentOnlyProjection, semanticHash, semanticProjection } from '@/lineage/identity';

describe('identity semantic projection (ERD 5.4, INV-016)', () => {
  it('normalizes prose and unordered criteria without hashing display prose', () => {
    const first = {
      type: 'functional',
      actor: ' Manager ',
      behavior: 'Review reports.',
      constraints: ['must be available'],
      acceptanceCriteria: ['Export CSV.', 'Filter by date.'],
      explanation: 'First draft',
    };
    const second = {
      ...first,
      actor: 'manager',
      behavior: 'review  reports',
      acceptanceCriteria: ['filter by date', 'export csv'],
      explanation: 'Reworded',
    };
    expect(semanticHash('requirement', first)).toBe(semanticHash('requirement', second));
  });

  it('retains structured values and exact upstream versions', () => {
    const constraint = {
      type: 'constraint',
      dimension: 'scale',
      actor: null,
      behavior: 'support load',
      constraints: [],
      acceptanceCriteria: [],
      value: { expectedScale: 1000, expression: 'p95 >= 99.9' },
    };
    expect(semanticHash('requirement', constraint)).not.toBe(
      semanticHash('requirement', {
        ...constraint,
        value: { expectedScale: 1000, expression: 'p95 > 99.9' },
      }),
    );

    const story = {
      userValueStatement: 'See reports',
      acceptanceCriteria: [],
      structuredBehavior: { steps: ['A', 'B'] },
    };
    const refs = ['B-EXACT', 'A-EXACT'];
    expect(semanticProjection('story', story, refs).upstreamItemVersionIds).toEqual([
      'A-EXACT',
      'B-EXACT',
    ]);
    expect(semanticHash('story', story, refs)).toBe(
      semanticHash('story', story, [...refs].reverse()),
    );
    expect(semanticHash('story', story, refs)).not.toBe(
      semanticHash('story', story, ['A-EXACT', 'C-EXACT']),
    );
    expect(semanticHash('story', story, refs)).not.toBe(
      semanticHash(
        'story',
        {
          ...story,
          structuredBehavior: { steps: ['B', 'A'] },
        },
        refs,
      ),
    );
  });

  it('does not include the Story Epic parent in the hash', () => {
    const story = {
      userValueStatement: 'See reports',
      acceptanceCriteria: [],
      structuredBehavior: {},
      parentLogicalItemId: 'epic-a',
    };
    expect(semanticHash('story', story)).toBe(
      semanticHash('story', { ...story, parentLogicalItemId: 'epic-b' }),
    );
  });

  it('INV-014 compares normalized content without upstream ids while full hashes retain them', () => {
    const payload = {
      decision: 'Use queues.',
      technologyOrApproach: 'Postgres queue',
      significantTradeoffs: ['Operations', 'Latency'],
    };
    expect(contentOnlyProjection('architecture_decision', payload)).toEqual(
      contentOnlyProjection('architecture_decision', {
        ...payload,
        decision: ' use  queues ',
        significantTradeoffs: ['Latency', 'Operations'],
      }),
    );
    expect(contentOnlyProjection('architecture_decision', payload)).not.toHaveProperty(
      'upstreamItemVersionIds',
    );
    expect(semanticHash('architecture_decision', payload, ['requirement-a'])).not.toBe(
      semanticHash('architecture_decision', payload, ['requirement-b']),
    );
  });
});
