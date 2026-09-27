import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { acknowledgeImpactWarning, getItemVersionProjectIds } from '@/artifact-lifecycle';
import { getRefById } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';
import { readJsonBody } from '@/app/api/_shared/body';
import { acknowledgeSchema } from '@/app/api/impact/schemas';

// One 404 for EVERY way this route can fail to place the ids in the caller's
// project: the subject or the root does not exist, they are in different
// projects, or the project is not the caller's. Same status, same code, same
// message (API Contracts 1.4, TR NFR-002), so the response never confirms that
// an id exists in a project the caller cannot access. The message is normalized
// on purpose, exactly as `resolveOwnedVersion` does for a version: letting
// `requireProjectOwner`'s own "Project not found." through for one case but not
// the others would tell the caller which case they hit.
function notFound(): ApiError {
  return new ApiError('NOT_FOUND', 'Warning subject or source item not found.');
}

type Subject = { itemVersionId: string } | { externalRefId: string };

/**
 * `POST /api/impact/acknowledgements` has no `:projectId`, so (API Contracts
 * 1.4, Module Boundaries 4.1) it resolves the project from the ids in the body
 * first, then runs `requireProjectOwner` on it - the same order as a
 * `:versionId` route. The subject is an item version (project via
 * `artifact-lifecycle.getItemVersionProjectIds`) or an external ref (via
 * `external-operations.getRefById`, which returns the row with its `projectId`);
 * the obsolete root is always an item version. All of them must exist and
 * be in ONE project, otherwise `notFound()`.
 */
async function resolveOwnedProjectId(
  userId: string,
  subject: Subject,
  obsoleteUpstreamItemVersionId: string,
): Promise<string> {
  let subjectProjectId: string | undefined;
  let rootProjectId: string | undefined;
  if ('itemVersionId' in subject) {
    const projectIds = await getItemVersionProjectIds([
      subject.itemVersionId,
      obsoleteUpstreamItemVersionId,
    ]);
    subjectProjectId = projectIds.get(subject.itemVersionId);
    rootProjectId = projectIds.get(obsoleteUpstreamItemVersionId);
  } else {
    subjectProjectId = (await getRefById(subject.externalRefId))?.projectId;
    rootProjectId = (await getItemVersionProjectIds([obsoleteUpstreamItemVersionId])).get(
      obsoleteUpstreamItemVersionId,
    );
  }
  if (!subjectProjectId || subjectProjectId !== rootProjectId) throw notFound();

  try {
    await requireProjectOwner(userId, subjectProjectId);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') throw notFound();
    throw error;
  }
  return subjectProjectId;
}

/**
 * `POST /api/impact/acknowledgements` -> API Contracts section 6: acknowledge
 * one warning directly from the panel. Body: exactly one of `subjectItemVersionId`
 * / `subjectExternalRefId`, plus `obsoleteUpstreamItemVersionId` and an optional
 * `note` (stored verbatim). `201 { acknowledged: true }`.
 *
 * 400 `VALIDATION_ERROR`: malformed JSON, zero or both subject fields, an id that
 * is not a uuid, a missing `obsoleteUpstreamItemVersionId`. 404: see `notFound`.
 * 409 `NOT_CURRENTLY_FLAGGED`: the pair is not a row the warnings report right
 * now - the server re-checks under the project lock and never trusts the
 * client's belief that something is flagged (INV-025); that includes a subject
 * that is a draft or otherwise not current, which `impact()` never reports
 * (INV-022).
 *
 * Idempotent: a pair that is already acknowledged answers `201` again and
 * writes nothing (`already_acknowledged`), so a double-click is not an error.
 *
 * `impact.acknowledge` is reached through `artifact-lifecycle.
 * acknowledgeImpactWarning` (layer 6 may not import `impact`, and the write
 * must happen inside the project lock, which only artifact-lifecycle takes).
 * The message on the 409 is deliberately conservative (INV-024): it never
 * claims the item is wrong, only that the warning is not flagged any more.
 */
export async function POST(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const body = await readJsonBody(request);
    const parsed = acknowledgeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }
    const { subject, obsoleteUpstreamItemVersionId, note } = parsed.data;

    const projectId = await resolveOwnedProjectId(user.id, subject, obsoleteUpstreamItemVersionId);

    const result = await acknowledgeImpactWarning({
      projectId,
      userId: user.id,
      subject,
      obsoleteUpstreamItemVersionId,
      note,
    });
    if (result.status === 'not_currently_flagged') {
      throw new ApiError(
        'NOT_CURRENTLY_FLAGGED',
        'This warning is no longer flagged for that source change.',
      );
    }
    return NextResponse.json({ acknowledged: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
