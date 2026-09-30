import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { listOwners } from '@/external/github';
import { ApiError } from '@/lib/errors';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';

/**
 * `GET /api/connections/github/owners` -> github.listOwners (API Contracts 10A,
 * FR-088): the caller's own login and the organizations they belong to, read
 * live with the caller's own connection. `github.listOwners` needs no project,
 * so `ctx` carries only the user. 409 `CONNECTION_REQUIRED` / `RECONNECT_REQUIRED`
 * come from the shared connection-error translation.
 */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    return NextResponse.json({ owners: await listOwners({ userId: user.id }) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
