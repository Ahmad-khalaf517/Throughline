import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import type postgres from 'postgres';
import { connect } from '../support/connection';
import * as fx from '../support/fixtures';
import type { JsonValue } from '../support/types';

// `stitch`'s real previewPrompt/generate/reconcile (E4-S4 / SCRUM-53, reworked
// onto the official `@google/stitch-sdk` by SCRUM-90; Module Boundaries 4.6,
// ERD 7.5/4.16, TR FR-050..054) against real Testcontainers Postgres, real
// triggers/CHECKs, and TWO in-process fakes - a `vi.mock` of
// `@google/stitch-sdk` (Stitch/StitchToolClient/StitchError with the SDK's real
// call shapes: createProject -> generate -> getHtml/getImage download URLs,
// projects()/screens() for reconcile) and a fake fetch that serves the asset
// download URLs plus a fake Supabase Storage backend (its own real
// @supabase/supabase-js client is exercised for real; only the underlying
// `fetch` calls it makes are faked, same "swap fetch, keep the real client
// code" technique tests/integration/external/jira.test.ts/github.test.ts
// already established) - no real Stitch/Supabase credentials exist anywhere
// in this sandbox.
//
// Round 14 (SCRUM-98): generate/previewPrompt/retryOperation take the acting
// user's `ctx`, and a new generate uses that user's own Stitch API key, saved
// through the real `connections.saveConnection`. The scenarios below written
// before round 14 run through the local `generate`/`previewPrompt` wrappers,
// which ensure the project owner has a connection; the last describe covers the
// per-user behavior itself and the stitch halves of T45, T49 and T51. NOT
// EXECUTED when written - Docker/Testcontainers was unavailable.
//
// This story's own Jira Plan row cites no ERD T## test id - these scenarios
// are this story's own coverage of FR-050..054 and ERD 4.16/7.5, not a T##
// deferred-to-later-slice stub the way jira.test.ts/github.test.ts's T##
// headers are.
//
// Same dynamic-import-after-env-setup gotcha as every other file in this
// directory: `@/external/stitch` pulls in `@/lib/env` at MODULE-IMPORT time,
// so every env var it (transitively) reads must be in `process.env` BEFORE
// the first `await import('@/external/stitch')`.

// ---------------------------------------------------------------------------
// Fake `@google/stitch-sdk` - hoisted so it is in place before
// `@/external/stitch` imports the SDK. State lives in `sdkWorld` so tests can
// script per-call behavior and assert call counts.
// ---------------------------------------------------------------------------

type GenerateBehavior =
  | 'ok'
  | 'validation_error' // definitive: StitchError VALIDATION_ERROR, nothing created
  | 'network_error' // ambiguous: NETWORK_ERROR, nothing created (no screen)
  | 'timeout_after_create' // ambiguous: screen IS created, but the call throws UNKNOWN_ERROR
  | 'auth_failed'; // the key is rejected: StitchError AUTH_FAILED (SCRUM-98)

const sdkWorld = vi.hoisted(() => ({
  projects: [] as {
    projectId: string;
    title: string;
    screens: { id: string; projectId: string }[];
  }[],
  nextId: 1,
  createProjectCalls: 0,
  generateCalls: 0,
  // Real Stitch's list_screens returns EMPTY even for a project with a generated
  // screen (verified live 2026-09-28), so the default is false. Only the "old
  // path" test flips it to prove reconcile still adopts a listed screen.
  screensListable: false,
  // One-shot: consumed (reset to 'ok') by the next generate() call.
  nextGenerate: 'ok' as GenerateBehavior,
  reset() {
    this.projects = [];
    this.screensListable = false;
    this.createProjectCalls = 0;
    this.generateCalls = 0;
    this.nextGenerate = 'ok';
  },
}));

vi.mock('@google/stitch-sdk', () => {
  class StitchError extends Error {
    readonly code: string;
    constructor(data: { code: string; message: string }) {
      super(data.message);
      this.name = 'StitchError';
      this.code = data.code;
    }
  }
  const assetHost = 'https://fake-stitch.example.test';
  function toScreen(screen: { id: string; projectId: string }) {
    return {
      id: screen.id,
      screenId: screen.id,
      projectId: screen.projectId,
      getHtml: async () => `${assetHost}/assets/html/${screen.id}`,
      getImage: async () => `${assetHost}/assets/screenshot/${screen.id}`,
    };
  }
  function toProject(record: (typeof sdkWorld.projects)[number]) {
    return {
      id: record.projectId,
      projectId: record.projectId,
      data: { name: `projects/${record.projectId}`, title: record.title },
      screens: async () => (sdkWorld.screensListable ? record.screens.map(toScreen) : []),
      generate: async (_prompt: string, _deviceType?: string) => {
        sdkWorld.generateCalls += 1;
        const behavior = sdkWorld.nextGenerate;
        sdkWorld.nextGenerate = 'ok';
        if (behavior === 'validation_error') {
          throw new StitchError({ code: 'VALIDATION_ERROR', message: 'invalid prompt' });
        }
        if (behavior === 'auth_failed') {
          throw new StitchError({ code: 'AUTH_FAILED', message: 'key rejected' });
        }
        if (behavior === 'network_error') {
          throw new StitchError({ code: 'NETWORK_ERROR', message: 'connection reset' });
        }
        const screen = { id: `screen-${sdkWorld.nextId++}`, projectId: record.projectId };
        record.screens.push(screen);
        if (behavior === 'timeout_after_create') {
          throw new StitchError({ code: 'UNKNOWN_ERROR', message: 'request timed out' });
        }
        return toScreen(screen);
      },
    };
  }
  class StitchToolClient {
    constructor(_config?: unknown) {}
    async close(): Promise<void> {}
  }
  class Stitch {
    constructor(_client: unknown) {}
    async createProject(title?: string) {
      sdkWorld.createProjectCalls += 1;
      const record = { projectId: `project-${sdkWorld.nextId++}`, title: title ?? '', screens: [] };
      sdkWorld.projects.push(record);
      return toProject(record);
    }
    async projects() {
      return sdkWorld.projects.map(toProject);
    }
  }
  return { Stitch, StitchToolClient, StitchError };
});

let sql: postgres.Sql;
let stitch: typeof import('@/external/stitch');
let connections: typeof import('@/connections');

const SUPABASE_URL = 'https://example.test';
const STORAGE_BUCKET = 'stitch-assets';

const HTML_CONTENT = '<html><body>Fake Stitch prototype</body></html>';
const SCREENSHOT_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // fake PNG header

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

beforeAll(async () => {
  sql = connect();
  const connectionUri = inject('pgConnectionUri');
  process.env.DATABASE_URL = connectionUri;
  process.env.DIRECT_DATABASE_URL = connectionUri;
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
  process.env.STITCH_API_KEY = 'fake-stitch-key';
  // 32 bytes, base64 - read by the connections module at call time.
  process.env.CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SUPABASE_STORAGE_BUCKET = STORAGE_BUCKET;

  stitch = await import('@/external/stitch');
  connections = await import('@/connections');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// ---------------------------------------------------------------------------
// Round 14: the acting user's own connection + ctx.
// ---------------------------------------------------------------------------

const SENTINEL_KEY = 'SENTINEL-STITCH-KEY-0123456789abcdef';

async function ownerOfVersion(versionId: string): Promise<string> {
  const [row] = await sql<{ owner_user_id: string }[]>`
    SELECT p.owner_user_id
    FROM artifact_version av
    JOIN artifact a ON a.id = av.artifact_id
    JOIN project p ON p.id = a.project_id
    WHERE av.id = ${versionId}
  `;
  return row!.owner_user_id;
}

/** The user's Stitch connection (account id `key:<userId>`, an upsert). */
async function ensureConnection(userId: string, accessToken = SENTINEL_KEY) {
  await connections.saveConnection({
    userId,
    provider: 'stitch',
    externalAccountId: `key:${userId}`,
    displayName: 'Stitch API key',
    accessToken,
    scopes: [],
    providerMeta: {},
  });
}

/** ctx for the owner of the project a UI Requirements version belongs to (a connection is ensured). */
async function ctxForVersion(versionId: string): Promise<{ userId: string }> {
  const userId = await ownerOfVersion(versionId);
  await ensureConnection(userId);
  return { userId };
}

const generate = async (versionId: string) =>
  stitch.generate(versionId, await ctxForVersion(versionId));
const previewPrompt = async (versionId: string) =>
  stitch.previewPrompt(versionId, await ctxForVersion(versionId));

// ---------------------------------------------------------------------------
// Fixture composition - an approved UI Requirements artifact_version with
// real `ui_requirement` payload content (ERD 5.4's projection fields), built
// directly through the fixture helpers (ui-requirements.generate() is a
// stub that always throws - E2-S9/SCRUM-35 scope - so there is no real
// generation path to call instead, same reasoning jira.test.ts's own
// `approveBacklogVersion` helper gives for backlog).
// ---------------------------------------------------------------------------

async function createApprovedUiRequirementsVersion(
  sqlExec: postgres.Sql,
  projectId: string,
  artifactId: string,
  versionNumber: number,
  itemPayloads: Record<string, JsonValue>[],
): Promise<{
  versionId: string;
  items: { logicalItemId: string; itemVersionId: string; displayKey: string }[];
}> {
  const versionId = await fx.createDraftArtifactVersion(sqlExec, artifactId, { versionNumber });
  const items: { logicalItemId: string; itemVersionId: string; displayKey: string }[] = [];
  for (const payload of itemPayloads) {
    const { id: logicalItemId, displayKey } = await fx.createLogicalItem(sqlExec, {
      projectId,
      artifactId,
      itemType: 'ui_requirement',
    });
    const itemVersionId = await fx.createItemVersion(sqlExec, {
      projectId,
      logicalItemId,
      payload,
    });
    await fx.createMembership(sqlExec, {
      artifactVersionId: versionId,
      artifactId,
      logicalItemId,
      itemVersionId,
    });
    items.push({ logicalItemId, itemVersionId, displayKey });
  }
  // Supersede whatever was previously approved for this artifact first
  // (one_approved_version) - mirrors jira.test.ts's own
  // `approveBacklogVersion` helper.
  const [current] = await sqlExec<{ id: string }[]>`
    SELECT id FROM artifact_version WHERE artifact_id = ${artifactId} AND status = 'approved'
  `;
  if (current) {
    await sqlExec`UPDATE artifact_version SET status = 'superseded' WHERE id = ${current.id}`;
  }
  await fx.approveArtifactVersion(sqlExec, versionId);
  return { versionId, items };
}

async function stitchOutputRows(sourceUiRequirementsVersionId: string) {
  return sql<
    {
      id: string;
      mode: string;
      external_ref_id: string | null;
      prompt_text: string;
      html_storage_key: string | null;
      html_checksum: string | null;
      screenshot_storage_key: string | null;
      screenshot_checksum: string | null;
    }[]
  >`
    SELECT id, mode, external_ref_id, prompt_text, html_storage_key, html_checksum,
           screenshot_storage_key, screenshot_checksum
    FROM stitch_output WHERE source_ui_requirements_version_id = ${sourceUiRequirementsVersionId}
  `;
}

async function stitchOperationRows(projectId: string) {
  return sql<{ operation_key: string; status: string; error_message: string | null }[]>`
    SELECT operation_key, status, error_message FROM external_operation
    WHERE project_id = ${projectId} AND provider = 'stitch'
    ORDER BY created_at
  `;
}

// ---------------------------------------------------------------------------
// Fake asset downloads + fake Supabase Storage - one combined `fetch`, since
// `stitch.generate` downloads the (faked) SDK's asset URLs and uploads to
// Storage through the same global fetch (src/external/stitch/index.ts's
// `fetchBytes` and @supabase/supabase-js's own storage client both resolve
// `fetch` lazily at call time - src/auth/supabase-storage.ts's own header
// comment). The SDK calls themselves are faked by the `vi.mock` above.
// ---------------------------------------------------------------------------

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bodyToBuffer(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  throw new Error('fake Supabase Storage: unsupported upload body type in test');
}

function createFakeExternalWorld() {
  const storedObjects = new Map<string, Buffer>(); // key: `${bucket}/${path}`
  async function fetchImpl(url: string | URL, init?: RequestInit): Promise<Response> {
    const { pathname } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    // --- fake Stitch asset downloads (URLs the mocked SDK hands out) ---
    if (method === 'GET' && pathname.startsWith('/assets/html/')) {
      return new Response(HTML_CONTENT, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (method === 'GET' && pathname.startsWith('/assets/screenshot/')) {
      return new Response(SCREENSHOT_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }

    // --- fake Supabase Storage ---
    const signMatch = /^\/storage\/v1\/object\/sign\/(.+)$/.exec(pathname);
    if (method === 'POST' && signMatch) {
      const key = signMatch[1]!;
      if (!storedObjects.has(key)) {
        return jsonResponse(400, { message: `not found: ${key}` });
      }
      return jsonResponse(200, { signedURL: `/object/sign/${key}?token=fake-signed-token` });
    }
    const uploadMatch = /^\/storage\/v1\/object\/(.+)$/.exec(pathname);
    if (method === 'POST' && uploadMatch) {
      const key = uploadMatch[1]!;
      storedObjects.set(key, bodyToBuffer(init?.body));
      return jsonResponse(200, { Id: 'fake-object-id', Key: key });
    }

    throw new Error(`fake fetch: unhandled ${method} ${pathname}`);
  }

  return { fetch: fetchImpl, storedObjects };
}

async function withFakeFetch<T>(
  fakeFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

/** Advances the FAKE clock past stitch's 90s RECONCILIATION_THRESHOLD_MS (src/external/operations/index.ts) - same technique jira.test.ts/github.test.ts already use. */
async function withClockAdvancedPastThreshold<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(Date.now() + 95_000);
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

describe('stitch (E4-S4 / SCRUM-53, SDK rework SCRUM-90)', () => {
  beforeEach(() => {
    sdkWorld.reset();
  });

  it('previewPrompt: approved version -> prompt text built from item content + impact shape', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch previewPrompt' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId, items } = await createApprovedUiRequirementsVersion(
      sql,
      projectId,
      artifactId,
      1,
      [
        {
          screenOrFlow: 'Login screen',
          interactionRequirement: 'User submits email and password',
          responsiveConstraints: ['mobile-first layout'],
          accessibilityConstraints: ['WCAG AA contrast'],
        },
      ],
    );

    const result = await previewPrompt(versionId);
    expect(result.prompt).toContain(items[0]!.displayKey);
    expect(result.prompt).toContain('Login screen');
    expect(result.prompt).toContain('User submits email and password');
    expect(result.prompt).toContain('mobile-first layout');
    expect(result.prompt).toContain('WCAG AA contrast');
    expect(Array.isArray(result.impact)).toBe(true);
    expect(result.impact).toEqual([]); // nothing upstream has changed yet
  });

  it('previewPrompt/generate refuse a non-approved version (UiRequirementsVersionNotApprovedError)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch not-approved' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const versionId = await fx.createDraftArtifactVersion(sql, artifactId, { versionNumber: 1 });

    await expect(previewPrompt(versionId)).rejects.toThrow(
      stitch.UiRequirementsVersionNotApprovedError,
    );
    await expect(generate(versionId)).rejects.toThrow(stitch.UiRequirementsVersionNotApprovedError);
  });

  it("generate: mode='api' success path - Stitch 2xx, assets uploaded, external_ref + stitch_output correct", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch generate api' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      {
        screenOrFlow: 'Dashboard',
        interactionRequirement: 'View project summary',
        responsiveConstraints: [],
        accessibilityConstraints: [],
      },
    ]);

    const world = createFakeExternalWorld();
    const output = await withFakeFetch(world.fetch, () => generate(versionId));

    // One project per generation, titled with the deterministic operation-key marker.
    expect(sdkWorld.createProjectCalls).toBe(1);
    expect(sdkWorld.generateCalls).toBe(1);
    expect(sdkWorld.projects[0]!.title).toBe(`throughline:stitch:generate:${versionId}`);

    expect(output.mode).toBe('api');
    expect(output.externalRefId).not.toBeNull();
    expect(output.htmlStorageKey).toBe(`stitch/${versionId}/index.html`);
    expect(output.screenshotStorageKey).toBe(`stitch/${versionId}/screenshot.png`);
    expect(output.htmlChecksum).toBe(sha256Hex(Buffer.from(HTML_CONTENT)));
    expect(output.screenshotChecksum).toBe(sha256Hex(SCREENSHOT_BYTES));

    // The bytes really were uploaded to the (faked) bucket, at the exact keys.
    expect(
      world.storedObjects.get(`${STORAGE_BUCKET}/stitch/${versionId}/index.html`)?.toString(),
    ).toBe(HTML_CONTENT);
    expect(world.storedObjects.get(`${STORAGE_BUCKET}/stitch/${versionId}/screenshot.png`)).toEqual(
      SCREENSHOT_BYTES,
    );

    const rows = await stitchOutputRows(versionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mode).toBe('api');
    expect(rows[0]!.external_ref_id).not.toBeNull();

    const [ref] = await sql<{ provider: string; source_item_version_id: string | null }[]>`
      SELECT provider, source_item_version_id FROM external_ref WHERE id = ${rows[0]!.external_ref_id!}
    `;
    expect(ref?.provider).toBe('stitch');
    expect(ref?.source_item_version_id).toBeNull(); // whole-version ref, not item-scoped (ERD 7.5)

    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.operation_key).toBe(`stitch:generate:${versionId}`);
    expect(ops[0]!.status).toBe('completed');

    // FR-052/053: signed URLs are reachable for both stored assets.
    const signed = await withFakeFetch(world.fetch, () => stitch.getSignedAssetUrls(output));
    expect(signed.htmlUrl).toContain('/object/sign/');
    expect(signed.screenshotUrl).toContain('/object/sign/');
  });

  it("generate: mode='api' twice for the same version -> AlreadyGeneratedError, no second stitch_output row", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, {
      name: 'stitch already-generated',
    });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Settings', interactionRequirement: 'Update profile' },
    ]);

    const world = createFakeExternalWorld();
    await withFakeFetch(world.fetch, () => generate(versionId));

    await expect(generate(versionId)).rejects.toThrow(stitch.AlreadyGeneratedError);

    const rows = await stitchOutputRows(versionId);
    expect(rows).toHaveLength(1);
  });

  it("generate: SDK definitive error (VALIDATION_ERROR) -> DefinitiveProviderError -> mode='manual_fallback' written directly, no ref, workflow continues", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch manual fallback' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Checkout', interactionRequirement: 'Confirm payment' },
    ]);

    const world = createFakeExternalWorld();
    sdkWorld.nextGenerate = 'validation_error';

    // FR-054: does NOT throw - the preserved prompt is the output, and the
    // planning workflow continues.
    const output = await withFakeFetch(world.fetch, () => generate(versionId));

    expect(output.mode).toBe('manual_fallback');
    expect(output.externalRefId).toBeNull();
    expect(output.promptText).toContain('Checkout');
    expect(output.htmlStorageKey).toBeNull();
    expect(output.screenshotStorageKey).toBeNull();

    const rows = await stitchOutputRows(versionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mode).toBe('manual_fallback');
    expect(rows[0]!.external_ref_id).toBeNull();

    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('failed'); // ERD 7.2: reserved for definitive rejections
    expect(ops[0]!.error_message).toBe('stitch_generate_rejected:VALIDATION_ERROR');

    expect(world.storedObjects.size).toBe(0); // nothing was ever uploaded
  });

  it("FR-054: a later successful retry UPDATEs the existing manual_fallback row to mode='api' - never a second row", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch fallback upgrade' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Onboarding', interactionRequirement: 'Complete signup wizard' },
    ]);

    const world = createFakeExternalWorld();
    sdkWorld.nextGenerate = 'validation_error';
    const firstAttempt = await withFakeFetch(world.fetch, () => generate(versionId));
    expect(firstAttempt.mode).toBe('manual_fallback');
    const fallbackRowId = firstAttempt.id;

    // Retry, this time the fake Stitch API succeeds.
    const secondAttempt = await withFakeFetch(world.fetch, () => generate(versionId));
    expect(secondAttempt.mode).toBe('api');
    expect(secondAttempt.id).toBe(fallbackRowId); // same row, updated in place - never a second insert
    expect(secondAttempt.externalRefId).not.toBeNull();
    expect(secondAttempt.htmlStorageKey).toBe(`stitch/${versionId}/index.html`);

    const rows = await stitchOutputRows(versionId);
    expect(rows).toHaveLength(1); // UNIQUE(source_ui_requirements_version_id) - only ever one row
    expect(rows[0]!.mode).toBe('api');

    // Exactly one external_operation row throughout (ERD 7.1) - the failed
    // first attempt was retried in place (status pending -> failed -> pending
    // -> completed), never a brand-new operation for the same version.
    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('completed');
  });

  it('SDK ambiguous error (NETWORK_ERROR) -> propagates, operation stays pending; retry past the threshold reconciles by regenerating once in the reused marker project', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, {
      name: 'stitch ambiguous no screen',
    });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Reports', interactionRequirement: 'Export CSV' },
    ]);

    const world = createFakeExternalWorld();

    // NOT a DefinitiveProviderError: the StitchError propagates uncaught (ERD
    // 7.2 R6/R9) and the operation row is left `pending`, not `failed`.
    sdkWorld.nextGenerate = 'network_error';
    await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });

    let ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('pending');
    expect(await stitchOutputRows(versionId)).toHaveLength(0); // nothing written yet

    // Second call, past the reconciliation threshold: Stitch cannot list
    // screens, so reconcile() regenerates exactly once, reusing the
    // marker-titled project (no second createProject).
    const output = await withClockAdvancedPastThreshold(() =>
      withFakeFetch(world.fetch, () => generate(versionId)),
    );

    expect(output.mode).toBe('api');
    expect(sdkWorld.projects).toHaveLength(1);
    expect(sdkWorld.createProjectCalls).toBe(1);
    expect(sdkWorld.generateCalls).toBe(2);

    ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1); // still the SAME one operation row
    expect(ops[0]!.status).toBe('completed');
    expect(await stitchOutputRows(versionId)).toHaveLength(1);
  });

  it('reconcile-time definitive error (VALIDATION_ERROR) -> manual_fallback, one output row', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, {
      name: 'stitch reconcile definitive',
    });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Billing', interactionRequirement: 'Download invoices' },
    ]);

    const world = createFakeExternalWorld();
    sdkWorld.nextGenerate = 'network_error';
    await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });

    sdkWorld.nextGenerate = 'validation_error';
    const output = await withClockAdvancedPastThreshold(() =>
      withFakeFetch(world.fetch, () => generate(versionId)),
    );

    expect(output.mode).toBe('manual_fallback');
    expect(output.externalRefId).toBeNull();
    expect(sdkWorld.generateCalls).toBe(2);
    expect(await stitchOutputRows(versionId)).toHaveLength(1);
    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('failed');
    expect(ops[0]!.error_message).toBe('stitch_generate_rejected:VALIDATION_ERROR');
  });

  it('reconcile-time ambiguous error -> still reconciliation_required and retryable (never a silent fallback)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, {
      name: 'stitch reconcile ambiguous',
    });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Team', interactionRequirement: 'Invite members' },
    ]);

    const world = createFakeExternalWorld();
    sdkWorld.nextGenerate = 'network_error';
    await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });

    // The reconcile-time regenerate is ALSO ambiguous.
    sdkWorld.nextGenerate = 'network_error';
    await expect(
      withClockAdvancedPastThreshold(() => withFakeFetch(world.fetch, () => generate(versionId))),
    ).rejects.toThrow(stitch.StitchReconciliationRequiredError);

    expect(sdkWorld.generateCalls).toBe(2);
    let ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('reconciliation_required');
    expect(await stitchOutputRows(versionId)).toHaveLength(0);

    // Retryable: a further user-initiated retry reconciles again and succeeds.
    const output = await withClockAdvancedPastThreshold(() =>
      withFakeFetch(world.fetch, () => generate(versionId)),
    );
    expect(output.mode).toBe('api');
    expect(sdkWorld.generateCalls).toBe(3);
    ops = await stitchOperationRows(projectId);
    expect(ops[0]!.status).toBe('completed');
    expect(await stitchOutputRows(versionId)).toHaveLength(1);
  });

  it('timed-out generate() (screen created server-side, not listable) -> reconcile regenerates once; exactly one stitch_output row (Spike B, TR 42)', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch reconcile regen' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Audit trail', interactionRequirement: 'Filter by date' },
    ]);

    const world = createFakeExternalWorld();
    sdkWorld.nextGenerate = 'timeout_after_create';
    await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
    });

    const output = await withClockAdvancedPastThreshold(() =>
      withFakeFetch(world.fetch, () => generate(versionId)),
    );

    expect(output.mode).toBe('api');
    expect(sdkWorld.generateCalls).toBe(2); // lost screen is unlistable -> regenerated
    expect(sdkWorld.createProjectCalls).toBe(1); // marker project reused
    expect(await stitchOutputRows(versionId)).toHaveLength(1);
    expect((await stitchOperationRows(projectId))[0]!.status).toBe('completed');
  });

  it('reconcile adopts a screen if screens() ever lists one -> completes with assets, without a second generate() call', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch reconcile found' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Audit log', interactionRequirement: 'Filter by actor' },
    ]);

    const world = createFakeExternalWorld();

    // The screen IS created on Stitch's side, but the client-side call times
    // out (UNKNOWN_ERROR - what the SDK wraps timeouts into): ambiguous.
    sdkWorld.screensListable = true; // hypothetical: the API starts listing screens
    sdkWorld.nextGenerate = 'timeout_after_create';
    await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
      code: 'UNKNOWN_ERROR',
    });
    expect((await stitchOperationRows(projectId))[0]!.status).toBe('pending');
    expect(await stitchOutputRows(versionId)).toHaveLength(0);
    expect(world.storedObjects.size).toBe(0); // the timed-out send() never got to upload

    const output = await withClockAdvancedPastThreshold(() =>
      withFakeFetch(world.fetch, () => generate(versionId)),
    );

    expect(sdkWorld.generateCalls).toBe(1); // reconcile adopted the screen; never re-sent
    expect(sdkWorld.createProjectCalls).toBe(1);

    expect(output.mode).toBe('api');
    expect(output.externalRefId).not.toBeNull();
    expect(output.htmlStorageKey).toBe(`stitch/${versionId}/index.html`);
    expect(output.htmlChecksum).toBe(sha256Hex(Buffer.from(HTML_CONTENT)));
    expect(output.screenshotChecksum).toBe(sha256Hex(SCREENSHOT_BYTES));
    expect(
      world.storedObjects.get(`${STORAGE_BUCKET}/stitch/${versionId}/index.html`)?.toString(),
    ).toBe(HTML_CONTENT);

    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('completed');
    const rows = await stitchOutputRows(versionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.mode).toBe('api');
  });

  describe('getOutput (SCRUM-91)', () => {
    async function setup(name: string, screenOrFlow: string) {
      const { projectId } = await fx.createProjectWithOwner(sql, { name });
      const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
      const { versionId } = await createApprovedUiRequirementsVersion(
        sql,
        projectId,
        artifactId,
        1,
        [{ screenOrFlow, interactionRequirement: 'Do the thing' }],
      );
      return { versionId };
    }

    it("none: no output and no operation -> { state: 'none' }, never throws", async () => {
      const { versionId } = await setup('stitch getOutput none', 'Empty');

      expect(await stitch.getOutput(versionId)).toEqual({ state: 'none' });
    });

    it("generated: mode='api' output -> { state: 'generated', output }", async () => {
      const { versionId } = await setup('stitch getOutput generated', 'Home');
      const world = createFakeExternalWorld();
      const generated = await withFakeFetch(world.fetch, () => generate(versionId));

      const result = await stitch.getOutput(versionId);

      expect(result.state).toBe('generated');
      if (result.state !== 'generated') throw new Error('unreachable');
      expect(result.output.id).toBe(generated.id);
      expect(result.output.mode).toBe('api');
    });

    it("manual_fallback: failed operation + fallback row -> { state: 'manual_fallback' }", async () => {
      const { versionId } = await setup('stitch getOutput fallback', 'Cart');
      const world = createFakeExternalWorld();
      sdkWorld.nextGenerate = 'validation_error';
      await withFakeFetch(world.fetch, () => generate(versionId));

      const result = await stitch.getOutput(versionId);

      expect(result.state).toBe('manual_fallback');
      if (result.state !== 'manual_fallback') throw new Error('unreachable');
      expect(result.output.promptText).toContain('Cart');
    });

    it("in_progress: a pending operation with no output -> { state: 'in_progress', status: 'pending' }", async () => {
      const { versionId } = await setup('stitch getOutput pending', 'Search');
      const world = createFakeExternalWorld();
      sdkWorld.nextGenerate = 'network_error';
      await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });

      const result = await stitch.getOutput(versionId);

      expect(result).toMatchObject({ state: 'in_progress', status: 'pending' });
    });

    it("in_progress: reconciliation_required operation -> status 'reconciliation_required'", async () => {
      const { versionId } = await setup('stitch getOutput reconciliation', 'Profile');
      const world = createFakeExternalWorld();
      sdkWorld.nextGenerate = 'network_error';
      await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });
      sdkWorld.nextGenerate = 'network_error';
      await expect(
        withClockAdvancedPastThreshold(() => withFakeFetch(world.fetch, () => generate(versionId))),
      ).rejects.toThrow(stitch.StitchReconciliationRequiredError);

      const result = await stitch.getOutput(versionId);

      expect(result).toMatchObject({ state: 'in_progress', status: 'reconciliation_required' });
    });

    it('precedence: a pending retry beats an older manual_fallback row', async () => {
      const { versionId } = await setup('stitch getOutput retry beats fallback', 'Inbox');
      const world = createFakeExternalWorld();
      sdkWorld.nextGenerate = 'validation_error';
      await withFakeFetch(world.fetch, () => generate(versionId));
      expect((await stitch.getOutput(versionId)).state).toBe('manual_fallback');

      // Retry in place: the operation goes back to pending, the fallback row stays.
      sdkWorld.nextGenerate = 'network_error';
      await expect(withFakeFetch(world.fetch, () => generate(versionId))).rejects.toMatchObject({
        code: 'NETWORK_ERROR',
      });

      expect((await stitchOutputRows(versionId))[0]!.mode).toBe('manual_fallback');
      expect(await stitch.getOutput(versionId)).toMatchObject({
        state: 'in_progress',
        status: 'pending',
      });
    });
  });
});

describe('stitch per-user connection (SCRUM-98; ERD 7.5/7.6, T45/T49/T51 stitch halves)', () => {
  beforeEach(() => {
    sdkWorld.reset();
  });

  async function setup(name: string) {
    const { projectId, userId } = await fx.createProjectWithOwner(sql, { name });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: name, interactionRequirement: 'Do the thing' },
    ]);
    return { projectId, userId, versionId };
  }

  async function connectionRow(userId: string) {
    const [row] = await sql<
      { id: string; status: string; access_token_enc: string; external_account_id: string }[]
    >`SELECT id, status, access_token_enc, external_account_id FROM provider_connection
      WHERE user_id = ${userId} AND provider = 'stitch'`;
    return row;
  }

  it('records the user connection and its account id on the operation', async () => {
    const { projectId, userId, versionId } = await setup('stitch per-user records');
    await ensureConnection(userId);
    const world = createFakeExternalWorld();

    const output = await withFakeFetch(world.fetch, () => stitch.generate(versionId, { userId }));

    expect(output.mode).toBe('api');
    const conn = await connectionRow(userId);
    const [op] = await sql<
      { connection_id: string | null; target_descriptor: { account_id?: string } }[]
    >`
      SELECT connection_id, target_descriptor FROM external_operation
      WHERE project_id = ${projectId} AND provider = 'stitch'
    `;
    expect(op!.connection_id).toBe(conn!.id);
    expect(op!.target_descriptor.account_id).toBe(`key:${userId}`);
  });

  it('T45 (stitch half): the saved key is ciphertext at rest and appears in no column', async () => {
    const { userId } = await setup('stitch per-user ciphertext');
    await ensureConnection(userId);

    const conn = await connectionRow(userId);
    expect(conn!.access_token_enc).not.toContain(SENTINEL_KEY);
    const [dump] = await sql<{ doc: string }[]>`
      SELECT row_to_json(pc)::text AS doc FROM provider_connection pc WHERE pc.user_id = ${userId}
    `;
    expect(dump!.doc).not.toContain(SENTINEL_KEY);
    const [opDump] = await sql<{ doc: string }[]>`
      SELECT COALESCE(string_agg(row_to_json(eo)::text, ''), '') AS doc FROM external_operation eo
    `;
    expect(opDump!.doc).not.toContain(SENTINEL_KEY);
  });

  it('no connection -> ConnectionRequiredError, and no external_operation / stitch_output row', async () => {
    const { projectId, userId, versionId } = await setup('stitch per-user none');
    const world = createFakeExternalWorld();

    await expect(
      withFakeFetch(world.fetch, () => stitch.generate(versionId, { userId })),
    ).rejects.toBeInstanceOf(connections.ConnectionRequiredError);

    expect(await stitchOperationRows(projectId)).toHaveLength(0);
    expect(await stitchOutputRows(versionId)).toHaveLength(0);
    expect(sdkWorld.createProjectCalls).toBe(0);
    // The preview needs no connection.
    const preview = await stitch.previewPrompt(versionId, { userId });
    expect(preview.connection).toEqual({ status: 'none', targetReady: true });
  });

  it('T49 (stitch half): AUTH_FAILED -> connection needs_reauth, operation untouched (not failed), no fallback row; retry stops before any SDK call', async () => {
    const { projectId, userId, versionId } = await setup('stitch per-user auth failed');
    await ensureConnection(userId);
    sdkWorld.nextGenerate = 'auth_failed';
    const world = createFakeExternalWorld();

    await expect(
      withFakeFetch(world.fetch, () => stitch.generate(versionId, { userId })),
    ).rejects.toBeInstanceOf(connections.ReconnectRequiredError);

    expect((await connectionRow(userId))!.status).toBe('needs_reauth');
    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('pending');
    expect(ops[0]!.error_message).toBeNull();
    expect(await stitchOutputRows(versionId)).toHaveLength(0);

    const generateCallsBefore = sdkWorld.generateCalls;
    const [op] = await sql<{ id: string }[]>`
      SELECT id FROM external_operation WHERE project_id = ${projectId} AND provider = 'stitch'
    `;
    await expect(stitch.retryOperation(op!.id, { userId })).rejects.toBeInstanceOf(
      connections.ReconnectRequiredError,
    );
    expect(sdkWorld.generateCalls).toBe(generateCallsBefore);
  });

  it('T51 (stitch half): after disconnect the tombstoned connection makes a retry reconnect-required, and the operation is unchanged', async () => {
    const { projectId, userId, versionId } = await setup('stitch per-user disconnect');
    await ensureConnection(userId);
    const world = createFakeExternalWorld();
    await withFakeFetch(world.fetch, () => stitch.generate(versionId, { userId }));
    const [op] = await sql<{ id: string }[]>`
      SELECT id FROM external_operation WHERE project_id = ${projectId} AND provider = 'stitch'
    `;

    expect(await connections.disconnect(userId, 'stitch')).toEqual({ providerRevoked: null });

    expect((await connectionRow(userId))!.status).toBe('revoked');
    await expect(stitch.retryOperation(op!.id, { userId })).rejects.toBeInstanceOf(
      connections.ReconnectRequiredError,
    );
    const ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('completed');
  });

  it('a different key (account) than the one recorded on the operation -> reconnect-required on retry', async () => {
    const { projectId, userId, versionId } = await setup('stitch per-user mismatch');
    await ensureConnection(userId);
    sdkWorld.nextGenerate = 'network_error'; // leaves a pending operation to retry
    const world = createFakeExternalWorld();
    await expect(
      withFakeFetch(world.fetch, () => stitch.generate(versionId, { userId })),
    ).rejects.toThrow();
    const [op] = await sql<{ id: string }[]>`
      SELECT id FROM external_operation WHERE project_id = ${projectId} AND provider = 'stitch'
    `;

    // The user pastes a different key: same connection row, a different account id.
    await connections.saveConnection({
      userId,
      provider: 'stitch',
      externalAccountId: `key:${randomUUID().slice(0, 16)}`,
      displayName: 'Stitch API key',
      accessToken: 'another-key',
      scopes: [],
      providerMeta: {},
    });

    const callsBefore = sdkWorld.generateCalls;
    await expect(stitch.retryOperation(op!.id, { userId })).rejects.toBeInstanceOf(
      connections.ReconnectRequiredError,
    );
    expect(sdkWorld.generateCalls).toBe(callsBefore);
  });
});
