// The Jira provider context of Module Boundaries 4.6 (D1), plus the layer-6
// translation of the `jira` module's own typed errors. Kept apart from
// `external.ts` for the same reason `github-ctx.ts` is.
import { JiraSiteNotAccessibleError, JiraTargetRequiredError, type JiraCtx } from '@/external/jira';
import { ApiError } from '@/lib/errors';

/**
 * The verified project owner and the project's chosen Jira site + project key,
 * read by the ROUTE because the provider module cannot read `project`. Both
 * halves are passed or neither is (the columns are a pair, ERD 4.2).
 */
export function toJiraCtx(
  userId: string,
  project: { jiraCloudId?: string | null; jiraProjectKey?: string | null },
): JiraCtx {
  return {
    userId,
    ...(project.jiraCloudId && project.jiraProjectKey
      ? { jiraCloudId: project.jiraCloudId, jiraProjectKey: project.jiraProjectKey }
      : {}),
  };
}

/**
 * `JiraTargetRequiredError` -> 409 `TARGET_REQUIRED` `{ target: 'jira' }`,
 * `JiraSiteNotAccessibleError` -> 422 `TARGET_NOT_ACCESSIBLE`; anything else is
 * returned unchanged (for `routeErrorResponse` to translate or pass through).
 */
export function translateJiraError(error: unknown): unknown {
  if (error instanceof JiraTargetRequiredError) {
    return new ApiError('TARGET_REQUIRED', error.message, { target: error.target });
  }
  if (error instanceof JiraSiteNotAccessibleError) {
    return new ApiError('TARGET_NOT_ACCESSIBLE', error.message, { target: 'jira' });
  }
  return error;
}
