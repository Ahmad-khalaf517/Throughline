import { describe, expect, it, vi } from 'vitest';

// Pure-function coverage only (outputSchema/toCandidates/buildPrompt) - no
// DB, same shape as tests/unit/identity-projection.test.ts. `qualityGate`
// and `generate` both read persisted rows through `identity`/
// `artifact-lifecycle` and are covered instead by
// tests/integration/backlog-quality-gate.test.ts (a real Postgres, per this
// story's own instructions: qualityGate cannot be exercised meaningfully as
// a pure unit test).
//
// `@/artifact-types/backlog` imports `@/ai-client` (`generateStructured`)
// directly, and `@/ai-client/generate-structured.ts` imports `@/lib/env` on
// its own path (independent of `@/db/client`) - `@/lib/env` does eager,
// throwing validation of required env vars at import time
// (DATABASE_URL/Supabase vars, see that file's own header comment), so both
// `@/db/client` and `@/lib/env` need mocking here, not just `@/db/client`
// the way tests/unit/identity-projection.test.ts (which never reaches
// ai-client) gets away with.
vi.mock('@/db/client', () => ({ db: {} }));
vi.mock('@/lib/env', () => ({
  env: {
    DATABASE_URL: 'postgres://test/test',
    DIRECT_DATABASE_URL: 'postgres://test/test',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.test',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    NEXT_PUBLIC_SITE_URL: 'https://example.test',
  },
}));

import * as backlog from '@/artifact-types/backlog';
import type { BacklogGenerationContext } from '@/artifact-types/backlog';

const validEpic = {
  kind: 'epic' as const,
  displayKey: 'E-01',
  previousDisplayKey: null,
  title: 'Article search',
  scopeStatement: 'Everything needed for a reader to find an article.',
  explanation: 'Groups the search-related stories.',
};

const validStory = {
  kind: 'story' as const,
  displayKey: 'S-01',
  previousDisplayKey: null,
  parentDisplayKey: 'E-01',
  userValueStatement: 'As a reader, I want to search articles, so that I can find what I need.',
  acceptanceCriteria: [] as string[],
  structuredBehavior: 'Typing a query filters the visible article list.',
  priority: 'medium' as const,
  upstreamRefs: ['R-01'],
  explanation: 'Implements the search requirement.',
};

describe('backlog.outputSchema (TR FR-060/061/062; ERD 5.4)', () => {
  it('accepts a valid Epic and Story, including an empty acceptanceCriteria array (FR-063)', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validEpic, validStory],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed Epic display key', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [{ ...validEpic, displayKey: 'S-01' }, validStory],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Story with no parentDisplayKey', () => {
    const storyWithoutParent: Record<string, unknown> = { ...validStory };
    delete storyWithoutParent.parentDisplayKey;
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validEpic, storyWithoutParent],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed Story parent display key', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validEpic, { ...validStory, parentDisplayKey: 'X-01' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Story whose parentDisplayKey matches no Epic label in the same output', () => {
    // Well-formed (E-02 passes the display-key regex) but no Epic in THIS
    // output is labelled E-02 - a label is only meaningful inside one
    // response, so this must fail before any persistence work.
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validEpic, { ...validStory, parentDisplayKey: 'E-02' }],
    });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes('matches no Epic displayKey'))).toBe(true);
  });

  it('rejects duplicate Epic labels within one output', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validEpic, { ...validEpic, title: 'Another epic' }, validStory],
    });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
    expect(messages.some((message) => message.includes('Duplicate Epic displayKey'))).toBe(true);
  });

  it('accepts Stories under different Epics when each parentDisplayKey names an Epic in the output', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [
        validEpic,
        { ...validEpic, displayKey: 'E-02', title: 'Accounts' },
        validStory,
        { ...validStory, displayKey: 'S-02', parentDisplayKey: 'E-02' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a backlog with only Epics (FR-060 requires both)', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validEpic, { ...validEpic, displayKey: 'E-02' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a backlog with only Stories (FR-060 requires both)', () => {
    const result = backlog.outputSchema.safeParse({
      payload: { summary: 'v1' },
      items: [validStory, { ...validStory, displayKey: 'S-02' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('backlog.toCandidates (Module Boundaries 4.4)', () => {
  it('sets itemType/upstreamRefs for both kinds and omits parentDisplayKey for Epics', () => {
    const [epicCandidate, storyCandidate] = backlog.toCandidates([validEpic, validStory]);

    expect(epicCandidate).toMatchObject({
      itemType: 'epic',
      previousDisplayKey: null,
      upstreamRefs: [],
    });
    expect('parentDisplayKey' in epicCandidate!).toBe(false);

    expect(storyCandidate).toMatchObject({
      itemType: 'story',
      previousDisplayKey: null,
      parentDisplayKey: 'E-01',
      upstreamRefs: ['R-01'],
    });
    expect(storyCandidate!.payload).toMatchObject({
      userValueStatement: validStory.userValueStatement,
      acceptanceCriteria: [],
      structuredBehavior: validStory.structuredBehavior,
      priority: 'medium',
    });
  });

  it('sets outputKey (the output-local label) on Epics only, leaving a Story parentDisplayKey as that label', () => {
    const [epicCandidate, storyCandidate] = backlog.toCandidates([
      { ...validEpic, displayKey: 'E-07' },
      { ...validStory, parentDisplayKey: 'E-07' },
    ]);

    expect(epicCandidate!.outputKey).toBe('E-07');
    // No real display key exists before the Epics are persisted - the Story
    // keeps the LABEL; createDraftFromGeneration rewrites it to the real key.
    expect(storyCandidate!.parentDisplayKey).toBe('E-07');
    expect('outputKey' in storyCandidate!).toBe(false);
  });
});

describe('backlog.buildPrompt (ERD 5.4 regeneration-stability technique)', () => {
  const baseContext: BacklogGenerationContext = {
    brief: 'A personal blog platform.',
    requirements: [
      {
        displayKey: 'R-01',
        itemType: 'requirement',
        summary: '[functional] Reader search articles',
      },
    ],
    architectureDecisions: [],
    uiRequirements: [],
    baseEpics: [],
    baseStories: [],
  };

  it('omits base items and asks for a fresh backlog on a first-ever generation', () => {
    const prompt = backlog.buildPrompt(baseContext);
    expect(prompt).toContain('Return a fresh backlog');
    expect(prompt).toContain('R-01');
    expect(prompt).not.toContain('already exist from that previous generation');
  });

  it('includes existing Epics/Stories verbatim and asks for them back unchanged on a regenerate call', () => {
    const regenerateContext: BacklogGenerationContext = {
      ...baseContext,
      baseEpics: [
        { displayKey: 'E-01', title: 'Article search', scopeStatement: 'Finding articles.' },
      ],
      baseStories: [
        {
          displayKey: 'S-01',
          parentDisplayKey: 'E-01',
          userValueStatement: validStory.userValueStatement,
          acceptanceCriteria: [],
          structuredBehavior: validStory.structuredBehavior,
          priority: null,
          upstreamRefs: ['R-01'],
        },
      ],
    };
    const prompt = backlog.buildPrompt(regenerateContext);
    expect(prompt).toContain('already exist from that previous generation');
    expect(prompt).toContain('E-01');
    expect(prompt).toContain('Article search');
    expect(prompt).toContain('S-01');
    expect(prompt).toContain('parent E-01');
    expect(prompt).toContain('Return the SAME items, unchanged and verbatim');
    expect(prompt).not.toContain('Return a fresh backlog');
  });

  it("drops a base Story's upstreamRef that is absent from the current context, keeping the present ones", () => {
    // R-09 was removed from the approved Requirements since S-01 was
    // generated (its stored edge still points at it); ADR-01/UI-01 remain.
    // Rendering R-09 verbatim would tell the model to return a ref
    // dependency-binding cannot resolve, breaking regeneration as a repair path.
    const prompt = backlog.buildPrompt({
      ...baseContext,
      architectureDecisions: [
        {
          displayKey: 'ADR-01',
          itemType: 'architecture_decision',
          summary: 'Use Postgres (Postgres)',
        },
      ],
      uiRequirements: [
        { displayKey: 'UI-01', itemType: 'ui_requirement', summary: 'Search page: filter' },
      ],
      baseEpics: [
        { displayKey: 'E-01', title: 'Article search', scopeStatement: 'Finding articles.' },
      ],
      baseStories: [
        {
          displayKey: 'S-01',
          parentDisplayKey: 'E-01',
          userValueStatement: validStory.userValueStatement,
          acceptanceCriteria: [],
          structuredBehavior: validStory.structuredBehavior,
          priority: null,
          upstreamRefs: ['R-01', 'R-09', 'ADR-01', 'UI-01'],
        },
      ],
    });
    expect(prompt).toContain('upstreamRefs: ["R-01","ADR-01","UI-01"]');
    expect(prompt).not.toContain('R-09');
  });
});

// The one trailing paragraph every artifact-type module appends (same wording in
// all four - each module carries its own copy, so each unit test pins it).
const FEEDBACK_HEADER =
  'Reviewer feedback on the previous version - address it, even where that means changing an item you were told above to keep verbatim, and keep every unrelated item unchanged:';

describe('backlog.buildPrompt - reviewer feedback (E3-S10)', () => {
  const firstContext: BacklogGenerationContext = {
    brief: 'A personal blog platform.',
    requirements: [
      { displayKey: 'R-01', itemType: 'requirement', summary: '[functional] Reader search' },
    ],
    architectureDecisions: [],
    uiRequirements: [],
    baseEpics: [],
    baseStories: [],
  };
  const regenerateContext: BacklogGenerationContext = {
    ...firstContext,
    baseEpics: [
      { displayKey: 'E-01', title: 'Article search', scopeStatement: 'Finding articles.' },
    ],
    baseStories: [
      {
        displayKey: 'S-01',
        parentDisplayKey: 'E-01',
        userValueStatement: validStory.userValueStatement,
        acceptanceCriteria: [],
        structuredBehavior: validStory.structuredBehavior,
        priority: null,
        upstreamRefs: ['R-01'],
      },
    ],
  };

  it('is byte-identical to the feedback-free prompt when feedback is absent, undefined or blank', () => {
    for (const context of [firstContext, regenerateContext]) {
      const plain = backlog.buildPrompt(context);
      for (const feedback of [undefined, '', '   \n\t ']) {
        expect(backlog.buildPrompt({ ...context, feedback })).toBe(plain);
      }
    }
  });

  it('appends exactly one trailing paragraph carrying the trimmed feedback', () => {
    for (const context of [firstContext, regenerateContext]) {
      const plain = backlog.buildPrompt(context);
      expect(backlog.buildPrompt({ ...context, feedback: '  Split S-01 in two.  \n' })).toBe(
        `${plain}\n\n${FEEDBACK_HEADER}\nSplit S-01 in two.`,
      );
    }
  });
});
