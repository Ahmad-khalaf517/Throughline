import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { unlinkGithubRepository, UnlinkBlockedError } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

const REMOVED_NOTE =
  'The repository still exists on GitHub. Delete it there if you no longer need it.';

/**
 * `DELETE /api/projects/:projectId/github` -> API Contracts section 8 (round
 * 16, UC-S10, TR FR-091, ERD 7.7): removes the project's GitHub repository
 * RECORD so a new repository can be created. Never deletes or changes anything
 * on GitHub and makes no GitHub call, so - like the project-scoped reads - it
 * needs no `getProjectById`, no `ctx` and no connection (Module Boundaries
 * 4.7, a direct one-call route).
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    let removed;
    try {
      removed = await unlinkGithubRepository(projectId);
    } catch (error) {
      if (error instanceof UnlinkBlockedError) {
        throw new ApiError(
          'UNLINK_BLOCKED',
          'A GitHub operation for this project is still in progress. Try again once it has finished.',
        );
      }
      throw error;
    }
    if (!removed) {
      throw new ApiError('NOT_FOUND', 'This project has no GitHub repository linked.');
    }

    return NextResponse.json({ removed, note: REMOVED_NOTE });
  } catch (error) {
    return errorResponse(error);
  }
}
