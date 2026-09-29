import { describe, expect, it, vi } from 'vitest';

// Layer-6 translation of the connections module's typed errors (API Contracts
// section 11). `@/connections` is mocked with stand-in classes that carry the
// same public fields as the real ones (src/connections/errors.ts) - the real
// module sits on `@/db`/`@/lib/env`, which a unit test cannot load.
const { FakeConnectionRequiredError, FakeReconnectRequiredError } = vi.hoisted(() => {
  class FakeConnectionRequiredError extends Error {
    constructor(readonly provider: string) {
      super(`No ${provider} connection. Connect your ${provider} account first.`);
    }
  }
  class FakeReconnectRequiredError extends Error {
    constructor(
      readonly provider: string,
      readonly reason: string,
      readonly connectionId: string,
    ) {
      super(`The ${provider} connection must be reconnected (${reason}).`);
    }
  }
  return { FakeConnectionRequiredError, FakeReconnectRequiredError };
});

vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
}));

import { routeErrorResponse, translateConnectionError } from '@/app/api/_shared/connection-errors';
import { ApiError } from '@/lib/errors';

describe('translateConnectionError', () => {
  it('maps ConnectionRequiredError to 409 CONNECTION_REQUIRED with the provider', () => {
    const translated = translateConnectionError(new FakeConnectionRequiredError('github'));
    expect(translated).toBeInstanceOf(ApiError);
    expect(translated).toMatchObject({
      code: 'CONNECTION_REQUIRED',
      status: 409,
      details: { provider: 'github' },
    });
  });

  it('maps ReconnectRequiredError to 409 RECONNECT_REQUIRED with provider and reason', () => {
    const translated = translateConnectionError(
      new FakeReconnectRequiredError('jira', 'account_mismatch', 'conn-1'),
    );
    expect(translated).toMatchObject({
      code: 'RECONNECT_REQUIRED',
      status: 409,
      details: { provider: 'jira', reason: 'account_mismatch' },
    });
  });

  it('returns any other error unchanged', () => {
    const other = new Error('boom');
    expect(translateConnectionError(other)).toBe(other);
    const api = new ApiError('NOT_FOUND', 'x');
    expect(translateConnectionError(api)).toBe(api);
  });
});

describe('routeErrorResponse', () => {
  it('answers the documented error shape and never includes the connection id', async () => {
    const response = routeErrorResponse(
      new FakeReconnectRequiredError('github', 'revoked', 'conn-secret-id'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({
      error: {
        code: 'RECONNECT_REQUIRED',
        message: 'The github connection must be reconnected (revoked).',
        details: { provider: 'github', reason: 'revoked' },
      },
    });
    expect(JSON.stringify(body)).not.toContain('conn-secret-id');
  });

  it('answers CONNECTION_REQUIRED as 409', async () => {
    const response = routeErrorResponse(new FakeConnectionRequiredError('stitch'));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('CONNECTION_REQUIRED');
  });

  it('still passes plain ApiErrors through', async () => {
    const response = routeErrorResponse(new ApiError('TARGET_LOCKED', 'locked'));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('TARGET_LOCKED');
  });
});
