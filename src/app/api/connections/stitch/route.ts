import { NextResponse } from 'next/server';
import { getVerifiedUser } from '@/auth';
import { saveConnection } from '@/connections';
import { validateApiKey } from '@/external/stitch';
import { ApiError } from '@/lib/errors';
import { toConnectionDTO } from '@/lib/serialize';
import { routeErrorResponse } from '@/app/api/_shared/connection-errors';
import { readJsonBody } from '@/app/api/_shared/body';
import { disconnectResponse } from '@/app/api/_shared/disconnect';
import { stitchConnectSchema } from '../schemas';

/**
 * `POST /api/connections/stitch` -> stitch.validateApiKey -> connections.saveConnection
 * (API Contracts 10A, FR-086). The pasted key is validated with one read-only
 * Stitch call BEFORE anything is stored, then saved encrypted. NFR-005: the key
 * is never logged, echoed or returned - every error below is a fixed message
 * (no zod `details`, which could carry input, and no SDK text), and the response
 * is the `ConnectionDTO` only.
 */
export async function POST(request: Request) {
  try {
    const user = await getVerifiedUser(request);
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Sign in required.');

    const parsed = stitchConnectSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new ApiError('VALIDATION_ERROR', 'apiKey must be a non-empty string.');
    }
    const { apiKey } = parsed.data;

    const validation = await validateApiKey(apiKey);
    if (!validation.ok) {
      if (validation.reason === 'rejected') {
        throw new ApiError('PROVIDER_KEY_REJECTED', 'Stitch rejected that API key.');
      }
      // API Contracts documents no code for "Stitch could not be reached", so this
      // is the generic 500 (nothing was stored, and the message carries no key).
      throw new Error('Stitch could not be reached to validate the API key.');
    }

    const saved = await saveConnection({
      userId: user.id,
      provider: 'stitch',
      externalAccountId: validation.accountId,
      // Never any part of the key, not even a suffix.
      displayName: validation.label,
      accessToken: apiKey,
      scopes: [],
      providerMeta: {},
    });
    return NextResponse.json(toConnectionDTO(saved));
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/**
 * `DELETE /api/connections/stitch`: this static route shadows the dynamic
 * `[provider]/route.ts` for this path (the App Router prefers the static segment),
 * so it needs its own DELETE or the request answers 405.
 */
export async function DELETE(request: Request) {
  return disconnectResponse(request, 'stitch');
}
