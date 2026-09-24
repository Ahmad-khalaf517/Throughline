import { beforeEach, describe, expect, it, vi } from 'vitest';

// Layer-6 route handler test (API Contracts section 2): no DB, no
// Testcontainers - `@/auth` is mocked outright so this stays in the `unit`
// vitest project (tests/unit/**, no DB per vitest.config.ts).
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  upsertAppUser: vi.fn(),
  getAppUserById: vi.fn(),
}));

import { getAppUserById, getVerifiedUser, upsertAppUser } from '@/auth';
import { POST } from '@/app/api/session/bootstrap/route';

function bootstrapRequest() {
  return new Request('http://localhost/api/session/bootstrap', { method: 'POST' });
}

describe('POST /api/session/bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 UNAUTHENTICATED and never upserts when there is no verified session', async () => {
    vi.mocked(getVerifiedUser).mockResolvedValue(null);

    const response = await POST(bootstrapRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String) },
    });
    expect(upsertAppUser).not.toHaveBeenCalled();
    expect(getAppUserById).not.toHaveBeenCalled();
  });

  it('upserts the verified user and returns the persisted displayName', async () => {
    const user = { id: 'user-1', email: 'ahmadkhalaf517@gmail.com', displayName: 'Ahmad Khalaf' };
    vi.mocked(getVerifiedUser).mockResolvedValue(user);
    vi.mocked(getAppUserById).mockResolvedValue({
      id: user.id,
      email: user.email,
      displayName: 'Ahmad Khalaf',
    } as never);

    const response = await POST(bootstrapRequest());
    const body = await response.json();

    expect(upsertAppUser).toHaveBeenCalledWith(user);
    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: { id: user.id, email: user.email, displayName: 'Ahmad Khalaf' },
    });
  });

  it('returns displayName: null when the persisted app_user row has none', async () => {
    const user = { id: 'user-2', email: 'new-user@example.com', displayName: null };
    vi.mocked(getVerifiedUser).mockResolvedValue(user);
    vi.mocked(getAppUserById).mockResolvedValue({
      id: user.id,
      email: user.email,
      displayName: null,
    } as never);

    const response = await POST(bootstrapRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      user: { id: user.id, email: user.email, displayName: null },
    });
  });
});
