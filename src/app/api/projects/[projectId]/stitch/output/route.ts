import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getOutput } from '@/external/stitch';
import { getRefById } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';
import { serializeStitchApiOutput } from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `GET /api/projects/:projectId/stitch/output` -> API Contracts section 10:
 * `stitch.getOutput`, for the current approved UI Requirements version. Lets
 * the panel show an already-generated (or in-flight, or manual-fallback)
 * result after a navigation/refresh instead of re-offering the form.
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

    const result = await getOutput(uiRequirementsVersionId);

    switch (result.state) {
      case 'none':
        return NextResponse.json({ state: 'none' });
      case 'in_progress':
        return NextResponse.json({
          state: 'in_progress',
          operationId: result.operationId,
          status: result.status,
        });
      case 'manual_fallback':
        return NextResponse.json({
          state: 'manual_fallback',
          mode: 'manual_fallback',
          promptText: result.output.promptText,
        });
      case 'generated': {
        const ref = result.output.externalRefId
          ? await getRefById(result.output.externalRefId)
          : null;
        if (!ref) {
          throw new Error(
            `stitch_output ${result.output.id} is mode='api' but its external_ref is missing`,
          );
        }
        return NextResponse.json({
          state: 'generated',
          ...(await serializeStitchApiOutput(result.output, ref)),
        });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}
