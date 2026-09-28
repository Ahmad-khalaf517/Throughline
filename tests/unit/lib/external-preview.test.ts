import { describe, expect, it } from 'vitest';
import type { ImpactRowDTO } from '@/lib/serialize';
import {
  describeExternalError,
  describeOperationStatus,
  describeRepoNameAvailability,
  describeSkipReason,
  EXTERNAL_ERROR_COPY,
  isExternalWriteBlocked,
  isRepoNameBlocked,
  missingJiraDecisions,
  readExistingRepository,
  readImpactFromError,
  splitImpact,
  type RepoNameAvailability,
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

describe('describeRepoNameAvailability / isRepoNameBlocked', () => {
  const available: RepoNameAvailability = {
    kind: 'available',
    typed: 'my-repo',
    repoName: 'my-repo',
  };
  const taken: RepoNameAvailability = { kind: 'taken', typed: 'my-repo', repoName: 'my-repo' };
  const invalid: RepoNameAvailability = { kind: 'invalid', typed: '!!!', repoName: '' };
  const failed: RepoNameAvailability = {
    kind: 'error',
    typed: 'my-repo',
    message: 'Could not reach the server.',
  };

  it('shows nothing for an empty field', () => {
    expect(describeRepoNameAvailability(null, '')).toBeNull();
    expect(describeRepoNameAvailability(available, '')).toBeNull();
  });

  it('reads as checking until an answer exists for the text currently in the field', () => {
    const checking = { tone: 'neutral', text: 'Checking availability…' };
    expect(describeRepoNameAvailability(null, 'my-repo')).toEqual(checking);
    // A slow answer for an earlier name must never be shown against a newer one.
    expect(describeRepoNameAvailability(taken, 'my-repo-2')).toEqual(checking);
  });

  it('reports an available name as a success', () => {
    expect(describeRepoNameAvailability(available, 'my-repo')).toEqual({
      tone: 'success',
      text: '"my-repo" is available.',
    });
  });

  it('says what the name will become when normalization changed it', () => {
    const copy = describeRepoNameAvailability(
      { kind: 'available', typed: 'My Repo!', repoName: 'my-repo' },
      'My Repo!',
    );
    expect(copy?.tone).toBe('success');
    expect(copy?.text).toContain('"my-repo" is available');
    expect(copy?.text).toContain('will be created with that name');
  });

  it('reports a taken name as an error naming the normalized name', () => {
    const copy = describeRepoNameAvailability(taken, 'my-repo');
    expect(copy?.tone).toBe('error');
    expect(copy?.text).toContain('"my-repo" is already taken');
  });

  it('reports a name with nothing usable left as an error', () => {
    expect(describeRepoNameAvailability(invalid, '!!!')?.tone).toBe('error');
  });

  it('reports a failed check as an error carrying the reason', () => {
    const copy = describeRepoNameAvailability(failed, 'my-repo');
    expect(copy?.tone).toBe('error');
    expect(copy?.text).toContain("Couldn't check availability.");
    expect(copy?.text).toContain('Could not reach the server.');
  });

  it('blocks submit only for a known taken/invalid answer about the current text', () => {
    expect(isRepoNameBlocked(taken, 'my-repo')).toBe(true);
    expect(isRepoNameBlocked(invalid, '!!!')).toBe(true);
  });

  it('never blocks submit on an available, failed, stale or missing check - the server still decides', () => {
    expect(isRepoNameBlocked(available, 'my-repo')).toBe(false);
    expect(isRepoNameBlocked(failed, 'my-repo')).toBe(false);
    expect(isRepoNameBlocked(taken, 'my-repo-2')).toBe(false); // stale: about other text
    expect(isRepoNameBlocked(null, 'my-repo')).toBe(false);
  });
});

describe('readExistingRepository', () => {
  const conflict = (repository: unknown) => ({
    error: { code: 'GITHUB_ALREADY_INITIALIZED', message: 'x', details: { repository } },
  });

  it('reads the URL and owner/name from a 409 GITHUB_ALREADY_INITIALIZED', () => {
    expect(
      readExistingRepository(
        conflict({ url: 'https://github.com/octo/demo-repo', name: 'octo/demo-repo' }),
      ),
    ).toEqual({ url: 'https://github.com/octo/demo-repo', name: 'octo/demo-repo' });
  });

  it('keeps the link when the name was never stored', () => {
    for (const name of [null, undefined, '', '   ', 42]) {
      expect(
        readExistingRepository(conflict({ url: 'https://github.com/octo/demo-repo', name })),
      ).toEqual({ url: 'https://github.com/octo/demo-repo', name: null });
    }
  });

  it('returns null when there is no usable link, so the screen falls back to the plain message', () => {
    for (const url of [null, undefined, '', '   ', 42, {}, 'not a url', 'github.com/octo/x']) {
      expect(readExistingRepository(conflict({ url, name: 'octo/x' })), String(url)).toBeNull();
    }
  });

  it('refuses a URL that is not https, because it is rendered as an href', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://github.com/octo/demo-repo',
      'ftp://github.com/octo/demo-repo',
      'file:///etc/passwd',
    ]) {
      expect(readExistingRepository(conflict({ url, name: 'octo/x' })), url).toBeNull();
    }
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'oops'],
    ['no error', {}],
    ['error is a string', { error: 'oops' }],
    ['no details', { error: { code: 'X' } }],
    ['details is a string', { error: { details: 'oops' } }],
    ['no repository', { error: { details: {} } }],
    ['repository is a string', { error: { details: { repository: 'oops' } } }],
  ])('returns null for a malformed body (%s)', (_label, body) => {
    expect(readExistingRepository(body)).toBeNull();
  });
});
