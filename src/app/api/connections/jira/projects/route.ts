import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { createProject, listProjects } from '@/external/jira';
import { ApiError } from '@/lib/errors';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { readJsonBody } from '@/app/api/_shared/body';
import { translateJiraError } from '@/app/api/_shared/jira-ctx';
import { createJiraProjectSchema, jiraProjectsQuerySchema } from '../../schemas';

/**
 * `POST /api/connections/jira/projects` -> jira.createProject (API Contracts 10A,
 * FR-092, ERD 7.8): creates a Jira project on one of the caller's sites with the
 * caller's own credential. A setup action: no operation, ref or lineage row, no
 * project lock. `PROJECT_KEY_TAKEN` (409), `JIRA_ADMIN_REQUIRED` (403),
 * `TARGET_NOT_ACCESSIBLE` (422) and the connection errors (`missing_scope` is a
 * `RECONNECT_REQUIRED` reason) come from the module's typed errors.
 */
export async function POST(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const parsed = createJiraProjectSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'cloudId, name, key (2-10 uppercase letters or digits, starting with a letter) and template are required.',
        parsed.error.flatten(),
      );
    }

    const project = await createProject({ userId: user.id }, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(translateJiraError(error));
  }
}

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
