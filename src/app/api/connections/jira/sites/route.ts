import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { listSites } from '@/external/jira';
import { ApiError } from '@/lib/errors';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { translateJiraError } from '@/app/api/_shared/jira-ctx';

/**
 * `GET /api/connections/jira/sites` -> jira.listSites (API Contracts 10A): every
 * Atlassian site the caller's own connection can act on, read live from
 * accessible-resources. Needs no project, so `ctx` carries only the user. 409
 * `CONNECTION_REQUIRED` / `RECONNECT_REQUIRED` come from the shared
 * connection-error translation.
 */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    return NextResponse.json({ sites: await listSites({ userId: user.id }) });
  } catch (error) {
    return routeErrorResponse(translateJiraError(error));
  }
}
