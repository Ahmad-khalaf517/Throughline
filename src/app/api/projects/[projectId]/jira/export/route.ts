import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import {
  previewExport,
  exportBacklog,
  BacklogVersionNotApprovedError,
  type LogicalItemId,
} from '@/external/jira';
import { getBacklogVersionMembers } from '@/artifact-types/backlog';
import { getOperationsForVersion } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';
import { serializeRefsWithFreshDrift, toImpactRowDTOs } from '@/app/api/_shared/external';
import { jiraExportSchema } from '../schemas';

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
 * `POST /api/projects/:projectId/jira/export` -> API Contracts section 9:
 * `jira.exportBacklog`. Re-runs `previewExport` first (a) to re-check impact
 * itself (TR FR-085 - never trust the client's `impactAcknowledged` flag)
 * and (b) to verify every `needsDecision` item has an entry in `decisions`
 * (`400 VALIDATION_ERROR` otherwise). `exportBacklog`'s own return value is
 * only the created refs (Module Boundaries 4.6) - per that module's own
 * comment on `exportBacklog`, `skipped`/`failures` are re-derived here from
 * the preview list plus the durable `external_operation` rows, not from a
 * redesign of that signature. A per-item failure never fails this call.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = jiraExportSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

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

    const skippedItems = preview.skipped.filter((item) => item.kind === 'skipped');
    const needsDecisionItems = preview.skipped.filter((item) => item.kind === 'needs_decision');

    const decisionsMap = new Map<LogicalItemId, 'skip' | 'create_new'>(
      parsed.data.decisions.map((d) => [d.logicalItemId, d.decision]),
    );
    for (const item of needsDecisionItems) {
      if (!decisionsMap.has(item.logicalItemId)) {
        throw new ApiError(
          'VALIDATION_ERROR',
          `Missing export decision for ${item.displayKey} (${item.logicalItemId}).`,
        );
      }
    }

    if (preview.impact.length > 0 && parsed.data.impactAcknowledged !== true) {
      throw new ApiError('IMPACT_NOT_ACKNOWLEDGED', 'Review the shown impact before continuing.', {
        impact: await toImpactRowDTOs(preview.impact),
      });
    }

    const created = await exportBacklog(backlogVersionId, decisionsMap);

    // Every LogicalItem the caller's response should list as `skipped`:
    // never-exportable this call (kind='skipped', epic_has_no_jira_ref) plus
    // whatever the caller explicitly chose to skip.
    const skippedLogicalItemIds = new Set<string>([
      ...skippedItems.map((item) => item.logicalItemId),
      ...needsDecisionItems
        .filter((item) => decisionsMap.get(item.logicalItemId) === 'skip')
        .map((item) => item.logicalItemId),
    ]);

    // Map every attempted item's item_version id back to its logicalItemId
    // (backlog's own membership rows - the full Epic/Story list, which
    // `previewExport`'s own return shape only ever exposes a filtered
    // subset of) so each non-completed `external_operation` row can be
    // reported as a `failures` entry.
    const members = await getBacklogVersionMembers(backlogVersionId);
    const logicalItemIdByItemVersionId = new Map<string, string>();
    for (const member of members) {
      if (member.itemVersionId && member.logicalItemId) {
        logicalItemIdByItemVersionId.set(member.itemVersionId, member.logicalItemId);
      }
    }

    const operations = await getOperationsForVersion(backlogVersionId, 'jira');
    const failures = operations
      .filter((op) => op.status !== 'completed' && op.sourceItemVersionId)
      .map((op) => ({
        logicalItemId: logicalItemIdByItemVersionId.get(op.sourceItemVersionId as string) ?? null,
        operationId: op.id,
        status: op.status as 'pending' | 'completed' | 'failed' | 'reconciliation_required',
      }))
      // Excludes an item the caller just chose to `skip` this call even if
      // an earlier export attempt left a non-completed operation row for it
      // (that row is durable history, not this call's outcome) - and the
      // defensive `logicalItemId !== null` case, which should never
      // actually trigger: every jira operation for this backlog version is
      // keyed to one of this exact version's own membership rows.
      .filter(
        (
          failure,
        ): failure is {
          logicalItemId: string;
          operationId: string;
          status: typeof failure.status;
        } => failure.logicalItemId !== null && !skippedLogicalItemIds.has(failure.logicalItemId),
      );

    return NextResponse.json({
      created: await serializeRefsWithFreshDrift(created),
      skipped: [...skippedLogicalItemIds].map((logicalItemId) => ({ logicalItemId })),
      failures,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
