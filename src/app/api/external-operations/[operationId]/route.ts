import { NextResponse } from 'next/server';
import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getOperationById } from '@/external/operations';
import { ApiError, errorResponse } from '@/lib/errors';
import { toExternalOperationDTO } from '@/lib/serialize';

interface RouteParams {
  params: Promise<{ operationId: string }>;
}

/**
 * `GET /api/external-operations/:operationId` -> API Contracts section 7:
 * the polling target for an operation left `pending`/`reconciliation_required`
 * after its initiating call returned. Resolves `operationId` -> its project
 * FIRST (API Contracts 1.4), then `requireProjectOwner` - identical shape to
 * every other cross-project-safe route.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const { operationId } = await params;
    const operation = await getOperationById(operationId);
    if (!operation) throw new ApiError('NOT_FOUND', 'Operation not found.');

    await requireProjectOwner(user.id, operation.projectId);

    return NextResponse.json(toExternalOperationDTO(operation));
  } catch (error) {
    return errorResponse(error);
  }
}
