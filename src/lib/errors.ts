// Framework-glue error helpers shared by route handlers (module 17). If a
// helper here starts knowing about artifact_version.status or any other
// domain state, it belongs in a module instead (Project Setup section 3 rule 3).
import { NextResponse } from 'next/server';

// Subset of API Contracts section 11 wired up so far. A later story adds a
// code here in the same change that starts throwing it - this union is not
// meant to get ahead of what's actually implemented.
//
// The six codes from `PREREQUISITE_NOT_APPROVED` through `REQUEST_CONFLICT`
// are E4-S6's own addition (API Contracts sections 7-10): exactly the codes
// the external-refs/GitHub/Jira/Stitch routes actually throw. The ten codes
// after `REQUEST_CONFLICT` are E3-S10's (API Contracts sections 4-5, the
// artifact/version/item-edit routes), again exactly what those routes throw,
// no more: `DRAFT_EXISTS` is reserved and never fires (API Contracts 4), and
// `NOT_CURRENTLY_FLAGGED` belongs to the acknowledgement routes (E3-S11).
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
  | 'REQUEST_CONFLICT'
  | 'NO_APPROVED_VERSION'
  | 'MANUAL_REVISION_UNSUPPORTED'
  | 'VERSION_NOT_DRAFT'
  | 'ITEM_NOT_IN_VERSION'
  | 'UPSTREAM_REMOVED'
  | 'CONFIRMATION_REQUIRED'
  | 'APPROVAL_BLOCKED'
  | 'STACK_UNCHANGED_DECISIONS'
  | 'OPTION_NOT_SELECTED'
  | 'OPTION_COUNT_INVALID';

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
  NO_APPROVED_VERSION: 409,
  MANUAL_REVISION_UNSUPPORTED: 422,
  VERSION_NOT_DRAFT: 409,
  ITEM_NOT_IN_VERSION: 409,
  UPSTREAM_REMOVED: 409,
  CONFIRMATION_REQUIRED: 409,
  APPROVAL_BLOCKED: 409,
  STACK_UNCHANGED_DECISIONS: 409,
  OPTION_NOT_SELECTED: 422,
  OPTION_COUNT_INVALID: 422,
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
