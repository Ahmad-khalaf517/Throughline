import { disconnectResponse } from '@/app/api/_shared/disconnect';

interface RouteParams {
  params: Promise<{ provider: string }>;
}

/**
 * `DELETE /api/connections/:provider` -> connections.disconnect (API Contracts
 * 10A); see `_shared/disconnect.ts`. Provider folders that own a static route.ts
 * (stitch) shadow this handler and delegate to the same helper.
 */
export async function DELETE(request: Request, { params }: RouteParams) {
  return disconnectResponse(request, (await params).provider);
}
