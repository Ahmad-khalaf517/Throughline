// Next.js starter: the "pinned reference stack" (Next.js + TypeScript, route
// handlers in the same app, PostgreSQL through Drizzle ORM). Versions match the
// ones Throughline itself runs on. It is a minimal, typechecking app: a layout,
// a page, a health route handler, and a Drizzle schema/client/config - not a
// product.
//
// The option title is model text, so it enters the source only as a
// JSON-escaped string literal (valid TypeScript).
import { stringLiteral, type Starter, type StarterContext, type StarterFile } from './types';

function packageJson(context: StarterContext): string {
  return `${JSON.stringify(
    {
      name: context.repoName,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev',
        build: 'next build',
        start: 'next start',
        typecheck: 'tsc --noEmit',
        'db:generate': 'drizzle-kit generate',
        'db:migrate': 'drizzle-kit migrate',
      },
      dependencies: {
        'drizzle-orm': '^0.44.6',
        next: '16.3.5',
        postgres: '^3.4.7',
        react: '19.2.8',
        'react-dom': '19.2.8',
      },
      devDependencies: {
        '@types/node': '^20',
        '@types/react': '^19',
        '@types/react-dom': '^19',
        'drizzle-kit': '^0.31.5',
        typescript: '^5',
      },
    },
    null,
    2,
  )}\n`;
}

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'react-jsx',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./src/*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  },
  null,
  2,
)}\n`;

const NEXT_CONFIG = `import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

export default nextConfig;
`;

const ENV_EXAMPLE = `# Copy to .env.local for local development.
# Pooled PostgreSQL connection string (Supabase: Project Settings -> Database).
DATABASE_URL=postgres://user:password@localhost:5432/dbname
`;

const GITIGNORE = `node_modules/
.next/
out/
.env
.env.local
.env.*.local
*.tsbuildinfo
next-env.d.ts
.DS_Store
`;

const DRIZZLE_CONFIG = `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
`;

const DB_SCHEMA = `import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Placeholder table - replace it with the real schema.
export const example = pgTable('example', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
`;

const DB_CLIENT = `import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set (see .env.example).');

// \`prepare: false\` keeps this working behind a transaction-mode pooler (Supabase).
const client = postgres(url, { prepare: false });

export const db = drizzle(client);
`;

const HEALTH_ROUTE = `export function GET() {
  return Response.json({ status: 'ok' });
}
`;

function layout(context: StarterContext): string {
  return `import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: ${stringLiteral(context.title)},
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;
}

function page(context: StarterContext): string {
  return `export default function Home() {
  return (
    <main>
      <h1>{${stringLiteral(context.title)}}</h1>
      <p>
        Generated starter. Health check: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
`;
}

function files(context: StarterContext): StarterFile[] {
  return [
    { path: 'package.json', content: packageJson(context) },
    { path: 'tsconfig.json', content: TSCONFIG },
    { path: 'next.config.ts', content: NEXT_CONFIG },
    { path: '.env.example', content: ENV_EXAMPLE },
    { path: '.gitignore', content: GITIGNORE },
    { path: 'drizzle.config.ts', content: DRIZZLE_CONFIG },
    { path: 'src/app/layout.tsx', content: layout(context) },
    { path: 'src/app/page.tsx', content: page(context) },
    { path: 'src/app/api/health/route.ts', content: HEALTH_ROUTE },
    { path: 'src/db/schema.ts', content: DB_SCHEMA },
    { path: 'src/db/index.ts', content: DB_CLIENT },
  ];
}

export const nextjsStarter: Starter = {
  id: 'nextjs',
  label: 'Next.js',
  // Next.js on the front end or back end, with PostgreSQL: the starter wires
  // Drizzle to Postgres, so a Next.js stack on Firestore/DynamoDB/MySQL is not
  // a fit and stays docs-only rather than getting a mismatched database layer.
  matches: (stack) =>
    /next\.?js/.test(`${stack.frontend} ${stack.backend}`) && /postgres/.test(stack.database),
  files,
  gettingStarted: () => `\`\`\`bash
npm install
cp .env.example .env.local   # then set DATABASE_URL
npm run dev
\`\`\`

Then open http://localhost:3000/ (health check at \`/api/health\`). Type-check with \`npm run typecheck\`. Generate and apply migrations with \`npm run db:generate\` and \`DATABASE_URL=... npm run db:migrate\`.`,
  notScaffolded: () => ['infrastructure and deployment configuration for the chosen hosting'],
};
