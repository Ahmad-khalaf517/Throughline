import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for GET /api/projects/:projectId/jira/preview
// (API Contracts section 9).
const { FakeBacklogVersionNotApprovedError, FakeJiraTargetRequiredError, FakeJiraSiteError } =
  vi.hoisted(() => {
    class FakeBacklogVersionNotApprovedError extends Error {}
    class FakeJiraTargetRequiredError extends Error {
      readonly target = 'jira' as const;
    }
    class FakeJiraSiteError extends Error {}
    return { FakeBacklogVersionNotApprovedError, FakeJiraTargetRequiredError, FakeJiraSiteError };
  });

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getRefsForVersion: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
}));

vi.mock('@/external/jira', () => ({
  previewExport: vi.fn(),
  checkDrift: vi.fn(),
  BacklogVersionNotApprovedError: FakeBacklogVersionNotApprovedError,
  JiraTargetRequiredError: FakeJiraTargetRequiredError,
  JiraSiteNotAccessibleError: FakeJiraSiteError,
}));
vi.mock('@/connections', () => ({
  ConnectionRequiredError: class extends Error {},
  ReconnectRequiredError: class extends Error {},
}));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getDisplayKeysForItemVersions } from '@/external/operations';
import { previewExport } from '@/external/jira';
import { checkDrift as checkJiraDrift } from '@/external/jira';
import { GET } from '@/app/api/projects/[projectId]/jira/preview/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedPreviewExport = vi.mocked(previewExport);
const mockedCheckJiraDrift = vi.mocked(checkJiraDrift);

const user = { id: 'user-1', email: 'a@b.com', displayName: null };
const now = new Date('2024-01-01T00:00:00.000Z');

function baseProject(backlogApproved: string | null = 'backlog-v1') {
  const artifacts = emptyArtifactSummaries();
  artifacts.backlog.approvedVersionId = backlogApproved;
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

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

function request() {
  return new Request('http://localhost/api/projects/project-1/jira/preview');
}

describe('GET /api/projects/:projectId/jira/preview', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedPreviewExport.mockReset();
    mockedCheckJiraDrift.mockReset().mockResolvedValue(null);

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
  });

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(404);
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when Backlog has no approved version', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject(null));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when previewExport reports the version is not approved', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewExport.mockRejectedValue(new FakeBacklogVersionNotApprovedError('not approved'));

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('splits skipped/needsDecision by kind and serializes existingRef', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewExport.mockResolvedValue({
      epics: 2,
      stories: 3,
      skipped: [
        {
          kind: 'skipped',
          logicalItemId: 'li-1',
          displayKey: 'S-02',
          reason: 'epic_has_no_jira_ref',
        },
        {
          kind: 'needs_decision',
          logicalItemId: 'li-2',
          displayKey: 'E-01',
          existingRef: {
            id: 'ref-existing',
            projectId: 'project-1',
            provider: 'jira',
            externalId: 'ext-1',
            externalKey: 'PROJ-1',
            externalUrl: 'https://jira/PROJ-1',
            sourceArtifactVersionId: 'backlog-v0',
            sourceItemVersionId: 'iv-old',
            externalOperationId: 'op-old',
            metadata: {},
            createdAt: now,
          },
        },
      ],
      impact: [],
      connection: { status: 'active', targetReady: true },
    });

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.epics).toBe(2);
    expect(body.stories).toBe(3);
    expect(body.skipped).toEqual([
      { logicalItemId: 'li-1', displayKey: 'S-02', reason: 'epic_has_no_jira_ref' },
    ]);
    expect(body.needsDecision).toHaveLength(1);
    expect(body.needsDecision[0]).toMatchObject({
      logicalItemId: 'li-2',
      displayKey: 'E-01',
      existingRef: { id: 'ref-existing', provider: 'jira' },
    });
    expect(body.impact).toEqual([]);
    // Round 14 (FR-089): the connection block rides along untouched.
    expect(body.connection).toEqual({ status: 'active', targetReady: true });
  });

  it('passes the JiraCtx built from the verified user and the project targets to previewExport', async () => {
    mockedGetProjectById.mockResolvedValue({
      ...baseProject(),
      jiraCloudId: 'cloud-1',
      jiraProjectKey: 'PROJ',
    });
    mockedPreviewExport.mockResolvedValue({
      epics: 0,
      stories: 0,
      skipped: [],
      impact: [],
      connection: { status: 'none', targetReady: true },
    });

    const response = await GET(request(), paramsFor('project-1'));

    expect(response.status).toBe(200);
    expect(mockedPreviewExport).toHaveBeenCalledWith('backlog-v1', {
      userId: 'user-1',
      jiraCloudId: 'cloud-1',
      jiraProjectKey: 'PROJ',
    });
  });

  it('passes a ctx with no target when the project has none, and reports targetReady false', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewExport.mockResolvedValue({
      epics: 1,
      stories: 1,
      skipped: [],
      impact: [],
      connection: { status: 'none', targetReady: false },
    });

    const response = await GET(request(), paramsFor('project-1'));

    expect(mockedPreviewExport).toHaveBeenCalledWith('backlog-v1', { userId: 'user-1' });
    expect((await response.json()).connection).toEqual({ status: 'none', targetReady: false });
  });
});
