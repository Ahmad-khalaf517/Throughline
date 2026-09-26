import { beforeEach, describe, expect, it, vi } from 'vitest';

// artifact-types/requirements: FR-012's deterministic quality gate (Jira E3-S6
// / SCRUM-41) and the FR-010 payload half of outputSchema. The pure rules
// (`evaluateRequirementsQuality`) run with no I/O at all; `qualityGate`'s
// loading glue is exercised against mocked collaborators here (the real
// database round trip is tests/integration/requirements-quality-gate.test.ts).
// The three collaborators are mocked with factories so their real modules -
// `@/artifact-lifecycle` transitively loads `@/lib/env`, which validates env
// vars at import - are never loaded.
const { withTxMock, getSourceVersionMembersMock, getArtifactVersionPayloadMock } = vi.hoisted(
  () => ({
    withTxMock: vi.fn(),
    getSourceVersionMembersMock: vi.fn(),
    getArtifactVersionPayloadMock: vi.fn(),
  }),
);

vi.mock('@/db', () => ({ withTx: withTxMock }));
vi.mock('@/lineage/identity', () => ({ getSourceVersionMembers: getSourceVersionMembersMock }));
vi.mock('@/artifact-lifecycle', () => ({
  getArtifactVersionPayload: getArtifactVersionPayloadMock,
}));

import {
  buildPrompt,
  evaluateRequirementsQuality,
  outputSchema,
  qualityGate,
  toCandidates,
  type QualityIssue,
  type RequirementItem,
} from '@/artifact-types/requirements';

type QualityItem = Parameters<typeof evaluateRequirementsQuality>[0]['items'][number];

const GOOD_PAYLOAD = {
  businessProblem: 'Teams cannot tell which downstream work is stale.',
  actors: ['Reviewer'],
  assumptions: [],
  unresolvedQuestions: [],
  userJourneys: [],
};

function item(
  displayKey: string,
  overrides: Record<string, unknown> = {},
  logicalItemId = `id-${displayKey}`,
): QualityItem {
  return {
    logicalItemId,
    displayKey,
    payload: {
      type: 'functional',
      actor: 'Reviewer',
      behavior: 'Approve a draft.',
      constraints: [],
      acceptanceCriteria: ['The approval is recorded.'],
      dimension: null,
      value: null,
      explanation: 'Free prose.',
      ...overrides,
    },
  };
}

function constraint(
  displayKey: string,
  dimension: string | null,
  overrides: Record<string, unknown> = {},
  logicalItemId = `id-${displayKey}`,
): QualityItem {
  return item(
    displayKey,
    { type: 'constraint', dimension, value: '5,000 users', ...overrides },
    logicalItemId,
  );
}

function evaluate(items: QualityItem[], payload: unknown = GOOD_PAYLOAD): QualityIssue[] {
  return evaluateRequirementsQuality({ items, payload });
}

function codes(issues: QualityIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

describe('evaluateRequirementsQuality - clean versions', () => {
  it('returns [] for a well-formed version', () => {
    expect(
      evaluate([
        item('R-01'),
        item('R-02', { type: 'non_functional' }),
        constraint('R-03', 'scale'),
      ]),
    ).toEqual([]);
  });

  it('returns [] for a version with no items and a good payload', () => {
    expect(evaluate([])).toEqual([]);
  });
});

describe('evaluateRequirementsQuality - MISSING_ACCEPTANCE_CRITERIA', () => {
  it('fires on an empty acceptanceCriteria array, naming the item', () => {
    expect(evaluate([item('R-01'), item('R-02', { acceptanceCriteria: [] })])).toEqual([
      {
        code: 'MISSING_ACCEPTANCE_CRITERIA',
        message: 'R-02 has no acceptance criteria.',
        logicalItemId: 'id-R-02',
      },
    ]);
  });

  it('fires when every criterion is blank, not when one is real', () => {
    expect(codes(evaluate([item('R-01', { acceptanceCriteria: ['', '   '] })]))).toEqual([
      'MISSING_ACCEPTANCE_CRITERIA',
    ]);
    expect(
      evaluate([item('R-01', { acceptanceCriteria: ['', 'The approval is recorded.'] })]),
    ).toEqual([]);
  });

  it('applies to constraint items too, and labels them with their dimension', () => {
    expect(evaluate([constraint('R-04', 'scale', { acceptanceCriteria: [] })])).toEqual([
      {
        code: 'MISSING_ACCEPTANCE_CRITERIA',
        message: 'R-04 (constraint: scale) has no acceptance criteria.',
        logicalItemId: 'id-R-04',
      },
    ]);
  });
});

describe('evaluateRequirementsQuality - REQUIRED_FIELD_MISSING (items)', () => {
  it('fires once per item, listing every blank field', () => {
    expect(evaluate([item('R-01', { actor: '  ', behavior: '' })])).toEqual([
      {
        code: 'REQUIRED_FIELD_MISSING',
        message: 'R-01 is missing required field(s): actor, behavior.',
        logicalItemId: 'id-R-01',
      },
    ]);
  });

  it('fires for a blank actor alone and for a blank behavior alone', () => {
    expect(evaluate([item('R-01', { actor: ' ' })])[0]?.message).toBe(
      'R-01 is missing required field(s): actor.',
    );
    expect(evaluate([item('R-01', { behavior: '' })])[0]?.message).toBe(
      'R-01 is missing required field(s): behavior.',
    );
  });

  it('requires a dimension and a value on constraint items (FR-010)', () => {
    expect(evaluate([constraint('R-04', null)])).toEqual([
      {
        code: 'REQUIRED_FIELD_MISSING',
        message: 'R-04 is missing required field(s): dimension.',
        logicalItemId: 'id-R-04',
      },
    ]);
    expect(evaluate([constraint('R-04', '  ', { value: null })])[0]?.message).toBe(
      'R-04 is missing required field(s): dimension, value.',
    );
    expect(evaluate([constraint('R-04', 'scale', { value: ' ' })])[0]?.message).toBe(
      'R-04 (constraint: scale) is missing required field(s): value.',
    );
  });

  it('does not require dimension or value on non-constraint items', () => {
    expect(
      evaluate([
        item('R-01', { dimension: null, value: null }),
        item('R-02', { type: 'non_functional', dimension: undefined, value: undefined }),
      ]),
    ).toEqual([]);
  });
});

describe('evaluateRequirementsQuality - MALFORMED_ITEM', () => {
  it('fires on a type outside the enum, naming the failing path', () => {
    const issues = evaluate([item('R-01', { type: 'bug' })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'MALFORMED_ITEM', logicalItemId: 'id-R-01' });
    expect(issues[0]?.message).toContain('R-01 is malformed (type)');
  });

  it('fires when constraints is not an array', () => {
    const issues = evaluate([item('R-01', { constraints: 'must be fast' })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'MALFORMED_ITEM', logicalItemId: 'id-R-01' });
    expect(issues[0]?.message).toContain('(constraints)');
  });

  it('fires when acceptanceCriteria holds a non-string, and on a missing actor', () => {
    expect(evaluate([item('R-01', { acceptanceCriteria: [1] })])[0]?.message).toContain(
      '(acceptanceCriteria.0)',
    );
    expect(evaluate([item('R-01', { actor: undefined })])[0]?.message).toContain('(actor)');
  });

  it('fires when the whole payload is not an object', () => {
    for (const payload of [null, 'text', 7, []]) {
      const issues = evaluate([{ logicalItemId: 'id-R-01', displayKey: 'R-01', payload }]);
      expect(codes(issues)).toEqual(['MALFORMED_ITEM']);
      expect(issues[0]?.message).toContain('R-01 is malformed (payload)');
    }
  });

  it('skips every payload-reading check on a malformed item', () => {
    expect(
      codes(
        evaluate([
          item('R-01', { type: 'bug', actor: '', acceptanceCriteria: [], behavior: 'See R-99.' }),
        ]),
      ),
    ).toEqual(['MALFORMED_ITEM']);
  });

  it('still counts a malformed item toward key checks and as a valid mention target', () => {
    const issues = evaluate([
      item('R-01', { behavior: 'Consistent with R-02.' }),
      item('R-02', { type: 'bug' }, 'a-id'),
      item('R-02', {}, 'b-id'),
    ]);
    expect(issues.map(({ code, logicalItemId }) => [code, logicalItemId])).toEqual([
      ['MALFORMED_ITEM', 'a-id'],
      ['DUPLICATE_REFERENCE', 'a-id'],
    ]);
  });
});

describe('evaluateRequirementsQuality - INVALID_REFERENCE', () => {
  it('fires on a display key that is not R-NN', () => {
    for (const displayKey of ['R-1', 'X-04', 'r-04', 'R-04a']) {
      const issues = evaluate([item(displayKey)]);
      expect(issues).toEqual([
        {
          code: 'INVALID_REFERENCE',
          message: `${displayKey} is not a valid display key (expected the form R-01).`,
          logicalItemId: `id-${displayKey}`,
        },
      ]);
    }
  });

  it('accepts R-01 and longer numbers such as R-100', () => {
    expect(evaluate([item('R-01'), item('R-100')])).toEqual([]);
  });

  it('fires on a dangling mention in behavior, constraints or acceptanceCriteria', () => {
    for (const overrides of [
      { behavior: 'Behaves like R-99.' },
      { constraints: ['Same limits as R-99'] },
      { acceptanceCriteria: ['Matches R-99 exactly'] },
    ]) {
      expect(evaluate([item('R-01', overrides)])).toEqual([
        {
          code: 'INVALID_REFERENCE',
          message: 'R-01 refers to R-99, which is not an item in this version.',
          logicalItemId: 'id-R-01',
        },
      ]);
    }
  });

  it('does not fire on a mention of another member or on a self mention', () => {
    expect(
      evaluate([
        item('R-04'),
        item('R-05', { behavior: 'Consistent with R-04 and R-05.', constraints: ['See R-04'] }),
      ]),
    ).toEqual([]);
  });

  it('reports each distinct dangling key once per item', () => {
    const issues = evaluate([
      item('R-01', { behavior: 'R-98 then R-99.', acceptanceCriteria: ['R-99 again', 'Done.'] }),
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      'R-01 refers to R-98, which is not an item in this version.',
      'R-01 refers to R-99, which is not an item in this version.',
    ]);
  });

  it('ignores text that only resembles a display key', () => {
    expect(
      evaluate([
        item('R-01', {
          behavior: 'Handles R-9, XR-99 and R-999a as opaque text.',
          explanation: 'Mentions R-77 but explanation is never scanned.',
        }),
      ]),
    ).toEqual([]);
  });
});

describe('evaluateRequirementsQuality - DUPLICATE_REFERENCE', () => {
  it('fires once for two items sharing a display key, on the first of them', () => {
    const issues = evaluate([item('R-03', {}, 'b-id'), item('R-03', {}, 'a-id')]);
    expect(issues).toEqual([
      {
        code: 'DUPLICATE_REFERENCE',
        message: 'Display key R-03 is used by 2 items in this version.',
        logicalItemId: 'a-id',
      },
    ]);
  });

  it('fires once for constraint items sharing a dimension, ignoring case and padding', () => {
    expect(
      evaluate([constraint('R-04', 'Scale'), constraint('R-05', '  scale '), item('R-06')]),
    ).toEqual([
      {
        code: 'DUPLICATE_REFERENCE',
        message:
          'Constraint items R-04, R-05 share the dimension "Scale" (one constraint item per dimension).',
        logicalItemId: 'id-R-04',
      },
    ]);
  });

  it('reports one issue per group and lists all three colliding keys', () => {
    const issues = evaluate([
      constraint('R-04', 'scale'),
      constraint('R-05', 'deadline'),
      constraint('R-06', 'SCALE'),
      constraint('R-07', 'deadline'),
      constraint('R-08', 'Scale'),
    ]);
    expect(issues.map(({ message, logicalItemId }) => [message, logicalItemId])).toEqual([
      [
        'Constraint items R-04, R-06, R-08 share the dimension "scale" (one constraint item per dimension).',
        'id-R-04',
      ],
      [
        'Constraint items R-05, R-07 share the dimension "deadline" (one constraint item per dimension).',
        'id-R-05',
      ],
    ]);
  });

  it('does not fire for distinct dimensions, non-constraint items, or blank dimensions', () => {
    expect(evaluate([constraint('R-04', 'scale'), constraint('R-05', 'deadline')])).toEqual([]);
    expect(
      evaluate([item('R-04', { dimension: 'scale' }), item('R-05', { dimension: 'scale' })]),
    ).toEqual([]);
    expect(codes(evaluate([constraint('R-04', null), constraint('R-05', '  ')]))).toEqual([
      'REQUIRED_FIELD_MISSING',
      'REQUIRED_FIELD_MISSING',
    ]);
  });
});

describe('evaluateRequirementsQuality - payload level', () => {
  it('reports one UNRESOLVED_ASSUMPTION per non-blank unresolved question', () => {
    expect(
      evaluate([item('R-01')], {
        ...GOOD_PAYLOAD,
        unresolvedQuestions: ['  Is multi-region required? ', '', '   ', 'Who signs off?'],
      }),
    ).toEqual([
      {
        code: 'UNRESOLVED_ASSUMPTION',
        message: 'Unresolved question: "Is multi-region required?"',
        logicalItemId: null,
      },
      {
        code: 'UNRESOLVED_ASSUMPTION',
        message: 'Unresolved question: "Who signs off?"',
        logicalItemId: null,
      },
    ]);
  });

  it('ignores non-string unresolved-question entries and non-array values', () => {
    expect(evaluate([], { ...GOOD_PAYLOAD, unresolvedQuestions: [1, null, {}] })).toEqual([]);
    expect(evaluate([], { ...GOOD_PAYLOAD, unresolvedQuestions: 'why?' })).toEqual([]);
  });

  it('does not treat assumptions as unresolved', () => {
    expect(evaluate([], { ...GOOD_PAYLOAD, assumptions: ['Single region is fine.'] })).toEqual([]);
  });

  it('reports a missing, blank or non-string businessProblem', () => {
    for (const businessProblem of [undefined, '', '   ', 42, null]) {
      expect(evaluate([], { ...GOOD_PAYLOAD, businessProblem })).toEqual([
        {
          code: 'REQUIRED_FIELD_MISSING',
          message: 'The requirements payload has no business problem.',
          logicalItemId: null,
        },
      ]);
    }
  });

  it('does not throw on a `{}` payload or a non-object payload', () => {
    // Called directly: `evaluate`'s default parameter would swallow `undefined`.
    for (const payload of [{}, null, undefined, 'text', 42, []]) {
      const input = { items: [item('R-01')], payload };
      expect(() => evaluateRequirementsQuality(input)).not.toThrow();
      expect(codes(evaluateRequirementsQuality(input))).toEqual(['REQUIRED_FIELD_MISSING']);
    }
  });
});

describe('evaluateRequirementsQuality - ordering', () => {
  const messy: QualityItem[] = [
    constraint('R-10', 'scale', { acceptanceCriteria: [] }),
    item('R-02', { behavior: 'Mirrors R-99.' }),
    constraint('R-04', 'Scale'),
    item('R-03', { actor: '' }),
    item('R-01', { type: 'bug' }),
  ];
  const payload = { ...GOOD_PAYLOAD, businessProblem: '', unresolvedQuestions: ['Region?'] };

  it('orders per-item issues by display key, then duplicates, then payload issues', () => {
    expect(
      evaluate(messy, payload).map(({ code, logicalItemId }) => [code, logicalItemId]),
    ).toEqual([
      ['MALFORMED_ITEM', 'id-R-01'],
      ['INVALID_REFERENCE', 'id-R-02'],
      ['REQUIRED_FIELD_MISSING', 'id-R-03'],
      ['MISSING_ACCEPTANCE_CRITERIA', 'id-R-10'],
      ['DUPLICATE_REFERENCE', 'id-R-04'],
      ['REQUIRED_FIELD_MISSING', null],
      ['UNRESOLVED_ASSUMPTION', null],
    ]);
  });

  it('is independent of input order and stable across runs', () => {
    const expected = evaluate(messy, payload);
    expect(evaluate([...messy].reverse(), payload)).toEqual(expected);
    expect(evaluate([messy[2]!, messy[0]!, messy[4]!, messy[1]!, messy[3]!], payload)).toEqual(
      expected,
    );
    expect(evaluate(messy, payload)).toEqual(expected);
  });

  it('sorts display keys numerically (R-09, R-10, R-11, R-100), not lexically', () => {
    const issues = evaluate([
      item('R-10', { acceptanceCriteria: [] }),
      item('R-09', { acceptanceCriteria: [] }),
      item('R-100', { acceptanceCriteria: [] }),
      item('R-11', { acceptanceCriteria: [] }),
    ]);
    expect(issues.map((issue) => issue.logicalItemId)).toEqual([
      'id-R-09',
      'id-R-10',
      'id-R-11',
      'id-R-100',
    ]);
  });
});

describe('qualityGate', () => {
  const memberRow = (overrides: Record<string, unknown> = {}) => ({
    sourceVersionId: 'version-1',
    logicalItemId: 'id-R-01',
    itemVersionId: 'iv-R-01',
    displayKey: 'R-01',
    itemType: 'requirement',
    payload: item('R-01').payload,
    ...overrides,
  });

  beforeEach(() => {
    vi.resetAllMocks();
    withTxMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
    getArtifactVersionPayloadMock.mockResolvedValue({ payload: GOOD_PAYLOAD });
  });

  it('loads members for exactly the requested version and returns the evaluator result', async () => {
    getSourceVersionMembersMock.mockResolvedValue([
      memberRow(),
      memberRow({
        logicalItemId: 'id-R-02',
        itemVersionId: 'iv-R-02',
        displayKey: 'R-02',
        payload: item('R-02', { acceptanceCriteria: [] }).payload,
      }),
    ]);

    await expect(qualityGate('version-1')).resolves.toEqual([
      {
        code: 'MISSING_ACCEPTANCE_CRITERIA',
        message: 'R-02 has no acceptance criteria.',
        logicalItemId: 'id-R-02',
      },
    ]);
    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['version-1']);
    expect(getArtifactVersionPayloadMock).toHaveBeenCalledWith('version-1');
  });

  it('drops the all-null LEFT JOIN row of a version with no members', async () => {
    getSourceVersionMembersMock.mockResolvedValue([
      memberRow({
        logicalItemId: null,
        itemVersionId: null,
        displayKey: null,
        itemType: null,
        payload: null,
      }),
    ]);
    await expect(qualityGate('version-1')).resolves.toEqual([]);
  });

  it('reports payload-level issues even when the version has no members', async () => {
    getSourceVersionMembersMock.mockResolvedValue([]);
    getArtifactVersionPayloadMock.mockResolvedValue({ payload: {} });
    expect(codes(await qualityGate('version-1'))).toEqual(['REQUIRED_FIELD_MISSING']);
  });

  it('throws, rather than reporting an issue, when a member is not a requirement', async () => {
    getSourceVersionMembersMock.mockResolvedValue([memberRow({ itemType: 'story' })]);
    await expect(qualityGate('version-1')).rejects.toThrow(/not a requirement/);
  });

  it('lets the unknown-version error from identity propagate', async () => {
    getSourceVersionMembersMock.mockRejectedValue(new Error('Unknown context source version'));
    await expect(qualityGate('missing')).rejects.toThrow('Unknown context source version');
  });

  it('throws when the version payload cannot be read', async () => {
    getSourceVersionMembersMock.mockResolvedValue([memberRow()]);
    getArtifactVersionPayloadMock.mockResolvedValue(null);
    await expect(qualityGate('version-1')).rejects.toThrow(/does not exist/);
  });
});

describe('outputSchema (FR-010 payload + items)', () => {
  const generatedItem: RequirementItem = {
    displayKey: 'R-01',
    previousDisplayKey: null,
    type: 'functional',
    actor: 'Reviewer',
    behavior: 'Approve a draft.',
    constraints: [],
    acceptanceCriteria: ['The approval is recorded.'],
    dimension: null,
    value: null,
    explanation: 'Free prose.',
  };
  const valid = { payload: GOOD_PAYLOAD, items: [generatedItem] };

  it('accepts a full payload with empty arrays', () => {
    expect(outputSchema.safeParse(valid).success).toBe(true);
    expect(
      outputSchema.safeParse({
        ...valid,
        payload: {
          businessProblem: 'A problem.',
          actors: ['A', 'B'],
          assumptions: ['One.'],
          unresolvedQuestions: ['Why?'],
          userJourneys: ['Sign in, then review.'],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a missing or empty businessProblem', () => {
    const withoutProblem: Record<string, unknown> = { ...GOOD_PAYLOAD };
    delete withoutProblem.businessProblem;
    expect(outputSchema.safeParse({ ...valid, payload: withoutProblem }).success).toBe(false);
    expect(
      outputSchema.safeParse({ ...valid, payload: { ...GOOD_PAYLOAD, businessProblem: '' } })
        .success,
    ).toBe(false);
  });

  it('requires every payload property to be present', () => {
    for (const key of ['actors', 'assumptions', 'unresolvedQuestions', 'userJourneys'] as const) {
      const partial: Record<string, unknown> = { ...GOOD_PAYLOAD };
      delete partial[key];
      expect(outputSchema.safeParse({ ...valid, payload: partial }).success).toBe(false);
    }
  });

  it('rejects an empty actor name and the old summary-only payload', () => {
    expect(
      outputSchema.safeParse({ ...valid, payload: { ...GOOD_PAYLOAD, actors: [''] } }).success,
    ).toBe(false);
    expect(
      outputSchema.safeParse({ ...valid, payload: { summary: 'Old placeholder.' } }).success,
    ).toBe(false);
  });

  it('still bounds and validates items exactly as before', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...generatedItem,
        displayKey: `R-${String(index + 1).padStart(2, '0')}`,
      }));
    expect(outputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(outputSchema.safeParse({ ...valid, items: many(8) }).success).toBe(true);
    expect(outputSchema.safeParse({ ...valid, items: many(9) }).success).toBe(false);
    expect(
      outputSchema.safeParse({ ...valid, items: [{ ...generatedItem, displayKey: 'R-1' }] })
        .success,
    ).toBe(false);
    expect(
      outputSchema.safeParse({ ...valid, items: [{ ...generatedItem, acceptanceCriteria: [] }] })
        .success,
    ).toBe(false);
    expect(
      outputSchema.safeParse({ ...valid, items: [{ ...generatedItem, actor: '' }] }).success,
    ).toBe(false);
    expect(
      outputSchema.safeParse({
        ...valid,
        items: [{ ...generatedItem, type: 'constraint', dimension: 'scale', value: '5k' }],
      }).success,
    ).toBe(true);
  });

  it('keeps the artifact payload out of item candidates (payload is never hashed)', () => {
    const [candidate] = toCandidates([generatedItem]);
    expect(candidate?.payload).not.toHaveProperty('businessProblem');
    expect(candidate?.upstreamRefs).toEqual([]);
  });

  it('tells the model to fill the payload fields in both fresh and regeneration prompts', () => {
    const fresh = buildPrompt({ brief: 'A brief.', baseItems: [] });
    const regenerate = buildPrompt({ brief: 'A brief.', baseItems: [generatedItem] });
    for (const prompt of [fresh, regenerate]) {
      for (const field of [
        'businessProblem',
        'actors',
        'assumptions',
        'unresolvedQuestions',
        'userJourneys',
      ]) {
        expect(prompt).toContain(`payload.${field}`);
      }
    }
  });

  it('tells the model constraints belong in constraint items, not payload.assumptions', () => {
    const fresh = buildPrompt({ brief: 'A brief.', baseItems: [] });
    const regenerate = buildPrompt({ brief: 'A brief.', baseItems: [generatedItem] });
    for (const prompt of [fresh, regenerate]) {
      // Whitespace-normalized: RULES wraps this sentence across source lines.
      const flat = prompt.replace(/\s+/g, ' ');
      expect(flat).toContain('Never restate a constraint here');
      expect(flat).toContain('those belong only in constraint items');
    }
  });
});
