import { beforeEach, describe, expect, it, vi } from 'vitest';

// DELETE /api/connections/stitch. `connections/stitch/route.ts` is a static
// segment, so it shadows `[provider]/route.ts` for this path and must carry its
// own DELETE handler (else 405). `@/connections` is mocked.
const { listConnectionsMock, disconnectMock } = vi.hoisted(() => ({
  listConnectionsMock: vi.fn(),
  disconnectMock: vi.fn(),
}));

vi.mock('@/auth', () => ({ getVerifiedUser: vi.fn() }));
vi.mock('@/connections', () => ({
  ConnectionRequiredError: class extends Error {},
  ReconnectRequiredError: class extends Error {},
  saveConnection: vi.fn(),
  listConnections: listConnectionsMock,
  disconnect: disconnectMock,
}));
vi.mock('@/external/stitch', () => ({ validateApiKey: vi.fn() }));

import { getVerifiedUser } from '@/auth';
import { DELETE } from '@/app/api/connections/stitch/route';

const mockedUser = vi.mocked(getVerifiedUser);
const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const del = () =>
  DELETE(new Request('http://localhost/api/connections/stitch', { method: 'DELETE' }));

beforeEach(() => {
  mockedUser.mockReset().mockResolvedValue(user);
  listConnectionsMock.mockReset();
  disconnectMock.mockReset();
});

describe('DELETE /api/connections/stitch', () => {
  it('returns 401 without a verified user and disconnects nothing', async () => {
    mockedUser.mockResolvedValue(null);
    expect((await del()).status).toBe(401);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('404 NOT_FOUND when nothing is connected', async () => {
    listConnectionsMock.mockResolvedValue([
      { provider: 'stitch', status: 'none', displayName: null, scopes: [], connectedAt: null },
    ]);
    const response = await del();
    expect(response.status).toBe(404);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('200 { providerRevoked: null } when connected (Stitch has no revocation API)', async () => {
    listConnectionsMock.mockResolvedValue([
      {
        provider: 'stitch',
        status: 'active',
        displayName: 'k',
        scopes: [],
        connectedAt: new Date(0),
      },
    ]);
    disconnectMock.mockResolvedValue({ providerRevoked: null });

    const response = await del();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providerRevoked: null });
    expect(disconnectMock).toHaveBeenCalledWith('user-1', 'stitch');
  });
});
