import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { previewPrompt, UiRequirementsVersionNotApprovedError } from '@/external/stitch';
import { ApiError, errorResponse } from '@/lib/errors';
import { toImpactRowDTOs } from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `GET /api/projects/:projectId/stitch/preview` -> API Contracts section 10:
 * `stitch.previewPrompt`, against the current approved UI Requirements.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const uiRequirementsVersionId = project.artifacts.ui_requirements.approvedVersionId;
    if (!uiRequirementsVersionId) {
      throw new ApiError('PREREQUISITE_NOT_APPROVED', 'UI Requirements has no approved version.');
    }

    let preview;
    try {
      preview = await previewPrompt(uiRequirementsVersionId);
    } catch (error) {
      if (error instanceof UiRequirementsVersionNotApprovedError) {
        throw new ApiError('PREREQUISITE_NOT_APPROVED', error.message);
      }
      throw error;
    }

    return NextResponse.json({
      prompt: preview.prompt,
      impact: await toImpactRowDTOs(preview.impact),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
