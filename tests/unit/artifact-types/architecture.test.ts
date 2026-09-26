import { beforeAll, describe, expect, it } from 'vitest';
// Test-only: `openai/helpers/zod` is a pure JSON-schema builder (no network
// call, no API key needed) and is the EXACT function
// src/ai-client/generate-structured.ts calls with the caller's schema - the
// only faithful regression guard against the `$ref`/`definitions`/prefixItems
// emission this schema was written to avoid (see the "distinct instances"
// comment in generation.ts). Project Setup 5.3 restricts the `openai` SDK
// import to src/ai-client - this is a deliberate, narrow deviation for that
// one converter function, in a test file, calling no API; not a precedent for
// importing `openai` itself anywhere outside ai-client.
import { zodResponseFormat } from 'openai/helpers/zod';
import type { OptionInput } from '@/architecture-materialization';
import type {
  ApprovedRequirementItem,
  ArchitectureGenerationContext,
  ArchitectureOptionOutput,
  ArchitectureOutput,
  BaseArchitectureDecision,
} from '@/artifact-types/architecture';

// Imported through the module's index.ts (Module Boundaries section 7), not by
// a deep import of ./generation - loaded dynamically in beforeAll, after the
// dummy env vars below are set, because the index also re-exports the
// DB-backed facade (@/architecture-materialization, @/artifact-lifecycle) and
// @/db/client calls `postgres(env.DATABASE_URL, ...)` at import time.
// Confirmed safe with dummy values by reading the source, not by running
// anything: `postgres()`'s constructor only builds its internal Connection
// queue (node_modules/.../postgres/src/index.js) - it defers the actual
// `c.connect(query)` call until a query is enqueued. Every function this file
// exercises (buildPrompt, outputSchema, toOptionInputs, toCandidates) is pure
// and issues no query, so no real Postgres connection is ever attempted. No
// vi.mock('@/db', ...) is needed as a result - unlike
// tests/unit/artifact-lifecycle/project.test.ts, which does call DB-touching
// functions.
let architecture: typeof import('@/artifact-types/architecture');

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/unit-test-unused';
  process.env.DIRECT_DATABASE_URL = 'postgres://user:pass@localhost:5432/unit-test-unused';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test';
  architecture = await import('@/artifact-types/architecture');
});

// `overrides` is deliberately loose: the negative cases below build options that
// are invalid on purpose (a stack missing a field, an extra key), which the
// real ArchitectureOptionOutput type would not let them express.
function option(title: string, overrides: Record<string, unknown> = {}): ArchitectureOptionOutput {
  const valid: ArchitectureOptionOutput = {
    title,
    summary: `${title} summary`,
    stack: {
      frontend: 'next.js + typescript',
      backend: 'next.js route handlers',
      database: 'postgresql',
      hosting: 'vercel',
      repositoryLayout: 'single repo',
    },
    tradeoffs: [
      { factor: 'delivery deadline', assessment: 'Eight days rules out a service split (R-03).' },
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
  return { ...valid, ...overrides };
}

function output(): ArchitectureOutput {
  return {
    payload: { summary: 'Two options for the project' },
    optionA: option('Option A title'),
    optionB: option('Option B title'),
  };
}

const requirements: ApprovedRequirementItem[] = [
  {
    displayKey: 'R-01',
    type: 'functional',
    actor: 'Manager',
    behavior: 'Review weekly reports',
    constraints: [],
    acceptanceCriteria: ['Reports list by date'],
    dimension: null,
    value: null,
  },
  {
    displayKey: 'R-02',
    type: 'constraint',
    actor: 'Team',
    behavior: 'Ship within the deadline',
    constraints: [],
    acceptanceCriteria: ['Delivered on time'],
    dimension: 'deadline',
    value: 'eight days from kickoff',
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

const baseDecisions: BaseArchitectureDecision[] = [
  {
    displayKey: 'ADR-01',
    title: 'Persistence',
    decision: 'Store all data in one relational database.',
    technologyOrApproach: 'postgresql',
    constraints: ['no second datastore'],
    significantTradeoffs: ['Single point of failure'],
    upstreamRefs: ['R-01', 'R-03'],
  },
  {
    displayKey: 'ADR-02',
    title: 'Deployment',
    decision: 'Deploy the app as one unit.',
    technologyOrApproach: 'vercel',
    constraints: [],
    significantTradeoffs: [],
    upstreamRefs: ['R-02'],
  },
];

const baseStack = {
  frontend: 'next.js + typescript',
  backend: 'next.js route handlers',
  database: 'postgresql',
  hosting: 'vercel',
  repositoryLayout: 'single repo',
};

const ctx = (
  overrides: Partial<ArchitectureGenerationContext> = {},
): ArchitectureGenerationContext => ({
  requirements,
  baseDecisions: [],
  baseStack: null,
  ...overrides,
});

describe('architecture outputSchema: exactly two options (FR-020, FR-021)', () => {
  it('FR-020: accepts exactly two valid options', () => {
    expect(architecture.outputSchema.safeParse(output()).success).toBe(true);
  });

  it('FR-020: rejects a missing option', () => {
    const { payload, optionA } = output();
    expect(architecture.outputSchema.safeParse({ payload, optionA }).success).toBe(false);
  });

  it('FR-020: rejects an extra option key (a third option)', () => {
    expect(
      architecture.outputSchema.safeParse({ ...output(), optionC: option('Option C') }).success,
    ).toBe(false);
  });

  it.each(['frontend', 'backend', 'database', 'hosting', 'repositoryLayout'] as const)(
    'FR-020: rejects an option whose stack descriptor is missing %s',
    (field) => {
      const stack = Object.fromEntries(
        Object.entries(option('x').stack).filter(([key]) => key !== field),
      );
      expect(
        architecture.outputSchema.safeParse({ ...output(), optionA: option('x', { stack }) })
          .success,
      ).toBe(false);
    },
  );

  it('FR-020: rejects a decision that lists no driving requirement (empty upstreamRefs)', () => {
    const base = option('x');
    const bad = option('x', {
      candidateDecisions: [{ ...base.candidateDecisions[0]!, upstreamRefs: [] }],
    });
    expect(architecture.outputSchema.safeParse({ ...output(), optionA: bad }).success).toBe(false);
  });

  it('FR-020: rejects an upstream ref that is not a requirement display key', () => {
    const base = option('x');
    const bad = option('x', {
      candidateDecisions: [{ ...base.candidateDecisions[0]!, upstreamRefs: ['not-a-display-key'] }],
    });
    expect(architecture.outputSchema.safeParse({ ...output(), optionA: bad }).success).toBe(false);
  });

  it('FR-020: rejects an option with no trade-offs', () => {
    expect(
      architecture.outputSchema.safeParse({ ...output(), optionA: option('x', { tradeoffs: [] }) })
        .success,
    ).toBe(false);
  });

  it('FR-020: rejects an option with no candidate decisions', () => {
    expect(
      architecture.outputSchema.safeParse({
        ...output(),
        optionA: option('x', { candidateDecisions: [] }),
      }).success,
    ).toBe(false);
  });

  it('FR-023 is P1-off: no requiredSkills field is declared, and one supplied is rejected', () => {
    const withSkills = { ...output(), optionA: { ...option('x'), requiredSkills: ['nestjs'] } };
    expect(architecture.outputSchema.safeParse(withSkills).success).toBe(false);
    const schema = zodResponseFormat(architecture.outputSchema, 'structured_output').json_schema
      .schema;
    expect(JSON.stringify(schema)).not.toContain('requiredSkills');
    const parsed = architecture.outputSchema.parse(output());
    expect(JSON.stringify(parsed)).not.toContain('requiredSkills');
  });

  it('FR-020: zodResponseFormat accepts the schema and yields a strict-mode-shaped JSON schema', () => {
    const format = zodResponseFormat(architecture.outputSchema, 'structured_output');
    expect(format.json_schema.strict).toBe(true);
    const schema = format.json_schema.schema as Record<string, unknown>;
    expect(schema.required).toEqual(['payload', 'optionA', 'optionB']);
    // Exactly two options without any array-length or tuple reliance.
    expect(JSON.stringify(schema)).not.toMatch(/prefixItems|\$ref|definitions/);
    // Strict mode: every object node lists all of its properties as required
    // and forbids extras.
    const objectNodes: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (record.properties) objectNodes.push(record);
        Object.values(record).forEach(walk);
      }
    };
    walk(schema);
    expect(objectNodes.length).toBeGreaterThan(5);
    for (const node of objectNodes) {
      expect(node.additionalProperties).toBe(false);
      expect(node.required).toEqual(Object.keys(node.properties as object));
    }
  });
});

describe('architecture toOptionInputs / toCandidates (FR-021)', () => {
  it('FR-021: returns the options in A then B order, assignable to createOptions input', () => {
    const tuple: [OptionInput, OptionInput] = architecture.toOptionInputs(output());
    expect(tuple.map((entry) => entry.title)).toEqual(['Option A title', 'Option B title']);
    expect(tuple[0]).toEqual(architecture.outputSchema.parse(output()).optionA);
    expect(tuple[1]).toEqual(architecture.outputSchema.parse(output()).optionB);
    // Identity is the A/B position - no model-supplied id rides along.
    for (const entry of tuple) expect(entry).not.toHaveProperty('id');
  });

  it('FR-020: toCandidates returns no lineage candidates (decisions are not items until approval)', () => {
    expect(architecture.toCandidates(output())).toEqual([]);
  });
});

describe('architecture buildPrompt (FR-020, FR-022)', () => {
  it('FR-020: first generation shows every requirement and constraint value and the FR-020 factors', () => {
    const prompt = architecture.buildPrompt(ctx());
    for (const item of requirements) expect(prompt).toContain(item.displayKey);
    expect(prompt).toContain('eight days from kickoff');
    expect(prompt).toContain('typescript and postgres only');
    expect(prompt).toContain('exactly two options');
    for (const factor of [
      'scale',
      'team skills',
      'delivery deadline',
      'maintainability',
      'cost',
      'deployment complexity',
      'security constraints',
      'operational complexity',
    ]) {
      expect(prompt).toContain(factor);
    }
    expect(prompt).toContain('Generic technology-comparison text');
    expect(prompt).toContain('ONLY these display keys');
    expect(prompt).toMatch(/no required-skills field/);
    for (const field of ['frontend', 'backend', 'database', 'hosting', 'repositoryLayout']) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("Set every decision's previousDisplayKey to null.");
  });

  it('FR-020: first generation does not carry the regenerate instructions or any base stack text', () => {
    const prompt = architecture.buildPrompt(ctx());
    expect(prompt).not.toContain('verbatim');
    expect(prompt).not.toContain('previous Architecture version');
    expect(prompt).not.toContain('ADR-01');
    expect(prompt).not.toContain('previously approved');
    expect(prompt).not.toContain('optionA CONTINUES');
  });

  it('FR-022: regenerate supplies each base decision verbatim, including upstreamRefs, and asks for previousDisplayKey', () => {
    const prompt = architecture.buildPrompt(ctx({ baseDecisions, baseStack }));
    for (const base of baseDecisions) {
      expect(prompt).toContain(base.displayKey);
      expect(prompt).toContain(base.title);
      expect(prompt).toContain(base.decision);
      expect(prompt).toContain(base.technologyOrApproach);
      expect(prompt).toContain(JSON.stringify(base.constraints));
      expect(prompt).toContain(JSON.stringify(base.significantTradeoffs));
      expect(prompt).toContain(JSON.stringify(base.upstreamRefs));
    }
    expect(prompt).toContain('unchanged and verbatim');
    expect(prompt).toContain('previousDisplayKey to the ADR display key');
    expect(prompt).not.toContain("Set every decision's previousDisplayKey to null.");
    // Still shows the requirements the decisions must be tied to.
    for (const item of requirements) expect(prompt).toContain(item.displayKey);
  });

  it('FR-022/ERD 5.5: regenerate shows the previously approved stack verbatim', () => {
    const prompt = architecture.buildPrompt(ctx({ baseDecisions, baseStack }));
    for (const value of Object.values(baseStack)) expect(prompt).toContain(value);
  });

  it('FR-022: states the single rule for which option continues the approved approach', () => {
    const prompt = architecture.buildPrompt(ctx({ baseDecisions, baseStack }));
    expect(prompt).toContain('optionA CONTINUES the previously approved approach');
    expect(prompt).toContain('optionB is the ALTERNATIVE');
  });

  it('ERD 5.5: throws when base decisions are supplied with no base stack (inconsistent input)', () => {
    expect(() => architecture.buildPrompt(ctx({ baseDecisions, baseStack: null }))).toThrow(
      'baseStack',
    );
  });

  it('FR-080: refuses to build a prompt with no approved requirements', () => {
    expect(() => architecture.buildPrompt(ctx({ requirements: [] }))).toThrow(
      'approved requirements',
    );
  });
});
