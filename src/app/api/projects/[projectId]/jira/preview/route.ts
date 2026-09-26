import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { previewExport, BacklogVersionNotApprovedError } from '@/external/jira';
import { ApiError, errorResponse } from '@/lib/errors';
import { serializeRefWithFreshDrift, toImpactRowDTOs } from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `GET /api/projects/:projectId/jira/preview` -> API Contracts section 9:
 * `jira.previewExport`, against the current approved Backlog.
 *
 * `previewExport` returns a single `skipped: PreviewItem[]` discriminated by
 * `kind` (jira/index.ts's own header comment on `PreviewItem` names this
 * exact splitting as this route's job, Module Boundaries 4.7's "serialize
 * the result") - split here: `kind: 'skipped'` -> the response's `skipped[]`,
 * `kind: 'needs_decision'` -> `needsDecision[]`, with `existingRef` (a raw
 * `ExternalRef`) serialized into an `ExternalRefDTO`.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const backlogVersionId = project.artifacts.backlog.approvedVersionId;
    if (!backlogVersionId) {
      throw new ApiError('PREREQUISITE_NOT_APPROVED', 'Backlog has no approved version.');
    }

    let preview;
    try {
      preview = await previewExport(backlogVersionId);
    } catch (error) {
      if (error instanceof BacklogVersionNotApprovedError) {
        throw new ApiError('PREREQUISITE_NOT_APPROVED', error.message);
      }
      throw error;
    }

    const skipped = preview.skipped.filter((item) => item.kind === 'skipped');
    const needsDecisionItems = preview.skipped.filter((item) => item.kind === 'needs_decision');

    const needsDecision = await Promise.all(
      needsDecisionItems.map(async (item) => ({
        logicalItemId: item.logicalItemId,
        displayKey: item.displayKey,
        existingRef: await serializeRefWithFreshDrift(item.existingRef),
      })),
    );

    return NextResponse.json({
      epics: preview.epics,
      stories: preview.stories,
      skipped: skipped.map((item) => ({
        logicalItemId: item.logicalItemId,
        displayKey: item.displayKey,
        reason: item.reason,
      })),
      needsDecision,
      impact: await toImpactRowDTOs(preview.impact),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
