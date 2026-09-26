import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  previewPrompt,
  generate,
  getSignedAssetUrls,
  UiRequirementsVersionNotApprovedError,
  AlreadyGeneratedError,
  StitchReconciliationRequiredError,
  StitchOperationInFlightError,
  StitchOperationConflictError,
} from '@/external/stitch';
import { getOperationsForVersion, getRefsForVersion } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';
import { toImpactRowDTOs, serializeRefWithFreshDrift } from '@/app/api/_shared/external';
import { stitchGenerateSchema } from '../schemas';

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
 * `POST /api/projects/:projectId/stitch/generate` -> API Contracts section
 * 10: `stitch.generate` -> `external-operations.runOperation`, or a direct
 * `manual_fallback` write on definitive failure (Module Boundaries 4.6). The
 * server re-runs `previewPrompt` and re-checks impact itself (TR FR-085).
 * A `manual_fallback` result is `200`, not an error - FR-054 requires the
 * workflow to continue.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = stitchGenerateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

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

    if (preview.impact.length > 0 && parsed.data.impactAcknowledged !== true) {
      throw new ApiError('IMPACT_NOT_ACKNOWLEDGED', 'Review the shown impact before continuing.', {
        impact: await toImpactRowDTOs(preview.impact),
      });
    }

    try {
      const output = await generate(uiRequirementsVersionId);

      if (output.mode === 'manual_fallback') {
        return NextResponse.json({ mode: 'manual_fallback', promptText: output.promptText });
      }

      const refs = await getRefsForVersion(uiRequirementsVersionId);
      const ref = refs.find((candidate) => candidate.provider === 'stitch');
      if (!ref) {
        throw new Error(
          `stitch_output ${output.id} is mode='api' but no stitch external_ref exists for ` +
            uiRequirementsVersionId,
        );
      }
      const urls = await getSignedAssetUrls(output);
      if (!urls.htmlUrl || !urls.screenshotUrl) {
        throw new Error(`stitch_output ${output.id} is missing a signed asset URL`);
      }

      return NextResponse.json({
        mode: 'api',
        ref: await serializeRefWithFreshDrift(ref),
        htmlUrl: urls.htmlUrl,
        screenshotUrl: urls.screenshotUrl,
      });
    } catch (error) {
      if (error instanceof AlreadyGeneratedError) {
        throw new ApiError('ALREADY_GENERATED', error.message);
      }
      if (error instanceof UiRequirementsVersionNotApprovedError) {
        throw new ApiError('PREREQUISITE_NOT_APPROVED', error.message);
      }
      if (error instanceof StitchOperationConflictError) {
        throw new ApiError(
          'REQUEST_CONFLICT',
          "This request's inputs no longer match a prior generation request.",
        );
      }
      if (
        error instanceof StitchReconciliationRequiredError ||
        error instanceof StitchOperationInFlightError
      ) {
        const operations = await getOperationsForVersion(uiRequirementsVersionId, 'stitch');
        const active = operations.find(
          (op) => op.status === 'pending' || op.status === 'reconciliation_required',
        );
        if (!active) throw error; // unreachable - the thrown error itself implies this row exists
        return NextResponse.json(
          {
            status:
              error instanceof StitchReconciliationRequiredError
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
