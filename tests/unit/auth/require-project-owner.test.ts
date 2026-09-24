import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireProjectOwner } from '@/auth';
import { ApiError } from '@/lib/errors';

// requireProjectOwner is the sole project-ownership authorization primitive
// (Module Boundaries 4.1) - it reads `project` directly via `@/db`. Mocked
// here (no live Postgres - that's E1-S5's harness, not yet built) so the
// branching logic (malformed id / no row / wrong owner / correct owner) is
// still exercised without standing up integration infra.
//
// `@/lib/env` is mocked too: importing `@/auth` transitively imports it, and
// its top-level `loadEnv()` throws without real Supabase/DB env vars, which
// this unit-test process does not have.
vi.mock('@/lib/env', () => ({
  env: {
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  },
}));

// vi.mock() factories are hoisted above plain `const` declarations, so the
// mock functions the factory below closes over must come from vi.hoisted()
// - a bare `const` here would be a temporal-dead-zone reference at runtime.
const { limitMock, whereMock, fromMock, selectMock } = vi.hoisted(() => {
  const limitMock = vi.fn();
  const whereMock = vi.fn(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return { limitMock, whereMock, fromMock, selectMock };
});

vi.mock('@/db', async () => {
  // The real table definitions (no DB connection needed to import them) -
  // requireProjectOwner's `eq(schema.project.id, ...)` needs real column
  // objects to build a well-formed (if never executed) SQL fragment.
  const schema = await import('@/db/schema');
  return {
    schema,
    db: { select: selectMock },
    withTx: vi.fn(),
  };
});

describe('requireProjectOwner', () => {
  const validProjectId = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    selectMock.mockClear();
    fromMock.mockClear();
    whereMock.mockClear();
    limitMock.mockReset();
  });

  it('rejects a malformed projectId as NOT_FOUND without querying the database', async () => {
    const error = await requireProjectOwner('user-1', 'not-a-uuid').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
    expect((error as ApiError).status).toBe(404);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('rejects a projectId that does not exist as NOT_FOUND, never 403', async () => {
    limitMock.mockResolvedValueOnce([]);
    const error = await requireProjectOwner('user-1', validProjectId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
  });

  it('rejects a project owned by a different user as NOT_FOUND, never 403 (API Contracts 1.4)', async () => {
    limitMock.mockResolvedValueOnce([{ ownerUserId: 'someone-else' }]);
    const error = await requireProjectOwner('user-1', validProjectId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('NOT_FOUND');
    expect((error as ApiError).status).toBe(404);
  });

  it('resolves without throwing when the caller owns the project', async () => {
    limitMock.mockResolvedValueOnce([{ ownerUserId: 'user-1' }]);
    await expect(requireProjectOwner('user-1', validProjectId)).resolves.toBeUndefined();
  });
});
