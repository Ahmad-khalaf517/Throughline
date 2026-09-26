import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { ApiError, errorResponse } from '@/lib/errors';
import { ARTIFACT_TYPE_DISPATCH, resolveOwnedVersion } from '@/app/api/_shared/artifacts';

interface RouteParams {
  params: Promise<{ versionId: string }>;
}

/**
 * `GET /api/artifact-versions/:versionId/quality-gate` -> API Contracts section
 * 4: the version's own artifact-type module's `qualityGate` (TR FR-012 for
 * `requirements`, FR-063 for `backlog`). Architecture and UI Requirements have
 * no gate in P0 (Module Boundaries 4.4), so their answer is `{ issues: [] }`,
 * not an error.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { versionId } = await params;
    const ref = await resolveOwnedVersion(user.id, versionId);

    const { qualityGate } = ARTIFACT_TYPE_DISPATCH[ref.artifactType];
    const issues = qualityGate ? await qualityGate(versionId) : [];

    return NextResponse.json({
      issues: issues.map(({ code, message, logicalItemId }) => ({ code, message, logicalItemId })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
