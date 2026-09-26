import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { ApiError, errorResponse } from '@/lib/errors';
import { loadVersionDTO, resolveOwnedVersion } from '@/app/api/_shared/artifacts';

interface RouteParams {
  params: Promise<{ versionId: string }>;
}

/**
 * `GET /api/artifact-versions/:versionId` -> API Contracts section 4: one
 * version in full - its items (each with the impact row `impact.getWarnings`
 * reports for it) and, for Architecture, its options. Resolves the version to
 * its project first, then the ownership check (API Contracts 1.4: another
 * owner's version and a nonexistent one are both `404 NOT_FOUND`).
 *
 * artifact-lifecycle.getArtifactVersionDetail (via `loadVersionDTO`) is called
 * directly - Module Boundaries 4.7's artifact/version-route exception
 * (src/app/api/README.md 4).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { versionId } = await params;
    await resolveOwnedVersion(user.id, versionId);

    return NextResponse.json(await loadVersionDTO(versionId));
  } catch (error) {
    return errorResponse(error);
  }
}
