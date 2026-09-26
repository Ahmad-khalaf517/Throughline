import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  getAllExternalRefsForProject,
  serializeRefWithFreshDrift,
} from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `GET /api/projects/:projectId/github/ref` -> API Contracts section 8:
 * "Convenience read (the one-per-project GitHub ref, if any), equivalent to
 * filtering `GET .../external-refs` by `provider='github'`" - same
 * `getAllExternalRefsForProject` read route 1 uses, filtered here. Fixed by
 * E4-T3 (SCRUM-56, ERD Appendix C T13): this reads by `project_id` now, not
 * by the Architecture artifact's CURRENT `approvedVersionId`, so the repo
 * stays discoverable across a re-approval - see `getAllExternalRefsForProject`'s
 * own doc comment. No `artifact-lifecycle.getProjectById` call is needed for
 * that read; `requireProjectOwner` already establishes the project exists
 * and is owned by the caller.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const refs = await getAllExternalRefsForProject(projectId);
    const ref = refs.find((candidate) => candidate.provider === 'github') ?? null;
    if (!ref) return NextResponse.json({ ref: null });

    return NextResponse.json({ ref: await serializeRefWithFreshDrift(ref) });
  } catch (error) {
    return errorResponse(error);
  }
}
