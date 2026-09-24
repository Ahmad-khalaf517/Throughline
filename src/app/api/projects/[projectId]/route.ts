import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { BriefFrozenError, getProjectById, updateProject } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import { toProjectDTO } from '@/lib/serialize';
import { updateProjectSchema } from '../schemas';

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/** `GET /api/projects/:projectId` */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    return NextResponse.json(toProjectDTO(project));
  } catch (error) {
    return errorResponse(error);
  }
}

/** `PATCH /api/projects/:projectId` -> artifact-lifecycle.updateProject */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const body = await readJsonBody(request);
    const parsed = updateProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    let project;
    try {
      project = await updateProject(projectId, parsed.data);
    } catch (error) {
      // Translated here, not inside lib/errors.ts: lib may not import
      // artifact-lifecycle (Module Boundaries layering), so only a route
      // handler - which is allowed to import both - can make this mapping.
      if (error instanceof BriefFrozenError) {
        throw new ApiError('BRIEF_FROZEN', error.message);
      }
      throw error;
    }

    return NextResponse.json(toProjectDTO(project));
  } catch (error) {
    return errorResponse(error);
  }
}
