import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { listProjects } from '@/external/jira';
import { ApiError } from '@/lib/errors';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { translateJiraError } from '@/app/api/_shared/jira-ctx';
import { jiraProjectsQuerySchema } from '../../schemas';

/**
 * `GET /api/connections/jira/projects?cloudId=` -> jira.listProjects (API
 * Contracts 10A): the projects the caller can see on one of their own sites.
 * A missing `cloudId` is 400 `VALIDATION_ERROR`; a `cloudId` that is not one of
 * the caller's sites is 422 `TARGET_NOT_ACCESSIBLE`.
 */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const parsed = jiraProjectsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'cloudId is required.', parsed.error.flatten());
    }

    return NextResponse.json({
      projects: await listProjects({ userId: user.id }, parsed.data.cloudId),
    });
  } catch (error) {
    return routeErrorResponse(translateJiraError(error));
  }
}
