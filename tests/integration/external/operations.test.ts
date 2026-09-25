import { afterAll, beforeAll, describe, expect, it, inject, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { connect } from '../support/connection';
import * as fx from '../support/fixtures';

// external/operations's real runOperation/getRefsForVersion/getRefForItem
// (Jira SCRUM-48 / E4-S1, Module Boundaries 4.5, ERD section 7.2) - the
// insert-first/lock/decide protocol, exercised against real Testcontainers
// Postgres, real advisory locks, real CHECK/FK constraints. Cited by R##
// (ERD section 9's concurrency table) and INV/FR id, not T## id: T11/T18
// (the ERD test ids Module Boundaries cites for this area) are explicitly
// deferred to E4-T3, the slice-4 end-to-end gate through real API routes -
// see tests/integration/appendix-c.test.ts's own `it.todo('T11')`/
// `it.todo('T18')`, both commented "Turns green with E4-T3", untouched by
// this file. The GitHub project-exclusivity behavior this file tests for
// real (T18's third clause: "a second concurrent GitHub operation is
// refused") is still real, tested behavior here - it just doesn't close
// T18 itself, the same deferral pattern E2-S8 used for its own cited T##
// ids against impact.test.ts.
//
// Same dynamic-import-after-env-setup pattern as impact.test.ts (that
// file's own comment explains why): @/external/operations pulls in @/db,
// which reads DATABASE_URL from @/lib/env at MODULE-IMPORT time, so the
// Testcontainers connection string (and Supabase-auth env stand-ins the
// module never touches) must be in `process.env` BEFORE the first
// `await import('@/external/operations')`, or `loadEnv()`'s eager
// `envSchema.safeParse()` throws. Fixture setup still goes through the raw
// `postgres`/`fx.*` helpers so every scenario is built through the real
// triggers/CHECKs; only the calls under test go through the dynamically
// imported real module.

let sql: postgres.Sql;
let runOperation: typeof import('@/external/operations').runOperation;
let getRefsForVersion: typeof import('@/external/operations').getRefsForVersion;
let getRefForItem: typeof import('@/external/operations').getRefForItem;
let DefinitiveProviderError: typeof import('@/external/operations').DefinitiveProviderError;

beforeAll(async () => {
  sql = connect();

  const connectionUri = inject('pgConnectionUri');
  process.env.DATABASE_URL = connectionUri;
  process.env.DIRECT_DATABASE_URL = connectionUri;
  // Required by src/lib/env.ts's envSchema but never exercised by this
  // module's code path - valid-shaped stand-ins only.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';

  const ops = await import('@/external/operations');
  runOperation = ops.runOperation;
  getRefsForVersion = ops.getRefsForVersion;
  getRefForItem = ops.getRefForItem;
  DefinitiveProviderError = ops.DefinitiveProviderError;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// A fresh project + one artifact + one draft artifact_version - the minimum
// real `source_artifact_version_id` every external_operation/external_ref
// row's FK requires. `artifactType` defaults to 'architecture' (GitHub's own
// source per ERD 7.3) since most scenarios below don't care which type.
async function setupProject(
  artifactType: fx.ArtifactType = 'architecture',
): Promise<{ projectId: string; artifactId: string; versionId: string }> {
  const { projectId } = await fx.createProjectWithOwner(sql);
  const artifactId = await fx.createArtifact(sql, projectId, artifactType);
  const versionId = await fx.createDraftArtifactVersion(sql, artifactId);
  return { projectId, artifactId, versionId };
}

// Jira operations are item-scoped (ERD 4.14's provider/item CHECK): a real
// membership row is required, so the composite FK to
// artifact_version_item_membership is satisfied.
async function setupJiraProject(): Promise<{
  projectId: string;
  artifactId: string;
  versionId: string;
  itemVersionId: string;
}> {
  const { projectId, artifactId, versionId } = await setupProject('backlog');
  const { logicalItemId, itemVersionId } = await fx.createLogicalItemWithVersion(sql, {
    projectId,
    artifactId,
    itemType: 'story',
  });
  await fx.createMembership(sql, {
    artifactVersionId: versionId,
    artifactId,
    logicalItemId,
    itemVersionId,
  });
  return { projectId, artifactId, versionId, itemVersionId };
}

async function operationRow(operationKey: string) {
  const [row] = await sql<
    { status: string; error_message: string | null; external_id: string | null }[]
  >`
    select status, error_message, external_id from external_operation where operation_key = ${operationKey}
  `;
  return row;
}

describe('runOperation', () => {
  it('winner path: a fresh operationKey wins the insert and calls send() once (ERD 7.2 steps 1-2)', async () => {
    const { projectId, versionId } = await setupProject('ui_requirements');
    const operationKey = `stitch:generate:${versionId}`;
    const send = vi.fn(async () => ({ externalId: 'stitch-1', metadata: { mode: 'api' } }));
    const reconcile = vi.fn(async () => ({ found: false as const }));

    const result = await runOperation({
      projectId,
      provider: 'stitch',
      operationType: 'generate_ui',
      operationKey,
      requestHash: 'hash-winner',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send,
      reconcile,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(reconcile).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.ref.externalId).toBe('stitch-1');
      expect(result.ref.provider).toBe('stitch');
      expect(result.ref.sourceArtifactVersionId).toBe(versionId);
    }

    const refs = await getRefsForVersion(versionId);
    expect(refs).toHaveLength(1);
    expect((await operationRow(operationKey))?.status).toBe('completed');
  });

  it('losing path, matching hash, status completed -> idempotent return, no second send() (ERD 7.2 step 3.b)', async () => {
    const { projectId, versionId } = await setupProject('architecture');
    const operationKey = `github:create_repo:${projectId}:idempotent-demo`;
    const requestHash = 'hash-idempotent';
    const operationId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'github',
      operationKey,
      requestHash,
      status: 'completed',
      sourceArtifactVersionId: versionId,
      externalId: 'repo-idempotent',
    });
    const refId = await fx.createExternalRef(sql, {
      projectId,
      provider: 'github',
      externalOperationId: operationId,
      sourceArtifactVersionId: versionId,
      externalId: 'repo-idempotent',
    });

    const send = vi.fn();
    const reconcile = vi.fn();
    const result = await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey,
      requestHash,
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send,
      reconcile,
    });

    expect(send).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.ref.id).toBe(refId);
  });

  it('hash mismatch on an existing row (any status, including completed) -> conflict, no send()/reconcile() (R11)', async () => {
    const { projectId, versionId, itemVersionId } = await setupJiraProject();
    const operationKey = `jira:create_issue:PROJ:${itemVersionId}`;
    const operationId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'jira',
      operationKey,
      requestHash: 'hash-original',
      status: 'completed',
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
      externalId: 'JIRA-1',
    });
    await fx.createExternalRef(sql, {
      projectId,
      provider: 'jira',
      externalOperationId: operationId,
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
      externalId: 'JIRA-1',
      externalKey: 'THR-1',
    });

    const send = vi.fn();
    const reconcile = vi.fn();
    const result = await runOperation({
      projectId,
      provider: 'jira',
      operationType: 'create_issue',
      operationKey,
      requestHash: 'hash-reconfigured', // e.g. a reconfigured Jira project (R11)
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
      send,
      reconcile,
    });

    expect(result).toEqual({ status: 'conflict' });
    expect(send).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('a pending row within T is rejected as in_flight, simulating a double-click, no send()/reconcile() (R5)', async () => {
    const { projectId, versionId } = await setupProject('ui_requirements');
    const operationKey = `stitch:generate:${versionId}`;
    const requestHash = 'hash-inflight';
    await fx.createExternalOperation(sql, {
      projectId,
      provider: 'stitch',
      operationKey,
      requestHash,
      status: 'pending',
      sourceArtifactVersionId: versionId,
    });

    const send = vi.fn();
    const reconcile = vi.fn();
    const result = await runOperation({
      projectId,
      provider: 'stitch',
      operationType: 'generate_ui',
      operationKey,
      requestHash,
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send,
      reconcile,
    });

    expect(result).toEqual({ status: 'in_flight' });
    expect(send).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  describe('a pending row older than T (R10)', () => {
    // `updated_at` can only be moved forward by the DB's own
    // touch_updated_at trigger (an UPDATE always sets it to the server's
    // now(), regardless of what's assigned) - so "older than T" is
    // simulated by faking the APPLICATION clock forward instead, not by
    // backdating the row. Only `Date` is faked (not setTimeout/etc.), so
    // the real Testcontainers network I/O underneath withTx is unaffected.
    async function withClockAdvanced<T>(fn: () => Promise<T>): Promise<T> {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(Date.now() + 95_000); // T (90s for stitch) + margin
        return await fn();
      } finally {
        vi.useRealTimers();
      }
    }

    it('flips to reconciliation_required and calls reconcile() - found finalizes as completed', async () => {
      const { projectId, versionId } = await setupProject('ui_requirements');
      const operationKey = `stitch:generate:${versionId}`;
      const requestHash = 'hash-stale-found';
      await fx.createExternalOperation(sql, {
        projectId,
        provider: 'stitch',
        operationKey,
        requestHash,
        status: 'pending',
        sourceArtifactVersionId: versionId,
      });

      const send = vi.fn();
      const reconcile = vi.fn(async () => ({ found: true as const, externalId: 'stitch-found-1' }));

      const result = await withClockAdvanced(() =>
        runOperation({
          projectId,
          provider: 'stitch',
          operationType: 'generate_ui',
          operationKey,
          requestHash,
          targetDescriptor: {},
          sourceArtifactVersionId: versionId,
          send,
          reconcile,
        }),
      );

      expect(send).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('completed');
      if (result.status === 'completed') expect(result.ref.externalId).toBe('stitch-found-1');
      expect((await operationRow(operationKey))?.status).toBe('completed');
    });

    it('flips to reconciliation_required and calls reconcile() - not found stays reconciliation_required (TR 30.2)', async () => {
      const { projectId, versionId } = await setupProject('ui_requirements');
      const operationKey = `stitch:generate:${versionId}`;
      const requestHash = 'hash-stale-not-found';
      await fx.createExternalOperation(sql, {
        projectId,
        provider: 'stitch',
        operationKey,
        requestHash,
        status: 'pending',
        sourceArtifactVersionId: versionId,
      });

      const send = vi.fn();
      const reconcile = vi.fn(async () => ({ found: false as const }));

      const result = await withClockAdvanced(() =>
        runOperation({
          projectId,
          provider: 'stitch',
          operationType: 'generate_ui',
          operationKey,
          requestHash,
          targetDescriptor: {},
          sourceArtifactVersionId: versionId,
          send,
          reconcile,
        }),
      );

      expect(send).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledTimes(1);
      // Not found: user must confirm an explicit retry (TR 30.2) - never
      // resolved automatically here.
      expect(result).toEqual({ status: 'reconciliation_required' });
      expect((await operationRow(operationKey))?.status).toBe('reconciliation_required');
    });
  });

  it('a reconciliation_required row calls reconcile() again on a subsequent call', async () => {
    const { projectId, versionId, itemVersionId } = await setupJiraProject();
    const operationKey = `jira:create_issue:PROJ:${itemVersionId}`;
    const requestHash = 'hash-recon-again';
    await fx.createExternalOperation(sql, {
      projectId,
      provider: 'jira',
      operationKey,
      requestHash,
      status: 'reconciliation_required',
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
    });

    const send = vi.fn();
    const reconcile = vi.fn(async () => ({
      found: true as const,
      externalId: 'JIRA-2',
      externalKey: 'THR-2',
    }));
    const result = await runOperation({
      projectId,
      provider: 'jira',
      operationType: 'create_issue',
      operationKey,
      requestHash,
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
      send,
      reconcile,
    });

    expect(send).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    if (result.status === 'completed') expect(result.ref.externalKey).toBe('THR-2');
  });

  it('a failed row is retried: status flips to pending and send() is called again (ERD 7.2 step 3.b)', async () => {
    const { projectId, versionId } = await setupProject('ui_requirements');
    const operationKey = `stitch:generate:${versionId}`;
    const requestHash = 'hash-retry';
    await fx.createExternalOperation(sql, {
      projectId,
      provider: 'stitch',
      operationKey,
      requestHash,
      status: 'failed',
      sourceArtifactVersionId: versionId,
    });

    const send = vi.fn(async () => ({ externalId: 'stitch-retry-1' }));
    const reconcile = vi.fn();
    const result = await runOperation({
      projectId,
      provider: 'stitch',
      operationType: 'generate_ui',
      operationKey,
      requestHash,
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send,
      reconcile,
    });

    expect(reconcile).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect((await operationRow(operationKey))?.status).toBe('completed');
  });

  it('send() throwing DefinitiveProviderError ends the row failed with the message', async () => {
    const { projectId, versionId } = await setupProject('architecture');
    const operationKey = `github:create_repo:${projectId}:taken-name`;
    const send = vi.fn(async () => {
      throw new DefinitiveProviderError('name_taken_by_other');
    });
    const reconcile = vi.fn();

    const result = await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey,
      requestHash: 'hash-definitive',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send,
      reconcile,
    });

    expect(result).toEqual({ status: 'failed', errorMessage: 'name_taken_by_other' });
    const row = await operationRow(operationKey);
    expect(row?.status).toBe('failed');
    expect(row?.error_message).toBe('name_taken_by_other');
  });

  it('send() throwing a plain error leaves the row pending and rethrows out of runOperation (R6, R9)', async () => {
    const { projectId, versionId } = await setupProject('ui_requirements');
    const operationKey = `stitch:generate:${versionId}`;
    const send = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const reconcile = vi.fn();

    await expect(
      runOperation({
        projectId,
        provider: 'stitch',
        operationType: 'generate_ui',
        operationKey,
        requestHash: 'hash-ambiguous',
        targetDescriptor: {},
        sourceArtifactVersionId: versionId,
        send,
        reconcile,
      }),
    ).rejects.toThrow('ECONNRESET');

    expect(reconcile).not.toHaveBeenCalled();
    // Never classified as failed - the pending row is left for a LATER
    // call's step 3 to reconcile (ERD 7.2: "Timeouts, 5xx and lost
    // responses are never `failed`: they go to reconciliation_required").
    expect((await operationRow(operationKey))?.status).toBe('pending');
  });
});

describe('GitHub project-exclusivity (ERD 4.15 line ~515)', () => {
  it('refuses a second concurrent GitHub operation for the same project while the first is active', async () => {
    const { projectId, versionId } = await setupProject('architecture');
    const firstKey = `github:create_repo:${projectId}:name-a`;
    const first = await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: firstKey,
      requestHash: 'hash-a',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send: vi.fn(async () => ({ externalId: 'repo-a' })),
      reconcile: vi.fn(),
    });
    expect(first.status).toBe('completed');

    const secondKey = `github:create_repo:${projectId}:name-b`;
    const send2 = vi.fn();
    const second = await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: secondKey,
      requestHash: 'hash-b',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send: send2,
      reconcile: vi.fn(),
    });

    expect(second).toEqual({ status: 'refused', reason: 'github_operation_already_active' });
    expect(send2).not.toHaveBeenCalled();

    // Refused before any insert was attempted - only the first operation
    // row exists for this project+github.
    const rows = await sql<{ operation_key: string }[]>`
      select operation_key from external_operation
      where project_id = ${projectId} and provider = 'github'
    `;
    expect(rows.map((r) => r.operation_key)).toEqual([firstKey]);
  });

  it("a non-GitHub provider is unaffected by another provider's active GitHub operation", async () => {
    const { projectId, versionId } = await setupProject('architecture');
    await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: `github:create_repo:${projectId}:name-c`,
      requestHash: 'hash-c',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send: vi.fn(async () => ({ externalId: 'repo-c' })),
      reconcile: vi.fn(),
    });

    const stitchArtifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const stitchVersionId = await fx.createDraftArtifactVersion(sql, stitchArtifactId);
    const stitchSend = vi.fn(async () => ({ externalId: 'stitch-unaffected-1' }));
    const stitchResult = await runOperation({
      projectId,
      provider: 'stitch',
      operationType: 'generate_ui',
      operationKey: `stitch:generate:${stitchVersionId}`,
      requestHash: 'hash-d',
      targetDescriptor: {},
      sourceArtifactVersionId: stitchVersionId,
      send: stitchSend,
      reconcile: vi.fn(),
    });

    expect(stitchSend).toHaveBeenCalledTimes(1);
    expect(stitchResult.status).toBe('completed');
  });

  it('allows a new GitHub operation for the project once the first one is failed', async () => {
    const { projectId, versionId } = await setupProject('architecture');
    const first = await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: `github:create_repo:${projectId}:name-e`,
      requestHash: 'hash-e',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send: vi.fn(async () => {
        throw new DefinitiveProviderError('name_taken_by_other');
      }),
      reconcile: vi.fn(),
    });
    expect(first.status).toBe('failed');

    const send2 = vi.fn(async () => ({ externalId: 'repo-f' }));
    const second = await runOperation({
      projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: `github:create_repo:${projectId}:name-f`,
      requestHash: 'hash-f',
      targetDescriptor: {},
      sourceArtifactVersionId: versionId,
      send: send2,
      reconcile: vi.fn(),
    });

    expect(send2).toHaveBeenCalledTimes(1);
    expect(second.status).toBe('completed');
  });
});

describe('getRefsForVersion / getRefForItem', () => {
  it('round-trips refs by source artifact version and by source item version', async () => {
    const { projectId, artifactId, versionId, itemVersionId } = await setupJiraProject();

    const operationId = await fx.createExternalOperation(sql, {
      projectId,
      provider: 'jira',
      operationKey: `jira:create_issue:PROJ:${itemVersionId}`,
      status: 'completed',
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
      externalId: 'JIRA-99',
    });
    const refId = await fx.createExternalRef(sql, {
      projectId,
      provider: 'jira',
      externalOperationId: operationId,
      sourceArtifactVersionId: versionId,
      sourceItemVersionId: itemVersionId,
      externalId: 'JIRA-99',
      externalKey: 'THR-99',
    });

    const byVersion = await getRefsForVersion(versionId);
    expect(byVersion.map((r) => r.id)).toEqual([refId]);

    const byItem = await getRefForItem(itemVersionId);
    expect(byItem?.id).toBe(refId);
    expect(byItem?.externalKey).toBe('THR-99');

    // A different item_version in the same artifact/project has no ref yet.
    const { itemVersionId: otherItemVersionId } = await fx.createLogicalItemWithVersion(sql, {
      projectId,
      artifactId,
      itemType: 'story',
    });
    expect(await getRefForItem(otherItemVersionId)).toBeNull();
    expect(await getRefForItem(randomUUID())).toBeNull();
  });
});
