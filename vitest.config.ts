import { defineConfig } from 'vitest/config';

// Two projects (Project Setup section 5.4):
//  - unit: tests/unit/** - lineage core (hashing, projection, matching,
//    freshness), no DB, runs in milliseconds. ERD section 14 risk 1: build it
//    headless.
//  - integration: tests/integration/** - the Appendix C behaviour suite
//    (T1-T43), against a throwaway postgres:15-alpine container. singleThread
//    so advisory-lock behaviour is observable and deterministic.
export default defineConfig({
  test: {
    // No tests exist yet (early slice-1); don't fail the run over an empty
    // suite. Remove once tests/unit and tests/integration have real specs.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      // Coverage thresholds apply only to the highest-risk code (ERD 14 risk
      // 1/2); coverage elsewhere is not a goal for an 8-day build (NFR-008).
      include: ['src/lineage/**', 'src/artifact-lifecycle/**'],
    },
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          // passWithNoTests is set once at the root (above) - vitest 3's
          // NonProjectOptions forbids it per-project (tsc catches this:
          // "'passWithNoTests' does not exist in type 'ProjectConfig'").
          // The root setting still applies when running `--project unit`.
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          // passWithNoTests is set once at the root (above); see the `unit`
          // project's comment - it is not a valid per-project option in vitest 3.
          // Testcontainers + advisory locks: keep it deterministic, not parallel.
          pool: 'threads',
          poolOptions: { threads: { singleThread: true } },
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // ONE Testcontainers postgres:15-alpine for the whole project (E1-S5):
          // starts the container, reproduces Supabase's anon/authenticated
          // roles + default privileges, and applies drizzle/migrations/*.sql in
          // order exactly once, then hands every *.test.ts file the resulting
          // connection string via provide/inject (tests/integration/support/
          // global-setup.ts). Torn down in the function it returns.
          globalSetup: ['tests/integration/support/global-setup.ts'],
        },
      },
    ],
  },
});
