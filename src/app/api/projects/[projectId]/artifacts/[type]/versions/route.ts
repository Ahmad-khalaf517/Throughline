import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { listArtifactVersions } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import { toArtifactVersionSummaryDTO } from '@/lib/serialize';
import { parseArtifactType } from '@/app/api/_shared/artifacts';

interface RouteParams {
  params: Promise<{ projectId: string; type: string }>;
}

/**
 * `GET /api/projects/:projectId/artifacts/:type/versions` -> API Contracts
 * section 4: every version of that artifact, newest first, as summaries (no
 * items, no options - fetch one version for those). `[]` when the artifact has
 * no version yet.
 *
 * artifact-lifecycle.listArtifactVersions is called directly - Module
 * Boundaries 4.7's artifact/version-route exception (src/app/api/README.md 4).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId, type: rawType } = await params;
    await requireProjectOwner(user.id, projectId);
    const type = parseArtifactType(rawType);

    const versions = await listArtifactVersions(projectId, type);
    return NextResponse.json({ versions: versions.map(toArtifactVersionSummaryDTO) });
  } catch (error) {
    return errorResponse(error);
  }
}
