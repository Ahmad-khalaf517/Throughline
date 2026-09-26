import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import type postgres from 'postgres';
import { connect } from '../support/connection';
import * as fx from '../support/fixtures';
import type { JsonValue } from '../support/types';

// `stitch`'s real previewPrompt/generate (E4-S4 / SCRUM-53, Module
// Boundaries 4.6, ERD 7.5/4.16, TR FR-050..054) against real Testcontainers
// Postgres, real triggers/CHECKs, and TWO in-process fakes - a raw-fetch
// "Stitch API" (this module's own judgment-call shape, see
// src/external/stitch/index.ts's header comment - no real spike has run yet,
// E4-S5 is next) and a fake Supabase Storage backend (its own real
// @supabase/supabase-js client is exercised for real; only the underlying
// `fetch` calls it makes are faked, same "swap fetch, keep the real client
// code" technique tests/integration/external/jira.test.ts/github.test.ts
// already established) - no real Stitch/Supabase credentials exist anywhere
// in this sandbox.
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

let sql: postgres.Sql;
let stitch: typeof import('@/external/stitch');

const STITCH_BASE_URL = 'https://fake-stitch.example.test';
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
  process.env.STITCH_BASE_URL = STITCH_BASE_URL;
  process.env.SUPABASE_STORAGE_BUCKET = STORAGE_BUCKET;

  stitch = await import('@/external/stitch');
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

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
  return sql<{ operation_key: string; status: string }[]>`
    SELECT operation_key, status FROM external_operation
    WHERE project_id = ${projectId} AND provider = 'stitch'
    ORDER BY created_at
  `;
}

// ---------------------------------------------------------------------------
// Fake Stitch API + fake Supabase Storage - one combined `fetch`, since
// `stitch.generate` calls both through the same global fetch (the Stitch
// HTTP client and @supabase/supabase-js's own storage client both resolve
// `fetch` lazily at call time - src/external/stitch/index.ts's and
// src/auth/supabase-storage.ts's own header comments).
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

let nextFakeGenerationId = 1;

function createFakeExternalWorld() {
  const storedObjects = new Map<string, Buffer>(); // key: `${bucket}/${path}`
  let failNextGenerate = false;

  function setFailNextGenerate(value: boolean): void {
    failNextGenerate = value;
  }

  async function fetchImpl(url: string | URL, init?: RequestInit): Promise<Response> {
    const { pathname } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();

    // --- fake Stitch API ---
    if (method === 'POST' && pathname === '/v1/generate') {
      if (failNextGenerate) {
        failNextGenerate = false;
        return jsonResponse(422, { error: 'invalid_prompt' });
      }
      const id = `gen-${nextFakeGenerationId++}`;
      return jsonResponse(200, {
        id,
        htmlUrl: `${STITCH_BASE_URL}/assets/html/${id}`,
        screenshotUrl: `${STITCH_BASE_URL}/assets/screenshot/${id}`,
      });
    }
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

  return { fetch: fetchImpl, storedObjects, setFailNextGenerate };
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

/** Same technique as jira.test.ts/github.test.ts's own dropper: the real fake call still runs to completion; only the caller's view of the response is lost. */
function createResponseDropper(
  underlyingFetch: (url: string | URL, init?: RequestInit) => Promise<Response>,
) {
  let dropNext = false;
  function simulateLostResponseOnNextGenerate(): void {
    dropNext = true;
  }
  async function fetchWithDrop(url: string | URL, init?: RequestInit): Promise<Response> {
    const { pathname } = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const shouldDrop = method === 'POST' && pathname === '/v1/generate' && dropNext;
    const response = await underlyingFetch(url, init);
    if (shouldDrop) {
      dropNext = false;
      throw new TypeError(
        'test-simulated network fault: response lost before the client could observe it',
      );
    }
    return response;
  }
  return { fetch: fetchWithDrop, simulateLostResponseOnNextGenerate };
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

describe('stitch (E4-S4 / SCRUM-53)', () => {
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

    const result = await stitch.previewPrompt(versionId);
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

    await expect(stitch.previewPrompt(versionId)).rejects.toThrow(
      stitch.UiRequirementsVersionNotApprovedError,
    );
    await expect(stitch.generate(versionId)).rejects.toThrow(
      stitch.UiRequirementsVersionNotApprovedError,
    );
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
    const output = await withFakeFetch(world.fetch, () => stitch.generate(versionId));

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
    await withFakeFetch(world.fetch, () => stitch.generate(versionId));

    await expect(stitch.generate(versionId)).rejects.toThrow(stitch.AlreadyGeneratedError);

    const rows = await stitchOutputRows(versionId);
    expect(rows).toHaveLength(1);
  });

  it("generate: Stitch 4xx -> DefinitiveProviderError -> mode='manual_fallback' written directly, no ref, workflow continues", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch manual fallback' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Checkout', interactionRequirement: 'Confirm payment' },
    ]);

    const world = createFakeExternalWorld();
    world.setFailNextGenerate(true);

    // FR-054: does NOT throw - the preserved prompt is the output, and the
    // planning workflow continues.
    const output = await withFakeFetch(world.fetch, () => stitch.generate(versionId));

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

    expect(world.storedObjects.size).toBe(0); // nothing was ever uploaded
  });

  it("FR-054: a later successful retry UPDATEs the existing manual_fallback row to mode='api' - never a second row", async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, { name: 'stitch fallback upgrade' });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Onboarding', interactionRequirement: 'Complete signup wizard' },
    ]);

    const world = createFakeExternalWorld();
    world.setFailNextGenerate(true);
    const firstAttempt = await withFakeFetch(world.fetch, () => stitch.generate(versionId));
    expect(firstAttempt.mode).toBe('manual_fallback');
    const fallbackRowId = firstAttempt.id;

    // Retry, this time the fake Stitch API succeeds.
    const secondAttempt = await withFakeFetch(world.fetch, () => stitch.generate(versionId));
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

  it('reconcile() is an honest not-found stub: an ambiguous send() failure stays reconciliation_required, never silently resolved', async () => {
    const { projectId } = await fx.createProjectWithOwner(sql, {
      name: 'stitch reconciliation stub',
    });
    const artifactId = await fx.createArtifact(sql, projectId, 'ui_requirements');
    const { versionId } = await createApprovedUiRequirementsVersion(sql, projectId, artifactId, 1, [
      { screenOrFlow: 'Reports', interactionRequirement: 'Export CSV' },
    ]);

    const world = createFakeExternalWorld();
    const dropper = createResponseDropper(world.fetch);

    // First call: the real fake-Stitch generation genuinely happens
    // underneath, but the caller's view of the response is lost (an
    // ambiguous failure, NOT a DefinitiveProviderError) - propagates
    // uncaught, same as github.initRepo's own one-shot behavior. The
    // operation row is left `pending` (ERD 7.2 R6/R9), not `failed`.
    dropper.simulateLostResponseOnNextGenerate();
    await expect(withFakeFetch(dropper.fetch, () => stitch.generate(versionId))).rejects.toThrow(
      TypeError,
    );

    let ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.status).toBe('pending');
    expect(await stitchOutputRows(versionId)).toHaveLength(0); // nothing written yet

    // Second call, past the reconciliation threshold: the operation moves to
    // reconciliation_required, and stitch's own reconcile() (ERD 7.5: "Stitch
    // has no chosen target") always reports not-found - stuck, not silently
    // resolved either way.
    await expect(
      withClockAdvancedPastThreshold(() =>
        withFakeFetch(world.fetch, () => stitch.generate(versionId)),
      ),
    ).rejects.toThrow(stitch.StitchReconciliationRequiredError);

    ops = await stitchOperationRows(projectId);
    expect(ops).toHaveLength(1); // still the SAME one operation row
    expect(ops[0]!.status).toBe('reconciliation_required');
    expect(await stitchOutputRows(versionId)).toHaveLength(0); // still nothing - never a silent fallback write
  });
});
