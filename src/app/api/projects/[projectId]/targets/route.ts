import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import {
  getProjectById,
  updateProjectTargets,
  InvalidProjectTargetsError,
} from '@/artifact-lifecycle';
import { checkOwnerAccessible } from '@/external/github';
import { checkProjectAccessible } from '@/external/jira';
import { hasOperationsFor } from '@/external/operations';
import { ApiError } from '@/lib/errors';
import { toProjectDTO } from '@/lib/serialize';
import { readJsonBody } from '@/app/api/_shared/body';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { updateProjectTargetsSchema } from '../../schemas';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `PATCH /api/projects/:projectId/targets` (API Contracts 10A, Module
 * Boundaries 4.7) - orchestrated HERE, in this order:
 *  0. `requireProjectOwner`;
 *  1. a non-null target is validated with the caller's own connection BEFORE any
 *     project lock (`TARGET_NOT_ACCESSIBLE`, `CONNECTION_REQUIRED`,
 *     `RECONNECT_REQUIRED`);
 *  2. a `githubOwner` change asks `external-operations.hasOperationsFor`
 *     (`TARGET_LOCKED`);
 *  3. `artifact-lifecycle.updateProjectTargets`, which only takes the project
 *     lock and writes the three columns.
 * The (2)->(3) window is a benign race: every operation snapshots its target
 * into `target_descriptor` at insert, so one inserted in between still
 * reconciles against the target it was created with.
 *
 * A Jira pair is validated with `jira.checkProjectAccessible` (SCRUM-97); clearing
 * it (`jira: null`) needs no provider call. Only a `githubOwner` change is
 * lockable: Jira targets are not (each operation snapshots its site + project into
 * `target_descriptor`, and FR-074 scopes on that), so `hasOperationsFor` is asked
 * for GitHub only.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = updateProjectTargetsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }
    const { githubOwner, jira } = parsed.data;

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    // (1) validate a non-null target with the caller's connection - no lock held.
    if (jira) {
      if (!(await checkProjectAccessible({ userId: user.id }, jira.cloudId, jira.projectKey))) {
        throw new ApiError(
          'TARGET_NOT_ACCESSIBLE',
          'That Jira site or project is not available to your connected Atlassian account.',
          { target: 'jira' },
        );
      }
    }

    if (githubOwner) {
      const ctx = {
        userId: user.id,
        ...(project.githubOwner ? { githubOwner: project.githubOwner } : {}),
      };
      if (!(await checkOwnerAccessible(ctx, githubOwner))) {
        throw new ApiError(
          'TARGET_NOT_ACCESSIBLE',
          'That GitHub owner is not available to your connected account.',
          { target: 'githubOwner' },
        );
      }
    }

    // (2) an owner CHANGE is locked once a non-failed GitHub operation exists.
    if (githubOwner !== undefined && githubOwner !== project.githubOwner) {
      if (await hasOperationsFor(projectId, 'github')) {
        throw new ApiError(
          'TARGET_LOCKED',
          'The GitHub owner cannot change once a GitHub operation exists for this project.',
          { target: 'githubOwner' },
        );
      }
    }

    // (3) the only write.
    let updated;
    try {
      updated = await updateProjectTargets(projectId, {
        ...(githubOwner !== undefined ? { githubOwner } : {}),
        ...(jira !== undefined ? { jira } : {}),
      });
    } catch (error) {
      if (error instanceof InvalidProjectTargetsError) {
        throw new ApiError('VALIDATION_ERROR', error.message);
      }
      throw error;
    }

    return NextResponse.json(toProjectDTO(updated));
  } catch (error) {
    return routeErrorResponse(error);
  }
}
