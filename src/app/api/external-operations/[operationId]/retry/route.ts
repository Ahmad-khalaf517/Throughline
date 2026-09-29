import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getOperationById, getRefsForVersion, type ExternalOperation } from '@/external/operations';
import { getProjectById } from '@/artifact-lifecycle';
import {
  retryOperation as retryGithubOperation,
  GithubOperationConflictError,
  GithubTargetRequiredError,
} from '@/external/github';
import { retryOperation as retryJiraOperation, JiraOperationConflictError } from '@/external/jira';
import {
  generate,
  StitchReconciliationRequiredError,
  StitchOperationInFlightError,
  StitchOperationConflictError,
} from '@/external/stitch';
import { ApiError } from '@/lib/errors';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { toGithubCtx } from '@/app/api/_shared/github-ctx';
import { toJiraCtx, translateJiraError } from '@/app/api/_shared/jira-ctx';
import { serializeRefWithFreshDrift } from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ operationId: string }>;
}

// ---------------------------------------------------------------------------
// KNOWN CONTRACT GAP (API Contracts section 7): the retry response union is
// `{ status: 'completed'; ref } | { status: 'reconciliation_required' | 'pending' }`,
// with errors `409 REQUEST_CONFLICT` / `404 NOT_FOUND`. There is NO slot for a
// definitive provider failure (`external_operation.status = 'failed'`, ERD
// 7.2) - the frozen contract simply doesn't say what a retry of a
// definitively-failed operation returns. Rather than invent a status that
// misreports the outcome (e.g. calling it "completed" with no ref, or
// silently reusing "pending"), every branch below that reaches this case
// throws a plain `Error` and lets it fall through to the existing
// `500 INTERNAL_ERROR` catch-all (`errorResponse`'s own generic branch). The
// durable `failed` row remains fully visible and inspectable at
// `GET /api/external-operations/:operationId` either way - this is a gap in
// the response contract, not in the data.
// ---------------------------------------------------------------------------

type RetryResult =
  | { status: 'completed'; ref: Awaited<ReturnType<typeof serializeRefWithFreshDrift>> }
  | { status: 'reconciliation_required' | 'pending' };

async function retryGithub(op: ExternalOperation, userId: string): Promise<RetryResult> {
  // Round 14: the ctx (D1) carries the project's CURRENT owner, for the
  // request-hash check; the credential is the one recorded on the operation.
  const project = await getProjectById(op.projectId);
  if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');
  try {
    const result = await retryGithubOperation(op.id, toGithubCtx(userId, project));
    if (result.status === 'completed') {
      return { status: 'completed', ref: await serializeRefWithFreshDrift(result.ref) };
    }
    return result;
  } catch (error) {
    if (error instanceof GithubTargetRequiredError) {
      throw new ApiError('TARGET_REQUIRED', error.message, { target: error.target });
    }
    if (error instanceof GithubOperationConflictError) {
      throw new ApiError(
        'REQUEST_CONFLICT',
        "This retry's inputs no longer match the original request.",
      );
    }
    // GithubOperationFailedError / GithubOperationRefusedError / anything
    // else: the known contract gap above - falls through to 500.
    throw error;
  }
}

async function retryStitch(op: ExternalOperation): Promise<RetryResult> {
  try {
    const output = await generate(op.sourceArtifactVersionId);
    if (output.mode === 'manual_fallback') {
      // Unlike GitHub/Jira, a Stitch definitive failure does not throw -
      // `stitch.generate` swallows it and returns normally with
      // `mode: 'manual_fallback'` (Module Boundaries 4.6's own doc comment).
      // Surfacing that here as `completed` would misreport the outcome (no
      // `external_ref` was created) - this deliberately throws instead, so
      // it reaches the same known-gap 500 as GitHub/Jira's failure case.
      throw new Error(
        `stitch retry for external_operation ${op.id} ended in mode='manual_fallback' ` +
          '(definitive failure) - see GET /api/external-operations/:operationId for the durable record',
      );
    }
    const refs = await getRefsForVersion(op.sourceArtifactVersionId);
    const ref = refs.find((candidate) => candidate.provider === 'stitch');
    if (!ref) {
      throw new Error(`stitch_output ${output.id} is mode='api' but no stitch external_ref exists`);
    }
    return { status: 'completed', ref: await serializeRefWithFreshDrift(ref) };
  } catch (error) {
    if (error instanceof StitchReconciliationRequiredError) {
      return { status: 'reconciliation_required' };
    }
    if (error instanceof StitchOperationInFlightError) {
      return { status: 'pending' };
    }
    if (error instanceof StitchOperationConflictError) {
      throw new ApiError(
        'REQUEST_CONFLICT',
        "This retry's inputs no longer match the original request.",
      );
    }
    throw error;
  }
}

async function retryJira(op: ExternalOperation, userId: string): Promise<RetryResult> {
  // Round 14: the ctx (D1) carries the project's CURRENT Jira site + project, for
  // the request-hash check; the credential is the one recorded on the operation.
  const project = await getProjectById(op.projectId);
  if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');
  try {
    // Retries only THIS operation (rebuilt from the captured Backlog version), not the whole backlog.
    const result = await retryJiraOperation(op.id, toJiraCtx(userId, project));
    if (result.status === 'completed') {
      return { status: 'completed', ref: await serializeRefWithFreshDrift(result.ref) };
    }
    return result;
  } catch (error) {
    if (error instanceof JiraOperationConflictError) {
      throw new ApiError(
        'REQUEST_CONFLICT',
        "This retry's inputs no longer match the original request.",
      );
    }
    // JiraTargetRequiredError -> TARGET_REQUIRED; JiraOperationFailedError /
    // JiraOperationRefusedError / anything else: the known contract gap above -
    // falls through to 500.
    throw translateJiraError(error);
  }
}

/**
 * `POST /api/external-operations/:operationId/retry` -> API Contracts
 * section 7: `external-operations.runOperation`, re-invoked for the stored
 * operation's provider/target via the owning provider module, dispatched by
 * `provider` - exactly as section 7's own text describes. User-initiated
 * retry only (ERD 7.2) - there is no automatic caller of this route.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { operationId } = await params;
    const operation = await getOperationById(operationId);
    if (!operation) throw new ApiError('NOT_FOUND', 'Operation not found.');

    await requireProjectOwner(user.id, operation.projectId);

    let result: RetryResult;
    switch (operation.provider) {
      case 'github':
        result = await retryGithub(operation, user.id);
        break;
      case 'jira':
        result = await retryJira(operation, user.id);
        break;
      case 'stitch':
        result = await retryStitch(operation);
        break;
      default:
        // external_operation_provider_check guarantees one of the three above.
        throw new Error(`unknown external_operation.provider '${operation.provider}'`);
    }

    return NextResponse.json(result);
  } catch (error) {
    // A `ReconnectRequiredError` from the recorded connection (ERD 7.6, T49)
    // leaves the operation untouched and answers 409 RECONNECT_REQUIRED.
    return routeErrorResponse(error);
  }
}
