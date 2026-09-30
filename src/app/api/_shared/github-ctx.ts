// The provider context of Module Boundaries 4.6 (D1). Kept apart from
// `external.ts` so a route that only needs the ctx does not pull in every
// provider module's drift check.
import type { GithubCtx } from '@/external/github';

/**
 * The verified project owner and the project's chosen GitHub owner, read by the
 * ROUTE because the provider module cannot read `project`.
 */
export function toGithubCtx(userId: string, project: { githubOwner: string | null }): GithubCtx {
  return { userId, ...(project.githubOwner ? { githubOwner: project.githubOwner } : {}) };
}
