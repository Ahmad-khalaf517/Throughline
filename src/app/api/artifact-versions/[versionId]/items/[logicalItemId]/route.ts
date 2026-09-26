import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { commitItemEdit } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  loadVersionDTO,
  parseLogicalItemId,
  resolveOwnedVersion,
  translateLifecycleError,
} from '@/app/api/_shared/artifacts';
import { readJsonBody } from '@/app/api/_shared/body';
import { itemEditCommitSchema } from '@/app/api/artifact-versions/schemas';

interface RouteParams {
  params: Promise<{ versionId: string; logicalItemId: string }>;
}

/**
 * `PUT /api/artifact-versions/:versionId/items/:logicalItemId` -> API Contracts
 * section 5: `artifact-lifecycle.commitItemEdit`, which recomputes the rebind
 * inside the project lock and refuses (409 `CONFIRMATION_REQUIRED`,
 * `details.changedRefs`) when it changed any upstream reference and `confirmed`
 * is not `true` - the client's copy of the preview is never trusted.
 *
 * `confirmed` is a required boolean and `payload` a JSON object (400 otherwise).
 * The 200 body's `item` is the committed item as it now reads in the draft: it
 * is looked up by `logicalItemId` in a fresh `loadVersionDTO`, so its
 * `displayKey`, `itemType`, `parentLogicalItemId` and `impact` are the real
 * ones rather than fields this route would have to fabricate from the bare
 * `item_version` row `commitItemEdit` returns.
 *
 * artifact-lifecycle is called directly - Module Boundaries 4.7's
 * artifact/version-route exception (src/app/api/README.md 4).
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { versionId, logicalItemId: rawLogicalItemId } = await params;
    await resolveOwnedVersion(user.id, versionId);
    const logicalItemId = parseLogicalItemId(rawLogicalItemId);

    const body = await readJsonBody(request);
    const parsed = itemEditCommitSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    let committed;
    try {
      committed = await commitItemEdit(
        versionId,
        logicalItemId,
        parsed.data.payload,
        parsed.data.confirmed,
      );
    } catch (error) {
      throw translateLifecycleError(error);
    }

    const version = await loadVersionDTO(versionId);
    const item = version.items.find((candidate) => candidate.logicalItemId === logicalItemId);
    if (!item) {
      // commitItemEdit just swapped this item into the draft's membership; not
      // finding it would be a bug, not a client-facing error.
      throw new Error(`item ${logicalItemId} missing from version ${versionId} after its edit`);
    }

    return NextResponse.json({ item, changedRefs: committed.changedRefs });
  } catch (error) {
    return errorResponse(error);
  }
}
