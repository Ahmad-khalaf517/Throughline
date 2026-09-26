import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
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
 * `getAllExternalRefsForProject` read route 1 uses, filtered here.
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
    const ref = refs.find((candidate) => candidate.provider === 'github') ?? null;
    if (!ref) return NextResponse.json({ ref: null });

    return NextResponse.json({ ref: await serializeRefWithFreshDrift(ref) });
  } catch (error) {
    return errorResponse(error);
  }
}
