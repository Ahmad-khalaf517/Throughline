import { describe, expect, it, vi } from 'vitest';
import { ApiError, errorResponse } from '@/lib/errors';

// API Contracts 1.3 (error shape) and section 11 (code -> status table),
// as far as the routes built so far wire them up: the first four are E1's,
// the ten after them are E3-S10's artifact/version/item-edit routes (API
// Contracts sections 4-5). `DRAFT_EXISTS` (reserved) and `NOT_CURRENTLY_FLAGGED`
// (E3-S11's) are deliberately absent from ErrorCode.
describe('ApiError', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['UNAUTHENTICATED', 401],
    ['NOT_FOUND', 404],
    ['BRIEF_FROZEN', 409],
    ['NO_APPROVED_VERSION', 409],
    ['MANUAL_REVISION_UNSUPPORTED', 422],
    ['VERSION_NOT_DRAFT', 409],
    ['ITEM_NOT_IN_VERSION', 409],
    ['UPSTREAM_REMOVED', 409],
    ['CONFIRMATION_REQUIRED', 409],
    ['APPROVAL_BLOCKED', 409],
    ['STACK_UNCHANGED_DECISIONS', 409],
    ['OPTION_NOT_SELECTED', 422],
    ['OPTION_COUNT_INVALID', 422],
  ] as const)('maps %s to status %i', (code, status) => {
    const error = new ApiError(code, 'message');
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.message).toBe('message');
    expect(error).toBeInstanceOf(Error);
  });

  it('carries optional details through', () => {
    const error = new ApiError('VALIDATION_ERROR', 'bad body', { field: 'name' });
    expect(error.details).toEqual({ field: 'name' });
  });

  it('serializes an approval-blocked 409 with its details, as API Contracts 4 documents it', async () => {
    const blocking = [{ subjectId: 'iv-1', rootDisplayKey: 'R-01' }];
    const response = errorResponse(
      new ApiError('APPROVAL_BLOCKED', 'Approval is blocked.', { blocking }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'APPROVAL_BLOCKED', message: 'Approval is blocked.', details: { blocking } },
    });
  });
});

describe('errorResponse', () => {
  it('serializes an ApiError into the documented { error: { code, message } } shape', async () => {
    const response = errorResponse(new ApiError('NOT_FOUND', 'Project not found.'));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: 'NOT_FOUND', message: 'Project not found.' },
    });
  });

  it('includes details only when present', async () => {
    const response = errorResponse(
      new ApiError('VALIDATION_ERROR', 'Invalid request body.', { formErrors: ['name required'] }),
    );
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body.',
        details: { formErrors: ['name required'] },
      },
    });
  });

  it('maps an unrecognized error to a generic 500 without leaking internals', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = errorResponse(new Error('some internal secret detail'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('secret');
    consoleSpy.mockRestore();
  });
});
