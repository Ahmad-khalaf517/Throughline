import { describe, expect, it } from 'vitest';

// Minimal smoke test for the `unit` vitest project (tests/unit/**/*.test.ts).
// Not required for `pnpm test`/`.husky/pre-push` to pass - vitest.config.ts's
// root-level `passWithNoTests: true` already makes an empty suite exit 0 -
// but it's a cheap, real check that the harness (vitest, tsconfig, the
// `unit` project's `include` glob) actually works, rather than an untested
// assumption. Delete once tests/unit has genuine lineage specs (ERD section
// 14: build it headless first).
describe('unit test harness', () => {
  it('runs', () => {
    expect(true).toBe(true);
  });
});
