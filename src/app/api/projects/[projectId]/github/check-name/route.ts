import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { checkRepoName, GithubLookupRejectedError } from '@/external/github';
import { ApiError, errorResponse } from '@/lib/errors';
import { readJsonBody } from '@/app/api/_shared/body';
import { githubCheckNameSchema } from '../schemas';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `POST /api/projects/:projectId/github/check-name` -> API Contracts section
 * 8: `github.checkRepoName`. Advisory availability check for the name the user
 * is typing on the GitHub screen - nothing is written, and `github/init` still
 * decides for real. Project-scoped (and owner-checked) like its siblings even
 * though the answer does not depend on the project: it spends the server's
 * GitHub credential, so it is never open to an arbitrary caller.
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

    try {
      return NextResponse.json(await checkRepoName(parsed.data.repoName));
    } catch (error) {
      if (error instanceof GithubLookupRejectedError) {
        throw new ApiError('GITHUB_REQUEST_REJECTED', error.message);
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
