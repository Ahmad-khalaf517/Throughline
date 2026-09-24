import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import boundaries from 'eslint-plugin-boundaries';
import prettierConfig from 'eslint-config-prettier';

// Module Boundaries v1.0 section 2 (layering) encoded as a lint rule.
// A layer may import strictly lower layers only; peers in the same layer are
// disallowed. Do not add an eslint-disable for a violation here - that is the
// signal to re-examine the boundary (Module Boundaries section 5), not to
// silence the rule.
const elementTypes = [
  'layer0-db',
  'layer0-auth',
  'layer0-ai-client',
  'layer1-identity',
  'layer1-dependency-binding',
  'layer1-impact',
  'layer2-artifact-lifecycle',
  'layer2-architecture-materialization',
  'layer3-artifact-types',
  'layer4-external-operations',
  'layer5-external-provider',
  'layer6-api',
  'app',
  'lib',
  'components',
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'layer0-db', pattern: 'src/db/**' },
        { type: 'layer0-auth', pattern: 'src/auth/**' },
        { type: 'layer0-ai-client', pattern: 'src/ai-client/**' },
        { type: 'layer1-identity', pattern: 'src/lineage/identity/**' },
        { type: 'layer1-dependency-binding', pattern: 'src/lineage/dependency-binding/**' },
        { type: 'layer1-impact', pattern: 'src/lineage/impact/**' },
        { type: 'layer2-artifact-lifecycle', pattern: 'src/artifact-lifecycle/**' },
        {
          type: 'layer2-architecture-materialization',
          pattern: 'src/architecture-materialization/**',
        },
        { type: 'layer3-artifact-types', pattern: 'src/artifact-types/*/**', capture: ['name'] },
        { type: 'layer4-external-operations', pattern: 'src/external/operations/**' },
        {
          type: 'layer5-external-provider',
          pattern: 'src/external/(github|jira|stitch)/**',
          capture: ['name'],
        },
        { type: 'layer6-api', pattern: 'src/app/api/**' },
        { type: 'app', pattern: 'src/app/**' },
        { type: 'lib', pattern: 'src/lib/**' },
        // Presentational only - no table ownership, no domain layer (Module
        // Boundaries doesn't cover UI yet because none existed). Treated like
        // `lib`: framework/presentation glue, reachable only from `app`.
        { type: 'components', pattern: 'src/components/**' },
      ],
    },
    plugins: { boundaries },
    rules: {
      // A leading underscore marks a param as intentionally unused (e.g. a
      // stubbed function that must keep its real signature).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'off',
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // `lib` (src/lib: env.ts, errors.ts, serialize.ts) is framework
            // glue below even layer 0 - every layer may import it (Project
            // Setup section 3 rule 3). Found the hard way: layer0-db/auth
            // couldn't import env.ts to read DATABASE_URL/Supabase config
            // until this was added.
            // Layer 0: no dependency on any domain layer.
            { from: ['layer0-db'], allow: ['lib'] },
            { from: ['layer0-auth'], allow: ['layer0-db', 'lib'] },
            { from: ['layer0-ai-client'], allow: ['layer0-db', 'lib'] },
            // Layer 1: lineage core - layer 0 only.
            {
              from: ['layer1-identity', 'layer1-dependency-binding', 'layer1-impact'],
              allow: ['layer0-db', 'layer0-auth', 'layer0-ai-client', 'lib'],
            },
            // Layer 2: state machine - layer 0-1. architecture-materialization -> identity
            // is the one documented exception (Module Boundaries section 4.4/8).
            {
              from: ['layer2-artifact-lifecycle'],
              allow: [
                'layer0-db',
                'layer0-auth',
                'layer0-ai-client',
                'layer1-identity',
                'layer1-dependency-binding',
                'layer1-impact',
                'lib',
              ],
            },
            {
              from: ['layer2-architecture-materialization'],
              allow: ['layer0-db', 'layer0-auth', 'layer0-ai-client', 'layer1-identity', 'lib'],
            },
            // Layer 3: artifact-type modules - layer 0-2 only. Never a layer-3 peer
            // (Module Boundaries section 4.4: "artifact-type modules never import each other").
            {
              from: ['layer3-artifact-types'],
              allow: [
                'layer0-db',
                'layer0-auth',
                'layer0-ai-client',
                'layer1-identity',
                'layer1-dependency-binding',
                'layer1-impact',
                'layer2-artifact-lifecycle',
                'layer2-architecture-materialization',
                'lib',
              ],
            },
            // Layer 4: shared external-write protocol - layer 0-1 only (db, impact).
            {
              from: ['layer4-external-operations'],
              allow: ['layer0-db', 'layer1-impact', 'lib'],
            },
            // Layer 5: provider integrations - layer 0-4, and read-only into their
            // paired layer-3 module (github->architecture, jira->backlog, stitch->ui-requirements).
            {
              from: ['layer5-external-provider'],
              allow: [
                'layer0-db',
                'layer0-auth',
                'layer0-ai-client',
                'layer1-impact',
                'layer3-artifact-types',
                'layer4-external-operations',
                'lib',
              ],
            },
            // Layer 6: API route handlers - everything below. Module Boundaries
            // section 4.7's project-creation-route exception is a code-review rule,
            // not encoded here (over-fitting the lint rule to one route isn't worth it).
            {
              from: ['layer6-api'],
              allow: [
                'layer0-auth',
                'layer2-artifact-lifecycle',
                'layer3-artifact-types',
                'layer4-external-operations',
                'layer5-external-provider',
                'lib',
              ],
            },
            { from: ['app'], allow: elementTypes },
            { from: ['lib'], allow: ['layer0-db'] },
            { from: ['components'], allow: ['lib'] },
          ],
        },
      ],
      // Module Boundaries principle 3 / section 4.1: withProjectLock, the
      // openai SDK, and the @supabase/* auth clients are each importable
      // from exactly one module.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message: 'Only src/ai-client may import the openai SDK (Module Boundaries 4.1).',
            },
          ],
          patterns: [
            {
              group: ['**/db/lock', '**/db/lock.ts'],
              message:
                'withProjectLock is imported from src/artifact-lifecycle only (Module Boundaries principle 3).',
            },
            {
              group: ['@supabase/*'],
              message:
                'Only src/auth may import @supabase/* auth/SSR clients (Module Boundaries 4.1). middleware.ts calls src/auth/updateSession instead of building its own client.',
            },
          ],
        },
      ],
    },
  },
  // Exceptions to the blanket no-restricted-imports ban above, for the one
  // module each rule allows.
  {
    // scripts/** is tooling, not a module in the layer graph (Module
    // Boundaries's import-direction rules govern src/ only - `boundaries/
    // include` above is scoped to 'src/**/*'). E2-T1 (Jira Plan; TR section
    // 42 Spike A) explicitly calls the openai SDK directly from
    // scripts/spike-structured-output.ts rather than building src/ai-client
    // early - see that file's header comment.
    files: ['scripts/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/lock', '**/db/lock.ts'],
              message:
                'withProjectLock is imported from src/artifact-lifecycle only (Module Boundaries principle 3).',
            },
            {
              group: ['@supabase/*'],
              message:
                'Only src/auth may import @supabase/* auth/SSR clients (Module Boundaries 4.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ai-client/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/lock', '**/db/lock.ts'],
              message:
                'withProjectLock is imported from src/artifact-lifecycle only (Module Boundaries principle 3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/artifact-lifecycle/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message: 'Only src/ai-client may import the openai SDK (Module Boundaries 4.1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/auth/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'openai',
              message: 'Only src/ai-client may import the openai SDK (Module Boundaries 4.1).',
            },
          ],
          patterns: [
            {
              group: ['**/db/lock', '**/db/lock.ts'],
              message:
                'withProjectLock is imported from src/artifact-lifecycle only (Module Boundaries principle 3).',
            },
          ],
        },
      ],
    },
  },
  // Disables ESLint stylistic rules that would otherwise conflict with
  // Prettier's formatting; must stay last so its "off" entries win.
  prettierConfig,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'coverage/**',
    // Covers the nested meta/ snapshots too.
    'drizzle/migrations/**',
  ]),
]);

export default eslintConfig;
