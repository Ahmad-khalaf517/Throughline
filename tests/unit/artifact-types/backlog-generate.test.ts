import { beforeEach, describe, expect, it, vi } from 'vitest';

// artifact-types/backlog `generate` (E3-S9's implementation; Jira E3-S10 /
// SCRUM-45 added the optional reviewer `feedback` passthrough): the FR-080
// refusal happens before any model call or transaction, and `feedback` reaches
// the prompt - and only when supplied. The context-loading queries themselves
// are covered against a real database by tests/integration/backlog-generation.test.ts
// and backlog-quality-gate.test.ts; here every collaborator is mocked with a
// factory so the real modules (which load `@/lib/env` at import) never load.
const {
  withTxMock,
  getProjectByIdMock,
  generateStructuredMock,
  getSourceVersionMembersMock,
  getUpstreamDependenciesMock,
} = vi.hoisted(() => ({
  withTxMock: vi.fn(),
  getProjectByIdMock: vi.fn(),
  generateStructuredMock: vi.fn(),
  getSourceVersionMembersMock: vi.fn(),
  getUpstreamDependenciesMock: vi.fn(),
}));

vi.mock('@/db', () => ({ withTx: withTxMock }));
vi.mock('@/ai-client', () => ({ generateStructured: generateStructuredMock }));
vi.mock('@/artifact-lifecycle', () => ({ getProjectById: getProjectByIdMock }));
vi.mock('@/lineage/identity', () => ({
  getSourceVersionMembers: getSourceVersionMembersMock,
  getUpstreamDependencies: getUpstreamDependenciesMock,
}));

import {
  buildPrompt,
  generate,
  outputSchema,
  toCandidates,
  type BacklogItem,
} from '@/artifact-types/backlog';

const project = (approved: {
  requirements: string | null;
  architecture: string | null;
  ui_requirements: string | null;
}) => ({
  id: 'project-1',
  brief: 'A brief.',
  artifacts: {
    requirements: { approvedVersionId: approved.requirements, draftVersionId: null },
    architecture: { approvedVersionId: approved.architecture, draftVersionId: null },
    ui_requirements: { approvedVersionId: approved.ui_requirements, draftVersionId: null },
    backlog: { approvedVersionId: null, draftVersionId: null },
  },
});

const items: BacklogItem[] = [
  {
    kind: 'epic',
    displayKey: 'E-01',
    previousDisplayKey: null,
    title: 'Article search',
    scopeStatement: 'Everything needed to find an article.',
    explanation: 'Groups the search stories.',
  },
  {
    kind: 'story',
    displayKey: 'S-01',
    previousDisplayKey: null,
    parentDisplayKey: 'E-01',
    userValueStatement: 'As a reader, I want to search, so that I find articles.',
    acceptanceCriteria: ['Results update as I type'],
    structuredBehavior: 'Typing filters the list.',
    priority: 'medium',
    upstreamRefs: ['R-01'],
    explanation: 'Implements search.',
  },
];

const emptyContext = {
  brief: 'A brief.',
  requirements: [],
  architectureDecisions: [],
  uiRequirements: [],
  baseEpics: [],
  baseStories: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  withTxMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  getSourceVersionMembersMock.mockResolvedValue([]);
  getUpstreamDependenciesMock.mockResolvedValue([]);
  generateStructuredMock.mockResolvedValue({
    data: { payload: { summary: 'v1' }, items },
    runId: 'run-1',
  });
});

describe('backlog.generate - FR-080 refusal', () => {
  it('names every missing prerequisite, before any model call or transaction', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: null, architecture: null, ui_requirements: null }),
    );
    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      'Backlog generation requires approved Requirements, Architecture, UI Requirements first (TR FR-080)',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it('refuses when only UI Requirements is missing', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v', architecture: 'arch-v', ui_requirements: null }),
    );
    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      'Backlog generation requires approved UI Requirements first (TR FR-080)',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });
});

describe('backlog.generate - reviewer feedback passthrough (E3-S10)', () => {
  beforeEach(() => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v', architecture: 'arch-v', ui_requirements: 'ui-v' }),
    );
  });

  it('without feedback the prompt is exactly the feedback-free prompt; returns payload/candidates/runId', async () => {
    const result = await generate({ projectId: 'project-1' });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v', 'arch-v', 'ui-v']);
    expect(generateStructuredMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      purpose: 'generation',
      prompt: buildPrompt(emptyContext),
      schema: outputSchema,
    });
    expect(result).toEqual({
      payload: { summary: 'v1' },
      candidates: toCandidates(items),
      runId: 'run-1',
    });
  });

  it('with feedback the prompt carries it as the trailing paragraph', async () => {
    await generate({ projectId: 'project-1', feedback: 'Split S-01 in two.' });

    const { prompt } = generateStructuredMock.mock.calls[0]![0] as { prompt: string };
    expect(prompt).toBe(buildPrompt({ ...emptyContext, feedback: 'Split S-01 in two.' }));
    expect(prompt.endsWith('\nSplit S-01 in two.')).toBe(true);
    expect(prompt).not.toBe(buildPrompt(emptyContext));
  });
});

const member = (overrides: Record<string, unknown>) => ({
  sourceVersionId: 'req-v',
  logicalItemId: 'logical',
  itemVersionId: 'item-version',
  displayKey: 'R-01',
  itemType: 'requirement',
  parentLogicalItemId: null,
  payload: {},
  ...overrides,
});

const projectWithBacklog = (
  approved: { requirements: string; architecture: string; ui_requirements: string },
  backlog: string | null,
) => {
  const base = project(approved);
  return {
    ...base,
    artifacts: { ...base.artifacts, backlog: { approvedVersionId: backlog, draftVersionId: null } },
  };
};

describe('backlog.generate - threaded createDraftFromGeneration values (INV-006: one snapshot)', () => {
  // The project has been re-approved since the route captured its ids: every
  // "current approved" id differs from the threaded one.
  const reapproved = { requirements: 'req-v2', architecture: 'arch-v2', ui_requirements: 'ui-v2' };
  const threaded = ['req-v1', 'arch-v1', 'ui-v1'];

  it('loads the supplied context ids and the captured base - never the project current approved ids', async () => {
    getProjectByIdMock.mockResolvedValue(projectWithBacklog(reapproved, 'bl-v2'));

    await generate({
      projectId: 'project-1',
      contextSourceVersionIds: threaded,
      baseVersionId: 'bl-v1',
    });

    expect(getSourceVersionMembersMock).toHaveBeenCalledTimes(1);
    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, [...threaded, 'bl-v1']);
  });

  it('classifies the supplied versions by item type, not by position: the members of every supplied version reach the prompt', async () => {
    getProjectByIdMock.mockResolvedValue(projectWithBacklog(reapproved, null));
    getSourceVersionMembersMock.mockResolvedValue([
      member({
        sourceVersionId: 'req-v1',
        displayKey: 'R-01',
        payload: { type: 'functional', actor: 'Ann', behavior: 'one' },
      }),
      member({
        sourceVersionId: 'arch-v1',
        displayKey: 'ADR-01',
        itemType: 'architecture_decision',
        payload: { decision: 'one', technologyOrApproach: 'x1' },
      }),
      member({
        sourceVersionId: 'ui-v1',
        displayKey: 'UI-01',
        itemType: 'ui_requirement',
        payload: { screenOrFlow: 'One', interactionRequirement: 'one it' },
      }),
    ]);

    await generate({
      projectId: 'project-1',
      contextSourceVersionIds: threaded,
      baseVersionId: null,
    });

    expect(generateStructuredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: buildPrompt({
          ...emptyContext,
          requirements: [
            { displayKey: 'R-01', itemType: 'requirement', summary: '[functional] Ann one' },
          ],
          architectureDecisions: [
            { displayKey: 'ADR-01', itemType: 'architecture_decision', summary: 'one (x1)' },
          ],
          uiRequirements: [
            { displayKey: 'UI-01', itemType: 'ui_requirement', summary: 'One: one it' },
          ],
        }),
      }),
    );
  });

  it('honours an explicit null base as a first generation even though the project now has an approved Backlog', async () => {
    getProjectByIdMock.mockResolvedValue(projectWithBacklog(reapproved, 'bl-v2'));

    await generate({
      projectId: 'project-1',
      contextSourceVersionIds: threaded,
      baseVersionId: null,
    });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, threaded);
    expect(getUpstreamDependenciesMock).not.toHaveBeenCalled();
  });

  it('still runs the FR-080 refusal against the project when ids are supplied', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: null, architecture: null, ui_requirements: null }),
    );

    await expect(
      generate({ projectId: 'project-1', contextSourceVersionIds: threaded }),
    ).rejects.toThrow(
      'Backlog generation requires approved Requirements, Architecture, UI Requirements first (TR FR-080)',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it.each([[[]], [['req-v1', 'arch-v1']], [['req-v1', 'arch-v1', 'ui-v1', 'extra']]])(
    'rejects a context list of the wrong length (%j) before any model call',
    async (contextSourceVersionIds) => {
      getProjectByIdMock.mockResolvedValue(projectWithBacklog(reapproved, null));

      await expect(generate({ projectId: 'project-1', contextSourceVersionIds })).rejects.toThrow(
        `Backlog generate expects exactly 3 context source version ids (requirements, architecture, ui_requirements), got ${contextSourceVersionIds.length}`,
      );
      expect(generateStructuredMock).not.toHaveBeenCalled();
      expect(withTxMock).not.toHaveBeenCalled();
    },
  );
});

describe('backlog.generate - the prompt is a pure function of the stored items, not of row order (T21)', () => {
  // `getSourceVersionMembers` and `getUpstreamDependencies` have no ORDER BY, so
  // the same stored state can come back in any order. Numeric keys (R-10 vs R-2)
  // make a plain string sort and a numeric-aware one disagree.
  const members = [
    member({
      sourceVersionId: 'req-v',
      displayKey: 'R-10',
      payload: { type: 'functional', actor: 'Ann', behavior: 'ten' },
    }),
    member({
      sourceVersionId: 'req-v',
      displayKey: 'R-2',
      payload: { type: 'functional', actor: 'Ann', behavior: 'two' },
    }),
    member({
      sourceVersionId: 'arch-v',
      displayKey: 'ADR-10',
      itemType: 'architecture_decision',
      payload: { decision: 'ten', technologyOrApproach: 'x10' },
    }),
    member({
      sourceVersionId: 'arch-v',
      displayKey: 'ADR-2',
      itemType: 'architecture_decision',
      payload: { decision: 'two', technologyOrApproach: 'x2' },
    }),
    member({
      sourceVersionId: 'ui-v',
      displayKey: 'UI-10',
      itemType: 'ui_requirement',
      payload: { screenOrFlow: 'Ten', interactionRequirement: 'ten it' },
    }),
    member({
      sourceVersionId: 'ui-v',
      displayKey: 'UI-2',
      itemType: 'ui_requirement',
      payload: { screenOrFlow: 'Two', interactionRequirement: 'two it' },
    }),
    member({
      sourceVersionId: 'bl-v',
      displayKey: 'E-10',
      itemType: 'epic',
      logicalItemId: 'l-e10',
      payload: { title: 'Ten', scopeStatement: 'ten scope' },
    }),
    member({
      sourceVersionId: 'bl-v',
      displayKey: 'E-2',
      itemType: 'epic',
      logicalItemId: 'l-e2',
      payload: { title: 'Two', scopeStatement: 'two scope' },
    }),
    member({
      sourceVersionId: 'bl-v',
      displayKey: 'S-10',
      itemType: 'story',
      logicalItemId: 'l-s10',
      itemVersionId: 'iv-s10',
      parentLogicalItemId: 'l-e10',
      payload: { userValueStatement: 'ten story' },
    }),
    member({
      sourceVersionId: 'bl-v',
      displayKey: 'S-2',
      itemType: 'story',
      logicalItemId: 'l-s2',
      itemVersionId: 'iv-s2',
      parentLogicalItemId: 'l-e2',
      payload: { userValueStatement: 'two story' },
    }),
  ];
  const dependencies = [
    { downstreamItemVersionId: 'iv-s10', upstreamDisplayKey: 'R-3' },
    { downstreamItemVersionId: 'iv-s10', upstreamDisplayKey: 'R-2' },
    { downstreamItemVersionId: 'iv-s2', upstreamDisplayKey: 'ADR-2' },
    { downstreamItemVersionId: 'iv-s2', upstreamDisplayKey: null },
  ];

  const story = (displayKey: string, parentDisplayKey: string, text: string, refs: string[]) => ({
    displayKey,
    parentDisplayKey,
    userValueStatement: text,
    acceptanceCriteria: [],
    structuredBehavior: '',
    priority: null,
    upstreamRefs: refs,
  });
  const expectedPrompt = buildPrompt({
    brief: 'A brief.',
    requirements: [
      { displayKey: 'R-2', itemType: 'requirement', summary: '[functional] Ann two' },
      { displayKey: 'R-10', itemType: 'requirement', summary: '[functional] Ann ten' },
    ],
    architectureDecisions: [
      { displayKey: 'ADR-2', itemType: 'architecture_decision', summary: 'two (x2)' },
      { displayKey: 'ADR-10', itemType: 'architecture_decision', summary: 'ten (x10)' },
    ],
    uiRequirements: [
      { displayKey: 'UI-2', itemType: 'ui_requirement', summary: 'Two: two it' },
      { displayKey: 'UI-10', itemType: 'ui_requirement', summary: 'Ten: ten it' },
    ],
    baseEpics: [
      { displayKey: 'E-2', title: 'Two', scopeStatement: 'two scope' },
      { displayKey: 'E-10', title: 'Ten', scopeStatement: 'ten scope' },
    ],
    baseStories: [
      story('S-2', 'E-2', 'two story', ['ADR-2']),
      story('S-10', 'E-10', 'ten story', ['R-2', 'R-3']),
    ],
  });

  const permutations: [string, <T>(rows: T[]) => T[]][] = [
    ['as stored', (rows) => [...rows]],
    ['reversed', (rows) => [...rows].reverse()],
    ['rotated by three', (rows) => [...rows.slice(3), ...rows.slice(0, 3)]],
  ];

  it.each(permutations)(
    'builds the identical, numeric-aware sorted prompt when the rows come back %s',
    async (_name, permute) => {
      getProjectByIdMock.mockResolvedValue(
        projectWithBacklog(
          { requirements: 'req-v', architecture: 'arch-v', ui_requirements: 'ui-v' },
          'bl-v',
        ),
      );
      getSourceVersionMembersMock.mockResolvedValue(permute(members));
      getUpstreamDependenciesMock.mockResolvedValue(permute(dependencies));

      await generate({ projectId: 'project-1' });

      expect(generateStructuredMock).toHaveBeenCalledTimes(1);
      const { prompt } = generateStructuredMock.mock.calls[0]![0] as { prompt: string };
      expect(prompt).toBe(expectedPrompt);
    },
  );
});
