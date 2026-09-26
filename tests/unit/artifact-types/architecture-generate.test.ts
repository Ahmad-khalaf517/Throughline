import { beforeEach, describe, expect, it, vi } from 'vitest';

// artifact-types/architecture `generate` (Jira E3-S10 / SCRUM-45): the FR-080
// refusal, the regeneration context it loads (base ADRs with their bound
// upstream display keys, and the approved option's stack) and the
// `{ payload, candidates, options, runId }` it returns for the route to feed
// createDraftFromGeneration + createOptions. Every collaborator is mocked with
// a factory, so the real modules - which load `@/lib/env` and validate env vars
// at import - are never loaded; tests/unit/artifact-types/architecture.test.ts
// keeps covering the pure prompt/schema half with the real ones. The real
// database round trip of the loading queries is covered by the route-level and
// integration tests.
const {
  withTxMock,
  getProjectByIdMock,
  generateStructuredMock,
  getSourceVersionMembersMock,
  getUpstreamDependenciesMock,
  getSelectedOptionMock,
} = vi.hoisted(() => ({
  withTxMock: vi.fn(),
  getProjectByIdMock: vi.fn(),
  generateStructuredMock: vi.fn(),
  getSourceVersionMembersMock: vi.fn(),
  getUpstreamDependenciesMock: vi.fn(),
  getSelectedOptionMock: vi.fn(),
}));

vi.mock('@/db', () => ({ withTx: withTxMock }));
vi.mock('@/ai-client', () => ({ generateStructured: generateStructuredMock }));
vi.mock('@/lineage/identity', () => ({
  getSourceVersionMembers: getSourceVersionMembersMock,
  getUpstreamDependencies: getUpstreamDependenciesMock,
}));
// The index also builds the createOptions/selectOption/approve facade over these,
// so every name it imports or re-exports is present (their bodies never run here).
vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: getProjectByIdMock,
  withArchitectureDraft: vi.fn(),
  approveVersion: vi.fn(),
  approveWithOverride: vi.fn(),
}));
vi.mock('@/architecture-materialization', () => ({
  getSelectedOption: getSelectedOptionMock,
  getOptionsForVersion: vi.fn(),
  getArchitectureDecisionItems: vi.fn(),
  createOptions: vi.fn(),
  selectOption: vi.fn(),
  materialize: vi.fn(),
  ArchitectureOptionError: class ArchitectureOptionError extends Error {},
}));

import {
  buildPrompt,
  generate,
  outputSchema,
  toCandidates,
  toOptionInputs,
  type ApprovedRequirementItem,
  type ArchitectureOptionOutput,
  type ArchitectureOutput,
  type BaseArchitectureDecision,
} from '@/artifact-types/architecture';

const STACK = {
  frontend: 'next.js + typescript',
  backend: 'next.js route handlers',
  database: 'postgresql',
  hosting: 'vercel',
  repositoryLayout: 'single repo',
};

function option(title: string): ArchitectureOptionOutput {
  return {
    title,
    summary: `${title} summary`,
    stack: { ...STACK },
    tradeoffs: [
      { factor: 'delivery deadline', assessment: 'Eight days rules out a split (R-03).' },
    ],
    candidateDecisions: [
      {
        previousDisplayKey: null,
        title: 'Persistence',
        decision: 'Store all data in one relational database.',
        technologyOrApproach: 'postgresql',
        constraints: [],
        significantTradeoffs: ['Single point of failure'],
        upstreamRefs: ['R-01', 'R-03'],
      },
    ],
  };
}

const generated: ArchitectureOutput = {
  payload: { summary: 'Two options for the project' },
  optionA: option('Option A'),
  optionB: option('Option B'),
};

const project = (approved: { requirements: string | null; architecture: string | null }) => ({
  id: 'project-1',
  brief: 'A brief.',
  artifacts: {
    requirements: { approvedVersionId: approved.requirements, draftVersionId: null },
    architecture: { approvedVersionId: approved.architecture, draftVersionId: null },
    ui_requirements: { approvedVersionId: null, draftVersionId: null },
    backlog: { approvedVersionId: null, draftVersionId: null },
  },
});

const member = (overrides: Record<string, unknown>) => ({
  sourceVersionId: 'req-v',
  logicalItemId: 'logical',
  itemVersionId: 'item-version',
  displayKey: 'R-01',
  itemType: 'requirement',
  payload: {},
  ...overrides,
});

const requirementMembers = [
  // Out of display-key order on purpose: the prompt must not depend on row order.
  member({
    displayKey: 'R-03',
    payload: {
      type: 'constraint',
      actor: 'Team',
      behavior: 'Use skills the team already has',
      constraints: [],
      acceptanceCriteria: ['No new language'],
      dimension: 'teamSkills',
      value: 'typescript and postgres only',
    },
  }),
  member({
    displayKey: 'R-01',
    payload: {
      type: 'functional',
      actor: 'Manager',
      behavior: 'Review weekly reports',
      constraints: ['read-only'],
      acceptanceCriteria: ['Reports list by date'],
      dimension: null,
      value: null,
      explanation: 'ignored prose',
    },
  }),
];

const expectedRequirements: ApprovedRequirementItem[] = [
  {
    displayKey: 'R-01',
    type: 'functional',
    actor: 'Manager',
    behavior: 'Review weekly reports',
    constraints: ['read-only'],
    acceptanceCriteria: ['Reports list by date'],
    dimension: null,
    value: null,
  },
  {
    displayKey: 'R-03',
    type: 'constraint',
    actor: 'Team',
    behavior: 'Use skills the team already has',
    constraints: [],
    acceptanceCriteria: ['No new language'],
    dimension: 'teamSkills',
    value: 'typescript and postgres only',
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  withTxMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  getSourceVersionMembersMock.mockResolvedValue(requirementMembers);
  getUpstreamDependenciesMock.mockResolvedValue([]);
  generateStructuredMock.mockResolvedValue({ data: generated, runId: 'run-1' });
});

describe('architecture.generate - FR-080 refusal', () => {
  it('refuses when Requirements are not approved, before any model call or transaction', async () => {
    getProjectByIdMock.mockResolvedValue(project({ requirements: null, architecture: null }));

    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      'Architecture generation requires approved Requirements first (TR FR-080)',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
    expect(getSelectedOptionMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown project before any model call', async () => {
    getProjectByIdMock.mockResolvedValue(null);
    await expect(generate({ projectId: 'missing' })).rejects.toThrow(
      'Project missing does not exist',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});

describe('architecture.generate - first generation', () => {
  it('sends the approved requirements (numeric order, constraint dimension/value included) with no base, and returns payload/candidates/options/runId', async () => {
    getProjectByIdMock.mockResolvedValue(project({ requirements: 'req-v', architecture: null }));

    const result = await generate({ projectId: 'project-1' });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v']);
    expect(getUpstreamDependenciesMock).not.toHaveBeenCalled();
    expect(getSelectedOptionMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    expect(generateStructuredMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      purpose: 'generation',
      prompt: buildPrompt({
        requirements: expectedRequirements,
        baseDecisions: [],
        baseStack: null,
      }),
      schema: outputSchema,
    });
    expect(result).toEqual({
      payload: { summary: 'Two options for the project' },
      candidates: [],
      options: toOptionInputs(generated),
      runId: 'run-1',
    });
    expect(result.candidates).toEqual(toCandidates(generated));
    expect(result.options).toHaveLength(2);
  });
});

describe('architecture.generate - regeneration', () => {
  const adrMembers = [
    member({
      sourceVersionId: 'arch-v',
      displayKey: 'ADR-02',
      itemType: 'architecture_decision',
      itemVersionId: 'iv-adr-02',
      payload: {
        title: 'Deployment',
        decision: 'Deploy the app as one unit.',
        technologyOrApproach: 'vercel',
        constraints: [],
        significantTradeoffs: [],
      },
    }),
    member({
      sourceVersionId: 'arch-v',
      displayKey: 'ADR-01',
      itemType: 'architecture_decision',
      itemVersionId: 'iv-adr-01',
      payload: {
        title: 'Persistence',
        decision: 'Store all data in one relational database.',
        technologyOrApproach: 'postgresql',
        constraints: ['no second datastore'],
        significantTradeoffs: ['Single point of failure'],
      },
    }),
  ];

  const expectedBase: BaseArchitectureDecision[] = [
    {
      displayKey: 'ADR-01',
      title: 'Persistence',
      decision: 'Store all data in one relational database.',
      technologyOrApproach: 'postgresql',
      constraints: ['no second datastore'],
      significantTradeoffs: ['Single point of failure'],
      // Sorted display keys of the bound upstream items, duplicates collapsed.
      upstreamRefs: ['R-01', 'R-03'],
    },
    {
      displayKey: 'ADR-02',
      title: 'Deployment',
      decision: 'Deploy the app as one unit.',
      technologyOrApproach: 'vercel',
      constraints: [],
      significantTradeoffs: [],
      // R-02 is not among the requirements shown: kept anyway - the prompt tells
      // the model an upstreamRefs array changes only when a shown requirement
      // is gone, and the semantic hash depends on the real bound set (INV-016).
      upstreamRefs: ['R-02'],
    },
  ];

  beforeEach(() => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v', architecture: 'arch-v' }),
    );
    getSourceVersionMembersMock.mockResolvedValue([...requirementMembers, ...adrMembers]);
    getUpstreamDependenciesMock.mockResolvedValue([
      { downstreamItemVersionId: 'iv-adr-01', upstreamDisplayKey: 'R-03' },
      { downstreamItemVersionId: 'iv-adr-01', upstreamDisplayKey: 'R-01' },
      { downstreamItemVersionId: 'iv-adr-01', upstreamDisplayKey: 'R-01' },
      { downstreamItemVersionId: 'iv-adr-01', upstreamDisplayKey: null },
      { downstreamItemVersionId: 'iv-adr-02', upstreamDisplayKey: 'R-02' },
    ]);
    getSelectedOptionMock.mockResolvedValue({ option: { stack: { ...STACK } } });
  });

  it('loads base ADRs with sorted upstream display keys and the approved stack, and folds in feedback', async () => {
    const result = await generate({ projectId: 'project-1', feedback: 'Prefer serverless.' });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v', 'arch-v']);
    expect(getUpstreamDependenciesMock).toHaveBeenCalledWith({}, ['iv-adr-02', 'iv-adr-01']);
    expect(getSelectedOptionMock).toHaveBeenCalledWith('arch-v');
    expect(generateStructuredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: buildPrompt({
          requirements: expectedRequirements,
          baseDecisions: expectedBase,
          baseStack: STACK,
          feedback: 'Prefer serverless.',
        }),
      }),
    );
    expect(result.options).toEqual(toOptionInputs(generated));
    expect(result.runId).toBe('run-1');
  });

  it('throws, rather than showing a made-up stack, when the approved version has no selected option', async () => {
    getSelectedOptionMock.mockResolvedValue(null);
    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      'Approved Architecture version arch-v has no selected option',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it('throws when the approved option has a malformed stack descriptor', async () => {
    getSelectedOptionMock.mockResolvedValue({ option: { stack: { frontend: 'next.js' } } });
    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      /Approved Architecture version arch-v has a malformed stack descriptor/,
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});

describe('architecture.generate - threaded createDraftFromGeneration values (INV-006: one snapshot)', () => {
  // The project has been re-approved since the route captured its ids: both
  // "current approved" ids differ from the threaded ones.
  beforeEach(() => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v2', architecture: 'arch-v2' }),
    );
  });

  const inV1 = (rows: ReturnType<typeof member>[], sourceVersionId: string) =>
    rows.map((row) => ({ ...row, sourceVersionId }));

  it('loads the requirements from position 0 of the supplied ids and the captured base - never the project current approved ids', async () => {
    getSourceVersionMembersMock.mockResolvedValue([
      ...inV1(requirementMembers, 'req-v1'),
      member({
        sourceVersionId: 'arch-v1',
        displayKey: 'ADR-01',
        itemType: 'architecture_decision',
        itemVersionId: 'iv-adr-01',
        payload: {
          title: 'Persistence',
          decision: 'Store all data in one relational database.',
          technologyOrApproach: 'postgresql',
          constraints: [],
          significantTradeoffs: [],
        },
      }),
    ]);
    getUpstreamDependenciesMock.mockResolvedValue([
      { downstreamItemVersionId: 'iv-adr-01', upstreamDisplayKey: 'R-01' },
    ]);
    getSelectedOptionMock.mockResolvedValue({ option: { stack: { ...STACK } } });

    await generate({
      projectId: 'project-1',
      contextSourceVersionIds: ['req-v1'],
      baseVersionId: 'arch-v1',
    });

    expect(getSourceVersionMembersMock).toHaveBeenCalledTimes(1);
    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v1', 'arch-v1']);
    expect(getSelectedOptionMock).toHaveBeenCalledTimes(1);
    expect(getSelectedOptionMock).toHaveBeenCalledWith('arch-v1');
    expect(generateStructuredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: buildPrompt({
          requirements: expectedRequirements,
          baseDecisions: [
            {
              displayKey: 'ADR-01',
              title: 'Persistence',
              decision: 'Store all data in one relational database.',
              technologyOrApproach: 'postgresql',
              constraints: [],
              significantTradeoffs: [],
              upstreamRefs: ['R-01'],
            },
          ],
          baseStack: STACK,
        }),
      }),
    );
  });

  it('honours an explicit null base as a first generation even though the project now has an approved Architecture version', async () => {
    getSourceVersionMembersMock.mockResolvedValue(inV1(requirementMembers, 'req-v1'));

    await generate({
      projectId: 'project-1',
      contextSourceVersionIds: ['req-v1'],
      baseVersionId: null,
    });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v1']);
    expect(getUpstreamDependenciesMock).not.toHaveBeenCalled();
    expect(getSelectedOptionMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: buildPrompt({
          requirements: expectedRequirements,
          baseDecisions: [],
          baseStack: null,
        }),
      }),
    );
  });

  it('still runs the FR-080 refusal against the project when ids are supplied', async () => {
    getProjectByIdMock.mockResolvedValue(project({ requirements: null, architecture: null }));

    await expect(
      generate({ projectId: 'project-1', contextSourceVersionIds: ['req-v1'] }),
    ).rejects.toThrow('Architecture generation requires approved Requirements first (TR FR-080)');
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it.each([[[]], [['req-v1', 'arch-v1']]])(
    'rejects a context list of the wrong length (%j) before any model call',
    async (contextSourceVersionIds) => {
      await expect(generate({ projectId: 'project-1', contextSourceVersionIds })).rejects.toThrow(
        `Architecture generate expects exactly 1 context source version id (requirements), got ${contextSourceVersionIds.length}`,
      );
      expect(generateStructuredMock).not.toHaveBeenCalled();
      expect(withTxMock).not.toHaveBeenCalled();
    },
  );
});
