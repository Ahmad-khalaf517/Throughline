import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  previewInit,
  ArchitectureOptionNotSelectedError,
  ArchitectureVersionNotApprovedError,
} from '@/external/github';
import { ApiError, errorResponse } from '@/lib/errors';
import { getAllExternalRefsForProject, toImpactRowDTOs } from '@/app/api/_shared/external';
import { githubPreviewSchema } from '../schemas';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

/**
 * `POST /api/projects/:projectId/github/preview` -> API Contracts section 8:
 * `github.previewInit`. `previewInit` ignores the request's `repoName` and
 * always returns its own deterministic suggestion (`suggestRepoName`'s own
 * comment in src/external/github/index.ts anticipates exactly this route) -
 * the request body is still zod-validated (a malformed body is a genuine
 * 400), just never passed through; the request's `repoName` only becomes
 * authoritative at `POST .../github/init`.
 *
 * artifact-lifecycle.getProjectById is called directly - documented
 * exception 3 in src/app/api/README.md.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = githubPreviewSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const architectureVersionId = project.artifacts.architecture.approvedVersionId;
    if (!architectureVersionId) {
      throw new ApiError('PREREQUISITE_NOT_APPROVED', 'Architecture has no approved version.');
    }

    // ERD: one GitHub repository per project. `previewInit` has no
    // `external_ref` read of its own (Module Boundaries 4.6) - the route
    // checks this directly before ever building a preview.
    const existingRefs = await getAllExternalRefsForProject(projectId);
    if (existingRefs.some((ref) => ref.provider === 'github')) {
      throw new ApiError(
        'GITHUB_ALREADY_INITIALIZED',
        'This project already has a GitHub repository.',
      );
    }

    let preview;
    try {
      preview = await previewInit(architectureVersionId);
    } catch (error) {
      if (
        error instanceof ArchitectureOptionNotSelectedError ||
        error instanceof ArchitectureVersionNotApprovedError
      ) {
        throw new ApiError('PREREQUISITE_NOT_APPROVED', error.message);
      }
      throw error;
    }

    return NextResponse.json({
      mode: preview.mode,
      repoName: preview.repoName,
      impact: await toImpactRowDTOs(preview.impact),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
