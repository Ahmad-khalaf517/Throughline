import { describe, expect, it, vi } from 'vitest';
import { ApiError, errorResponse } from '@/lib/errors';

// API Contracts 1.3 (error shape) and section 11 (code -> status table),
// as far as this story wires them up: VALIDATION_ERROR, UNAUTHENTICATED,
// NOT_FOUND, BRIEF_FROZEN.
describe('ApiError', () => {
  it.each([
    ['VALIDATION_ERROR', 400],
    ['UNAUTHENTICATED', 401],
    ['NOT_FOUND', 404],
    ['BRIEF_FROZEN', 409],
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
