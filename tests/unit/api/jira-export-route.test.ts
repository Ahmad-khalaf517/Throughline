import { beforeEach, describe, expect, it, vi } from 'vitest';

// Route-handler wiring test for POST /api/projects/:projectId/jira/export
// (API Contracts section 9).
const { FakeBacklogVersionNotApprovedError } = vi.hoisted(() => {
  class FakeBacklogVersionNotApprovedError extends Error {}
  return { FakeBacklogVersionNotApprovedError };
});

vi.mock('@/auth', () => ({
  getVerifiedUser: vi.fn(),
  requireProjectOwner: vi.fn(),
}));

vi.mock('@/artifact-lifecycle', () => ({
  getProjectById: vi.fn(),
}));

vi.mock('@/artifact-types/backlog', () => ({
  getBacklogVersionMembers: vi.fn(),
}));

vi.mock('@/external/operations', () => ({
  getRefsForVersion: vi.fn(),
  getDisplayKeysForItemVersions: vi.fn(),
  getOperationsForVersion: vi.fn(),
}));

vi.mock('@/external/jira', () => ({
  previewExport: vi.fn(),
  exportBacklog: vi.fn(),
  checkDrift: vi.fn(),
  BacklogVersionNotApprovedError: FakeBacklogVersionNotApprovedError,
}));
vi.mock('@/external/github', () => ({ checkDrift: vi.fn() }));
vi.mock('@/external/stitch', () => ({ checkDrift: vi.fn() }));

import { getVerifiedUser, requireProjectOwner } from '@/auth';
import { getProjectById } from '@/artifact-lifecycle';
import { getBacklogVersionMembers } from '@/artifact-types/backlog';
import { getDisplayKeysForItemVersions, getOperationsForVersion } from '@/external/operations';
import { previewExport, exportBacklog, checkDrift as checkJiraDrift } from '@/external/jira';
import { POST } from '@/app/api/projects/[projectId]/jira/export/route';
import { ApiError } from '@/lib/errors';
import { emptyArtifactSummaries } from '@/lib/serialize';

const mockedGetVerifiedUser = vi.mocked(getVerifiedUser);
const mockedRequireProjectOwner = vi.mocked(requireProjectOwner);
const mockedGetProjectById = vi.mocked(getProjectById);
const mockedGetBacklogVersionMembers = vi.mocked(getBacklogVersionMembers);
const mockedGetDisplayKeys = vi.mocked(getDisplayKeysForItemVersions);
const mockedGetOperationsForVersion = vi.mocked(getOperationsForVersion);
const mockedPreviewExport = vi.mocked(previewExport);
const mockedExportBacklog = vi.mocked(exportBacklog);
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
    createdAt: now,
    updatedAt: now,
    artifacts,
  };
}

function makeRef(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'ref-1',
    projectId: 'project-1',
    provider: 'jira',
    externalId: 'ext-1',
    externalKey: 'PROJ-1',
    externalUrl: 'https://jira/PROJ-1',
    sourceArtifactVersionId: 'backlog-v1',
    sourceItemVersionId: null,
    externalOperationId: 'op-1',
    metadata: {},
    createdAt: now,
    ...overrides,
  };
}

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/projects/project-1/jira/export', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function paramsFor(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

const needsDecisionPreviewItem = {
  kind: 'needs_decision' as const,
  logicalItemId: 'li-decide',
  displayKey: 'S-01',
  existingRef: makeRef({ id: 'ref-old', sourceItemVersionId: 'iv-decide-old' }),
};
const skippedPreviewItem = {
  kind: 'skipped' as const,
  logicalItemId: 'li-skip-parent',
  displayKey: 'S-99',
  reason: 'epic_has_no_jira_ref' as const,
};

describe('POST /api/projects/:projectId/jira/export', () => {
  beforeEach(() => {
    mockedGetVerifiedUser.mockReset();
    mockedRequireProjectOwner.mockReset();
    mockedGetProjectById.mockReset();
    mockedGetBacklogVersionMembers.mockReset().mockResolvedValue([]);
    mockedGetDisplayKeys.mockReset().mockResolvedValue(new Map());
    mockedGetOperationsForVersion.mockReset().mockResolvedValue([]);
    mockedPreviewExport.mockReset();
    mockedExportBacklog.mockReset().mockResolvedValue([]);
    mockedCheckJiraDrift.mockReset().mockResolvedValue(null);

    mockedGetVerifiedUser.mockResolvedValue(user);
    mockedRequireProjectOwner.mockResolvedValue(undefined);
    mockedGetProjectById.mockResolvedValue(baseProject());
    mockedPreviewExport.mockResolvedValue({
      epics: 1,
      stories: 3,
      skipped: [skippedPreviewItem, needsDecisionPreviewItem],
      impact: [],
    });
  });

  function validBody(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      decisions: [{ logicalItemId: 'li-decide', decision: 'create_new' }],
      impactAcknowledged: true,
      ...overrides,
    };
  }

  it('returns 401 UNAUTHENTICATED when there is no verified user', async () => {
    mockedGetVerifiedUser.mockResolvedValue(null);

    const response = await POST(postRequest(validBody()), paramsFor('project-1'));

    expect(response.status).toBe(401);
  });

  it('returns 404 NOT_FOUND (never 403) when the caller does not own the project', async () => {
    mockedRequireProjectOwner.mockRejectedValue(new ApiError('NOT_FOUND', 'Project not found.'));

    const response = await POST(postRequest(validBody()), paramsFor('project-1'));

    expect(response.status).toBe(404);
  });

  it('returns 400 VALIDATION_ERROR for a malformed decision value', async () => {
    const response = await POST(
      postRequest({
        decisions: [{ logicalItemId: 'li-decide', decision: 'nope' }],
        impactAcknowledged: true,
      }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when Backlog has no approved version', async () => {
    mockedGetProjectById.mockResolvedValue(baseProject(null));

    const response = await POST(postRequest(validBody()), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 409 PREREQUISITE_NOT_APPROVED when previewExport reports the version is not approved', async () => {
    mockedPreviewExport.mockRejectedValue(new FakeBacklogVersionNotApprovedError('not approved'));

    const response = await POST(postRequest(validBody()), paramsFor('project-1'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('PREREQUISITE_NOT_APPROVED');
  });

  it('returns 400 VALIDATION_ERROR when a needsDecision item is missing from decisions', async () => {
    const response = await POST(
      postRequest({ decisions: [], impactAcknowledged: true }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mockedExportBacklog).not.toHaveBeenCalled();
  });

  it('returns 409 IMPACT_NOT_ACKNOWLEDGED with details.impact when impact is unacknowledged', async () => {
    mockedPreviewExport.mockResolvedValue({
      epics: 1,
      stories: 3,
      skipped: [skippedPreviewItem, needsDecisionPreviewItem],
      impact: [
        {
          subjectKind: 'item_version',
          subjectId: 'iv-decide',
          rootItemVersionId: 'iv-req',
          depth: 1,
          path: ['iv-req', 'iv-decide'],
          acknowledged: false,
        },
      ],
    });
    mockedGetDisplayKeys.mockResolvedValue(
      new Map([
        ['iv-req', 'R-01'],
        ['iv-decide', 'S-01'],
      ]),
    );

    const response = await POST(
      postRequest({ ...validBody(), impactAcknowledged: false }),
      paramsFor('project-1'),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('IMPACT_NOT_ACKNOWLEDGED');
    expect(body.error.details.impact[0]).toMatchObject({ rootDisplayKey: 'R-01' });
    expect(mockedExportBacklog).not.toHaveBeenCalled();
  });

  it('re-derives created/skipped/failures from the preview list and the operation rows', async () => {
    mockedGetBacklogVersionMembers.mockResolvedValue([
      {
        logicalItemId: 'li-epic',
        itemVersionId: 'iv-epic',
        displayKey: 'E-01',
        itemType: 'epic',
        parentLogicalItemId: null,
        sourceVersionId: 'backlog-v1',
        projectId: 'project-1',
        status: 'approved',
      },
      {
        logicalItemId: 'li-decide',
        itemVersionId: 'iv-decide',
        displayKey: 'S-01',
        itemType: 'story',
        parentLogicalItemId: 'li-epic',
        sourceVersionId: 'backlog-v1',
        projectId: 'project-1',
        status: 'approved',
      },
      {
        logicalItemId: 'li-fail',
        itemVersionId: 'iv-fail',
        displayKey: 'S-02',
        itemType: 'story',
        parentLogicalItemId: 'li-epic',
        sourceVersionId: 'backlog-v1',
        projectId: 'project-1',
        status: 'approved',
      },
      {
        logicalItemId: 'li-skip-parent',
        itemVersionId: 'iv-skip-parent',
        displayKey: 'S-99',
        itemType: 'story',
        parentLogicalItemId: null,
        sourceVersionId: 'backlog-v1',
        projectId: 'project-1',
        status: 'approved',
      },
    ] as never);

    const refEpic = makeRef({ id: 'ref-epic', sourceItemVersionId: 'iv-epic' });
    const refDecide = makeRef({ id: 'ref-decide', sourceItemVersionId: 'iv-decide' });
    mockedExportBacklog.mockResolvedValue([refEpic, refDecide]);

    mockedGetOperationsForVersion.mockResolvedValue([
      { id: 'op-epic', status: 'completed', sourceItemVersionId: 'iv-epic' },
      { id: 'op-decide', status: 'completed', sourceItemVersionId: 'iv-decide' },
      { id: 'op-fail', status: 'failed', sourceItemVersionId: 'iv-fail' },
    ] as never);

    const response = await POST(postRequest(validBody()), paramsFor('project-1'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(mockedExportBacklog).toHaveBeenCalledWith(
      'backlog-v1',
      new Map([['li-decide', 'create_new']]),
    );
    expect(body.created).toHaveLength(2);
    expect(body.created.map((r: { id: string }) => r.id).sort()).toEqual([
      'ref-decide',
      'ref-epic',
    ]);
    expect(body.skipped).toEqual([{ logicalItemId: 'li-skip-parent' }]);
    expect(body.failures).toEqual([
      { logicalItemId: 'li-fail', operationId: 'op-fail', status: 'failed' },
    ]);
  });
});
