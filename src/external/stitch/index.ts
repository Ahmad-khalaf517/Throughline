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
//
// Round 14 (SCRUM-98, ERD 7.5 / 7.6, FR-086): a NEW generate uses the acting
// user's own Stitch API key (`connections.getCredential(ctx.userId, 'stitch')`,
// resolved BEFORE `runOperation`, so a missing connection leaves no operation
// row and never degrades into `manual_fallback`). Anything that touches an
// EXISTING operation (its send, its reconcile, a retry) takes its key from the
// connection recorded on that row (`getCredentialForOperation`); only
// `{ kind: 'legacy' }` (no recorded connection) reads the optional
// STITCH_API_KEY environment credential, exactly as before round 14. An
// AUTH_FAILED from the SDK on a user credential marks the connection
// `needs_reauth` and stops with `ReconnectRequiredError` - never a `failed`
// operation or a fallback. The key is never logged, echoed or put in an error.
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Stitch, StitchError, StitchToolClient, type Screen } from '@google/stitch-sdk';
import { env } from '@/lib/env';
import { legacyCredentialAvailable } from '@/lib/legacy-credentials';
import { db, schema } from '@/db';
import { getStorageServiceClient } from '@/auth';
import {
  getCredential,
  getCredentialForOperation,
  listConnections,
  reportAuthFailure,
  ReconnectRequiredError,
  type ConnectionStatus,
  type Credential,
} from '@/connections';
import {
  runOperation,
  getRefById,
  getRefsForVersion,
  getOperationById,
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

/** Module Boundaries D1: the verified caller. The Stitch key is theirs, resolved inside this module. */
export type StitchCtx = { userId: string };

/**
 * Round 14 (API Contracts `PreviewConnectionDTO`, FR-089): whether the caller
 * can generate right now. `targetReady` is always true - Stitch has no chosen target.
 */
export interface PreviewConnection {
  status: ConnectionStatus['status'];
  targetReady: true;
}

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

/**
 * Round 14 (FR-089): built from local state only - no Stitch call, no
 * credential - so it never throws `ConnectionRequiredError` /
 * `ReconnectRequiredError`; `connection` tells the screen whether to show the
 * connect-to-continue prompt.
 */
export async function previewPrompt(
  uiRequirementsVersionId: string,
  ctx: StitchCtx,
): Promise<{ prompt: string; impact: ImpactRow[]; connection: PreviewConnection }> {
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

  // Read last, as the other providers' previews do, so the status is as current as it can be.
  const stitch = (await listConnections(ctx.userId)).find((c) => c.provider === 'stitch');
  const connection: PreviewConnection = { status: stitch?.status ?? 'none', targetReady: true };

  return { prompt, impact, connection };
}

// ---------------------------------------------------------------------------
// Stitch SDK client (official `@google/stitch-sdk`).
// ---------------------------------------------------------------------------

/** Deterministic project title - the marker `reconcileGenerate` finds the project by. */
function projectTitle(uiRequirementsVersionId: string): string {
  return `throughline:stitch:generate:${uiRequirementsVersionId}`;
}

/** The legacy environment credential - used only for an operation with no recorded connection. */
function requireStitchApiKey(): string {
  // Missing legacy key: RECONNECT_REQUIRED with the legacy hint, never a failed
  // operation (ERD 7.6, Module Boundaries 4.9 rule 6).
  if (!legacyCredentialAvailable('stitch') || !env.STITCH_API_KEY) {
    throw new ReconnectRequiredError('stitch', 'legacy_credential_missing', null);
  }
  return env.STITCH_API_KEY;
}

/** The key one send/reconcile runs with, and the connection behind it (`null` = legacy env key). */
interface StitchAuth {
  apiKey: string;
  credential: Credential | null;
}

/**
 * An operation always takes its key from the row itself, so a retry never
 * silently switches account. Throws `ReconnectRequiredError` when the recorded
 * connection is unusable or belongs to a different key.
 */
async function authForOperation(operationId: string): Promise<StitchAuth> {
  const recorded = await getCredentialForOperation(operationId);
  if ('kind' in recorded) return { apiKey: requireStitchApiKey(), credential: null };
  return { apiKey: recorded.accessToken, credential: recorded };
}

/** The SDK rejected the user's key: the credential is dead, not the operation. */
function isUserAuthFailure(error: unknown, credential: Credential | null): boolean {
  return credential !== null && error instanceof StitchError && error.code === 'AUTH_FAILED';
}

/**
 * Runs `fn` against a fresh SDK client and always closes it. `baseUrl` is
 * deliberately left to the SDK default. AUTH_FAILED on a user credential marks
 * the connection `needs_reauth` and becomes `ReconnectRequiredError` (ERD 7.6) -
 * the SDK's own message is dropped. The legacy env key keeps its old handling.
 */
async function withStitch<T>(auth: StitchAuth, fn: (client: Stitch) => Promise<T>): Promise<T> {
  const toolClient = new StitchToolClient({ apiKey: auth.apiKey });
  try {
    return await fn(new Stitch(toolClient));
  } catch (error) {
    if (auth.credential && isUserAuthFailure(error, auth.credential)) {
      await reportAuthFailure(auth.credential.connectionId);
      throw new ReconnectRequiredError('stitch', 'needs_reauth', auth.credential.connectionId);
    }
    throw error;
  } finally {
    await toolClient.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// FR-086 - validate a pasted API key (Module Boundaries 4.6). One cheap
// read-only SDK call; persists nothing (the route then calls
// `connections.saveConnection`). Never throws, and the result never carries the
// key or any SDK text.
// ---------------------------------------------------------------------------

export type ValidateApiKeyResult =
  | { ok: true; accountId: string; label: string }
  | { ok: false; reason: 'rejected' | 'unavailable' };

const VALIDATE_TIMEOUT_MS = 15_000;

/**
 * The SDK exposes no account identity, so the stable non-secret account id is a
 * truncated SHA-256 fingerprint of the key (`key:` + 16 hex chars). It reveals no
 * part of the key. Consequence: pasting a different key is a different account
 * (operations recorded with the old one resolve as `account_mismatch`).
 */
function keyFingerprint(apiKey: string): string {
  return `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`;
}

/**
 * The SDK has no `limit` on list_projects; a valid key answers quickly either
 * way. AUTH_FAILED / PERMISSION_DENIED => `rejected`; network, rate limit,
 * timeout and anything unknown => `unavailable` (the key is not judged).
 */
export async function validateApiKey(apiKey: string): Promise<ValidateApiKeyResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      withStitch({ apiKey, credential: null }, (client) => client.projects()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), VALIDATE_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    const rejected =
      error instanceof StitchError &&
      (error.code === 'AUTH_FAILED' || error.code === 'PERMISSION_DENIED');
    return { ok: false, reason: rejected ? 'rejected' : 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
  return { ok: true, accountId: keyFingerprint(apiKey), label: 'Stitch API key' };
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

function classifyStitchError(error: unknown, credential: Credential | null): unknown {
  // A user credential's AUTH_FAILED is never the operation's outcome: it passes
  // through unchanged so `withStitch` can turn it into ReconnectRequiredError.
  if (isUserAuthFailure(error, credential)) return error;
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
  auth: StitchAuth;
  storage: StorageServiceClient;
  bucket: string;
  prompt: string;
  uiRequirementsVersionId: string;
}): Promise<{ externalId: string; externalUrl: string; metadata: AssetMetadata }> {
  return withStitch(args.auth, async (client) => {
    let screen: Screen;
    try {
      const project = await client.createProject(projectTitle(args.uiRequirementsVersionId));
      screen = await project.generate(args.prompt, 'DESKTOP');
    } catch (error) {
      throw classifyStitchError(error, args.auth.credential);
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
  auth: StitchAuth;
  storage: StorageServiceClient;
  bucket: string;
  prompt: string;
  uiRequirementsVersionId: string;
}): Promise<
  | { found: true; externalId: string; externalUrl: string; metadata: AssetMetadata }
  | { found: false }
> {
  const title = projectTitle(args.uiRequirementsVersionId);
  return withStitch(args.auth, async (client) => {
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
      const classified = classifyStitchError(error, args.auth.credential);
      if (classified instanceof DefinitiveProviderError) throw classified;
      if (isUserAuthFailure(error, args.auth.credential)) throw error; // -> ReconnectRequiredError
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

export async function generate(
  uiRequirementsVersionId: string,
  ctx: StitchCtx,
): Promise<StitchOutput> {
  // Round 14 (ERD 7.2 step 0): the caller's own key, resolved BEFORE any
  // operation row or stitch_output write - `ConnectionRequiredError` /
  // `ReconnectRequiredError` therefore leave nothing behind and never become a
  // manual_fallback (that is for a failed generation, FR-054). The approval
  // and already-generated checks come first so they keep their own answers.
  await resolveApprovedVersion(uiRequirementsVersionId);
  const existing = await findExistingStitchOutput(uiRequirementsVersionId);
  if (existing?.mode === 'api') {
    throw new AlreadyGeneratedError(uiRequirementsVersionId);
  }
  const credential = await getCredential(ctx.userId, 'stitch');
  return generateWith(uiRequirementsVersionId, credential);
}

/**
 * The shared body of `generate` (a NEW operation, the user's own credential) and
 * `retryOperation` (the credential recorded on the operation, or `legacy`).
 */
async function generateWith(
  uiRequirementsVersionId: string,
  recorded: Credential | { kind: 'legacy' },
): Promise<StitchOutput> {
  const version = await resolveApprovedVersion(uiRequirementsVersionId);
  const prompt = buildPrompt(version.items);

  const existing = await findExistingStitchOutput(uiRequirementsVersionId);
  if (existing?.mode === 'api') {
    throw new AlreadyGeneratedError(uiRequirementsVersionId);
  }

  // A legacy operation still needs the environment key: fail before any row is touched.
  if ('kind' in recorded) requireStitchApiKey();
  const credential = 'kind' in recorded ? null : recorded;
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
    connectionId: credential?.connectionId ?? null,
    accountId: credential?.accountId ?? null,
    send: async ({ operationId }) =>
      sendGenerate({
        auth: await authForOperation(operationId),
        storage,
        bucket,
        prompt,
        uiRequirementsVersionId,
      }),
    reconcile: async ({ operationId }) =>
      reconcileGenerate({
        auth: await authForOperation(operationId),
        storage,
        bucket,
        prompt,
        uiRequirementsVersionId,
      }),
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

/**
 * Round 14: the retry route's entry point for ONE existing Stitch operation. The
 * request is rebuilt from current inputs (so the request-hash check still
 * catches a changed prompt), but the CREDENTIAL is the one recorded on the
 * operation (`getCredentialForOperation`), never the user's current connection.
 * A recorded connection that is not usable, or whose key is no longer the one
 * the operation used, throws `ReconnectRequiredError` before any network call
 * and leaves the operation exactly as it was; an operation with no recorded
 * connection retries with the optional environment key. `ctx` is accepted for
 * signature parity with the other providers; Stitch has no target to re-check.
 */
export async function retryOperation(
  operationId: string,
  _ctx: StitchCtx,
): Promise<
  { status: 'completed'; ref: ExternalRef } | { status: 'reconciliation_required' | 'pending' }
> {
  const operation = await getOperationById(operationId);
  if (!operation || operation.provider !== 'stitch') {
    throw new Error(`external_operation ${operationId} is not a Stitch operation`);
  }
  const uiRequirementsVersionId = operation.sourceArtifactVersionId;
  const recorded = await getCredentialForOperation(operationId);

  try {
    const output = await generateWith(uiRequirementsVersionId, recorded);
    if (output.mode === 'manual_fallback') {
      // Unlike GitHub/Jira, a Stitch definitive failure does not throw -
      // `generate` swallows it and returns normally with
      // `mode: 'manual_fallback'` (Module Boundaries 4.6). Reporting that as
      // `completed` would misreport the outcome (no `external_ref` was
      // created), so this throws and reaches the retry route's known
      // contract-gap 500 (API Contracts section 7), like GitHub/Jira failures.
      throw new Error(
        `stitch retry for external_operation ${operationId} ended in mode='manual_fallback' ` +
          '(definitive failure) - see GET /api/external-operations/:operationId for the durable record',
      );
    }
    const refs = await getRefsForVersion(uiRequirementsVersionId);
    const ref = refs.find((candidate) => candidate.provider === 'stitch');
    if (!ref) {
      throw new Error(`stitch_output ${output.id} is mode='api' but no stitch external_ref exists`);
    }
    return { status: 'completed', ref };
  } catch (error) {
    if (error instanceof StitchReconciliationRequiredError) {
      return { status: 'reconciliation_required' };
    }
    if (error instanceof StitchOperationInFlightError) return { status: 'pending' };
    throw error;
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
