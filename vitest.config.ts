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
          // No unit tests exist yet (early slice-1); don't fail the run
          // over an empty suite. Remove once tests/unit has real specs.
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          // No integration tests exist yet (early slice-1); don't fail the
          // run over an empty suite. Remove once tests/integration has real specs.
          passWithNoTests: true,
          // Testcontainers + advisory locks: keep it deterministic, not parallel.
          pool: 'threads',
          poolOptions: { threads: { singleThread: true } },
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
