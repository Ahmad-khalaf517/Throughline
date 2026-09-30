import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/stitch/output
// (API Contracts section 10, SCRUM-91).
vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getRefById: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
}));

vi.mock('@/external/stitch', () => ({
  getOutput: vi.fn(),
  getSignedAssetUrls: vi.fn(),
  checkDrift: vi.fn(),
}));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/jira', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getRefById, getDisplayKeysForItemVersions } from '@/external/operations';
import { getOutput, getSignedAssetUrls, checkDrift as checkStitchDrift } from '@/external/stitch';
import { GET } from '@/app/api/projects/[projectId]/stitch/output/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetRefById = vi.mocked(getRefById);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedGetOutput = vi.mocked(getOutput);
const mockedGetSignedAssetUrls = vi.mocked(getSignedAssetUrls);
const mockedCheckStitchDrift = vi.mocked(checkStitchDrift);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function baseProject(uiApproved: string | null = 'ui-v1') {
  const artifacts = emptyArtifactSummaries();
  artifacts.ui_requirements.approvedVersionId = uiApproved;
  return {
    id: 'project-1',
    ownerUserId: 'user-1',
    name: 'x',
    brief: 'y',
    inputContext: null,
    githubOwner: null,
    jiraCloudId: null,
    jiraProjectKey: null,
    createdAt: now,
    updatedAt: now,
    artifacts,
  };
}

function getRequest(): Request {
  return new Request('http://localhost/api/projects/project-1/stitch/output');
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

const apiOutput = {
  id: 'stitch-1',
  mode: 'api',
  externalRefId: 'ref-1',
  promptText: 'Generate...',
} as never;

const stitchRef = {
  id: 'ref-1',
  projectId: 'project-1',
  provider: 'stitch',
  externalId: 'ext-1',
  externalKey: null,
  externalUrl: null,
  sourceArtifactVersionId: 'ui-v1',
  sourceItemVersionId: null,
  metadata: {},
  createdAt: now,
} as never;

describe('GET /api/projects/:projectId/stitch/output', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetRefById.mockReset().mockResolvedValue(stitchRef);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedGetOutput.mockReset();
    mockedGetSignedAssetUrls.mockReset();
    mockedCheckStitchDrift.mockReset().mockResolvedValue(null);

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedGetProjectById.mockResolvedValue(baseProject());
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(getRequest(), paramsFor('project-1'));

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(getRequest(), paramsFor('project-1'));

    expect(response.status).toBe(404);
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when UI Requirements has no approved version', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject(null));

    const response = await GET(getRequest(), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
    expect(mockedGetOutput).not.toHaveBeenCalled();
  });

  it('returns 200 { state: none } when nothing exists yet', async () => {
    mockedGetOutput.mockResolvedValue({ state: 'none' });

    const response = await GET(getRequest(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'none' });
    expect(mockedGetOutput).toHaveBeenCalledWith('ui-v1');
  });

  it('returns 200 { state: generated, mode: api, ref, htmlUrl, screenshotUrl }', async () => {
    mockedGetOutput.mockResolvedValue({ state: 'generated', output: apiOutput });
    mockedGetSignedAssetUrls.mockResolvedValue({
      htmlUrl: 'https://signed/html',
      screenshotUrl: 'https://signed/screenshot',
    });

    const response = await GET(getRequest(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      state: 'generated',
      mode: 'api',
      ref: { id: 'ref-1', provider: 'stitch' },
      htmlUrl: 'https://signed/html',
      screenshotUrl: 'https://signed/screenshot',
    });
    expect(mockedGetRefById).toHaveBeenCalledWith('ref-1');
  });

  it('mints fresh signed URLs on every request (never stored)', async () => {
    mockedGetOutput.mockResolvedValue({ state: 'generated', output: apiOutput });
    mockedGetSignedAssetUrls
      .mockResolvedValueOnce({ htmlUrl: 'https://signed/html-1', screenshotUrl: 'https://s/1' })
      .mockResolvedValueOnce({ htmlUrl: 'https://signed/html-2', screenshotUrl: 'https://s/2' });

    const first = await (await GET(getRequest(), paramsFor('project-1'))).json();
    const second = await (await GET(getRequest(), paramsFor('project-1'))).json();

    expect(mockedGetSignedAssetUrls).toHaveBeenCalledTimes(2);
    expect(first.htmlUrl).toBe('https://signed/html-1');
    expect(second.htmlUrl).toBe('https://signed/html-2');
  });

  it('returns 200 { state: manual_fallback, mode, promptText }', async () => {
    mockedGetOutput.mockResolvedValue({
      state: 'manual_fallback',
      output: { id: 'stitch-1', mode: 'manual_fallback', promptText: 'Generate...' } as never,
    });

    const response = await GET(getRequest(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: 'manual_fallback',
      mode: 'manual_fallback',
      promptText: 'Generate...',
    });
    expect(mockedGetSignedAssetUrls).not.toHaveBeenCalled();
  });

  it.each(['pending', 'reconciliation_required'] as const)(
    'returns 200 { state: in_progress, operationId, status: %s }',
    async (status) => {
      mockedGetOutput.mockResolvedValue({ state: 'in_progress', operationId: 'op-1', status });

      const response = await GET(getRequest(), paramsFor('project-1'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ state: 'in_progress', operationId: 'op-1', status });
    },
  );
});
