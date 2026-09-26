// Framework-glue error helpers shared by route handlers (module 17). If a
// helper here starts knowing about artifact_version.status or any other
// domain state, it belongs in a module instead (Project Setup section 3 rule 3).
import { NextResponse } from 'next/server';

// Subset of API Contracts section 11 wired up so far. A later story adds a
// code here in the same change that starts throwing it - this union is not
// meant to get ahead of what's actually implemented.
//
// The six codes below `BRIEF_FROZEN` are E4-S6's own addition (API Contracts
// sections 7-10): exactly the codes the external-refs/GitHub/Jira/Stitch
// routes actually throw, no more (`APPROVAL_BLOCKED`, `OPTION_NOT_SELECTED`,
// etc. belong to routes this story doesn't build).
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'NOT_FOUND'
  | 'BRIEF_FROZEN'
  | 'PREREQUISITE_NOT_APPROVED'
  | 'IMPACT_NOT_ACKNOWLEDGED'
  | 'GITHUB_ALREADY_INITIALIZED'
  | 'NAME_TAKEN_BY_OTHER'
  | 'ALREADY_GENERATED'
  | 'REQUEST_CONFLICT';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  BRIEF_FROZEN: 409,
  PREREQUISITE_NOT_APPROVED: 409,
  IMPACT_NOT_ACKNOWLEDGED: 409,
  GITHUB_ALREADY_INITIALIZED: 409,
  NAME_TAKEN_BY_OTHER: 409,
  ALREADY_GENERATED: 409,
  REQUEST_CONFLICT: 409,
};

// The one error shape every route handler throws and every response maps
// from - matches API Contracts 1.3's response body exactly:
// `{ error: { code, message, details? } }`.
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

// Converts anything a route handler's try/catch caught into the right
// NextResponse. An error that isn't an ApiError is a bug, not a validated
// client-facing failure - logged and returned as a generic 500 rather than
// leaking internals into the response body.
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      { status: error.status },
    );
  }

  console.error('Unhandled route error:', error);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
    { status: 500 },
  );
}
