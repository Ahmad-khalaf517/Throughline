import { beforeEach, describe, expect, it, vi } from 'vitest';

// legacyCredentialAvailable (FR-090, Module Boundaries 4.9 rule 6): presence of
// the OPTIONAL legacy env credential, read from `env` at call time.
const mocks = vi.hoisted(() => ({ env: {} as Record<string, string | undefined> }));
vi.mock('@/lib/env', () => ({ env: mocks.env }));

import { legacyCredentialAvailable } from '@/lib/legacy-credentials';

const FULL = {
  GITHUB_TOKEN: 'gh-token',
  GITHUB_OWNER: 'owner',
  JIRA_BASE_URL: 'https://x.atlassian.net',
  JIRA_EMAIL: 'a@b.test',
  JIRA_API_TOKEN: 'jira-token',
  JIRA_PROJECT_KEY: 'KEY',
  STITCH_API_KEY: 'stitch-key',
};

beforeEach(() => {
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, FULL);
});

describe('legacyCredentialAvailable', () => {
  it('is true for each provider when its whole credential is configured', () => {
    expect(legacyCredentialAvailable('github')).toBe(true);
    expect(legacyCredentialAvailable('jira')).toBe(true);
    expect(legacyCredentialAvailable('stitch')).toBe(true);
  });

  it.each([
    ['github', 'GITHUB_TOKEN'],
    ['github', 'GITHUB_OWNER'],
    ['jira', 'JIRA_BASE_URL'],
    ['jira', 'JIRA_EMAIL'],
    ['jira', 'JIRA_API_TOKEN'],
    ['jira', 'JIRA_PROJECT_KEY'],
    ['stitch', 'STITCH_API_KEY'],
  ] as const)('%s is unavailable when %s is unset, empty or blank', (provider, variable) => {
    for (const value of [undefined, '', '   ']) {
      mocks.env[variable] = value;
      expect(legacyCredentialAvailable(provider)).toBe(false);
    }
  });

  it('is independent per provider', () => {
    delete mocks.env.STITCH_API_KEY;
    expect(legacyCredentialAvailable('stitch')).toBe(false);
    expect(legacyCredentialAvailable('github')).toBe(true);
    expect(legacyCredentialAvailable('jira')).toBe(true);
  });
});
