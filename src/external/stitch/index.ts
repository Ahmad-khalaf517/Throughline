// Module 16: external/stitch
// Owns: stitch_output - the one provider module with a table of its own
// (Module Boundaries 4.6/section 5: `github`/`jira` own no table; `stitch`
// owns `stitch_output`).
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// ERD 7.5, 4.16, TR FR-050..054 (E4-S4 / SCRUM-53). Never writes
// `external_operation`/`external_ref` directly (Module Boundaries 4.5's own
// rule) - every real object mutation goes through
// `external-operations.runOperation`, supplying only the Stitch-specific
// `send`/`reconcile` closures, same as `github`/`jira`. UNLIKE those two,
// this module's own `send()`/`generate()` also writes `stitch_output`
// directly (never through `runOperation`, which never touches that table) -
// Module Boundaries 4.6's own doc comment on `stitch.generate`: "on
// definitive failure, writes/updates stitch_output(mode='manual_fallback')
// directly... with the preserved prompt".
//
// Reads the approved UI Requirements version's own item content through
// `artifact-types/ui-requirements` (this module's documented paired layer-3
// module, Module Boundaries 4.6 / eslint.config.mjs's layer5-external-provider
// rule), never through `lineage/identity` directly - see that file's own
// `getUiRequirementsForPrompt` header comment for why.
//
// Talks to Stitch through Google's official `@google/stitch-sdk` (ESM-only;
// this module hands it only the `apiKey` - the base URL is left to the SDK
// default, https://stitch.googleapis.com/mcp). One Stitch project is created per
// generation, titled with a deterministic marker containing the operation key
// (`throughline:stitch:generate:<uiRequirementsVersionId>`), then
// `project.generate(prompt, 'DESKTOP')` produces the screen. `getHtml()`/
// `getImage()` return short-lived DOWNLOAD URLs this module immediately fetches
// and re-uploads to Supabase Storage (FR-052: "shall persist the useful Stitch
// result rather than depend permanently on remote output URLs" - the remote
// URLs are used exactly once, to fetch bytes, never stored or read again).
// The project-title marker is also what `reconcileGenerate` searches by (a slow
// generation can time out client-side after the screen really was created -
// Spike B, TR 42). Stitch cannot enumerate screens (verified live 2026-09-28),
// so reconcile falls back to regenerating once - see its own doc comment.
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Stitch, StitchError, StitchToolClient, type Screen } from '@google/stitch-sdk';
import { env } from '@/lib/env';
import { db, schema } from '@/db';
import { getStorageServiceClient } from '@/auth';
import {
  runOperation,
  getRefById,
  getOperationsForVersion,
  DefinitiveProviderError,
  type ExternalRef,
} from '@/external/operations';
import { getWarnings, getExternalDrift, type ImpactRow } from '@/lineage/impact';
import {
  getUiRequirementsForPrompt,
  type UiRequirementItemForPrompt,
} from '@/artifact-types/ui-requirements';

export type StitchOutput = typeof schema.stitchOutput.$inferSelect;

// ---------------------------------------------------------------------------
// Errors - mirrors github/jira's own named-Error-subclass convention.
// ---------------------------------------------------------------------------

/**
 * Judgment call, same shape as `github`'s `ArchitectureVersionNotApprovedError`
 * / `jira`'s `BacklogVersionNotApprovedError`: matches `impact()`'s own
 * `current_m` definition (ERD 6.1) and `docs/Throughline_API_Contracts.md`
 * section 10's `409 PREREQUISITE_NOT_APPROVED` - Stitch can only
 * preview/generate from the CURRENT, authoritative UI Requirements version.
 */
export class UiRequirementsVersionNotApprovedError extends Error {
  constructor(uiRequirementsVersionId: string, actualStatus: string) {
    super(
      `artifact_version ${uiRequirementsVersionId} is '${actualStatus}', not 'approved' - Stitch ` +
        'can only preview/generate from the current, authoritative UI Requirements version',
    );
    this.name = 'UiRequirementsVersionNotApprovedError';
  }
}

/**
 * ERD 4.16: "one output per UI Requirements version" (UNIQUE on
 * `source_ui_requirements_version_id`) + `docs/Throughline_API_Contracts.md`
 * section 10's `409 ALREADY_GENERATED`. A `manual_fallback` row does NOT
 * trigger this - FR-054's retry-in-place path is exactly what `generate`
 * still allows for that case (see its own body below).
 */
export class AlreadyGeneratedError extends Error {
  constructor(uiRequirementsVersionId: string) {
    super(
      `stitch_output for ui_requirements artifact_version ${uiRequirementsVersionId} already has ` +
        "mode='api' - one Stitch output per UI Requirements version (ERD 4.16)",
    );
    this.name = 'AlreadyGeneratedError';
  }
}

export class StitchReconciliationRequiredError extends Error {
  constructor(operationKey: string) {
    super(
      `Stitch operation ${operationKey} is reconciliation_required - retry is user-initiated ` +
        '(ERD 7.2), not automatic',
    );
    this.name = 'StitchReconciliationRequiredError';
  }
}

export class StitchOperationInFlightError extends Error {
  constructor(operationKey: string) {
    super(`Stitch operation ${operationKey} is already in flight (R5) - do not resend yet`);
    this.name = 'StitchOperationInFlightError';
  }
}

export class StitchOperationConflictError extends Error {
  constructor(operationKey: string) {
    super(
      `Stitch operation ${operationKey} already exists with a different request (R11) - never a ` +
        'silent resend or reuse',
    );
    this.name = 'StitchOperationConflictError';
  }
}

// ---------------------------------------------------------------------------
// FR-050 prompt building - reads the ERD 5.4 `ui_requirement` projection
// fields (src/lineage/identity/projection.ts's `semanticProjection`) straight
// off `item_version.payload`, defensively: no `ui-requirements`
// outputSchema/toCandidates exists yet to validate this shape structurally
// (E2-S9's own stub scope, ui-requirements/index.ts's header comment), so a
// missing/malformed field renders as an empty placeholder rather than
// throwing - a hand-built test fixture with a partial payload still produces
// a legible (if incomplete) prompt instead of crashing previewPrompt/generate
// outright.
// ---------------------------------------------------------------------------

function textField(payload: unknown, key: string): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function listField(payload: unknown, key: string): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function buildPrompt(items: UiRequirementItemForPrompt[]): string {
  const sections = items.map((item) => {
    const screenOrFlow = textField(item.payload, 'screenOrFlow') || '(unspecified screen/flow)';
    const interactionRequirement = textField(item.payload, 'interactionRequirement');
    const responsiveConstraints = listField(item.payload, 'responsiveConstraints');
    const accessibilityConstraints = listField(item.payload, 'accessibilityConstraints');
    return (
      `${item.displayKey}: ${screenOrFlow}\n` +
      `  Interaction: ${interactionRequirement || '(none specified)'}\n` +
      `  Responsive constraints: ${responsiveConstraints.join('; ') || 'none'}\n` +
      `  Accessibility constraints: ${accessibilityConstraints.join('; ') || 'none'}`
    );
  });

  return (
    'Generate one primary UI prototype (TR FR-051) covering the following approved UI ' +
    `Requirements:\n\n${sections.join('\n\n')}`
  );
}

async function resolveApprovedVersion(uiRequirementsVersionId: string) {
  const version = await getUiRequirementsForPrompt(uiRequirementsVersionId);
  if (version.status !== 'approved') {
    throw new UiRequirementsVersionNotApprovedError(uiRequirementsVersionId, version.status);
  }
  return version;
}

// ---------------------------------------------------------------------------
// FR-050 - preview.
// ---------------------------------------------------------------------------

export async function previewPrompt(
  uiRequirementsVersionId: string,
): Promise<{ prompt: string; impact: ImpactRow[] }> {
  const version = await resolveApprovedVersion(uiRequirementsVersionId);
  const prompt = buildPrompt(version.items);

  // TR FR-085: "Every external-write preview... shows current impact for the
  // items it would create from" - same item-level-impact-preview pattern
  // `github.previewInit`/`jira.previewExport` both already use.
  const itemVersionIdSet = new Set(version.items.map((item) => item.itemVersionId));
  const projectWarnings = await getWarnings(version.projectId);
  const impact = projectWarnings.filter(
    (row) => row.subjectKind === 'item_version' && itemVersionIdSet.has(row.subjectId),
  );

  return { prompt, impact };
}

// ---------------------------------------------------------------------------
// Stitch SDK client (official `@google/stitch-sdk`).
// ---------------------------------------------------------------------------

/** Deterministic project title - the marker `reconcileGenerate` finds the project by. */
function projectTitle(uiRequirementsVersionId: string): string {
  return `throughline:stitch:generate:${uiRequirementsVersionId}`;
}

function requireStitchApiKey(): string {
  if (!env.STITCH_API_KEY) {
    throw new Error('Stitch is not configured - missing STITCH_API_KEY (ERD 7.5, real mode).');
  }
  return env.STITCH_API_KEY;
}

/**
 * Runs `fn` against a fresh SDK client and always closes it. `baseUrl` is
 * deliberately left to the SDK default.
 */
async function withStitch<T>(apiKey: string, fn: (client: Stitch) => Promise<T>): Promise<T> {
  const toolClient = new StitchToolClient({ apiKey });
  try {
    return await fn(new Stitch(toolClient));
  } finally {
    await toolClient.close().catch(() => undefined);
  }
}

// ERD 7.2: `failed` is reserved for DEFINITIVE provider rejections. These SDK
// codes are the 4xx-equivalents; RATE_LIMITED/NETWORK_ERROR/UNKNOWN_ERROR
// (which is also what the SDK wraps timeouts and 5xx into) stay ambiguous.
const DEFINITIVE_STITCH_CODES: ReadonlySet<string> = new Set([
  'VALIDATION_ERROR',
  'AUTH_FAILED',
  'PERMISSION_DENIED',
  'NOT_FOUND',
]);

function classifyStitchError(error: unknown): unknown {
  if (error instanceof StitchError && DEFINITIVE_STITCH_CODES.has(error.code)) {
    return new DefinitiveProviderError(`stitch_generate_rejected:${error.code}`);
  }
  return error; // ambiguous - propagates unchanged (ERD 7.2 R6/R9)
}

function requireStorageBucket(): string {
  if (!env.SUPABASE_STORAGE_BUCKET) {
    throw new Error(
      'SUPABASE_STORAGE_BUCKET is not configured - required to persist Stitch output (ERD 4.16, ' +
        'FR-052, real mode).',
    );
  }
  return env.SUPABASE_STORAGE_BUCKET;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Stitch asset fetch failed: GET ${url} -> ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// `getStorageServiceClient`'s return type, referenced structurally (no
// `@supabase/*` import here - `no-restricted-imports` allows that only from
// `src/auth`, Module Boundaries 4.1).
type StorageServiceClient = ReturnType<typeof getStorageServiceClient>;

async function uploadAsset(
  storage: StorageServiceClient,
  bucket: string,
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await storage.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true, // FR-054: a later successful retry overwrites the same key in place.
  });
  if (error) {
    throw new Error(`Supabase Storage upload failed for ${bucket}/${path}: ${error.message}`);
  }
}

interface AssetMetadata {
  htmlStorageKey: string;
  htmlChecksum: string;
  screenshotStorageKey: string;
  screenshotChecksum: string;
}

/**
 * Downloads a generated screen's HTML + screenshot and uploads both to
 * Supabase Storage. Shared by `send` and `reconcile` (which must return the
 * same shape). Runs INSIDE those closures (same discipline `github`'s own
 * `sendCreateRepo` uses for `writeProvenanceFiles` - a failure here is ALSO
 * ambiguous/retryable via the same path as a lost create response).
 */
async function persistScreen(args: {
  screen: Screen;
  storage: StorageServiceClient;
  bucket: string;
  uiRequirementsVersionId: string;
}): Promise<{ externalId: string; externalUrl: string; metadata: AssetMetadata }> {
  const htmlUrl = await args.screen.getHtml();
  const screenshotUrl = await args.screen.getImage();
  const html = await fetchBytes(htmlUrl);
  const screenshot = await fetchBytes(screenshotUrl);

  const htmlStorageKey = `stitch/${args.uiRequirementsVersionId}/index.html`;
  const screenshotStorageKey = `stitch/${args.uiRequirementsVersionId}/screenshot.png`;
  const htmlChecksum = sha256Hex(html);
  const screenshotChecksum = sha256Hex(screenshot);

  await uploadAsset(args.storage, args.bucket, htmlStorageKey, html, 'text/html; charset=utf-8');
  await uploadAsset(args.storage, args.bucket, screenshotStorageKey, screenshot, 'image/png');

  return {
    externalId: `${args.screen.projectId}/${args.screen.id}`,
    // Informational only (audit trail of where the bytes originally came
    // from) - FR-052's "never depend permanently on remote output URLs" means
    // this module never reads it back; `getSignedAssetUrls` below is the only
    // read path a future UI ever uses.
    externalUrl: htmlUrl,
    metadata: { htmlStorageKey, htmlChecksum, screenshotStorageKey, screenshotChecksum },
  };
}

/**
 * `runOperation`'s `send()` closure: create the marker-titled project, generate
 * one DESKTOP screen, persist its assets. Definitive SDK rejections become
 * `DefinitiveProviderError` (FR-054 manual_fallback); everything else -
 * including the SDK's timeout - propagates ambiguous and is never re-sent
 * (reconcile finds the screen instead).
 */
async function sendGenerate(args: {
  apiKey: string;
  storage: StorageServiceClient;
  bucket: string;
  prompt: string;
  uiRequirementsVersionId: string;
}): Promise<{ externalId: string; externalUrl: string; metadata: AssetMetadata }> {
  return withStitch(args.apiKey, async (client) => {
    let screen: Screen;
    try {
      const project = await client.createProject(projectTitle(args.uiRequirementsVersionId));
      screen = await project.generate(args.prompt, 'DESKTOP');
    } catch (error) {
      throw classifyStitchError(error);
    }
    return persistScreen({
      screen,
      storage: args.storage,
      bucket: args.bucket,
      uiRequirementsVersionId: args.uiRequirementsVersionId,
    });
  });
}

/**
 * `runOperation`'s `reconcile()` closure (ERD 7.3, Spike B / TR 42): Stitch's
 * generation is slow and can time out client-side after the screen was in fact
 * created. Stitch CANNOT enumerate screens (verified live 2026-09-28:
 * `project.screens()` / list_screens returns empty even for a project with a
 * generated screen, and the project record carries no screen list), so a lost
 * screen can never be recovered by lookup. `runOperation` never resends and
 * treats `found: false` as a dead end (reconciliation_required forever), so this
 * closure does:
 *   1. the cheap lookup - find the marker-titled project via `stitch.projects()`
 *      and, if `screens()` ever returns one, persist it (harmless if the API
 *      later starts listing screens); no second generate.
 *   2. otherwise REGENERATE: reuse the marker project if one exists (else
 *      create it), call `project.generate` exactly once, persist, and return
 *      `found: true` with the same shape `send` returns.
 * Only reached via a user-initiated retry (`runOperation` never auto-reconciles),
 * so it is bounded: at most one generate per call. Error mapping is identical to
 * `send`: definitive => `DefinitiveProviderError` (manual_fallback); an ambiguous
 * regenerate error returns `found: false` (reconciliation_required, retryable;
 * `generate()` surfaces StitchReconciliationRequiredError). Disclosed tradeoff: a
 * still-running server-side generation from the lost attempt may produce a
 * duplicate orphan screen/project on Stitch's side - harmless to Throughline.
 */
async function reconcileGenerate(args: {
  apiKey: string;
  storage: StorageServiceClient;
  bucket: string;
  prompt: string;
  uiRequirementsVersionId: string;
}): Promise<
  | { found: true; externalId: string; externalUrl: string; metadata: AssetMetadata }
  | { found: false }
> {
  const title = projectTitle(args.uiRequirementsVersionId);
  return withStitch(args.apiKey, async (client) => {
    const persist = (screen: Screen) =>
      persistScreen({
        screen,
        storage: args.storage,
        bucket: args.bucket,
        uiRequirementsVersionId: args.uiRequirementsVersionId,
      });

    const projects = (await client.projects()).filter(
      (project) => (project.data as { title?: string } | undefined)?.title === title,
    );
    for (const project of projects) {
      const [screen] = await project.screens();
      if (screen) {
        return { found: true as const, ...(await persist(screen)) };
      }
    }

    let screen: Screen;
    try {
      const project = projects[0] ?? (await client.createProject(title));
      screen = await project.generate(args.prompt, 'DESKTOP');
    } catch (error) {
      const classified = classifyStitchError(error);
      if (classified instanceof DefinitiveProviderError) throw classified;
      // Ambiguous: the regenerate itself is inconclusive, so report
      // "not found" -> reconciliation_required (retryable, 409 at the route).
      return { found: false as const };
    }
    return { found: true as const, ...(await persist(screen)) };
  });
}

// ---------------------------------------------------------------------------
// stitch_output - this module's own owned table (Module Boundaries section
// 5). Never written through `runOperation` (that module never touches this
// table) - written/updated directly here, both on success and on definitive
// failure.
// ---------------------------------------------------------------------------

async function findExistingStitchOutput(
  uiRequirementsVersionId: string,
): Promise<StitchOutput | null> {
  const [row] = await db
    .select()
    .from(schema.stitchOutput)
    .where(eq(schema.stitchOutput.sourceUiRequirementsVersionId, uiRequirementsVersionId))
    .limit(1);
  return row ?? null;
}

/**
 * Insert-or-update keyed on the table's own UNIQUE
 * (`source_ui_requirements_version_id`) constraint - FR-054: "a later
 * successful API retry... UPDATEs the existing manual_fallback row... never a
 * second row." One write path, used for both the `mode='api'` success case
 * and the `mode='manual_fallback'` definitive-failure case.
 */
async function upsertStitchOutput(args: {
  projectId: string;
  uiRequirementsVersionId: string;
  mode: 'api' | 'manual_fallback';
  externalRefId: string | null;
  promptText: string;
  assets: AssetMetadata | null;
}): Promise<StitchOutput> {
  const values = {
    projectId: args.projectId,
    sourceUiRequirementsVersionId: args.uiRequirementsVersionId,
    externalRefId: args.externalRefId,
    mode: args.mode,
    promptText: args.promptText,
    htmlStorageKey: args.assets?.htmlStorageKey ?? null,
    htmlChecksum: args.assets?.htmlChecksum ?? null,
    screenshotStorageKey: args.assets?.screenshotStorageKey ?? null,
    screenshotChecksum: args.assets?.screenshotChecksum ?? null,
  };
  const [row] = await db
    .insert(schema.stitchOutput)
    .values(values)
    .onConflictDoUpdate({
      target: schema.stitchOutput.sourceUiRequirementsVersionId,
      set: {
        externalRefId: values.externalRefId,
        mode: values.mode,
        promptText: values.promptText,
        htmlStorageKey: values.htmlStorageKey,
        htmlChecksum: values.htmlChecksum,
        screenshotStorageKey: values.screenshotStorageKey,
        screenshotChecksum: values.screenshotChecksum,
      },
    })
    .returning();
  if (!row) {
    throw new Error(`stitch_output upsert for ${args.uiRequirementsVersionId} returned no row`);
  }
  return row;
}

function assetMetadataFromRef(ref: ExternalRef): AssetMetadata {
  const metadata =
    typeof ref.metadata === 'object' && ref.metadata !== null
      ? (ref.metadata as Record<string, unknown>)
      : {};
  const htmlStorageKey = metadata.htmlStorageKey;
  const htmlChecksum = metadata.htmlChecksum;
  const screenshotStorageKey = metadata.screenshotStorageKey;
  const screenshotChecksum = metadata.screenshotChecksum;
  if (
    typeof htmlStorageKey !== 'string' ||
    typeof htmlChecksum !== 'string' ||
    typeof screenshotStorageKey !== 'string' ||
    typeof screenshotChecksum !== 'string'
  ) {
    // external_operation_completed_has_external_id_check plus `sendGenerate`
    // always setting all four fields together mean this is a data-integrity
    // bug, not a normal runtime path (same convention
    // external-operations/index.ts's own `finalizeCompleted` uses for its
    // analogous "should never happen" checks).
    throw new Error(`external_ref ${ref.id} completed without expected Stitch asset metadata`);
  }
  return { htmlStorageKey, htmlChecksum, screenshotStorageKey, screenshotChecksum };
}

// ---------------------------------------------------------------------------
// FR-051/052/054 + ERD 7.5/4.16 - generate.
// ---------------------------------------------------------------------------

export async function generate(uiRequirementsVersionId: string): Promise<StitchOutput> {
  const version = await resolveApprovedVersion(uiRequirementsVersionId);
  const prompt = buildPrompt(version.items);

  const existing = await findExistingStitchOutput(uiRequirementsVersionId);
  if (existing?.mode === 'api') {
    throw new AlreadyGeneratedError(uiRequirementsVersionId);
  }

  const apiKey = requireStitchApiKey();
  const bucket = requireStorageBucket();
  const storage = getStorageServiceClient();

  // ERD line ~474: "stitch:generate:<ui_version_id> (Stitch has no chosen
  // target)" - the operation key format is ERD-literal.
  const operationKey = `stitch:generate:${uiRequirementsVersionId}`;
  const requestHash = createHash('sha256').update(prompt).digest('hex');

  const result = await runOperation({
    projectId: version.projectId,
    provider: 'stitch',
    operationType: 'generate',
    operationKey,
    requestHash,
    targetDescriptor: { uiRequirementsVersionId },
    sourceArtifactVersionId: uiRequirementsVersionId,
    // Legacy environment-credential path (SCRUM-96 part A keeps today's behaviour):
    // per-user connections arrive with the provider stories (UC-S4 part B / UC-S5 / UC-S6).
    connectionId: null,
    send: () => sendGenerate({ apiKey, storage, bucket, prompt, uiRequirementsVersionId }),
    reconcile: () =>
      reconcileGenerate({ apiKey, storage, bucket, prompt, uiRequirementsVersionId }),
  });

  switch (result.status) {
    case 'completed':
      return upsertStitchOutput({
        projectId: version.projectId,
        uiRequirementsVersionId,
        mode: 'api',
        externalRefId: result.ref.id,
        promptText: prompt,
        assets: assetMetadataFromRef(result.ref),
      });
    case 'failed':
      // Module Boundaries 4.6 / ERD 7.5: a DEFINITIVE provider failure is
      // written directly here (never through `runOperation`, which never
      // touches `stitch_output`) - `mode='manual_fallback'`, prompt
      // preserved, no ref. FR-054: "Third-party failure must not invalidate
      // the rest of the project" - this returns normally, it does not throw;
      // the planning workflow continues in manual mode.
      return upsertStitchOutput({
        projectId: version.projectId,
        uiRequirementsVersionId,
        mode: 'manual_fallback',
        externalRefId: null,
        promptText: prompt,
        assets: null,
      });
    case 'reconciliation_required':
      throw new StitchReconciliationRequiredError(operationKey);
    case 'in_flight':
      throw new StitchOperationInFlightError(operationKey);
    case 'conflict':
      throw new StitchOperationConflictError(operationKey);
    case 'refused':
      // Never actually reachable for provider='stitch' - `runOperation`'s own
      // GitHub-exclusivity refusal check (external-operations/index.ts's
      // `insertOperationRow`) only ever fires for `provider === 'github'`.
      // Kept only so this switch stays exhaustive against
      // `RunOperationResult`'s real 6-variant union.
      throw new Error(`unexpected 'refused' status for Stitch operation ${operationKey}`);
  }
}

// ---------------------------------------------------------------------------
// FR-052/053/054 - read the persisted result back (SCRUM-91). Without this the
// only place a generated result lived was the generating page's own React
// state: leaving and returning showed the form again (a second submit then hit
// ALREADY_GENERATED), and a refresh mid-generation hit the in-flight error.
// ---------------------------------------------------------------------------

export type StitchOutputState =
  | { state: 'none' }
  | { state: 'generated'; output: StitchOutput }
  | { state: 'manual_fallback'; output: StitchOutput }
  | {
      state: 'in_progress';
      operationId: string;
      status: 'pending' | 'reconciliation_required';
    };

/**
 * What exists for one UI Requirements version, as a discriminated state.
 * Precedence: a `mode='api'` output wins; else an unfinished operation
 * (`pending`/`reconciliation_required`) means `in_progress` - even over an
 * older `manual_fallback` row, since a retry in flight is more current; else a
 * `manual_fallback` row; else `none`. A `failed` operation with a fallback row
 * is just `manual_fallback`. Reads `stitch_output` directly (own table) and the
 * operation only through `external-operations` (Module Boundaries 4.5); never
 * throws for the empty case.
 */
export async function getOutput(uiRequirementsVersionId: string): Promise<StitchOutputState> {
  const output = await findExistingStitchOutput(uiRequirementsVersionId);
  if (output?.mode === 'api') return { state: 'generated', output };

  const operationKey = `stitch:generate:${uiRequirementsVersionId}`;
  const operations = await getOperationsForVersion(uiRequirementsVersionId, 'stitch');
  const active = operations.find(
    (op) =>
      op.operationKey === operationKey &&
      (op.status === 'pending' || op.status === 'reconciliation_required'),
  );
  if (active) {
    return {
      state: 'in_progress',
      operationId: active.id,
      status: active.status as 'pending' | 'reconciliation_required',
    };
  }

  if (output) return { state: 'manual_fallback', output };
  return { state: 'none' };
}

// ---------------------------------------------------------------------------
// FR-052/053 - short-lived signed URLs for stored assets (this story's own
// title names this as in-scope). A future route/UI story (E4-S6+) is the
// actual consumer: it reads a `stitch_output` row, calls this for each
// non-null storage key, and renders the HTML only inside a sandboxed iframe
// without `allow-same-origin` (FR-053) - that rendering step is NOT this
// module's job.
// ---------------------------------------------------------------------------

const SIGNED_URL_TTL_SECONDS = 300;

export async function getSignedAssetUrls(
  output: StitchOutput,
): Promise<{ htmlUrl: string | null; screenshotUrl: string | null }> {
  const bucket = requireStorageBucket();
  const storage = getStorageServiceClient();

  async function sign(storageKey: string | null): Promise<string | null> {
    if (!storageKey) return null;
    const { data, error } = await storage.storage
      .from(bucket)
      .createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      throw new Error(
        `Supabase Storage signed URL failed for ${bucket}/${storageKey}: ${error?.message}`,
      );
    }
    return data.signedUrl;
  }

  const [htmlUrl, screenshotUrl] = await Promise.all([
    sign(output.htmlStorageKey),
    sign(output.screenshotStorageKey),
  ]);
  return { htmlUrl, screenshotUrl };
}

// ---------------------------------------------------------------------------
// Drift - the missing counterpart to `github.checkDrift` (Module Boundaries
// 4.6). Added by E4-S6 (SCRUM-55): API Contracts section 7's
// `GET .../external-refs` calls `impact.getExternalDrift` per ref, but
// `eslint.config.mjs`'s `layer6-api` allow-list has no `layer1-impact` entry
// - a route handler cannot call it directly. `github.checkDrift` is already
// the documented layer-5 delegator for exactly this case; `stitch` was
// simply missing its own copy. Byte-for-byte the same shape: resolve `refId`
// -> `projectId` via `external-operations.getRefById` (this module never
// queries `external_ref` itself, Module Boundaries 4.5), then delegate
// entirely to `impact.getExternalDrift` - the one impact engine (INV-025),
// no separate Stitch-specific staleness logic. `null` both when the ref
// doesn't exist and when it has no drift - a manual-fallback Stitch output
// has no `external_ref` row to begin with, so it never reaches this
// function with a real id in the first place.
// ---------------------------------------------------------------------------

export async function checkDrift(refId: string): Promise<ImpactRow | null> {
  const ref = await getRefById(refId);
  if (!ref) return null;
  return getExternalDrift(ref.projectId, refId);
}
