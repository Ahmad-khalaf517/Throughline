import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import { loadVersionDTO, parseArtifactType } from '@/app/api/_shared/artifacts';

interface RouteParams {
  params: Promise<{ projectId: string; type: string }>;
}

/**
 * `GET /api/projects/:projectId/artifacts/:type/current` -> API Contracts
 * section 4: the artifact's approved version in full, or `{ version: null }` if
 * none exists yet (not a 404 - "nothing approved yet" is a normal state).
 *
 * artifact-lifecycle.getProjectById resolves which version is approved - Module
 * Boundaries 4.7's artifact/version-route exception (src/app/api/README.md 4).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId, type: rawType } = await params;
    await requireProjectOwner(user.id, projectId);
    const type = parseArtifactType(rawType);

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const approvedVersionId = project.artifacts[type].approvedVersionId;
    if (!approvedVersionId) return NextResponse.json({ version: null });

    return NextResponse.json({ version: await loadVersionDTO(approvedVersionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
