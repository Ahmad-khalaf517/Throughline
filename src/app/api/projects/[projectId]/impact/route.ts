import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getImpactWarnings } from '@/artifact-lifecycle';
import { ApiError, errorResponse } from '@/lib/errors';
import { toImpactRowDTOs } from '@/app/api/_shared/external';

interface RouteParams {
  params: Promise<{ projectId: string }>;
}

/**
 * `GET /api/projects/:projectId/impact` -> API Contracts section 6: every
 * warning the project reports right now, `{ warnings: ImpactRowDTO[] }` - the
 * warning panel's and the dependency view's data source (ERD 6.3/6.4, INV-025:
 * one engine, no candidate, recomputed on every read).
 *
 * `impact.getWarnings` is reached through `artifact-lifecycle.getImpactWarnings`
 * (layer 6 may not import `impact`), which returns the rows in a deterministic
 * order - `depth`, then root, subject kind, subject id - so the panel does not
 * reshuffle between two identical reads. Each row's root and every entry of its
 * `path` are resolved to display keys in ONE batched lookup (`toImpactRowDTOs`),
 * never one per row: the path is what makes a warning inspectable (INV-023).
 *
 * `[]` is a normal answer - a project with nothing flagged. A project the
 * caller does not own (or that does not exist, or whose id is not a uuid) is
 * `404 NOT_FOUND`, never `403` (API Contracts 1.4).
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { projectId } = await params;
    await requireProjectOwner(user.id, projectId);

    const warnings = await getImpactWarnings(projectId);
    return NextResponse.json({ warnings: await toImpactRowDTOs(warnings) });
  } catch (error) {
    return errorResponse(error);
  }
}
