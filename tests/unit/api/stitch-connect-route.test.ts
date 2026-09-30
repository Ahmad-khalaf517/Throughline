import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring for POST /api/connections/stitch (API Contracts 10A,
// FR-086, NFR-005). `@/connections` and `@/external/stitch` are mocked (the real
// modules sit on `@/db` and the SDK). The point of most cases is that the pasted
// key reaches `saveConnection` and NOWHERE ELSE: not a response, not a log line.
const {
  FakeConnectionRequiredError,
  FakeReconnectRequiredError,
  validateApiKeyMock,
  saveConnectionMock,
} = vi.hoisted(() => {
  class FakeConnectionRequiredError extends Error {
    provider = 'stitch';
  }
  class FakeReconnectRequiredError extends Error {
    provider = 'stitch';
    reason = 'needs_reauth';
  }
  return {
    FakeConnectionRequiredError,
    FakeReconnectRequiredError,
    validateApiKeyMock: vi.fn(),
    saveConnectionMock: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ getVerifiedUser: vi.fn() }));
vi.mock('@/connections', () => ({
  ConnectionRequiredError: FakeConnectionRequiredError,
  ReconnectRequiredError: FakeReconnectRequiredError,
  saveConnection: saveConnectionMock,
}));
vi.mock('@/external/stitch', () => ({ validateApiKey: validateApiKeyMock }));

import { getVerifiedUser } from '@/auth';
import { POST } from '@/app/api/connections/stitch/route';

const mockedUser = vi.mocked(getVerifiedUser);
const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const KEY = 'AQ.super-secret-stitch-key-0123456789';

function post(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/connections/stitch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

let logSpies: ReturnType<typeof vi.spyOn>[];

function everythingLogged(): string {
  return logSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))))
    .join('\n');
}

beforeEach(() => {
  mockedUser.mockReset().mockResolvedValue(user);
  validateApiKeyMock
    .mockReset()
    .mockResolvedValue({ ok: true, accountId: 'key:0123456789abcdef', label: 'Stitch API key' });
  saveConnectionMock.mockReset().mockResolvedValue({
    provider: 'stitch',
    status: 'active',
    displayName: 'Stitch API key',
    scopes: [],
    connectedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  logSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
});

afterEach(() => {
  logSpies.forEach((spy) => spy.mockRestore());
});

describe('POST /api/connections/stitch', () => {
  it('returns 401 without a verified user and validates nothing', async () => {
    mockedUser.mockResolvedValue(null);

    const response = await POST(post({ apiKey: KEY }));

    expect(response.status).toBe(401);
    expect(validateApiKeyMock).not.toHaveBeenCalled();
    expect(saveConnectionMock).not.toHaveBeenCalled();
  });

  it('validates the key, saves it through connections.saveConnection, and answers the ConnectionDTO', async () => {
    const response = await POST(post({ apiKey: KEY }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      provider: 'stitch',
      status: 'active',
      displayName: 'Stitch API key',
      scopes: [],
      connectedAt: '2026-01-01T00:00:00.000Z',
      site: null,
    });
    expect(validateApiKeyMock).toHaveBeenCalledWith(KEY);
    expect(saveConnectionMock).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'stitch',
      externalAccountId: 'key:0123456789abcdef',
      displayName: 'Stitch API key',
      accessToken: KEY,
      scopes: [],
      providerMeta: {},
    });
  });

  it('trims the pasted key before validating and saving it', async () => {
    await POST(post({ apiKey: `  ${KEY}\n` }));

    expect(validateApiKeyMock).toHaveBeenCalledWith(KEY);
    expect(saveConnectionMock.mock.calls[0]![0].accessToken).toBe(KEY);
  });

  it('the success response and the logs never contain the key (or any part of it)', async () => {
    const response = await POST(post({ apiKey: KEY }));
    const text = await response.text();

    expect(text).not.toContain(KEY);
    expect(text).not.toContain(KEY.slice(-4));
    expect(text).not.toMatch(/apiKey|accessToken/);
    expect(everythingLogged()).not.toContain(KEY);
  });

  it('a rejected key is 422 PROVIDER_KEY_REJECTED, stores nothing, and echoes nothing', async () => {
    validateApiKeyMock.mockResolvedValue({ ok: false, reason: 'rejected' });

    const response = await POST(post({ apiKey: KEY }));

    expect(response.status).toBe(422);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('PROVIDER_KEY_REJECTED');
    expect(text).not.toContain(KEY);
    expect(saveConnectionMock).not.toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(KEY);
  });

  it('an unreachable Stitch is the generic 500 (no contract code), stores nothing, and logs no key', async () => {
    validateApiKeyMock.mockResolvedValue({ ok: false, reason: 'unavailable' });

    const response = await POST(post({ apiKey: KEY }));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('INTERNAL_ERROR');
    expect(text).not.toContain(KEY);
    expect(saveConnectionMock).not.toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(KEY);
  });

  it('a storage failure is a generic 500 that leaks neither the key nor the cause', async () => {
    saveConnectionMock.mockRejectedValue(new Error('A stored-secret failure'));

    const response = await POST(post({ apiKey: KEY }));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('stored-secret');
  });

  it.each([
    ['a missing apiKey', {}],
    ['an empty apiKey', { apiKey: '' }],
    ['a blank apiKey', { apiKey: '   ' }],
    ['a non-string apiKey', { apiKey: 42 }],
    ['an absurdly long apiKey', { apiKey: 'k'.repeat(5000) }],
  ])('%s is 400 VALIDATION_ERROR without echoing the input', async (_name, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('VALIDATION_ERROR');
    expect(text).not.toContain('kkkkkkkk');
    expect(validateApiKeyMock).not.toHaveBeenCalled();
  });

  it('a malformed JSON body is 400 VALIDATION_ERROR', async () => {
    const response = await POST(post('{not json', true));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });
});
