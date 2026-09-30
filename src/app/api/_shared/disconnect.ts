// The body of `DELETE /api/connections/:provider`, shared by the dynamic
// `[provider]/route.ts` and by every provider folder that has a route.ts of its
// own. In the App Router a STATIC segment (e.g. `connections/stitch/route.ts`)
// shadows the dynamic `[provider]` for that path, so a static provider route that
// lacks a DELETE handler answers 405 - each such route must delegate here
// (guarded by tests/unit/api/connections-route-shadowing.test.ts).
import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { disconnect, listConnections } from '@/connections';
import { ApiError, errorResponse } from '@/lib/errors';
import { providerParamSchema } from '@/app/api/connections/schemas';

/**
 * `connections.disconnect` (API Contracts 10A). Revokes at the provider where an
 * API exists, then removes the local credential (row deleted, or tombstoned when
 * an operation still references it). `providerRevoked` is `null` when the
 * provider has no revocation API; nothing connected at all is `404 NOT_FOUND`.
 */
export async function disconnectResponse(
  request: Request,
  providerRaw: string,
): Promise<NextResponse> {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const parsed = providerParamSchema.safeParse(providerRaw);
    if (!parsed.success) throw new ApiError('NOT_FOUND', 'Unknown provider.');

    // `disconnect` answers `providerRevoked: null` both for "no revocation API"
    // and "no such connection"; only the latter is a 404, so ask first.
    const current = (await listConnections(user.id)).find((c) => c.provider === parsed.data);
    if (!current || current.status === 'none') {
      throw new ApiError('NOT_FOUND', 'Nothing is connected for that provider.');
    }
    const result = await disconnect(user.id, parsed.data);
    return NextResponse.json({ providerRevoked: result.providerRevoked });
  } catch (error) {
    return errorResponse(error);
  }
}
