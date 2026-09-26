import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import {
  approveVersion,
  approveWithOverride,
  ApprovalGateBlockedError,
  type ImpactRow,
} from '@/artifact-lifecycle';
import {
  approveVersion as approveArchitectureVersion,
  approveWithOverride as approveArchitectureWithOverride,
} from '@/artifact-types/architecture';
import { ApiError, errorResponse } from '@/lib/errors';
import { toImpactRowDTO } from '@/lib/serialize';
import {
  loadVersionDTO,
  resolveOwnedVersion,
  translateLifecycleError,
} from '@/app/api/_shared/artifacts';
import { readOptionalJsonBody } from '@/app/api/_shared/body';
import { approveSchema } from '@/app/api/artifact-versions/schemas';

interface RouteParams {
  params: Promise<{ versionId: string }>;
}

// `details.blocking` is display-key rows (API Contracts 4). Used for both ways
// the gate can report a block: `{ ok: false, blocking, displayKeys }` from
// `approveVersion`, and a thrown `ApprovalGateBlockedError` from
// `approveWithOverride` (an override satisfies the gate, it does not bypass it -
// FR-084). The keys are the ones artifact-lifecycle captured INSIDE the approval
// transaction, never a fresh lookup on the pool: a blocked Architecture approval
// rolls back the ADR ItemVersions `materialize` minted, yet the blocking rows
// still name them (ERD 3.5, "Why ids never cross the API"), so a post-rollback
// read (`getDisplayKeysForItemVersions`) has nothing to resolve them with and
// would 500. `toImpactRowDTO` throws if the map misses an id - a missing map is
// a lifecycle bug, surfaced loudly rather than papered over.
function approvalBlocked(
  blocking: readonly ImpactRow[],
  displayKeys: Map<string, string> | undefined,
): ApiError {
  const keys = displayKeys ?? new Map<string, string>();
  return new ApiError(
    'APPROVAL_BLOCKED',
    'Approval is blocked by unacknowledged impact warnings.',
    {
      blocking: blocking.map((row) => toImpactRowDTO(row, keys)),
    },
  );
}

/**
 * `POST /api/artifact-versions/:versionId/approve` -> API Contracts section 4:
 * `artifact-lifecycle.approveVersion`, or `.approveWithOverride` exactly when
 * `overrideNote` is present. An Architecture version goes through the
 * `architecture` facade's composed `approveVersion`/`approveWithOverride`
 * instead - they inject the `materialize` callback that mints the selected
 * option's ADRs inside the approval transaction (ERD 3.4/5.5), which the plain
 * lifecycle functions do not do for an Architecture draft.
 *
 * 400 `VALIDATION_ERROR`: `selectedArchitectureOptionId` missing for an
 * Architecture version or present for any other type; `overrideNote` present but
 * blank. Whether a body is legal depends on the version's artifact type, so that
 * check lives here beside the lookup that provides it; the zod schema only
 * checks the wire shape.
 *
 * Outcomes: `{ ok: true }` -> 200 `{ version }`. `{ ok: false, code }` -> 422
 * `OPTION_NOT_SELECTED`/`OPTION_COUNT_INVALID`, 409 `STACK_UNCHANGED_DECISIONS`.
 * A gate block (`{ ok: false, blocking }` with no code, or a thrown
 * `ApprovalGateBlockedError`) -> 409 `APPROVAL_BLOCKED` with the blocking rows.
 * `VersionNotDraftError` -> 409 `VERSION_NOT_DRAFT`.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { versionId } = await params;
    const ref = await resolveOwnedVersion(user.id, versionId);

    const body = await readOptionalJsonBody(request);
    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }
    const { selectedArchitectureOptionId, overrideNote } = parsed.data;

    const isArchitecture = ref.artifactType === 'architecture';
    if (isArchitecture && selectedArchitectureOptionId === undefined) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'selectedArchitectureOptionId is required to approve an architecture version.',
      );
    }
    if (!isArchitecture && selectedArchitectureOptionId !== undefined) {
      throw new ApiError(
        'VALIDATION_ERROR',
        'selectedArchitectureOptionId is only valid for an architecture version.',
      );
    }

    let result;
    try {
      if (isArchitecture) {
        result =
          overrideNote === undefined
            ? await approveArchitectureVersion(versionId, user.id, selectedArchitectureOptionId)
            : await approveArchitectureWithOverride(
                versionId,
                user.id,
                overrideNote,
                selectedArchitectureOptionId,
              );
      } else {
        result =
          overrideNote === undefined
            ? await approveVersion(versionId, user.id)
            : await approveWithOverride(versionId, user.id, overrideNote);
      }
    } catch (error) {
      if (error instanceof ApprovalGateBlockedError) {
        throw approvalBlocked(error.blocking, error.displayKeys);
      }
      throw translateLifecycleError(error);
    }

    if (result.ok) {
      return NextResponse.json({ version: await loadVersionDTO(versionId) });
    }

    switch (result.code) {
      case 'OPTION_NOT_SELECTED':
        throw new ApiError(
          'OPTION_NOT_SELECTED',
          'The selected option does not belong to this architecture version.',
        );
      case 'OPTION_COUNT_INVALID':
        throw new ApiError(
          'OPTION_COUNT_INVALID',
          'This architecture version does not have exactly two options.',
        );
      case 'STACK_UNCHANGED_DECISIONS':
        throw new ApiError(
          'STACK_UNCHANGED_DECISIONS',
          'Every decision is unchanged but the selected option changes the stack.',
        );
      default:
        throw approvalBlocked(result.blocking, result.displayKeys);
    }
  } catch (error) {
    return errorResponse(error);
  }
}
