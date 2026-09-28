import { describe, expect, it } from 'vitest';
import { pickStarter, readStack, type StarterContext } from '@/external/github/starters';

// The starters are pure: same inputs, same files. The generated code itself was
// also run for real when these were written (a fresh virtualenv with
// `manage.py check` + `manage.py test` for every Django variant, and `tsc
// --noEmit` for the Next.js one) - these tests pin the decisions that made
// that output: which stacks match, which optional parts appear, what is never
// written, and that model text cannot break the generated code.

// Stack descriptors exactly as the model produced them for real projects.
const REAL_STACKS = {
  djangoHtmx: {
    backend: 'Django modular monolith',
    hosting: 'AWS ECS Fargate',
    database: 'Amazon RDS for PostgreSQL',
    frontend: 'Django templates with HTMX',
    repositoryLayout: 'Single Django repository organized by domain apps',
  },
  djangoDrfReact: {
    backend: 'Django REST Framework modular monolith',
    hosting: 'AWS App Runner with Amazon RDS',
    database: 'PostgreSQL',
    frontend: 'React with TypeScript',
    repositoryLayout: 'Single application monorepo',
  },
  djangoPlain: {
    backend: 'Django monolith',
    hosting: 'Container hosting on a managed application platform',
    database: 'PostgreSQL',
    frontend: 'Django server-rendered templates',
    repositoryLayout: 'Single repository with Django application and tests',
  },
  nextjsPostgres: {
    frontend: 'Next.js with TypeScript',
    backend: 'Next.js route handlers (same app)',
    database: 'PostgreSQL via Drizzle ORM',
    hosting: 'Vercel + Supabase',
    repositoryLayout: 'single repo, layered src/ modules',
  },
  rails: {
    backend: 'Ruby on Rails modular monolith',
    hosting: 'Managed Rails application platform',
    database: 'PostgreSQL',
    frontend: 'Rails server-rendered HTML with responsive CSS',
    repositoryLayout: 'Single application repository',
  },
  lambda: {
    backend: 'AWS Lambda functions behind API Gateway',
    hosting: 'AWS managed serverless services',
    database: 'Amazon DynamoDB',
    frontend: 'React single-page application with responsive CSS',
    repositoryLayout: 'Single repository with frontend and function packages',
  },
  springBoot: {
    backend: 'Spring Boot modular API',
    hosting: 'AWS ECS Fargate with Amazon RDS',
    database: 'PostgreSQL',
    frontend: 'React with TypeScript',
    repositoryLayout: 'Separate frontend and backend repositories',
  },
  firebaseNext: {
    backend: 'Firebase Cloud Functions event-driven services',
    hosting: 'Firebase Hosting',
    database: 'Cloud Firestore',
    frontend: 'Next.js web application',
    repositoryLayout: 'Single application monorepo',
  },
} as const;

function contextFor(
  stack: Record<string, unknown>,
  overrides: Partial<Pick<StarterContext, 'repoName' | 'title'>> = {},
): StarterContext {
  return {
    repoName: 'demo-repo',
    title: 'Demo Architecture',
    ...overrides,
    stack: readStack(stack),
  };
}

function filesFor(stack: Record<string, unknown>, overrides = {}) {
  const starter = pickStarter(stack);
  if (!starter) throw new Error('expected a starter for this stack');
  const context = contextFor(stack, overrides);
  return {
    starter,
    context,
    files: new Map(starter.files(context).map((file) => [file.path, file.content])),
  };
}

describe('pickStarter', () => {
  it.each([
    ['djangoHtmx', 'django'],
    ['djangoDrfReact', 'django'],
    ['djangoPlain', 'django'],
    ['nextjsPostgres', 'nextjs'],
  ] as const)('matches the real %s stack to the %s starter', (name, id) => {
    expect(pickStarter(REAL_STACKS[name])?.id).toBe(id);
  });

  it.each(['rails', 'lambda', 'springBoot', 'firebaseNext'] as const)(
    'leaves the real %s stack docs-only - no starter is forced onto a stack it does not fit',
    (name) => {
      expect(pickStarter(REAL_STACKS[name])).toBeNull();
    },
  );

  it('does not match Next.js without PostgreSQL: the starter wires Drizzle to Postgres', () => {
    expect(pickStarter({ ...REAL_STACKS.nextjsPostgres, database: 'MySQL' })).toBeNull();
    expect(pickStarter({ ...REAL_STACKS.nextjsPostgres, database: 'Cloud Firestore' })).toBeNull();
  });

  it('prefers Django when the backend is Django even with a Next.js front end', () => {
    expect(
      pickStarter({ ...REAL_STACKS.djangoDrfReact, frontend: 'Next.js with TypeScript' })?.id,
    ).toBe('django');
  });

  it('matches on the backend layer only, so a mention elsewhere does not select Django', () => {
    expect(
      pickStarter({ ...REAL_STACKS.lambda, repositoryLayout: 'Django-style apps folder' }),
    ).toBeNull();
  });

  it.each([null, undefined, 'Django', 42, [], {}, { backend: 7 }])(
    'returns no starter for an unusable descriptor (%j)',
    (stack) => {
      expect(pickStarter(stack)).toBeNull();
    },
  );
});

describe('Django starter', () => {
  it('generates the runnable project skeleton', () => {
    const { files } = filesFor(REAL_STACKS.djangoPlain);

    for (const path of [
      'manage.py',
      'requirements.txt',
      '.env.example',
      '.gitignore',
      'Dockerfile',
      'config/settings.py',
      'config/urls.py',
      'config/wsgi.py',
      'apps/core/views.py',
      'apps/core/urls.py',
      'apps/core/tests.py',
      'apps/core/templates/core/index.html',
    ]) {
      expect(files.has(path), path).toBe(true);
    }
  });

  it('never writes an empty file (the contents API is not reliable for zero bytes)', () => {
    for (const stack of Object.values(REAL_STACKS)) {
      const starter = pickStarter(stack);
      if (!starter) continue;
      for (const file of starter.files(contextFor(stack))) {
        expect(file.content.length, `${starter.id}: ${file.path}`).toBeGreaterThan(0);
      }
    }
  });

  it('never writes a CI workflow: a classic repo-scope token cannot create .github/workflows', () => {
    for (const stack of Object.values(REAL_STACKS)) {
      const starter = pickStarter(stack);
      if (!starter) continue;
      for (const file of starter.files(contextFor(stack))) {
        expect(file.path.startsWith('.github/'), `${starter.id}: ${file.path}`).toBe(false);
      }
    }
  });

  it('writes each path once and only relative, safe paths', () => {
    for (const stack of Object.values(REAL_STACKS)) {
      const starter = pickStarter(stack);
      if (!starter) continue;
      const paths = starter.files(contextFor(stack)).map((file) => file.path);
      expect(new Set(paths).size).toBe(paths.length);
      for (const path of paths) {
        expect(path).not.toMatch(/^\/|\.\.|\\/);
      }
    }
  });

  it('adds Django REST Framework only when the backend names it', () => {
    const drf = filesFor(REAL_STACKS.djangoDrfReact).files;
    expect(drf.get('requirements.txt')).toContain('djangorestframework');
    expect(drf.get('config/settings.py')).toContain('"rest_framework"');
    expect(drf.get('apps/core/urls.py')).toContain('api/health/');
    expect(drf.get('apps/core/tests.py')).toContain('test_api_health');

    const plain = filesFor(REAL_STACKS.djangoPlain).files;
    expect(plain.get('requirements.txt')).not.toContain('djangorestframework');
    expect(plain.get('config/settings.py')).not.toContain('rest_framework');
    expect(plain.get('apps/core/urls.py')).not.toContain('api/health/');
  });

  it('adds HTMX only when the front end names it', () => {
    const htmx = filesFor(REAL_STACKS.djangoHtmx).files;
    expect(htmx.get('apps/core/templates/core/index.html')).toContain('htmx.org');
    expect(htmx.get('apps/core/urls.py')).toContain('status/');
    expect(htmx.get('apps/core/tests.py')).toContain('test_status_fragment');

    const plain = filesFor(REAL_STACKS.djangoPlain).files;
    expect(plain.get('apps/core/templates/core/index.html')).not.toContain('htmx');
    expect(plain.get('apps/core/urls.py')).not.toContain('status/');
  });

  it('adds the PostgreSQL driver only when the database names PostgreSQL', () => {
    expect(filesFor(REAL_STACKS.djangoHtmx).files.get('requirements.txt')).toContain('psycopg');
    expect(
      filesFor({ ...REAL_STACKS.djangoPlain, database: 'SQLite' }).files.get('requirements.txt'),
    ).not.toContain('psycopg');
  });

  it('refuses to start in production without a secret key, instead of using a default', () => {
    const settings = filesFor(REAL_STACKS.djangoPlain).files.get('config/settings.py');
    expect(settings).toContain('DJANGO_DEBUG", "0"');
    expect(settings).toContain('raise ImproperlyConfigured');
  });

  describe('model text in the title', () => {
    const hostile = String.raw`Bad "title" {{ 7*7 }} {% load x %} \ ' </title><script>alert(1)</script> ☃`;

    it('is a single JSON-escaped Python literal in views.py that round-trips exactly', () => {
      const views = filesFor(REAL_STACKS.djangoPlain, { title: hostile }).files.get(
        'apps/core/views.py',
      )!;
      const literal = /^PROJECT_TITLE = (.*)$/m.exec(views)?.[1];

      expect(literal).toBeDefined();
      expect(JSON.parse(literal!)).toBe(hostile);
    });

    it('never appears in the template source, where {{ ... }} would be evaluated', () => {
      for (const stack of [REAL_STACKS.djangoPlain, REAL_STACKS.djangoHtmx]) {
        const template = filesFor(stack, { title: hostile }).files.get(
          'apps/core/templates/core/index.html',
        )!;

        expect(template).not.toContain('7*7');
        expect(template).not.toContain('alert(1)');
        expect(template).toContain('{{ project_title }}');
      }
    });
  });

  it('reports the React front end as not generated, but not a templates/HTMX one', () => {
    const react = pickStarter(REAL_STACKS.djangoDrfReact)!.notScaffolded(
      readStack(REAL_STACKS.djangoDrfReact),
    );
    expect(react.join(' ')).toContain('front-end application');
    expect(react.join(' ')).toContain('infrastructure');

    const templates = pickStarter(REAL_STACKS.djangoHtmx)!.notScaffolded(
      readStack(REAL_STACKS.djangoHtmx),
    );
    expect(templates.join(' ')).not.toContain('front-end application');
    expect(templates.join(' ')).toContain('infrastructure');
  });

  it('explains how to run it, and mentions the REST endpoint only when there is one', () => {
    const drf = filesFor(REAL_STACKS.djangoDrfReact);
    const drfGuide = drf.starter.gettingStarted(drf.context);
    expect(drfGuide).toContain('python manage.py runserver');
    expect(drfGuide).toContain('python manage.py test');
    expect(drfGuide).toContain('/api/health/');

    const plain = filesFor(REAL_STACKS.djangoPlain);
    expect(plain.starter.gettingStarted(plain.context)).not.toContain('/api/health/');
  });
});

describe('Next.js starter', () => {
  it('generates a typechecking app with a Drizzle/Postgres layer', () => {
    const { files } = filesFor(REAL_STACKS.nextjsPostgres);

    for (const path of [
      'package.json',
      'tsconfig.json',
      'next.config.ts',
      '.env.example',
      '.gitignore',
      'drizzle.config.ts',
      'src/app/layout.tsx',
      'src/app/page.tsx',
      'src/app/api/health/route.ts',
      'src/db/schema.ts',
      'src/db/index.ts',
    ]) {
      expect(files.has(path), path).toBe(true);
    }
  });

  it('writes valid JSON config, named after the repository, with pinned framework versions', () => {
    const { files } = filesFor(REAL_STACKS.nextjsPostgres, { repoName: 'my-next-app' });
    const pkg = JSON.parse(files.get('package.json')!);

    expect(pkg.name).toBe('my-next-app');
    expect(pkg.dependencies).toMatchObject({
      next: '16.3.5',
      react: '19.2.8',
      'react-dom': '19.2.8',
    });
    expect(pkg.scripts).toHaveProperty('typecheck', 'tsc --noEmit');
    expect(() => JSON.parse(files.get('tsconfig.json')!)).not.toThrow();
  });

  it('keeps local env files out of git', () => {
    const gitignore = filesFor(REAL_STACKS.nextjsPostgres).files.get('.gitignore')!;
    expect(gitignore).toContain('.env.local');
    expect(gitignore).toContain('node_modules/');
  });

  it('puts the title in source only as a JSON-escaped literal that round-trips', () => {
    const title = 'Next "quoted" {braces} `tick` ${x} \\ end';
    const { files } = filesFor(REAL_STACKS.nextjsPostgres, { title });

    expect(files.get('src/app/layout.tsx')).toContain(`title: ${JSON.stringify(title)}`);
    expect(files.get('src/app/page.tsx')).toContain(`{${JSON.stringify(title)}}`);
  });

  it('reports infrastructure as the one layer it does not generate', () => {
    const { starter, context } = filesFor(REAL_STACKS.nextjsPostgres);
    expect(starter.notScaffolded(context.stack)).toEqual([
      'infrastructure and deployment configuration for the chosen hosting',
    ]);
  });
});

describe('readStack', () => {
  it('lowercases each layer and joins them for whole-stack checks', () => {
    const stack = readStack({ frontend: ' React ', backend: 'Django', database: ['A', 'B'] });

    expect(stack.frontend).toBe('react');
    expect(stack.backend).toBe('django');
    expect(stack.database).toBe('a b');
    expect(stack.all).toBe('react django a b');
  });

  it('treats a missing or non-object descriptor as empty', () => {
    for (const stack of [null, undefined, 'x', 3, []]) {
      expect(readStack(stack).all).toBe('');
    }
  });
});
