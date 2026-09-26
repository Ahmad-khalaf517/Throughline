import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import {
  getOperationById,
  getRefForItem,
  getRefsForVersion,
  type ExternalOperation,
} from '@/external/operations';
import {
  initRepo,
  GithubReconciliationRequiredError,
  GithubOperationInFlightError,
  GithubOperationConflictError,
} from '@/external/github';
import { exportBacklog } from '@/external/jira';
import {
  generate,
  StitchReconciliationRequiredError,
  StitchOperationInFlightError,
  StitchOperationConflictError,
} from '@/external/stitch';
import { ApiError, errorResponse } from '@/lib/errors';
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

async function retryGithub(op: ExternalOperation): Promise<RetryResult> {
  const targetDescriptor = op.targetDescriptor as { repoName?: unknown };
  if (typeof targetDescriptor.repoName !== 'string') {
    throw new Error(`github external_operation ${op.id} has a malformed target_descriptor`);
  }
  try {
    const ref = await initRepo(op.sourceArtifactVersionId, targetDescriptor.repoName);
    return { status: 'completed', ref: await serializeRefWithFreshDrift(ref) };
  } catch (error) {
    if (error instanceof GithubReconciliationRequiredError) {
      return { status: 'reconciliation_required' };
    }
    if (error instanceof GithubOperationInFlightError) {
      return { status: 'pending' };
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

async function retryJira(op: ExternalOperation): Promise<RetryResult> {
  if (!op.sourceItemVersionId) {
    // external_operation_jira_requires_item_check guarantees this can't happen.
    throw new Error(`jira external_operation ${op.id} has no source_item_version_id`);
  }

  // Re-running the whole backlog is safe: every already-completed
  // operation_key short-circuits to its existing ref inside `runOperation`'s
  // `decideExisting` (idempotent by construction, API Contracts 1.5). An
  // empty decisions map is correct here - a `needsDecision` item can only
  // reach a `failed`/`pending`/`reconciliation_required` operation row AFTER
  // its decision was already resolved to `create_new` in an earlier export
  // call (a `skip` decision never creates an operation row at all, per
  // `jira.exportOneItem`'s own logic), so this retry never needs a decision
  // supplied again.
  await exportBacklog(op.sourceArtifactVersionId, new Map());

  const ref = await getRefForItem(op.sourceItemVersionId);
  if (ref) {
    return { status: 'completed', ref: await serializeRefWithFreshDrift(ref) };
  }

  // `exportBacklog` never throws for one item's outcome (its own header
  // comment: "must never let one item's... ambiguous failure abort the rest
  // of the batch") - failure/pending/reconciliation_required are only
  // observable by re-reading the durable row, not by catching a named error
  // the way the GitHub/Stitch branches above do.
  const current = await getOperationById(op.id);
  if (!current) {
    throw new Error(`external_operation ${op.id} vanished during retry`);
  }
  if (current.status === 'pending') return { status: 'pending' };
  if (current.status === 'reconciliation_required') return { status: 'reconciliation_required' };
  // current.status === 'failed' (or an unreachable 'completed' with no ref):
  // the known contract gap above. Also worth naming here specifically: a
  // Jira request-hash conflict (ERD 7.2/29) is swallowed the same opaque way
  // by `exportBacklog`'s own per-item handling (Module Boundaries 4.6 - its
  // return type carries no per-item outcome detail), so it surfaces here as
  // this same fall-through rather than as a distinguished 409
  // REQUEST_CONFLICT the way GitHub/Stitch's own named `*ConflictError`
  // classes let this route detect explicitly above.
  throw new Error(
    `external_operation ${op.id} retry ended in status '${current.status}' with no ref created - ` +
      'see GET /api/external-operations/:operationId for the durable record',
  );
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
        result = await retryGithub(operation);
        break;
      case 'jira':
        result = await retryJira(operation);
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
    return errorResponse(error);
  }
}
