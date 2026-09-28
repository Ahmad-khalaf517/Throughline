import { describe, expect, it } from 'vitest';
import {
  buildAdrDoc,
  buildReadme,
  type AdrForDocs,
  type SelectedForDocs,
} from '@/external/github/repo-docs';

// Pure builders (no DB, no network) for the README and ADR files `initRepo`
// commits. Fixtures mirror the real rows from the ShiftSwap demo project: an
// Architecture option with a five-field stack descriptor, and ADR item
// versions whose payload carries title / decision / technologyOrApproach /
// constraints / significantTradeoffs.

const VERSION_ID = 'c7a54067-af43-4454-b7b3-4046998a4015';

function selected(overrides: Partial<SelectedForDocs['option']> = {}): SelectedForDocs {
  return {
    versionNumber: 2,
    option: {
      optionKey: 'A',
      title: 'Django Modular Monolith',
      summary: 'A server-rendered Django application handles the swap workflow in one service.',
      stack: {
        frontend: 'Django templates with HTMX',
        backend: 'Django',
        database: 'PostgreSQL',
        hosting: 'Render',
        repositoryLayout: 'Single repository, one Django project',
      },
      tradeoffs: [
        { factor: 'Deployment complexity', assessment: 'One deployable unit, simple to operate.' },
        { factor: 'Front-end interactivity', assessment: 'Limited compared with a SPA.' },
      ],
      ...overrides,
    },
  };
}

function adr(overrides: Partial<AdrForDocs> = {}): AdrForDocs {
  return {
    displayKey: 'ADR-01',
    logicalItemId: '2c95e1a7-7adb-45a5-89f8-8709e26bfd2b',
    itemVersionId: 'a7ddef86-5300-4b68-ad12-3dff0f704969',
    payload: {
      title: 'Server-rendered workflow',
      decision: 'Use Django templates with HTMX for employee and manager workflow screens.',
      technologyOrApproach: 'Django templates with HTMX',
      constraints: ['Provide submission, manager review, and employee status views.'],
      significantTradeoffs: [
        'Keeps the UI and workflow in one application rather than a separately deployed frontend.',
      ],
    },
    ...overrides,
  };
}

const readmeArgs = () => ({
  selected: selected(),
  mode: 'docs-only' as const,
  starter: null,
  architectureVersionId: VERSION_ID,
  adrItems: [adr(), adr({ displayKey: 'ADR-02' })],
});

describe('buildReadme', () => {
  it('opens with the option title, the honest mode note, and the summary', () => {
    const readme = buildReadme(readmeArgs());

    expect(readme.startsWith('# Django Modular Monolith\n')).toBe(true);
    expect(readme).toContain('initialization mode: **docs-only**');
    expect(readme).toContain('documentation only - no application code was generated');
    expect(readme).toContain('A server-rendered Django application handles the swap workflow');
  });

  describe('with a starter (scaffold mode)', () => {
    const starter = {
      label: 'Django',
      gettingStarted: '```bash\npython manage.py runserver\n```',
      notScaffolded: ['the front-end application', 'infrastructure and deployment configuration'],
    };
    const withStarter = () => buildReadme({ ...readmeArgs(), mode: 'scaffold', starter });

    it('says a starter was generated, not that the repo is docs-only', () => {
      const readme = withStarter();

      expect(readme).toContain('initialization mode: **scaffold**');
      expect(readme).toContain('A Django starter was generated from the selected stack');
      expect(readme).not.toContain('no application code was generated');
    });

    it('adds a Getting started section, after the stack and before the decisions', () => {
      const readme = withStarter();

      expect(readme).toContain('## Getting started\n\n```bash\npython manage.py runserver\n```');
      expect(readme.indexOf('## Technology stack')).toBeLessThan(
        readme.indexOf('## Getting started'),
      );
      expect(readme.indexOf('## Getting started')).toBeLessThan(
        readme.indexOf('## Architecture decisions'),
      );
    });

    it('lists what the starter did not generate, so the repo never implies more than it holds', () => {
      expect(withStarter()).toContain(
        '**Not generated** (documentation only): the front-end application; infrastructure and deployment configuration.',
      );
    });

    it('omits the "Not generated" line when the starter covers every layer', () => {
      const readme = buildReadme({
        ...readmeArgs(),
        mode: 'scaffold',
        starter: { ...starter, notScaffolded: [] },
      });

      expect(readme).toContain('## Getting started');
      expect(readme).not.toContain('Not generated');
    });
  });

  it('has no Getting started section without a starter (docs-only)', () => {
    const readme = buildReadme(readmeArgs());

    expect(readme).not.toContain('## Getting started');
    expect(readme).toContain('no application code was generated');
  });

  it('renders the stack descriptor as a table with readable labels', () => {
    const readme = buildReadme(readmeArgs());

    expect(readme).toContain('## Technology stack');
    expect(readme).toContain('| Layer | Choice |');
    expect(readme).toContain('| Frontend | Django templates with HTMX |');
    expect(readme).toContain('| Database | PostgreSQL |');
    expect(readme).toContain('| Repository layout | Single repository, one Django project |');
  });

  it('puts the stack layers in reading order even when jsonb returned them shuffled', () => {
    // The order Postgres actually hands back for the demo project's descriptor.
    const readme = buildReadme({
      ...readmeArgs(),
      selected: selected({
        stack: {
          backend: 'B',
          hosting: 'H',
          database: 'D',
          frontend: 'F',
          extraThing: 'X',
          repositoryLayout: 'R',
        },
      }),
    });

    const order = [
      '| Frontend |',
      '| Backend |',
      '| Database |',
      '| Hosting |',
      '| Repository layout |',
      '| Extra thing |',
    ];
    const positions = order.map((label) => readme.indexOf(label));
    expect(positions.every((position) => position > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('capitalizes trade-off factors, which the model writes lowercase', () => {
    const readme = buildReadme({
      ...readmeArgs(),
      selected: selected({
        tradeoffs: [{ factor: 'security constraints', assessment: 'Enforce roles.' }],
      }),
    });

    expect(readme).toContain('- **Security constraints:** Enforce roles.');
  });

  it('humanizes extra stack keys, joins lists, escapes pipes and skips empty values', () => {
    const readme = buildReadme({
      ...readmeArgs(),
      selected: selected({
        stack: {
          frontend: 'React | Vite',
          messageQueue: ['Redis', 'Celery'],
          ciProvider: '',
          nothing: null,
          maxUsers: 500,
        },
      }),
    });

    expect(readme).toContain('| Frontend | React \\| Vite |');
    expect(readme).toContain('| Message queue | Redis, Celery |');
    expect(readme).toContain('| Max users | 500 |');
    expect(readme).not.toContain('Ci provider');
    expect(readme).not.toContain('Nothing');
  });

  it('omits the stack section for a missing or non-object descriptor', () => {
    for (const stack of [null, 'Django', [], {}]) {
      expect(buildReadme({ ...readmeArgs(), selected: selected({ stack }) })).not.toContain(
        '## Technology stack',
      );
    }
  });

  it('lists the option trade-offs, and omits the section when there are none', () => {
    const readme = buildReadme(readmeArgs());
    expect(readme).toContain('## Trade-offs considered');
    expect(readme).toContain(
      '- **Deployment complexity:** One deployable unit, simple to operate.',
    );

    for (const tradeoffs of [[], null, 'oops', [{}], [{ factor: '', assessment: '' }]]) {
      expect(buildReadme({ ...readmeArgs(), selected: selected({ tradeoffs }) })).not.toContain(
        '## Trade-offs considered',
      );
    }
  });

  it('links each ADR with its title, falling back to a bare link without one', () => {
    const readme = buildReadme({
      ...readmeArgs(),
      adrItems: [
        adr(),
        adr({ displayKey: 'ADR-02', payload: {} }),
        adr({ displayKey: 'ADR-03', payload: null }),
      ],
    });

    expect(readme).toContain('- [ADR-01](./docs/adr/ADR-01.md) - Server-rendered workflow');
    expect(readme).toContain('- [ADR-02](./docs/adr/ADR-02.md)\n');
    expect(readme).toContain('- [ADR-03](./docs/adr/ADR-03.md)\n');
  });

  it('says so when no decisions were materialized', () => {
    expect(buildReadme({ ...readmeArgs(), adrItems: [] })).toContain(
      '_No architecture decisions were materialized for this version._',
    );
  });

  it('keeps the provenance section with the exact architecture version and option', () => {
    const readme = buildReadme(readmeArgs());

    expect(readme).toContain(`\`${VERSION_ID}\` (v2), option\n\`A\``);
    expect(readme).toContain('docs/architecture/lineage.json');
    expect(readme.endsWith('\n')).toBe(true);
  });
});

describe('buildAdrDoc', () => {
  const args = () => ({ selected: selected(), architectureVersionId: VERSION_ID });

  it('writes the real decision content, not just ids', () => {
    const doc = buildAdrDoc(adr(), args());

    expect(doc.startsWith('# ADR-01: Server-rendered workflow\n')).toBe(true);
    expect(doc).toContain('## Decision\n\nUse Django templates with HTMX for employee and manager');
    expect(doc).toContain('## Technology / approach\n\nDjango templates with HTMX');
    expect(doc).toContain(
      '## Constraints\n\n- Provide submission, manager review, and employee status views.',
    );
    expect(doc).toContain('## Trade-offs\n\n- Keeps the UI and workflow in one application');
  });

  it('states where the decision was approved', () => {
    expect(buildAdrDoc(adr(), args())).toContain(
      '**Status:** Approved in Throughline - part of Architecture v2, option A ("Django Modular Monolith").',
    );
  });

  it('keeps the exact provenance ids (FR-034)', () => {
    const doc = buildAdrDoc(adr(), args());

    expect(doc).toContain('adr: ADR-01');
    expect(doc).toContain('adr_logical_item_id: 2c95e1a7-7adb-45a5-89f8-8709e26bfd2b');
    expect(doc).toContain('adr_item_version_id: a7ddef86-5300-4b68-ad12-3dff0f704969');
    expect(doc).toContain(`architecture_version_id: ${VERSION_ID}`);
    expect(doc).toContain('architecture_version_number: 2');
    expect(doc).toContain('selected_option: A');
  });

  it('no longer tells the reader to go look in the Throughline workspace', () => {
    expect(buildAdrDoc(adr(), args())).not.toContain('See the parent');
  });

  it('drops a section whose field is missing, empty or the wrong type', () => {
    const doc = buildAdrDoc(
      adr({ payload: { title: 'Only a title', constraints: [], significantTradeoffs: 'nope' } }),
      args(),
    );

    expect(doc).toContain('# ADR-01: Only a title');
    expect(doc).not.toContain('## Decision');
    expect(doc).not.toContain('## Technology / approach');
    expect(doc).not.toContain('## Constraints');
    expect(doc).not.toContain('## Trade-offs');
    expect(doc).toContain('## Provenance');
  });

  it('ignores non-string and blank list entries', () => {
    const doc = buildAdrDoc(
      adr({
        payload: { title: 'T', constraints: ['Keep A', 42, '', '  ', null, 'Keep B'] },
      }),
      args(),
    );

    expect(doc).toContain('## Constraints\n\n- Keep A\n- Keep B\n');
  });

  it.each([null, undefined, 'text', 7, ['x']])(
    'still produces a valid ADR with provenance for an unusable payload (%j)',
    (payload) => {
      const doc = buildAdrDoc(adr({ payload }), args());

      expect(doc.startsWith('# ADR-01\n')).toBe(true);
      expect(doc).toContain('adr_item_version_id: a7ddef86-5300-4b68-ad12-3dff0f704969');
    },
  );
});
