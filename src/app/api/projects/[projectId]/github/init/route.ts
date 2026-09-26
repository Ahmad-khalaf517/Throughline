import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  previewInit,
  initRepo,
  ArchitectureOptionNotSelectedError,
  ArchitectureVersionNotApprovedError,
  GithubOperationRefusedError,
  GithubOperationFailedError,
  GithubOperationConflictError,
  GithubReconciliationRequiredError,
  GithubOperationInFlightError,
} from '@/external/github';
import { getOperationsForVersion } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';
import { toImpactRowDTOs, serializeRefWithFreshDrift } from '@/app/api/_shared/external';
import { githubInitSchema } from '../schemas';

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
 * `POST /api/projects/:projectId/github/init` -> API Contracts section 8:
 * `github.initRepo` -> `external-operations.runOperation`. The server
 * re-runs `previewInit` and re-checks impact itself (TR FR-085) - the
 * client's `impactAcknowledged` flag is never trusted on its own.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = githubInitSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const architectureVersionId = project.artifacts.architecture.approvedVersionId;
    if (!architectureVersionId) {
      throw new ApiError('PREREQUISITE_NOT_APPROVED', 'Architecture has no approved version.');
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

    if (preview.impact.length > 0 && parsed.data.impactAcknowledged !== true) {
      throw new ApiError('IMPACT_NOT_ACKNOWLEDGED', 'Review the shown impact before continuing.', {
        impact: await toImpactRowDTOs(preview.impact),
      });
    }

    try {
      const ref = await initRepo(architectureVersionId, parsed.data.repoName);
      return NextResponse.json({ status: 'completed', ref: await serializeRefWithFreshDrift(ref) });
    } catch (error) {
      if (error instanceof GithubOperationRefusedError) {
        // reason === 'github_operation_already_active' (the only reason this
        // module currently produces).
        throw new ApiError(
          'GITHUB_ALREADY_INITIALIZED',
          'This project already has a GitHub repository or a GitHub operation in progress.',
        );
      }
      if (error instanceof GithubOperationFailedError) {
        // The only failure reason `github` currently produces
        // (`name_taken_by_other`, from either an immediate 422 or a marker
        // mismatch found during reconciliation - src/external/github/index.ts).
        throw new ApiError('NAME_TAKEN_BY_OTHER', error.message);
      }
      if (error instanceof GithubOperationConflictError) {
        throw new ApiError(
          'REQUEST_CONFLICT',
          "This request's inputs no longer match a prior request for the same repository name.",
        );
      }
      if (
        error instanceof GithubReconciliationRequiredError ||
        error instanceof GithubOperationInFlightError
      ) {
        const operations = await getOperationsForVersion(architectureVersionId, 'github');
        const active = operations.find(
          (op) => op.status === 'pending' || op.status === 'reconciliation_required',
        );
        if (!active) throw error; // unreachable - the thrown error itself implies this row exists
        return NextResponse.json(
          {
            status:
              error instanceof GithubReconciliationRequiredError
                ? 'reconciliation_required'
                : 'pending',
            operationId: active.id,
          },
          { status: 202 },
        );
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
