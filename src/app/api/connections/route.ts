import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { listConnections } from '@/connections';
import { ApiError, errorResponse } from '@/lib/errors';
import { toConnectionDTO } from '@/lib/serialize';

/**
 * `GET /api/connections` -> connections.listConnections (API Contracts 10A).
 * Always three entries (github, jira, stitch); status and identity only, never a
 * token, ciphertext or key.
 */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const connections = await listConnections(user.id);
    return NextResponse.json({ connections: connections.map(toConnectionDTO) });
  } catch (error) {
    return errorResponse(error);
  }
}
