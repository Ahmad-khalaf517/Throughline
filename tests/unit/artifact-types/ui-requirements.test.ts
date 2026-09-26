import { describe, expect, it, vi } from 'vitest';

// artifact-types/ui-requirements (Module Boundaries 4.4, TR FR-040, Jira
// E3-S8/SCRUM-43) against outputSchema/buildPrompt/toCandidates - no
// database, no OpenAI call. The module's top-level imports pull in `@/db`
// (getUiRequirementsForPrompt's `withTx`) and `@/artifact-lifecycle`
// (generate's `getProjectById`), and both transitively import `@/lib/env`
// (eager-validated at import time, Project Setup section 7) - mocked here,
// same approach as tests/unit/artifact-lifecycle/project.test.ts, so this
// file loads with no DATABASE_URL set in the real process environment.
vi.mock('@/db', () => ({ withTx: vi.fn() }));
vi.mock('@/artifact-lifecycle', () => ({ getProjectById: vi.fn() }));

import { semanticHash, semanticProjection } from '@/lineage/identity';
import {
  buildPrompt,
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
