import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { createProject, getProjectById, listProjectsForOwner } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import { toProjectDTO } from '@/lib/serialize';
import { createProjectSchema } from './schemas';

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

/** `POST /api/projects` -> artifact-lifecycle.createProject */
export async function POST(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const body = await readJsonBody(request);
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'Invalid request body.', parsed.error.flatten());
    }

    const project = await createProject(
      user.id,
      parsed.data.name,
      parsed.data.brief,
      parsed.data.inputContext,
    );

    // Freshly created - re-fetch through the same read path GET uses rather
    // than assuming the shape of a brand-new project's artifacts here too.
    const projectWithArtifacts = await getProjectById(project.id);
    if (!projectWithArtifacts) {
      throw new Error(`project ${project.id} not found immediately after creation`);
    }

    return NextResponse.json(toProjectDTO(projectWithArtifacts), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** `GET /api/projects` -> the caller's own projects only (owner_user_id-scoped). */
export async function GET(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const projects = await listProjectsForOwner(user.id);
    return NextResponse.json({ projects: projects.map(toProjectDTO) });
  } catch (error) {
    return errorResponse(error);
  }
}
