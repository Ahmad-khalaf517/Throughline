import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { proposeItemEdit } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  parseLogicalItemId,
  resolveOwnedVersion,
  translateLifecycleError,
} from '@/app/api/_shared/artifacts';
import { readJsonBody } from '@/app/api/_shared/body';
import { itemEditPreviewSchema } from '@/app/api/artifact-versions/schemas';

interface RouteParams {
  params: Promise<{ versionId: string; logicalItemId: string }>;
}

/**
 * `POST /api/artifact-versions/:versionId/items/:logicalItemId/edit/preview` ->
 * API Contracts section 5: `artifact-lifecycle.proposeItemEdit` - the real
 * rebind run in a transaction that is rolled back, so nothing persists. The
 * `changedRefs` it returns are what the client shows before asking the user to
 * confirm; an empty array means the commit needs no confirmation.
 *
 * Order: auth (401) -> version ownership (404) -> `:logicalItemId` shape (404) ->
 * body (400; `payload` must be a JSON object) -> the domain call. Errors:
 * `VERSION_NOT_DRAFT`, `ITEM_NOT_IN_VERSION`, `UPSTREAM_REMOVED` (all 409).
 *
 * artifact-lifecycle is called directly - Module Boundaries 4.7's
 * artifact/version-route exception (src/app/api/README.md 4).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { versionId, logicalItemId: rawLogicalItemId } = await params;
    await resolveOwnedVersion(user.id, versionId);
    const logicalItemId = parseLogicalItemId(rawLogicalItemId);

    const body = await readJsonBody(request);
    const parsed = itemEditPreviewSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    let preview;
    try {
      preview = await proposeItemEdit(versionId, logicalItemId, parsed.data.payload);
    } catch (error) {
      throw translateLifecycleError(error);
    }

    return NextResponse.json({ changedRefs: preview.changedRefs });
  } catch (error) {
    return errorResponse(error);
  }
}
