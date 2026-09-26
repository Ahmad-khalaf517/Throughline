import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  getAllExternalRefsForProject,
  serializeRefsWithFreshDrift,
} from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `GET /api/projects/:projectId/external-refs` -> API Contracts section 7:
 * `external-operations.getRefsForVersion` (once per approved version,
 * merged - see `_shared/external.getAllExternalRefsForProject`, called
 * below through `serializeRefsWithFreshDrift`) plus `impact.getExternalDrift`
 * per ref, reached only through each provider's own `checkDrift` delegate
 * (layer6-api may not import layer1-impact directly - eslint.config.mjs's
 * layer6-api allow-list has no entry for it; Module Boundaries 4.6's
 * `github.checkDrift` is the documented delegator, mirrored for jira/stitch
 * this same story). Display keys are resolved once, batched across every
 * ref's impact row, not once per ref (this route's own contract text:
 * "called once per approved version and merged").
 *
 * artifact-lifecycle.getProjectById (layer 2) is called directly here -
 * documented exception 3 in src/app/api/README.md: no layer-3/4/5 export
 * maps a projectId to its approved version ids.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const refs = await getAllExternalRefsForProject(project);
    const dtos = await serializeRefsWithFreshDrift(refs);

    return NextResponse.json({ refs: dtos });
  } catch (error) {
    return errorResponse(error);
  }
}
