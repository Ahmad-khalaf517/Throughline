import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/external-operations/:operationId
// (API Contracts section 7). No shared `_shared/external` import here, so
// only `@/auth` and `@/external/operations` need mocking.
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getOperationById: vi.fn(),
}));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getOperationById } from '@/external/operations';
import { GET } from '@/app/api/external-operations/[operationId]/route';
import { ApiError } from '@/lib/errors';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetOperationById = vi.mocked(getOperationById);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function makeOperation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'op-1',
    projectId: 'project-1',
    provider: 'github',
    operationType: 'create_repo',
    operationKey: 'github:create_repo:project-1:repo',
    status: 'pending',
    requestHash: 'hash',
    sourceArtifactVersionId: 'arch-v1',
    sourceItemVersionId: null,
    targetDescriptor: { repoName: 'repo' },
    externalId: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function paramsFor(operationId: string) {
  return { params: Promise.resolve({ operationId }) };
}

describe('GET /api/external-operations/:operationId', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetOperationById.mockReset();
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/external-operations/op-1'),
      paramsFor('op-1'),
    );

    expect(response.status).toBe(401);
    expect(mockedGetOperationById).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the operation does not exist', async () => {
    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedGetOperationById.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/external-operations/op-1'),
      paramsFor('op-1'),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockedRequireProjectOwner).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND (never 403) when the operation belongs to a project the caller does not own', async () => {
    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedGetOperationById.mockResolvedValue(makeOperation());
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(
      new Request('http://localhost/api/external-operations/op-1'),
      paramsFor('op-1'),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockedRequireProjectOwner).toHaveBeenCalledWith('user-1', 'project-1');
  });

  it('returns 200 with an ExternalOperationDTO on success', async () => {
    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedGetOperationById.mockResolvedValue(makeOperation({ status: 'reconciliation_required' }));
    mockedRequireProjectOwner.mockResolvedValue(undefined);

    const response = await GET(
      new Request('http://localhost/api/external-operations/op-1'),
      paramsFor('op-1'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: 'op-1',
      provider: 'github',
      status: 'reconciliation_required',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });
});
