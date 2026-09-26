// SCRUM-54 / Jira Plan E4-S5 - Spike B: Stitch (TR section 42, "Spike B -
// Stitch"): "Prove: approved UI prompt -> Stitch generation -> persist
// screenshot/HTML or fallback prompt." Depends on E4-S4 (SCRUM-53, merged) -
// src/external/stitch/index.ts is a real, already-built, already-gated
// module (previewPrompt/generate/getSignedAssetUrls, Module Boundaries 4.6).
// This story's own Jira Plan row cites TR 42 only - no ERD T## id, no
// FR/INV id (confirmed by reading that row before writing this file).
//
// ===========================================================================
// Critical difference from this repo's other two spike scripts (read both in
// full before this one - they are this file's direct precedent for spike-
// script conventions: header-comment discipline, .env.local real-vs-mock
// toggle, cleanup-on-exit, "no package.json script, no vitest wiring"):
//   scripts/spike-github-reconciliation.mts (E4-T1) and
//   scripts/spike-jira-reconciliation.ts   (E4-T2)
// Both of THOSE spikes PRECEDED their real provider module (github/jira
// didn't exist yet), so both reimplemented a throwaway, spike-local HTTP
// client. E4-S5 is the reverse: it comes AFTER E4-S4, and the real module
// already exists. This script therefore calls the REAL, already-built
// `previewPrompt`/`generate`/`getSignedAssetUrls` (imported from
// `../src/external/stitch`, never reimplemented) - it is a stand-in for a
// real CALLER of that module (e.g. a future route handler), not a stand-in
// for the module itself. It does NOT modify src/external/stitch/index.ts -
// that module already went through a full review/gate pass in E4-S4; if
// this run had surfaced an actual bug in it, the correct move would be to
// stop and report it, not silently patch around it here (none was found -
// see this story's own report for the run's real output).
// ===========================================================================
//
// Explicit non-goals:
//   - Does NOT modify src/external/stitch/index.ts (see above).
//   - Does NOT build a spike-local Stitch/Supabase HTTP client - calls the
//     real module directly.
//   - Does NOT provision a real Supabase Storage bucket. SUPABASE_STORAGE_
//     BUCKET is blank in this worktree's .env.local (confirmed by reading
//     it) - creating one is real cloud infrastructure provisioning, out of
//     scope for a spike. This script FAKES the Supabase Storage HTTP layer
//     too, exactly the same "swap globalThis.fetch, keep the real client
//     code" technique tests/integration/external/stitch.test.ts already
//     established (its own `createFakeExternalWorld` - this script's fake
//     world below is a close, spike-local adaptation of that same fake,
//     re-declared here rather than imported, since tests/integration/** is
//     vitest-only test support, not a module this script may reach into).
//     `getStorageServiceClient()` (src/auth/supabase-storage.ts) is still
//     called for REAL inside `stitch.generate`/`getSignedAssetUrls` - it
//     constructs a real `@supabase/supabase-js` client against the REAL
//     `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` already in
//     .env.local (left unmodified - no reason to fake those, since only the
//     underlying `fetch` call is ever actually faked, per that file's own
//     `resolveFetch`-is-lazy header comment). That means the real client-
//     construction / URL-building code genuinely executes against this
//     project's real Supabase URL shape; only the actual network round trip
//     never leaves this process. Disclosed, not papered over: this does NOT
//     prove the real bucket/network path works, only that the module's own
//     code correctly drives whatever `fetch` is in play.
//   - Does NOT validate a real Stitch HTTP endpoint shape - none exists
//     anywhere. STITCH_API_KEY/STITCH_BASE_URL are blank in this worktree's
//     .env.local (confirmed by reading it, same as GITHUB_TOKEN/JIRA_* were
//     for E4-T1/E4-T2). src/external/stitch/index.ts's own header comment
//     already discloses its POST `/v1/generate` -> `{id,htmlUrl,
//     screenshotUrl}` shape as an undecided judgment call, unconfirmed by
//     any real spike. Faking that same shape here does not newly confirm or
//     deny it - see the live MCP finding below for what WAS actually learned
//     about real Stitch, empirically, and why it doesn't settle this either.
//
// ===========================================================================
// What this run actually found (an empirical, live finding - NOT reproduced
// by this script, which cannot reach it): the orchestrating session for this
// story had live MCP tool access to the actual Google Stitch product
// (`mcp__stitch__*` - Claude-side tools, unavailable to a plain Node/tsx
// script, so this script cannot call them and does not attempt to). It used
// them to empirically validate what "Google Stitch" (BRD lines 18/109/140)
// actually is, since that is directly relevant to whether this module's own
// invented HTTP client shape is realistic. Findings, attributed to that
// session, not to this script:
//   - Real Stitch is a Google API with an AIP-160-style resource model:
//     `projects/{projectId}` and `projects/{projectId}/screens/{screenId}`,
//     plus a `projectId/files/{fileId}` resource for generated assets
//     (thumbnails etc., each with a real signed `downloadUrl`).
//     `generate_screen_from_text` takes `projectId`, `prompt`, `deviceType`,
//     optional `designSystem`/`modelId` - and its own tool description warns
//     it is slow/async ("can take a few minutes... if it times out, don't
//     retry, poll `get_screen` every 30s up to 10 times").
//   - That session created a throwaway Stitch project
//     (`SPIKE-B-E4-S5-throwaway-delete-me`) and called
//     `generate_screen_from_text` with a realistic UI-requirement-derived
//     prompt (a backlog review screen with status badges and a stale-
//     dependency warning - the SAME theme this script's own scenario 1 item
//     payload below uses, deliberately, for narrative continuity). The
//     initial call itself timed out. Polling `get_project`/`list_screens`
//     several times over several minutes showed a design theme and a
//     thumbnail *file* resource had been generated, but no `screens/{id}`
//     resource ever materialized in that window - `list_screens` stayed
//     empty throughout. The throwaway project was deleted afterward.
//   - THIS IS ITSELF THE SPIKE'S MOST IMPORTANT REAL FINDING: a real, live
//     demonstration of ERD 7.2's "ambiguous/lost response" scenario
//     happening for real against Stitch specifically - not simulated. It
//     directly supports FR-054's manual-fallback requirement and the BRD's
//     own already-flagged risk ("Stitch: Availability/support/pricing risk
//     must be reassessed before commercialization," BRD line 289).
//   - Separately: there is no real STITCH_API_KEY/HTTP endpoint for the
//     "available programmatic workflow" the BRD names - confirmed by reading
//     this environment's own .env.local (STITCH_API_KEY/SUPABASE_STORAGE_
//     BUCKET both genuinely blank, same as GITHUB_TOKEN/JIRA_*). The MCP-
//     based access used above is a fundamentally DIFFERENT integration
//     surface (Claude-side tool calls, not a server-callable REST endpoint) -
//     it is NOT something the deployed Next.js app could call the same way,
//     and it remains genuinely unknown whether a production Throughline
//     would integrate via a public REST API (if Google ever ships one) or
//     something else entirely. This gap is real and unresolved: the MCP
//     finding confirms real resource IDs, real async slowness, and a real
//     ambiguous-timeout failure mode exist for Stitch in general - it does
//     NOT confirm or deny src/external/stitch's own invented `POST
//     /v1/generate` shape either way.
// ===========================================================================
//
// What IS real about this run (unlike E4-T1/E4-T2, which had zero real
// credentials for anything): this worktree's .env.local (copied in from the
// main checkout) has a REAL hosted Supabase Postgres project - DATABASE_URL/
// DIRECT_DATABASE_URL point at olqxqsfowewvyrpwvepr.supabase.co, already
// migrated (drizzle/migrations/0000..0007, including the triggers and the
// impact() function this run depends on). Every DB write below - project,
// artifact, artifact_version, logical_item, item_version, membership,
// stitch_output, external_operation, external_ref - is a REAL row in that
// REAL hosted project, not Testcontainers. That is genuinely CLOSER to
// production infrastructure than tests/integration/external/stitch.test.ts's
// own Testcontainers-based coverage of the identical previewPrompt/generate
// code paths - this script's whole point is to exercise the real pipeline
// against something closer to that, not to duplicate that test's own
// coverage.
//
// Real-vs-faked matrix for this run, spelled out plainly:
//   DATABASE_URL / DIRECT_DATABASE_URL          REAL  (hosted Supabase Postgres)
//   NEXT_PUBLIC_SUPABASE_URL / SERVICE_ROLE_KEY  REAL  (used to construct the
//                                                       real storage client;
//                                                       only its outbound
//                                                       fetch is faked)
//   STITCH_API_KEY / STITCH_BASE_URL            FAKE  (blank in .env.local -
//                                                       spike-local values set
//                                                       via process.env below,
//                                                       before the first
//                                                       import that reads them)
//   SUPABASE_STORAGE_BUCKET                     FAKE  (blank in .env.local -
//                                                       same reason)
//   Stitch's own HTTP responses                 FAKE  (in-process fake fetch,
//                                                       same technique as
//                                                       stitch.test.ts)
//   Supabase Storage's own HTTP responses        FAKE  (same fetch, same file)
//
// Dynamic-import-after-env-setup gotcha (same one tests/integration/
// external/stitch.test.ts's own header comment documents): src/lib/env.ts
// parses `process.env` ONCE, at that module's own first import, into a
// frozen singleton (`export const env = loadEnv()`). Since STITCH_API_KEY/
// STITCH_BASE_URL/SUPABASE_STORAGE_BUCKET are blank in .env.local, this
// script must set `process.env.*` for those three BEFORE the first import of
// anything that transitively imports src/lib/env (../src/db, ../src/external/
// stitch, ...). A static top-level `import` is hoisted and would run before
// any of this file's own top-level statements regardless of source order, so
// those imports are deliberately `await import(...)`-ed inside main(), AFTER
// the process.env assignments - not a stylistic choice, a correctness one.
//
// `.ts`, not `.mts` (verified, not assumed - the concern E4-T1's own header
// comment raises for `octokit`): this script's only real dependencies beyond
// Node builtins are ../src/db, ../src/external/stitch (composing ../src/auth,
// ../src/external/operations, ../src/lineage/impact, ../src/artifact-types/
// ui-requirements transitively) and drizzle-orm - all either this project's
// own code or a dual CJS/ESM package (drizzle-orm, postgres, @supabase/
// supabase-js all ship a `require` exports condition). This ran successfully
// under plain `.ts` - see this story's own report for the real run output.
// No `octokit`-style ESM-only forced import exists on this path.
//
// ===========================================================================
// Permanent-leftover-rows disclosure (read before re-running this script):
// This spike calls `stitch.generate` against a REAL, APPROVED UI Requirements
// artifact_version with REAL `ui_requirement` item content (previewPrompt/
// generate both require `status = 'approved'` - src/external/stitch/
// index.ts's own `resolveApprovedVersion`). Approving a version, and giving
// it real logical_item/item_version/membership rows, runs straight into the
// ERD Appendix A invariants this repo enforces for real (see
// throughline-lineage-invariants):
//   - item_version_append_only (T1): a BEFORE UPDATE OR DELETE trigger that
//     unconditionally RAISEs on any attempt to touch an item_version row,
//     ever, for any reason. There is no code path - not even a DELETE - that
//     removes one once created.
//   - membership_draft_only (T4): artifact_version_item_membership rows can
//     only be inserted/updated/DELETEd while their artifact_version is still
//     'draft'. Once approved, they are frozen - including against DELETE.
//   - Every other table in the chain (logical_item, artifact_version,
//     artifact, project) is only reachable via ON DELETE RESTRICT foreign
//     keys pointing at the two tables above, so once a membership row is
//     frozen, the entire chain above it becomes permanently undeletable too.
// This is NOT a bug in this script or in src/external/stitch - it is these
// invariants working exactly as designed, demonstrated here for real against
// a real database rather than Testcontainers. It is also a genuine,
// unavoidable COST of running this particular spike for real: cleanup below
// deletes everything that CAN be deleted (stitch_output, external_ref,
// external_operation - none of which carry an append-only trigger or a
// frozen-once-non-draft rule) and clearly labels the project/artifact/
// version/item chain that cannot be deleted, so a human can identify it
// later. Every run of this script leaves ONE MORE such permanent chain in
// the real hosted database - do not re-run it casually or wire it into any
// repeated/CI process (same "cost/side-effect discipline" convention E4-T2's
// own header comment uses for its one real Jira issue per run).
//
// Run:
//   pnpm dotenv -e .env.local -- tsx scripts/spike-stitch-generation.ts
//
// Do not add a package.json script for this and do not wire it into vitest
// (same convention as every other scripts/spike-*.{ts,mts} file).

import { createHash, randomBytes, randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. Fake Stitch API + fake Supabase Storage - ONE combined `fetch`, since
//    `stitch.generate` calls both through the same global fetch (the Stitch
//    HTTP client in src/external/stitch/index.ts and @supabase/supabase-js's
//    own storage client both resolve `fetch` lazily at call time). Close,
//    spike-local adaptation of tests/integration/external/stitch.test.ts's
//    own `createFakeExternalWorld` - re-declared here rather than imported,
//    since tests/integration/** is vitest-only test support.
// ---------------------------------------------------------------------------

const STITCH_BASE_URL = 'https://fake-stitch.spike-e4-s5.test';
const HTML_CONTENT = '<html><body>Spike E4-S5 fake Stitch prototype</body></html>';
const SCREENSHOT_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // fake PNG header

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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
  throw new Error('fake Supabase Storage: unsupported upload body type in this spike');
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
        return jsonResponse(422, { error: 'invalid_prompt' }); // definitive 4xx (ERD 7.2)
      }
      const id = `spike-gen-${nextFakeGenerationId++}`;
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

    // --- fake Supabase Storage (real @supabase/supabase-js client, faked
    // network only - see header comment) ---
    const signMatch = /^\/storage\/v1\/object\/sign\/(.+)$/.exec(pathname);
    if (method === 'POST' && signMatch) {
      const key = signMatch[1]!;
      if (!storedObjects.has(key)) {
        return jsonResponse(400, { message: `not found: ${key}` });
      }
      return jsonResponse(200, { signedURL: `/object/sign/${key}?token=spike-fake-signed-token` });
    }
    const uploadMatch = /^\/storage\/v1\/object\/(.+)$/.exec(pathname);
    if (method === 'POST' && uploadMatch) {
      const key = uploadMatch[1]!;
      storedObjects.set(key, bodyToBuffer(init?.body));
      return jsonResponse(200, { Id: 'spike-fake-object-id', Key: key });
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

// ---------------------------------------------------------------------------
// 2. main() - everything below that touches ../src/* is inside here, so the
//    process.env assignments at the top of main() always run first (see the
//    "dynamic-import-after-env-setup gotcha" in the header comment).
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "[spike] E4-S5 Spike B (Stitch) starting - see this file's header for what this proves, " +
      'what it explicitly does NOT do, and the live MCP finding folded into this run.',
  );

  // STITCH_API_KEY/STITCH_BASE_URL/SUPABASE_STORAGE_BUCKET are blank in
  // .env.local - fill in spike-local fake values BEFORE the first import of
  // anything that reads them (src/lib/env.ts's module-level singleton).
  // DATABASE_URL/NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY etc. are
  // already real via .env.local and are left untouched.
  process.env.STITCH_API_KEY = 'spike-e4-s5-fake-key';
  process.env.STITCH_BASE_URL = STITCH_BASE_URL;
  process.env.SUPABASE_STORAGE_BUCKET = 'spike-e4-s5-stitch-assets';

  const { db, schema } = await import('../src/db');
  const stitch = await import('../src/external/stitch');
  const { eq, and } = await import('drizzle-orm');

  // -------------------------------------------------------------------------
  // 2a. Owner app_user - reuse an existing row if one already exists in this
  //     real hosted DB (same convention spike-github-reconciliation.mts
  //     uses), else create a throwaway one. app_user.id carries no FK to
  //     Supabase auth.users (src/db/schema/app-user.ts's own comment: "no FK
  //     to auth.users... a cascade would break audit history") so an
  //     arbitrary UUID is a valid, unconstrained insert - but it too becomes
  //     permanently retained via project's FK, once created (see header
  //     comment). Preferring an existing row avoids adding a NEW permanent
  //     row for this alone when one isn't needed.
  // -------------------------------------------------------------------------
  const [existingUser] = await db.select().from(schema.appUser).limit(1);
  let ownerUserId: string;
  if (existingUser) {
    ownerUserId = existingUser.id;
    console.log(`[spike] reusing existing app_user ${ownerUserId} as project owner.`);
  } else {
    const id = randomUUID();
    await db.insert(schema.appUser).values({ id, email: `${id}@spike-e4-s5.example.test` });
    ownerUserId = id;
    console.log(
      `[spike] no app_user existed in this real hosted DB - created a throwaway one (${id}), ` +
        'which will also become permanently retained (see header comment).',
    );
  }

  // -------------------------------------------------------------------------
  // 2b. One throwaway project + one ui_requirements artifact, shared by both
  //     scenarios (minimizes the permanent footprint - see header comment).
  // -------------------------------------------------------------------------
  const [project] = await db
    .insert(schema.project)
    .values({
      ownerUserId,
      name: 'E4-S5 SPIKE B (Stitch) - throwaway, PERMANENT by design, safe to ignore',
      brief:
        'SCRUM-54 / E4-S5 Spike B spike-stitch-generation.ts run. This project (and its ' +
        'ui_requirements artifact/versions/items) is permanently retained by design once approved ' +
        '- ERD Appendix A append-only/frozen invariants (T1 item_version, T4 membership). See that ' +
        "script's own header comment. Safe to ignore.",
    })
    .returning();
  if (!project) throw new Error('project insert returned no row');
  const projectId = project.id;

  const [artifact] = await db
    .insert(schema.artifact)
    .values({ projectId, type: 'ui_requirements' })
    .returning();
  if (!artifact) throw new Error('artifact insert returned no row');
  const artifactId = artifact.id;

  console.log(`[spike] project ${projectId} / ui_requirements artifact ${artifactId} created.`);

  let scenario1Passed = false;
  let scenario2Passed = false;
  let scenario1Error: unknown;
  let scenario2Error: unknown;
  let version1Id: string | null = null;

  const stitchOutputIdsToClean: string[] = [];
  const externalRefIdsToClean: string[] = [];
  const externalOperationIdsToClean: string[] = [];

  // ============= Scenario 1: approved prompt -> Stitch 2xx -> mode='api' ====
  try {
    console.log(
      '\n[spike] ===== Scenario 1: approved prompt -> generation -> persisted stitch_output' +
        "(mode='api') + external_ref =====",
    );

    const [version1] = await db
      .insert(schema.artifactVersion)
      .values({ artifactId, versionNumber: 1, status: 'draft', schemaVersion: 1 })
      .returning();
    if (!version1) throw new Error('artifact_version (v1) insert returned no row');
    version1Id = version1.id;

    // Same theme as the orchestrating session's own live MCP experiment
    // (see header comment) - a backlog review screen with status badges and
    // a stale-dependency warning - deliberate narrative continuity, not a
    // coincidence.
    const [logicalItem1] = await db
      .insert(schema.logicalItem)
      .values({ projectId, artifactId, itemType: 'ui_requirement', displayKey: 'UI-01' })
      .returning();
    if (!logicalItem1) throw new Error('logical_item (UI-01) insert returned no row');

    const [itemVersion1] = await db
      .insert(schema.itemVersion)
      .values({
        projectId,
        logicalItemId: logicalItem1.id,
        revisionNumber: 1,
        payload: {
          screenOrFlow: 'Backlog review screen',
          interactionRequirement:
            'Reviewer scans the backlog, sees a status badge per item, and is warned inline when an ' +
            'upstream dependency has gone stale.',
          responsiveConstraints: ['mobile-first layout', 'collapsible sidebar below 768px'],
          accessibilityConstraints: ['WCAG AA contrast', 'keyboard-navigable status badges'],
        },
        semanticHash: randomBytes(32).toString('hex'),
        semanticHashVersion: 1,
      })
      .returning();
    if (!itemVersion1) throw new Error('item_version (UI-01) insert returned no row');

    await db.insert(schema.artifactVersionItemMembership).values({
      artifactVersionId: version1.id,
      artifactId,
      logicalItemId: logicalItem1.id,
      itemVersionId: itemVersion1.id,
    });

    // Approve BEFORE calling previewPrompt/generate - both require
    // status='approved' (resolveApprovedVersion). Membership must be added
    // first: it is only mutable while the version is still 'draft' (T4).
    await db
      .update(schema.artifactVersion)
      .set({ status: 'approved' })
      .where(eq(schema.artifactVersion.id, version1.id));
    console.log(`[spike] scenario 1: ui_requirements artifact_version ${version1.id} approved.`);

    const preview = await stitch.previewPrompt(version1.id);
    if (!preview.prompt.includes('Backlog review screen') || !preview.prompt.includes('UI-01')) {
      throw new Error(
        `scenario 1 assertion failed: previewPrompt's prompt did not contain expected content: ` +
          preview.prompt,
      );
    }
    console.log(
      `[spike] scenario 1: previewPrompt() built a real prompt against the real approved version ` +
        `(${preview.prompt.length} chars, impact=${JSON.stringify(preview.impact)}).`,
    );

    const world = createFakeExternalWorld();
    const output = await withFakeFetch(world.fetch, () => stitch.generate(version1.id));

    if (output.mode !== 'api') {
      throw new Error(`scenario 1 assertion failed: expected mode='api', got ${output.mode}`);
    }
    if (!output.externalRefId) {
      throw new Error('scenario 1 assertion failed: expected a non-null externalRefId');
    }
    if (output.htmlChecksum !== sha256Hex(Buffer.from(HTML_CONTENT))) {
      throw new Error('scenario 1 assertion failed: html checksum did not match the fake bytes');
    }
    if (output.screenshotChecksum !== sha256Hex(SCREENSHOT_BYTES)) {
      throw new Error(
        'scenario 1 assertion failed: screenshot checksum did not match the fake bytes',
      );
    }
    stitchOutputIdsToClean.push(output.id);
    externalRefIdsToClean.push(output.externalRefId);

    // Independent SELECT - verify persistence for real, not just trust the
    // return value (same discipline spike-github-reconciliation.mts uses).
    const [persistedOutput] = await db
      .select()
      .from(schema.stitchOutput)
      .where(eq(schema.stitchOutput.id, output.id));
    if (!persistedOutput || persistedOutput.mode !== 'api') {
      throw new Error('scenario 1 assertion failed: independent SELECT of stitch_output mismatch');
    }
    const [persistedRef] = await db
      .select()
      .from(schema.externalRef)
      .where(eq(schema.externalRef.id, output.externalRefId));
    if (!persistedRef || persistedRef.provider !== 'stitch') {
      throw new Error('scenario 1 assertion failed: independent SELECT of external_ref mismatch');
    }
    const [persistedOp] = await db
      .select()
      .from(schema.externalOperation)
      .where(
        and(
          eq(schema.externalOperation.projectId, projectId),
          eq(schema.externalOperation.provider, 'stitch'),
          eq(schema.externalOperation.operationKey, `stitch:generate:${version1.id}`),
        ),
      );
    if (!persistedOp || persistedOp.status !== 'completed') {
      throw new Error(
        'scenario 1 assertion failed: independent SELECT of external_operation mismatch',
      );
    }
    externalOperationIdsToClean.push(persistedOp.id);
    console.log(
      `[spike] scenario 1: independent SELECTs confirm real persistence - stitch_output ` +
        `${persistedOutput.id} (mode=api), external_ref ${persistedRef.id}, external_operation ` +
        `${persistedOp.id} (status=completed).`,
    );

    const signed = await withFakeFetch(world.fetch, () => stitch.getSignedAssetUrls(output));
    if (
      !signed.htmlUrl?.includes('/object/sign/') ||
      !signed.screenshotUrl?.includes('/object/sign/')
    ) {
      throw new Error(
        `scenario 1 assertion failed: unexpected signed URL shape: ${JSON.stringify(signed)}`,
      );
    }
    console.log('[spike] scenario 1: getSignedAssetUrls() returned signed URLs for both assets.');

    scenario1Passed = true;
  } catch (err) {
    scenario1Error = err;
    console.error('[spike] scenario 1 FAILED:', err);
  }

  // ===== Scenario 2: approved prompt -> Stitch 4xx -> mode='manual_fallback' =====
  try {
    console.log(
      '\n[spike] ===== Scenario 2: approved prompt -> Stitch definitive 4xx -> persisted ' +
        "stitch_output(mode='manual_fallback'), prompt preserved, no ref =====",
    );

    const [version2] = await db
      .insert(schema.artifactVersion)
      .values({ artifactId, versionNumber: 2, status: 'draft', schemaVersion: 1 })
      .returning();
    if (!version2) throw new Error('artifact_version (v2) insert returned no row');

    const [logicalItem2] = await db
      .insert(schema.logicalItem)
      .values({ projectId, artifactId, itemType: 'ui_requirement', displayKey: 'UI-02' })
      .returning();
    if (!logicalItem2) throw new Error('logical_item (UI-02) insert returned no row');

    const [itemVersion2] = await db
      .insert(schema.itemVersion)
      .values({
        projectId,
        logicalItemId: logicalItem2.id,
        revisionNumber: 1,
        payload: {
          screenOrFlow: 'Stale dependency warning banner',
          interactionRequirement:
            'User must acknowledge a stale-upstream-dependency banner before proceeding to checkout.',
          responsiveConstraints: [],
          accessibilityConstraints: ['aria-live region for the warning'],
        },
        semanticHash: randomBytes(32).toString('hex'),
        semanticHashVersion: 1,
      })
      .returning();
    if (!itemVersion2) throw new Error('item_version (UI-02) insert returned no row');

    await db.insert(schema.artifactVersionItemMembership).values({
      artifactVersionId: version2.id,
      artifactId,
      logicalItemId: logicalItem2.id,
      itemVersionId: itemVersion2.id,
    });

    // one_approved_version (INV-001/INV-005): only one 'approved' version per
    // artifact at a time - supersede v1 (still 'approved' from scenario 1)
    // before approving v2. This UPDATE is unconditionally legal regardless
    // of whether scenario 1's own assertions passed, since v1 was inserted
    // and approved unconditionally at the top of that try block.
    if (!version1Id) {
      throw new Error(
        'scenario 2 cannot run: scenario 1 never got far enough to create/approve version 1',
      );
    }
    await db
      .update(schema.artifactVersion)
      .set({ status: 'superseded' })
      .where(eq(schema.artifactVersion.id, version1Id));
    await db
      .update(schema.artifactVersion)
      .set({ status: 'approved' })
      .where(eq(schema.artifactVersion.id, version2.id));
    console.log(
      `[spike] scenario 2: version 1 (${version1Id}) superseded, version 2 (${version2.id}) approved.`,
    );

    const preview = await stitch.previewPrompt(version2.id);
    if (!preview.prompt.includes('Stale dependency warning banner')) {
      throw new Error(
        `scenario 2 assertion failed: previewPrompt's prompt did not contain expected content: ` +
          preview.prompt,
      );
    }

    const world = createFakeExternalWorld();
    world.setFailNextGenerate(true);

    // FR-054: generate() does NOT throw on a definitive failure - the
    // preserved prompt IS the output, and the planning workflow continues.
    const output = await withFakeFetch(world.fetch, () => stitch.generate(version2.id));

    if (output.mode !== 'manual_fallback') {
      throw new Error(
        `scenario 2 assertion failed: expected mode='manual_fallback', got ${output.mode}`,
      );
    }
    if (output.externalRefId !== null) {
      throw new Error('scenario 2 assertion failed: expected a null externalRefId');
    }
    if (!output.promptText.includes('Stale dependency warning banner')) {
      throw new Error('scenario 2 assertion failed: promptText did not preserve the real prompt');
    }
    if (output.htmlStorageKey !== null || output.screenshotStorageKey !== null) {
      throw new Error('scenario 2 assertion failed: expected no assets to have been uploaded');
    }
    if (world.storedObjects.size !== 0) {
      throw new Error('scenario 2 assertion failed: expected nothing uploaded to fake storage');
    }
    stitchOutputIdsToClean.push(output.id);

    const [persistedOutput] = await db
      .select()
      .from(schema.stitchOutput)
      .where(eq(schema.stitchOutput.id, output.id));
    if (!persistedOutput || persistedOutput.mode !== 'manual_fallback') {
      throw new Error('scenario 2 assertion failed: independent SELECT of stitch_output mismatch');
    }
    const [persistedOp] = await db
      .select()
      .from(schema.externalOperation)
      .where(
        and(
          eq(schema.externalOperation.projectId, projectId),
          eq(schema.externalOperation.provider, 'stitch'),
          eq(schema.externalOperation.operationKey, `stitch:generate:${version2.id}`),
        ),
      );
    if (!persistedOp || persistedOp.status !== 'failed') {
      throw new Error(
        'scenario 2 assertion failed: independent SELECT expected external_operation.status=failed',
      );
    }
    externalOperationIdsToClean.push(persistedOp.id);
    console.log(
      `[spike] scenario 2: independent SELECTs confirm real persistence - stitch_output ` +
        `${persistedOutput.id} (mode=manual_fallback, external_ref_id=null), external_operation ` +
        `${persistedOp.id} (status=failed) - the prompt is preserved, no ref, workflow continues.`,
    );

    scenario2Passed = true;
  } catch (err) {
    scenario2Error = err;
    console.error('[spike] scenario 2 FAILED:', err);
  }

  // ---------------------------------------------------------------------------
  // 3. Cleanup - best effort. Deletes everything that CAN be deleted
  //    (stitch_output/external_ref/external_operation carry no append-only
  //    trigger). Then ATTEMPTS the lineage chain in FK-safe order purely to
  //    demonstrate - and log - that it is genuinely blocked by design (see
  //    header comment), rather than silently leaving the reader to wonder
  //    why cleanup "only did part of the job".
  // ---------------------------------------------------------------------------

  console.log('\n[spike] ===== Cleanup =====');

  for (const id of stitchOutputIdsToClean) {
    try {
      await db.delete(schema.stitchOutput).where(eq(schema.stitchOutput.id, id));
      console.log(`[spike] cleanup: stitch_output ${id} deleted.`);
    } catch (err) {
      console.error(`[spike] cleanup FAILED for stitch_output ${id}:`, err);
    }
  }
  for (const id of externalRefIdsToClean) {
    try {
      await db.delete(schema.externalRef).where(eq(schema.externalRef.id, id));
      console.log(`[spike] cleanup: external_ref ${id} deleted.`);
    } catch (err) {
      console.error(`[spike] cleanup FAILED for external_ref ${id}:`, err);
    }
  }
  for (const id of externalOperationIdsToClean) {
    try {
      await db.delete(schema.externalOperation).where(eq(schema.externalOperation.id, id));
      console.log(`[spike] cleanup: external_operation ${id} deleted.`);
    } catch (err) {
      console.error(`[spike] cleanup FAILED for external_operation ${id}:`, err);
    }
  }

  async function tryDelete(label: string, fn: () => Promise<unknown>): Promise<boolean> {
    try {
      await fn();
      console.log(`[spike] cleanup: ${label} deleted.`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
      console.log(
        `[spike] cleanup: ${label} NOT deleted (EXPECTED - append-only/frozen lineage ` +
          `invariants, see this file's header comment): ${message}`,
      );
      return false;
    }
  }

  await tryDelete('artifact_version_item_membership rows', () =>
    db
      .delete(schema.artifactVersionItemMembership)
      .where(eq(schema.artifactVersionItemMembership.artifactId, artifactId)),
  );
  await tryDelete('item_version rows', () =>
    db.delete(schema.itemVersion).where(eq(schema.itemVersion.projectId, projectId)),
  );
  await tryDelete('logical_item rows', () =>
    db.delete(schema.logicalItem).where(eq(schema.logicalItem.artifactId, artifactId)),
  );
  await tryDelete('artifact_version rows', () =>
    db.delete(schema.artifactVersion).where(eq(schema.artifactVersion.artifactId, artifactId)),
  );
  await tryDelete('artifact', () =>
    db.delete(schema.artifact).where(eq(schema.artifact.id, artifactId)),
  );
  await tryDelete('project', () =>
    db.delete(schema.project).where(eq(schema.project.id, projectId)),
  );

  console.log(
    `\n[spike] PERMANENTLY RETAINED in the real hosted DB (by design - see header comment): ` +
      `project ${projectId}, artifact ${artifactId}, up to 2 artifact_version rows, up to 2 ` +
      `logical_item rows, up to 2 item_version rows, up to 2 membership rows. Clearly labeled via ` +
      `the project's own name/brief for a human to find later.`,
  );

  // ---------------------------------------------------------------------------
  // 4. Report.
  // ---------------------------------------------------------------------------

  console.log('\n================= E4-S5 SPIKE B (STITCH) RESULT =================');
  console.log(
    `Scenario 1 (approved prompt -> generation -> mode='api' + external_ref): ` +
      `${scenario1Passed ? 'PASSED end-to-end against the real hosted DB' : 'FAILED'}` +
      (scenario1Error ? ` - ${String((scenario1Error as Error)?.message ?? scenario1Error)}` : ''),
  );
  console.log(
    `Scenario 2 (approved prompt -> Stitch 4xx -> mode='manual_fallback', prompt preserved): ` +
      `${scenario2Passed ? 'PASSED end-to-end against the real hosted DB' : 'FAILED'}` +
      (scenario2Error ? ` - ${String((scenario2Error as Error)?.message ?? scenario2Error)}` : ''),
  );
  console.log(
    '\nLive MCP finding folded into this run (see header comment for the full account, ' +
      'attributed to the orchestrating session, not reproduced by this script): a real Stitch ' +
      'generation request timed out and never produced a screens/{id} resource across several ' +
      "minutes of polling - a live instance of ERD 7.2's ambiguous/lost-response scenario, " +
      "supporting FR-054 manual fallback and the BRD's own already-flagged Stitch availability risk.",
  );
  console.log(
    '\nUnresolved gap this run does NOT settle: no real STITCH_API_KEY/HTTP endpoint exists ' +
      "anywhere in this environment - src/external/stitch's own POST /v1/generate shape remains " +
      'an undecided judgment call from E4-S4, neither confirmed nor denied by this run or by the ' +
      'live MCP finding above (a fundamentally different integration surface).',
  );
  console.log('===================================================================\n');

  process.exit(scenario1Passed && scenario2Passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[spike] unhandled error:', err);
  process.exit(1);
});
