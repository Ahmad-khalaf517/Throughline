import { env } from '@/lib/env';

// Round 14 (FR-090, Module Boundaries 4.9 rule 6): whether the OPTIONAL legacy
// environment credential of a provider is configured. Used only for an
// operation with `connection_id IS NULL` - a new operation never consults it.
//
// Pure and env-only on purpose: `external-operations` (layer 4) sits below the
// provider modules that own the env readers, so it cannot ask them, and the
// `connections` module must not read these variables at all. This is the one
// place that says which variables make up a provider's legacy credential; the
// provider modules' own readers (`requireOwner`, `requireJiraConfig`,
// `requireStitchApiKey`) stay in step with it. Reads `env` at call time.

export type LegacyProvider = 'github' | 'jira' | 'stitch';

function isSet(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

export function legacyCredentialAvailable(provider: LegacyProvider): boolean {
  switch (provider) {
    case 'github':
      return isSet(env.GITHUB_TOKEN) && isSet(env.GITHUB_OWNER);
    case 'jira':
      return (
        isSet(env.JIRA_BASE_URL) &&
        isSet(env.JIRA_EMAIL) &&
        isSet(env.JIRA_API_TOKEN) &&
        isSet(env.JIRA_PROJECT_KEY)
      );
    case 'stitch':
      return isSet(env.STITCH_API_KEY);
  }
}
