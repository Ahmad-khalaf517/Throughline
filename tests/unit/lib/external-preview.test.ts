import { describe, expect, it } from 'vitest';
import type { ImpactRowDTO } from '@/lib/serialize';
import {
  describeExternalError,
  describeOperationStatus,
  describeSkipReason,
  EXTERNAL_ERROR_COPY,
  isExternalWriteBlocked,
  missingJiraDecisions,
  readImpactFromError,
  splitImpact,
} from '@/lib/external-preview';

function impactRow(overrides: Partial<ImpactRowDTO> = {}): ImpactRowDTO {
  return {
    subjectKind: 'item_version',
    subjectId: 'iv-1',
    rootItemVersionId: 'iv-root',
    rootDisplayKey: 'R-01',
    depth: 0,
    path: ['R-01', 'S-01'],
    acknowledged: false,
    ...overrides,
  };
}

describe('splitImpact', () => {
  it('puts depth 0 rows in direct and depth > 0 rows in transitive (INV-022)', () => {
    const rows = [
      impactRow({ subjectId: 'a', depth: 0 }),
      impactRow({ subjectId: 'b', depth: 1 }),
      impactRow({ subjectId: 'c', depth: 2 }),
    ];
    const { direct, transitive } = splitImpact(rows);
    expect(direct.map((row) => row.subjectId)).toEqual(['a']);
    expect(transitive.map((row) => row.subjectId)).toEqual(['b', 'c']);
  });

  it('returns empty arrays for no impact - never flattened, never missing either section', () => {
    expect(splitImpact([])).toEqual({ direct: [], transitive: [] });
  });

  it('never drops a row: direct.length + transitive.length === rows.length', () => {
    const rows = [
      impactRow({ subjectId: 'a', depth: 0 }),
      impactRow({ subjectId: 'b', depth: 0 }),
      impactRow({ subjectId: 'c', depth: 3 }),
    ];
    const { direct, transitive } = splitImpact(rows);
    expect(direct.length + transitive.length).toBe(rows.length);
  });
});

describe('isExternalWriteBlocked', () => {
  // FR-085's full truth table - the one invariant this story exists to
  // hold: empty impact never blocks, and non-empty + unacknowledged does.
  it('does not block when there is no impact and it is unacknowledged', () => {
    expect(isExternalWriteBlocked([], false)).toBe(false);
  });

  it('does not block when there is no impact even if acknowledged is true', () => {
    expect(isExternalWriteBlocked([], true)).toBe(false);
  });

  it('blocks when there is impact and it has not been acknowledged', () => {
    expect(isExternalWriteBlocked([impactRow()], false)).toBe(true);
  });

  it('does not block when there is impact and it has been acknowledged', () => {
    expect(isExternalWriteBlocked([impactRow()], true)).toBe(false);
  });
});

describe('missingJiraDecisions', () => {
  it('lists logicalItemIds with no entry in decisions', () => {
    const needsDecision = [{ logicalItemId: 'a' }, { logicalItemId: 'b' }];
    const decisions = new Map<string, 'skip' | 'create_new'>([['a', 'skip']]);
    expect(missingJiraDecisions(needsDecision, decisions)).toEqual(['b']);
  });

  it('is empty once every item has a decision', () => {
    const needsDecision = [{ logicalItemId: 'a' }, { logicalItemId: 'b' }];
    const decisions = new Map<string, 'skip' | 'create_new'>([
      ['a', 'skip'],
      ['b', 'create_new'],
    ]);
    expect(missingJiraDecisions(needsDecision, decisions)).toEqual([]);
  });

  it('is empty when there is nothing to decide', () => {
    expect(missingJiraDecisions([], new Map())).toEqual([]);
  });

  it('ignores decisions for items not in needsDecision', () => {
    const needsDecision = [{ logicalItemId: 'a' }];
    const decisions = new Map<string, 'skip' | 'create_new'>([['unrelated', 'skip']]);
    expect(missingJiraDecisions(needsDecision, decisions)).toEqual(['a']);
  });
});

describe('describeOperationStatus', () => {
  it('describes pending as in progress, not retryable', () => {
    const copy = describeOperationStatus('pending');
    expect(copy.retryable).toBe(false);
    expect(copy.label.toLowerCase()).not.toContain('fail');
  });

  it('describes completed as finished, not retryable', () => {
    const copy = describeOperationStatus('completed');
    expect(copy.retryable).toBe(false);
    expect(copy.label.toLowerCase()).not.toContain('fail');
  });

  it('describes reconciliation_required conservatively - checking, not failed', () => {
    const copy = describeOperationStatus('reconciliation_required');
    expect(copy.label.toLowerCase()).not.toContain('fail');
    expect(copy.detail.toLowerCase()).not.toContain('failed');
    expect(copy.retryable).toBe(true);
  });

  it('describes failed as retryable', () => {
    const copy = describeOperationStatus('failed');
    expect(copy.retryable).toBe(true);
  });
});

describe('describeSkipReason', () => {
  it('explains epic_has_no_jira_ref in plain language (TR section 16)', () => {
    const message = describeSkipReason('epic_has_no_jira_ref');
    expect(message.toLowerCase()).toContain('epic');
    expect(message.toLowerCase()).toContain('jira');
  });
});

describe('EXTERNAL_ERROR_COPY', () => {
  const documentedCodes = [
    'PREREQUISITE_NOT_APPROVED',
    'GITHUB_ALREADY_INITIALIZED',
    'NAME_TAKEN_BY_OTHER',
    'IMPACT_NOT_ACKNOWLEDGED',
    'ALREADY_GENERATED',
    'REQUEST_CONFLICT',
    'VALIDATION_ERROR',
    'NOT_FOUND',
  ];

  it('has a specific, non-trivial message for every API Contracts section 11 code this story surfaces', () => {
    for (const code of documentedCodes) {
      const message = EXTERNAL_ERROR_COPY[code];
      expect(typeof message).toBe('string');
      expect((message ?? '').length).toBeGreaterThan(10);
    }
  });
});

describe('describeExternalError', () => {
  it('returns the mapped copy for a known code, not the server message', () => {
    expect(describeExternalError('ALREADY_GENERATED', 'a raw server message')).toBe(
      EXTERNAL_ERROR_COPY.ALREADY_GENERATED,
    );
  });

  it('falls back to the server message for a code the map does not know - never a bare generic message', () => {
    expect(describeExternalError('SOME_UNMAPPED_CODE', 'server-provided detail')).toBe(
      'server-provided detail',
    );
  });

  it('falls back to the server message when there is no code at all', () => {
    expect(describeExternalError(undefined, 'server-provided detail')).toBe(
      'server-provided detail',
    );
  });
});

describe('readImpactFromError', () => {
  it('extracts details.impact from a well-formed 409 IMPACT_NOT_ACKNOWLEDGED body', () => {
    const rows = [impactRow({ subjectId: 'fresh' })];
    const body = {
      error: { code: 'IMPACT_NOT_ACKNOWLEDGED', message: 'x', details: { impact: rows } },
    };
    expect(readImpactFromError(body)).toEqual(rows);
  });

  it('returns null when details.impact is an empty array (the route only sends this code when impact is non-empty)', () => {
    const body = { error: { code: 'IMPACT_NOT_ACKNOWLEDGED', details: { impact: [] } } };
    expect(readImpactFromError(body)).toBeNull();
  });

  it('returns null when details is missing', () => {
    const body = { error: { code: 'IMPACT_NOT_ACKNOWLEDGED' } };
    expect(readImpactFromError(body)).toBeNull();
  });

  it('returns null when details.impact is missing', () => {
    const body = { error: { code: 'IMPACT_NOT_ACKNOWLEDGED', details: {} } };
    expect(readImpactFromError(body)).toBeNull();
  });

  it('returns null when details.impact is not an array', () => {
    const body = { error: { code: 'IMPACT_NOT_ACKNOWLEDGED', details: { impact: 'nope' } } };
    expect(readImpactFromError(body)).toBeNull();
  });

  it('returns null when error is missing entirely', () => {
    expect(readImpactFromError({})).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(readImpactFromError(null)).toBeNull();
    expect(readImpactFromError(undefined)).toBeNull();
    expect(readImpactFromError('not an object')).toBeNull();
  });
});
