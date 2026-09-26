import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { createManualRevisionDraft, getProjectById } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import {
  loadVersionDTO,
  missingPrerequisites,
  parseArtifactType,
} from '@/app/api/_shared/artifacts';

interface RouteParams {
  params: Promise<{ projectId: string; type: string }>;
}

/**
 * `POST /api/projects/:projectId/artifacts/:type/revise` -> API Contracts
 * section 4: `artifact-lifecycle.createManualRevisionDraft` - a new draft with
 * every item unchanged and no model call (ERD 3.6, TR FR-081). No request body.
 *
 * Order (each is a distinct documented error, so the order is part of the
 * contract): `architecture` -> 422 `MANUAL_REVISION_UNSUPPORTED` (ERD 3.6:
 * Architecture is revised by regeneration only, and this holds whatever else is
 * true of the project); a prerequisite without an approved version -> 409
 * `PREREQUISITE_NOT_APPROVED` (`details.missing`); nothing approved of this type
 * yet -> 409 `NO_APPROVED_VERSION`.
 *
 * artifact-lifecycle is called directly - Module Boundaries 4.7's
 * artifact/version-route exception (src/app/api/README.md 4).
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId, type: rawType } = await params;
    await requireProjectOwner(user.id, projectId);
    const type = parseArtifactType(rawType);

    if (type === 'architecture') {
      throw new ApiError(
        'MANUAL_REVISION_UNSUPPORTED',
        'Architecture has no manual revision - regenerate it instead.',
      );
    }

    const project = await getProjectById(projectId);
    if (!project) throw new ApiError('NOT_FOUND', 'Project not found.');

    const missing = missingPrerequisites(project, type);
    if (missing.length) {
      throw new ApiError(
        'PREREQUISITE_NOT_APPROVED',
        `Approve ${missing.join(', ')} before revising ${type}.`,
        { missing },
      );
    }

    if (!project.artifacts[type].approvedVersionId) {
      throw new ApiError('NO_APPROVED_VERSION', `There is no approved ${type} version to revise.`);
    }

    const draft = await createManualRevisionDraft(projectId, type, user.id);
    return NextResponse.json({ version: await loadVersionDTO(draft.id) });
  } catch (error) {
    return errorResponse(error);
  }
}
