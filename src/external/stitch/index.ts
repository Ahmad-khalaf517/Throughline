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
// No verified real Stitch REST API shape exists anywhere in this codebase -
// no spike has run yet (E4-S5/Spike B is the NEXT story, and depends on this
// one). The raw-fetch client below (`requireStitchConfig`/`stitchFetch`/
// `requestGeneration`) is therefore this story's own explicit, disclosed
// judgment call, same convention `jira`'s `sendCreateIssue`/`adfDoc` comments
// already use for their own undecided details (issue-type naming, marker
// mechanism): POST `${STITCH_BASE_URL}/v1/generate` with `{ prompt }`,
// expecting back `{ id, htmlUrl, screenshotUrl }` - a generation id plus two
// short-lived remote URLs this module immediately downloads and re-uploads to
// Supabase Storage (FR-052: "shall persist the useful Stitch result rather
// than depend permanently on remote output URLs" - the remote URLs are used
// exactly once, to fetch bytes, never stored or read again). E4-S5 replaces
// this shape once a real spike confirms the actual Stitch API.
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import { db, schema } from '@/db';
import { getStorageServiceClient } from '@/auth';
import {
  runOperation,
  getRefById,
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
// Stitch HTTP client - raw fetch, judgment-call shape (see header comment).
// ---------------------------------------------------------------------------

interface StitchConfig {
  baseUrl: string;
  apiKey: string;
}

function requireStitchConfig(): StitchConfig {
  if (!env.STITCH_BASE_URL || !env.STITCH_API_KEY) {
    const missing: string[] = [];
    if (!env.STITCH_BASE_URL) missing.push('STITCH_BASE_URL');
    if (!env.STITCH_API_KEY) missing.push('STITCH_API_KEY');
    throw new Error(
      `Stitch is not configured - missing ${missing.join(', ')} (ERD 7.5, real mode).`,
    );
  }
  return { baseUrl: env.STITCH_BASE_URL, apiKey: env.STITCH_API_KEY };
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

/** Thrown for any non-2xx Stitch response - `sendGenerate` classifies 4xx as definitive, everything else as ambiguous (ERD 7.2). */
class StitchHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'StitchHttpError';
  }
}

async function stitchFetch<T>(config: StitchConfig, path: string, init: RequestInit): Promise<T> {
  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new StitchHttpError(
      res.status,
      `Stitch API ${init.method ?? 'GET'} ${path} -> ${res.status}: ${bodyText}`,
    );
  }
  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

interface StitchGenerateResponse {
  id: string;
  htmlUrl: string;
  screenshotUrl: string;
}

async function requestGeneration(
  config: StitchConfig,
  prompt: string,
): Promise<StitchGenerateResponse> {
  return stitchFetch<StitchGenerateResponse>(config, '/v1/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
  });
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
 * `runOperation`'s `send()` closure. Uploads both assets to Supabase Storage
 * INSIDE `send()` itself (same discipline `github`'s own `sendCreateRepo` uses
 * for `writeProvenanceFiles` - a failure here is ALSO ambiguous/retryable via
 * the same path as a lost create response, not a separate failure mode), then
 * returns the storage keys/checksums via `SendResult.metadata` (the same slot
 * `jira`'s `jiraProjectKey` and `github`'s `mode` already use) so `generate`
 * can read them back off the finalized `external_ref` without a second
 * round-trip.
 */
async function sendGenerate(args: {
  config: StitchConfig;
  storage: StorageServiceClient;
  bucket: string;
  prompt: string;
  uiRequirementsVersionId: string;
}): Promise<{ externalId: string; externalUrl: string; metadata: AssetMetadata }> {
  let response: StitchGenerateResponse;
  try {
    response = await requestGeneration(args.config, args.prompt);
  } catch (error) {
    if (error instanceof StitchHttpError && error.status >= 400 && error.status < 500) {
      // ERD 7.2: "`failed` is reserved for DEFINITIVE provider rejections
      // (validation/4xx)."
      throw new DefinitiveProviderError(`stitch_generate_rejected:${error.status}`);
    }
    throw error; // ambiguous - propagates unchanged (ERD 7.2 R6/R9)
  }

  const html = await fetchBytes(response.htmlUrl);
  const screenshot = await fetchBytes(response.screenshotUrl);

  const htmlStorageKey = `stitch/${args.uiRequirementsVersionId}/index.html`;
  const screenshotStorageKey = `stitch/${args.uiRequirementsVersionId}/screenshot.png`;
  const htmlChecksum = sha256Hex(html);
  const screenshotChecksum = sha256Hex(screenshot);

  await uploadAsset(args.storage, args.bucket, htmlStorageKey, html, 'text/html; charset=utf-8');
  await uploadAsset(args.storage, args.bucket, screenshotStorageKey, screenshot, 'image/png');

  return {
    externalId: response.id,
    // Informational only (audit trail of where the bytes originally came
    // from) - FR-052's "never depend permanently on remote output URLs" means
    // this module never reads it back; `getSignedAssetUrls` below is the only
    // read path a future UI ever uses.
    externalUrl: response.htmlUrl,
    metadata: { htmlStorageKey, htmlChecksum, screenshotStorageKey, screenshotChecksum },
  };
}

/**
 * `runOperation`'s `reconcile()` closure. ERD 7.5 describes no reconciliation
 * mechanism for Stitch, and ERD 4.14 itself notes "Stitch has no chosen
 * target" (operation_key has no separate resource name to search an object
 * by, unlike GitHub's repo name or Jira's label) - there is nothing to look
 * up here. An honest stub: always reports not-found. This leaves a genuinely
 * ambiguous `send()` outcome (a lost response, a 5xx) stuck in
 * `reconciliation_required` until a future story defines a real strategy
 * (E4-S5, the next one in this pipeline) - disclosed, not papered over with
 * an invented mechanism.
 */
async function reconcileGenerate(): Promise<{ found: false }> {
  return { found: false };
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

  const config = requireStitchConfig();
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
    send: () => sendGenerate({ config, storage, bucket, prompt, uiRequirementsVersionId }),
    reconcile: () => reconcileGenerate(),
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
