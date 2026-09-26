import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
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
 * every `external_ref` this project has ever produced (`_shared/
 * external.getAllExternalRefsForProject`, a plain `project_id` read - see
 * that function's own doc comment for the E4-T3 fix this replaced) plus
 * `impact.getExternalDrift` per ref, reached only through each provider's
 * own `checkDrift` delegate (layer6-api may not import layer1-impact
 * directly - eslint.config.mjs's layer6-api allow-list has no entry for it;
 * Module Boundaries 4.6's `github.checkDrift` is the documented delegator,
 * mirrored for jira/stitch this same story). Display keys are resolved
 * once, batched across every ref's impact row, not once per ref.
 *
 * API Contracts section 7 used to annotate this route
 * `-> external-operations.getRefsForVersion` ("called once per approved
 * version and merged"). That is no longer what this route does, and the
 * contract was corrected to `getRefsForProject` in its own v1.4 rather than
 * reinterpreted here: the old wording named a real mechanism, and that
 * mechanism was lossy (ERD T13 - a GitHub ref stays pinned to the
 * Architecture version approved when `initRepo` ran, so any later
 * re-approval dropped an existing repository from this route).
 *
 * No `artifact-lifecycle.getProjectById` call here (E4-T3, SCRUM-56): this
 * route no longer needs a project's `approvedVersionId`s for anything, so
 * it needs nothing beyond `requireProjectOwner`'s own existence/ownership
 * check - `src/app/api/README.md`'s exception 3 narrows accordingly (see
 * this story's report, not edited here).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const refs = await getAllExternalRefsForProject(projectId);
    const dtos = await serializeRefsWithFreshDrift(refs);

    return NextResponse.json({ refs: dtos });
  } catch (error) {
    return errorResponse(error);
  }
}
