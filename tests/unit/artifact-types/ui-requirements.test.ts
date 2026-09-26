import { beforeEach, describe, expect, it, vi } from 'vitest';

// artifact-types/ui-requirements (Module Boundaries 4.4, TR FR-040, Jira
// E3-S8/SCRUM-43) against outputSchema/buildPrompt/toCandidates - no
// database, no OpenAI call. The module's top-level imports pull in `@/db`
// (getUiRequirementsForPrompt's `withTx`), `@/artifact-lifecycle` (generate's
// `getProjectById`) and `@/ai-client` (generate's `generateStructured`), and
// all three transitively import `@/lib/env` (eager-validated at import time,
// Project Setup section 7) - mocked here, same approach as
// tests/unit/artifact-lifecycle/project.test.ts, so this file loads with no
// DATABASE_URL set in the real process environment. `generate` (Jira E3-S10 /
// SCRUM-45) is exercised against those same mocks; `@/lineage/identity` stays
// real for `semanticHash`/`semanticProjection`, with only its two member/edge
// reads replaced.
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
vi.mock('@/artifact-lifecycle', () => ({ getProjectById: getProjectByIdMock }));
vi.mock('@/ai-client', () => ({ generateStructured: generateStructuredMock }));
vi.mock('@/lineage/identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lineage/identity')>()),
  getSourceVersionMembers: getSourceVersionMembersMock,
  getUpstreamDependencies: getUpstreamDependenciesMock,
}));

import { semanticHash, semanticProjection } from '@/lineage/identity';
import {
  buildPrompt,
  generate,
  outputSchema,
  toCandidates,
  type BaseUiRequirementItem,
  type UiRequirementItem,
  type UiRequirementsGenerationContext,
  type UiRequirementsOutput,
} from '@/artifact-types/ui-requirements';

// Typed builders for a valid output - each malformed case below is a valid
// output with one field overridden, or (for the two cases that break the
// *shape* rather than a value) a spread/copy whose result is only ever passed
// to `outputSchema.safeParse`, which accepts `unknown`, so those need no cast.
function validItem(overrides: Partial<UiRequirementItem> = {}): UiRequirementItem {
  return {
    displayKey: 'UI-01',
    previousDisplayKey: null,
    screenOrFlow: 'Dashboard',
    interactionRequirement: 'User views a summary of open items and can drill into any of them.',
    responsiveConstraints: ['Collapses to a single column below 768px'],
    accessibilityConstraints: ['All summary cards are keyboard-focusable'],
    upstreamRefs: ['R-01', 'ADR-01'],
    explanation: 'Drives visibility into project status.',
    ...overrides,
  };
}

function validOutput(overrides: Partial<UiRequirementsOutput> = {}): UiRequirementsOutput {
  return {
    payload: {
      targetUsers: ['Project managers'],
      navigationExpectations: 'A persistent sidebar links every screen.',
      rtlLocalizationRequirements: [],
      uxPriorities: ['Clarity over density'],
    },
    items: [validItem()],
    ...overrides,
  };
}

describe('artifact-types/ui-requirements.outputSchema (TR FR-040, ERD 5.4/5.6)', () => {
  it('accepts a valid output', () => {
    expect(outputSchema.safeParse(validOutput()).success).toBe(true);
  });

  it('rejects a malformed displayKey', () => {
    const output = validOutput({ items: [validItem({ displayKey: 'UI1' })] });
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects an upstreamRefs entry that is not an R-.. or ADR-.. display key', () => {
    const output = validOutput({ items: [validItem({ upstreamRefs: ['S-01'] })] });
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects more than 5 upstreamRefs (ERD 5.5 alert-fatigue discipline)', () => {
    const output = validOutput({
      items: [validItem({ upstreamRefs: ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06'] })],
    });
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it('accepts exactly 5 upstreamRefs and an empty upstreamRefs array', () => {
    const atMax = validOutput({
      items: [validItem({ upstreamRefs: ['R-01', 'R-02', 'R-03', 'ADR-01', 'ADR-02'] })],
    });
    expect(outputSchema.safeParse(atMax).success).toBe(true);

    const none = validOutput({ items: [validItem({ upstreamRefs: [] })] });
    expect(outputSchema.safeParse(none).success).toBe(true);
  });

  it('rejects empty items', () => {
    const output = validOutput({ items: [] });
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects more than 8 items', () => {
    const output = validOutput({
      items: Array.from({ length: 9 }, (_, i) =>
        validItem({ displayKey: `UI-${String(i + 1).padStart(2, '0')}` }),
      ),
    });
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects an unknown-shape payload', () => {
    const output = { ...validOutput(), payload: { wrongField: true } };
    expect(outputSchema.safeParse(output).success).toBe(false);
  });

  it('rejects a payload missing a required array field', () => {
    const payload: Partial<UiRequirementsOutput['payload']> = { ...validOutput().payload };
    delete payload.uxPriorities;
    const output = { ...validOutput(), payload };
    expect(outputSchema.safeParse(output).success).toBe(false);
  });
});

describe('artifact-types/ui-requirements.buildPrompt (ERD 5.4 regeneration stability)', () => {
  const baseCtx: UiRequirementsGenerationContext = {
    requirements: [
      {
        displayKey: 'R-01',
        type: 'functional',
        actor: 'Manager',
        behavior: 'Review project status',
        acceptanceCriteria: ['Shows current status'],
      },
    ],
    architectureDecisions: [
      { displayKey: 'ADR-01', decision: 'Use a single-page app', technologyOrApproach: 'Next.js' },
    ],
    baseItems: [],
  };

  it('first generation: lists upstream items and asks for previousDisplayKey null', () => {
    const prompt = buildPrompt(baseCtx);
    expect(prompt).toContain('R-01');
    expect(prompt).toContain('ADR-01');
    expect(prompt).toContain('Manager');
    expect(prompt).toContain('Use a single-page app');
    expect(prompt).toContain('previousDisplayKey');
    expect(prompt).toContain('fresh set');
    expect(prompt).not.toContain('already exist from that previous generation');
  });

  it('regeneration: shows base items verbatim, keyed by display key, and asks for them unchanged', () => {
    const baseItems: BaseUiRequirementItem[] = [
      {
        displayKey: 'UI-01',
        screenOrFlow: 'Dashboard',
        interactionRequirement: 'View metrics',
        responsiveConstraints: ['Stacks on mobile'],
        accessibilityConstraints: ['Focus visible'],
        upstreamRefs: ['R-01'],
      },
    ];
    const prompt = buildPrompt({ ...baseCtx, baseItems });

    // Upstream items still listed (so the model can only cite existing keys).
    expect(prompt).toContain('R-01');
    expect(prompt).toContain('ADR-01');

    // Base item shown verbatim, keyed by its display key.
    expect(prompt).toContain('UI-01');
    expect(prompt).toContain('Dashboard');
    expect(prompt).toContain('View metrics');
    expect(prompt).toContain(JSON.stringify(['Stacks on mobile']));
    expect(prompt).toContain(JSON.stringify(['Focus visible']));
    expect(prompt).toContain(JSON.stringify(['R-01']));

    expect(prompt).toContain('SAME items, unchanged and verbatim');
    expect(prompt).toContain('previousDisplayKey');
    expect(prompt).toContain('already exist from that previous generation');
  });

  it('a previously parsed UiRequirementItem satisfies BaseUiRequirementItem structurally', () => {
    const parsed: UiRequirementItem = {
      displayKey: 'UI-01',
      previousDisplayKey: null,
      screenOrFlow: 'Dashboard',
      interactionRequirement: 'View metrics',
      responsiveConstraints: [],
      accessibilityConstraints: [],
      upstreamRefs: ['R-01'],
      explanation: 'first pass',
    };
    const baseItems: BaseUiRequirementItem[] = [parsed];
    expect(() => buildPrompt({ ...baseCtx, baseItems })).not.toThrow();
  });
});

describe('artifact-types/ui-requirements.toCandidates (Module Boundaries 4.4)', () => {
  const items: UiRequirementItem[] = [
    {
      displayKey: 'UI-01',
      previousDisplayKey: 'UI-01',
      screenOrFlow: 'Dashboard',
      interactionRequirement: 'View metrics',
      responsiveConstraints: ['Stacks on mobile'],
      accessibilityConstraints: ['Focus visible'],
      upstreamRefs: ['R-01', 'ADR-01'],
      explanation: 'First pass',
    },
  ];

  it('maps fields, passes previousDisplayKey and upstreamRefs through, and does not leak displayKey into payload', () => {
    const [candidate] = toCandidates(items);
    expect(candidate).toEqual({
      previousDisplayKey: 'UI-01',
      payload: {
        screenOrFlow: 'Dashboard',
        interactionRequirement: 'View metrics',
        responsiveConstraints: ['Stacks on mobile'],
        accessibilityConstraints: ['Focus visible'],
        explanation: 'First pass',
      },
      upstreamRefs: ['R-01', 'ADR-01'],
    });
    expect(candidate!.payload).not.toHaveProperty('displayKey');
  });

  it('passes previousDisplayKey through as null on a first generation', () => {
    const [candidate] = toCandidates([{ ...items[0]!, previousDisplayKey: null }]);
    expect(candidate!.previousDisplayKey).toBeNull();
  });

  it('regeneration stability: two outputs differing only in explanation hash identically (ERD 5.4, INV-016)', () => {
    const first = toCandidates(items)[0]!;
    const second = toCandidates([{ ...items[0]!, explanation: 'Completely different prose.' }])[0]!;

    const upstreamIds = ['item-version-a', 'item-version-b'];
    expect(semanticHash('ui_requirement', first.payload, upstreamIds)).toBe(
      semanticHash('ui_requirement', second.payload, upstreamIds),
    );
  });

  it('semanticProjection does not throw for a toCandidates result and carries sorted upstream ids', () => {
    const [candidate] = toCandidates(items);
    const upstreamIds = ['item-version-b', 'item-version-a'];
    expect(() =>
      semanticProjection('ui_requirement', candidate!.payload, upstreamIds),
    ).not.toThrow();
    expect(
      semanticProjection('ui_requirement', candidate!.payload, upstreamIds).upstreamItemVersionIds,
    ).toEqual(['item-version-a', 'item-version-b']);
  });
});

// The one trailing paragraph every artifact-type module appends (same wording in
// all four - each module carries its own copy, so each unit test pins it).
const FEEDBACK_HEADER =
  'Reviewer feedback on the previous version - address it, even where that means changing an item you were told above to keep verbatim, and keep every unrelated item unchanged:';

describe('artifact-types/ui-requirements.buildPrompt - reviewer feedback (E3-S10)', () => {
  const ctx: UiRequirementsGenerationContext = {
    requirements: [
      {
        displayKey: 'R-01',
        type: 'functional',
        actor: 'Manager',
        behavior: 'Review project status',
        acceptanceCriteria: ['Shows current status'],
      },
    ],
    architectureDecisions: [
      { displayKey: 'ADR-01', decision: 'Use a single-page app', technologyOrApproach: 'Next.js' },
    ],
    baseItems: [],
  };
  const baseItem: BaseUiRequirementItem = {
    displayKey: 'UI-01',
    screenOrFlow: 'Dashboard',
    interactionRequirement: 'View metrics',
    responsiveConstraints: [],
    accessibilityConstraints: [],
    upstreamRefs: ['R-01'],
  };

  it('is byte-identical to the feedback-free prompt when feedback is absent, undefined or blank', () => {
    for (const baseItems of [[], [baseItem]]) {
      const plain = buildPrompt({ ...ctx, baseItems });
      for (const feedback of [undefined, '', '   \n\t ']) {
        expect(buildPrompt({ ...ctx, baseItems, feedback })).toBe(plain);
      }
    }
  });

  it('appends exactly one trailing paragraph carrying the trimmed feedback', () => {
    for (const baseItems of [[], [baseItem]]) {
      const plain = buildPrompt({ ...ctx, baseItems });
      expect(buildPrompt({ ...ctx, baseItems, feedback: '  Add a settings screen.  \n' })).toBe(
        `${plain}\n\n${FEEDBACK_HEADER}\nAdd a settings screen.`,
      );
    }
  });
});

describe('artifact-types/ui-requirements.generate (FR-080 refusal + E3-S10 loading)', () => {
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
  const member = (overrides: Record<string, unknown>) => ({
    sourceVersionId: 'req-v',
    logicalItemId: 'logical',
    itemVersionId: 'item-version',
    displayKey: 'R-01',
    itemType: 'requirement',
    payload: {},
    ...overrides,
  });
  const generated = validItem();

  beforeEach(() => {
    vi.resetAllMocks();
    withTxMock.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
    getSourceVersionMembersMock.mockResolvedValue([]);
    getUpstreamDependenciesMock.mockResolvedValue([]);
    generateStructuredMock.mockResolvedValue({
      data: validOutput({ items: [generated] }),
      runId: 'run-1',
    });
  });

  it('refuses when Requirements and Architecture are both unapproved, before any model call or transaction (T43)', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: null, architecture: null, ui_requirements: null }),
    );
    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      'UI Requirements generation requires approved Requirements and Architecture first (TR FR-080)',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it('names only the missing prerequisite', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v', architecture: null, ui_requirements: null }),
    );
    await expect(generate({ projectId: 'project-1' })).rejects.toThrow(
      'UI Requirements generation requires approved Architecture first (TR FR-080)',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(withTxMock).not.toHaveBeenCalled();
  });

  it('rejects an unknown project before any model call', async () => {
    getProjectByIdMock.mockResolvedValue(null);
    await expect(generate({ projectId: 'missing' })).rejects.toThrow(
      'Project missing does not exist',
    );
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it('first generation: sends the approved upstream items (numeric order) and no base, returns payload/candidates/runId', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v', architecture: 'arch-v', ui_requirements: null }),
    );
    getSourceVersionMembersMock.mockResolvedValue([
      member({
        displayKey: 'R-10',
        payload: {
          type: 'constraint',
          actor: 'Ops',
          behavior: 'Serve 5,000 users.',
          acceptanceCriteria: ['Load test passes.'],
        },
      }),
      member({
        displayKey: 'R-02',
        payload: {
          type: 'functional',
          actor: 'Manager',
          behavior: 'Review status.',
          acceptanceCriteria: ['Status shown.'],
        },
      }),
      member({
        sourceVersionId: 'arch-v',
        displayKey: 'ADR-01',
        itemType: 'architecture_decision',
        payload: { decision: 'Use a SPA', technologyOrApproach: 'Next.js', title: 'ignored' },
      }),
      // The all-null row of a version with no members: skipped.
      member({ displayKey: null, itemType: null, itemVersionId: null, payload: null }),
    ]);

    const result = await generate({ projectId: 'project-1' });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v', 'arch-v']);
    expect(getUpstreamDependenciesMock).not.toHaveBeenCalled();
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
    expect(generateStructuredMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      purpose: 'generation',
      prompt: buildPrompt({
        requirements: [
          {
            displayKey: 'R-02',
            type: 'functional',
            actor: 'Manager',
            behavior: 'Review status.',
            acceptanceCriteria: ['Status shown.'],
          },
          {
            displayKey: 'R-10',
            type: 'constraint',
            actor: 'Ops',
            behavior: 'Serve 5,000 users.',
            acceptanceCriteria: ['Load test passes.'],
          },
        ],
        architectureDecisions: [
          { displayKey: 'ADR-01', decision: 'Use a SPA', technologyOrApproach: 'Next.js' },
        ],
        baseItems: [],
      }),
      schema: outputSchema,
    });
    expect(result).toEqual({
      payload: validOutput().payload,
      candidates: toCandidates([generated]),
      runId: 'run-1',
    });
  });

  it('regeneration: base items carry real display keys and sorted, in-context upstreamRefs; feedback is folded in', async () => {
    getProjectByIdMock.mockResolvedValue(
      project({ requirements: 'req-v', architecture: 'arch-v', ui_requirements: 'ui-v' }),
    );
    getSourceVersionMembersMock.mockResolvedValue([
      member({ displayKey: 'R-02', payload: { type: 'functional', actor: 'M', behavior: 'B' } }),
      member({
        sourceVersionId: 'arch-v',
        displayKey: 'ADR-01',
        itemType: 'architecture_decision',
        payload: { decision: 'Use a SPA', technologyOrApproach: 'Next.js' },
      }),
      member({
        sourceVersionId: 'ui-v',
        displayKey: 'UI-02',
        itemType: 'ui_requirement',
        itemVersionId: 'iv-ui-02',
        payload: { screenOrFlow: 'Settings', interactionRequirement: 'Edit settings' },
      }),
      member({
        sourceVersionId: 'ui-v',
        displayKey: 'UI-01',
        itemType: 'ui_requirement',
        itemVersionId: 'iv-ui-01',
        payload: {
          screenOrFlow: 'Dashboard',
          interactionRequirement: 'View metrics',
          responsiveConstraints: ['Stacks on mobile'],
          accessibilityConstraints: ['Focus visible'],
        },
      }),
    ]);
    getUpstreamDependenciesMock.mockResolvedValue([
      { downstreamItemVersionId: 'iv-ui-01', upstreamDisplayKey: 'R-02' },
      { downstreamItemVersionId: 'iv-ui-01', upstreamDisplayKey: 'ADR-01' },
      // R-99 is no longer among the approved Requirements shown: dropped, so the
      // model is never told to return a reference that cannot be bound.
      { downstreamItemVersionId: 'iv-ui-01', upstreamDisplayKey: 'R-99' },
      { downstreamItemVersionId: 'iv-ui-01', upstreamDisplayKey: null },
    ]);

    const result = await generate({ projectId: 'project-1', feedback: 'Add a settings screen.' });

    expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v', 'arch-v', 'ui-v']);
    expect(getUpstreamDependenciesMock).toHaveBeenCalledWith({}, ['iv-ui-02', 'iv-ui-01']);
    expect(generateStructuredMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: buildPrompt({
          requirements: [
            {
              displayKey: 'R-02',
              type: 'functional',
              actor: 'M',
              behavior: 'B',
              acceptanceCriteria: [],
            },
          ],
          architectureDecisions: [
            { displayKey: 'ADR-01', decision: 'Use a SPA', technologyOrApproach: 'Next.js' },
          ],
          baseItems: [
            {
              displayKey: 'UI-01',
              screenOrFlow: 'Dashboard',
              interactionRequirement: 'View metrics',
              responsiveConstraints: ['Stacks on mobile'],
              accessibilityConstraints: ['Focus visible'],
              upstreamRefs: ['ADR-01', 'R-02'],
            },
            {
              displayKey: 'UI-02',
              screenOrFlow: 'Settings',
              interactionRequirement: 'Edit settings',
              responsiveConstraints: [],
              accessibilityConstraints: [],
              upstreamRefs: [],
            },
          ],
          feedback: 'Add a settings screen.',
        }),
      }),
    );
    expect(result.runId).toBe('run-1');
  });

  describe('threaded createDraftFromGeneration values (INV-006: one snapshot)', () => {
    // The project has been re-approved since the route captured its ids: every
    // "current approved" id below differs from the threaded one.
    beforeEach(() => {
      getProjectByIdMock.mockResolvedValue(
        project({ requirements: 'req-v2', architecture: 'arch-v2', ui_requirements: 'ui-v2' }),
      );
    });

    const requirementMember = member({
      sourceVersionId: 'req-v1',
      displayKey: 'R-02',
      payload: { type: 'functional', actor: 'M', behavior: 'B' },
    });
    const architectureMember = member({
      sourceVersionId: 'arch-v1',
      displayKey: 'ADR-01',
      itemType: 'architecture_decision',
      payload: { decision: 'Use a SPA', technologyOrApproach: 'Next.js' },
    });
    const baseMember = member({
      sourceVersionId: 'ui-v1',
      displayKey: 'UI-01',
      itemType: 'ui_requirement',
      itemVersionId: 'iv-ui-01',
      payload: { screenOrFlow: 'Dashboard', interactionRequirement: 'View metrics' },
    });

    it('maps [requirements, architecture] by position and loads them and the captured base - never the project current approved ids', async () => {
      getSourceVersionMembersMock.mockResolvedValue([
        requirementMember,
        architectureMember,
        baseMember,
      ]);
      getUpstreamDependenciesMock.mockResolvedValue([
        { downstreamItemVersionId: 'iv-ui-01', upstreamDisplayKey: 'R-02' },
      ]);

      await generate({
        projectId: 'project-1',
        contextSourceVersionIds: ['req-v1', 'arch-v1'],
        baseVersionId: 'ui-v1',
      });

      expect(getSourceVersionMembersMock).toHaveBeenCalledTimes(1);
      expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v1', 'arch-v1', 'ui-v1']);
      // Position 0 is Requirements and position 1 is Architecture: a swap would
      // leave both lists empty (each is filtered to its own source version).
      expect(generateStructuredMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: buildPrompt({
            requirements: [
              {
                displayKey: 'R-02',
                type: 'functional',
                actor: 'M',
                behavior: 'B',
                acceptanceCriteria: [],
              },
            ],
            architectureDecisions: [
              { displayKey: 'ADR-01', decision: 'Use a SPA', technologyOrApproach: 'Next.js' },
            ],
            baseItems: [
              {
                displayKey: 'UI-01',
                screenOrFlow: 'Dashboard',
                interactionRequirement: 'View metrics',
                responsiveConstraints: [],
                accessibilityConstraints: [],
                upstreamRefs: ['R-02'],
              },
            ],
          }),
        }),
      );
    });

    it('honours an explicit null base as a first generation even though the project now has an approved UI Requirements version', async () => {
      getSourceVersionMembersMock.mockResolvedValue([requirementMember, architectureMember]);

      await generate({
        projectId: 'project-1',
        contextSourceVersionIds: ['req-v1', 'arch-v1'],
        baseVersionId: null,
      });

      expect(getSourceVersionMembersMock).toHaveBeenCalledWith({}, ['req-v1', 'arch-v1']);
      expect(getUpstreamDependenciesMock).not.toHaveBeenCalled();
    });

    it('still runs the FR-080 refusal against the project when ids are supplied', async () => {
      getProjectByIdMock.mockResolvedValue(
        project({ requirements: null, architecture: null, ui_requirements: null }),
      );

      await expect(
        generate({ projectId: 'project-1', contextSourceVersionIds: ['req-v1', 'arch-v1'] }),
      ).rejects.toThrow(
        'UI Requirements generation requires approved Requirements and Architecture first (TR FR-080)',
      );
      expect(generateStructuredMock).not.toHaveBeenCalled();
      expect(withTxMock).not.toHaveBeenCalled();
    });

    it.each([[[]], [['req-v1']], [['req-v1', 'arch-v1', 'ui-v1']]])(
      'rejects a context list of the wrong length (%j) before any model call',
      async (contextSourceVersionIds) => {
        await expect(generate({ projectId: 'project-1', contextSourceVersionIds })).rejects.toThrow(
          `UI Requirements generate expects exactly 2 context source version ids (requirements, architecture), got ${contextSourceVersionIds.length}`,
        );
        expect(generateStructuredMock).not.toHaveBeenCalled();
        expect(withTxMock).not.toHaveBeenCalled();
      },
    );
  });
});
