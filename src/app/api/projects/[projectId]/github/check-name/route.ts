import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  checkRepoName,
  GithubLookupRejectedError,
  GithubTargetRequiredError,
} from '@/external/github';
import { ApiError } from '@/lib/errors';
import { readJsonBody } from '@/app/api/_shared/body';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { toGithubCtx } from '@/app/api/_shared/github-ctx';
import { githubCheckNameSchema } from '../schemas';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `POST /api/projects/:projectId/github/check-name` -> API Contracts section
 * 8: `github.checkRepoName`. Advisory availability check for the name the user
 * is typing on the GitHub screen - nothing is written, and `github/init` still
 * decides for real. Project-scoped (and owner-checked) like its siblings even
 * though the answer does not depend on the project's content: it needs the
 * project's chosen GitHub owner, and spends the caller's own GitHub quota
 * (round 14), so it is never open to an arbitrary caller.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = githubCheckNameSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    try {
      return NextResponse.json(
        await checkRepoName(parsed.data.repoName, toGithubCtx(user.id, project)),
      );
    } catch (error) {
      if (error instanceof GithubLookupRejectedError) {
        throw new ApiError('GITHUB_REQUEST_REJECTED', error.message);
      }
      if (error instanceof GithubTargetRequiredError) {
        throw new ApiError('TARGET_REQUIRED', error.message, { target: error.target });
      }
      throw error;
    }
  } catch (error) {
    return routeErrorResponse(error);
  }
}
