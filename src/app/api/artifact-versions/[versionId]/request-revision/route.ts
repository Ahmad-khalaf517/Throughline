import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { requestRevision } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  loadVersionDTO,
  resolveOwnedVersion,
  translateLifecycleError,
} from '@/app/api/_shared/artifacts';
import { readOptionalJsonBody } from '@/app/api/_shared/body';
import { feedbackSchema } from '@/app/api/artifact-versions/schemas';

interface RouteParams {
  params: Promise<{ versionId: string }>;
}

/**
 * `POST /api/artifact-versions/:versionId/request-revision` -> API Contracts
 * section 4: `artifact-lifecycle.requestRevision` (draft -> rejected,
 * `status_reason='revision_requested'`). The 200 body is the now-rejected draft.
 * A version that is not a draft is `409 VERSION_NOT_DRAFT`.
 *
 * artifact-lifecycle is called directly - Module Boundaries 4.7's
 * artifact/version-route exception (src/app/api/README.md 4).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { versionId } = await params;
    await resolveOwnedVersion(user.id, versionId);

    const body = await readOptionalJsonBody(request);
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    try {
      await requestRevision(versionId, user.id, parsed.data.feedback);
    } catch (error) {
      throw translateLifecycleError(error);
    }

    return NextResponse.json({ version: await loadVersionDTO(versionId) });
  } catch (error) {
    return errorResponse(error);
  }
}
