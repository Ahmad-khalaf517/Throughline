// Layer-6 translation of the `connections` module's typed errors into the API
// error codes of API Contracts section 11 (round 14). Lives here, not in
// `lib/errors.ts`, because lib may not import `connections` (layer 3b). A route
// that can reach a provider call wraps its handler's catch with
// `routeErrorResponse` instead of `errorResponse`.
//
// The response carries only the provider name and, for a reconnect, the reason
// enum - never a token, connection id or provider text (NFR-005).
import type { NextResponse } from 'next/server';
import { ConnectionRequiredError, ReconnectRequiredError } from '@/connections';
import { ApiError, errorResponse } from '@/lib/errors';

/** `ConnectionRequiredError` -> 409 `CONNECTION_REQUIRED`, `ReconnectRequiredError` -> 409 `RECONNECT_REQUIRED`; anything else is returned unchanged. */
export function translateConnectionError(error: unknown): unknown {
  if (error instanceof ConnectionRequiredError) {
    return new ApiError('CONNECTION_REQUIRED', error.message, { provider: error.provider });
  }
  if (error instanceof ReconnectRequiredError) {
    return new ApiError('RECONNECT_REQUIRED', error.message, {
      provider: error.provider,
      reason: error.reason,
    });
  }
  return error;
}

/** `errorResponse` with the connection-error translation applied first. */
export function routeErrorResponse(error: unknown): NextResponse {
  return errorResponse(translateConnectionError(error));
}
