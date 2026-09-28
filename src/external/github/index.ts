// Module 14: external/github
// Owns: GitHub repo init - no table of its own
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// ERD 7.3, TR FR-030..036, TR 30.1 (E4-S2 / SCRUM-51). Never writes
// `external_operation`/`external_ref` directly (Module Boundaries 4.5's own
// rule) - every real object mutation goes through
// `external-operations.runOperation`, supplying only the GitHub-specific
// `send`/`reconcile` closures (the marker mechanism, ERD 7.3/30.1).
//
// Reads the selected architecture option's stack (Module Boundaries 4.6:
// "via `architecture`, read-only") and the ADR item versions it
// materialized through `src/artifact-types/architecture` - NOT through
// `architecture-materialization`/`identity` directly. Both of those are
// lower layers this module is not allowed to import directly
// (eslint.config.mjs's layer5-external-provider allow-list has no entry for
// layer1-identity or layer2-architecture-materialization); `architecture`
// (layer 3, this module's documented paired artifact-type module) is a
// permitted import and re-exports exactly the two getters needed. See that
// file's own header comment for the full reasoning.
import { createHash, createHmac } from 'node:crypto';
import { Octokit, RequestError } from 'octokit';
import { env } from '@/lib/env';
import {
  runOperation,
  getRefById,
  DefinitiveProviderError,
  type ExternalRef,
} from '@/external/operations';
import { getWarnings, getExternalDrift, type ImpactRow } from '@/lineage/impact';
import {
  getSelectedOption,
  getArchitectureDecisionItems,
  type ArchitectureDecisionItem,
  type SelectedArchitectureOption,
} from '@/artifact-types/architecture';
import { buildReadme, buildAdrDoc } from './repo-docs';

// ---------------------------------------------------------------------------
// Errors - initRepo's signature (Module Boundaries 4.6) is `Promise<ExternalRef>`,
// with no room for a result union, so every non-`completed` `runOperation`
// outcome (and every precondition failure) is surfaced as a distinct,
// named Error subclass instead - the same convention artifact-lifecycle
// already uses for its own precondition errors (e.g. `BriefFrozenError`).
// ---------------------------------------------------------------------------

export class ArchitectureOptionNotSelectedError extends Error {
  constructor(architectureVersionId: string) {
    super(`architecture_version ${architectureVersionId} has no selected architecture option`);
    this.name = 'ArchitectureOptionNotSelectedError';
  }
}

/**
 * ERD 7.3: `external_ref.source_artifact_version_id` = "the selected
 * Architecture version" - judgment call (not pinned down verbatim by ERD/TR):
 * read as the CURRENT authoritative one, i.e. `status = 'approved'`
 * specifically, not merely "has a selection" (a `superseded` version also
 * has one, since `selected_architecture_option_id` is never cleared). GitHub
 * initialization is a one-shot, one-repo-per-project action (FR-031) that
 * should always be driven from whatever is authoritative *now* - mirrors
 * `impact()`'s own `current_m` definition (ERD 6.1: current = member of an
 * *approved* version).
 */
export class ArchitectureVersionNotApprovedError extends Error {
  constructor(architectureVersionId: string, actualStatus: string) {
    super(
      `architecture_version ${architectureVersionId} is '${actualStatus}', not 'approved' - ` +
        'GitHub can only be initialized from the current, authoritative Architecture version',
    );
    this.name = 'ArchitectureVersionNotApprovedError';
  }
}

export class GithubOperationFailedError extends Error {
  /**
   * `name_taken_by_other` for a name collision (ERD 7.3); otherwise the
   * human-readable description of GitHub's own rejection (see
   * `describeRejection`). The init route branches on this to pick between
   * `NAME_TAKEN_BY_OTHER` and `GITHUB_REQUEST_REJECTED`.
   */
  readonly reason: string;

  constructor(reason: string) {
    super(`GitHub operation failed: ${reason}`);
    this.name = 'GithubOperationFailedError';
    this.reason = reason;
  }
}

/**
 * `checkRepoName` only: GitHub answered the name lookup with a definitive 4xx
 * other than "not found" (e.g. 401/403 for an unusable `GITHUB_TOKEN`). Not a
 * `GithubOperationFailedError` - a lookup is not an `external_operation`, so
 * there is no row to fail. `message` already names GitHub's own reason.
 */
export class GithubLookupRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubLookupRejectedError';
  }
}

export class GithubOperationRefusedError extends Error {
  constructor(reason: string) {
    super(`GitHub operation refused: ${reason}`);
    this.name = 'GithubOperationRefusedError';
  }
}

export class GithubReconciliationRequiredError extends Error {
  constructor(operationKey: string) {
    super(
      `GitHub operation ${operationKey} is reconciliation_required - retry is user-initiated ` +
        '(ERD 7.2), not automatic',
    );
    this.name = 'GithubReconciliationRequiredError';
  }
}

export class GithubOperationInFlightError extends Error {
  constructor(operationKey: string) {
    super(`GitHub operation ${operationKey} is already in flight (R5) - do not resend yet`);
    this.name = 'GithubOperationInFlightError';
  }
}

export class GithubOperationConflictError extends Error {
  constructor(operationKey: string) {
    super(
      `GitHub operation ${operationKey} already exists with a different request (R11) - ` +
        'never a silent resend or reuse',
    );
    this.name = 'GithubOperationConflictError';
  }
}

// ---------------------------------------------------------------------------
// ERD 7.3 marker mechanism - adapted from the already-verified
// scripts/spike-github-reconciliation.mts (its own header comment: reused/
// adapted, not re-derived). `MARKER_TOKEN_HEX_LENGTH` (16 hex chars, 64
// bits) is this story's own pinned choice, same as the spike's - ERD 7.3
// only says "truncated", not to what length.
// ---------------------------------------------------------------------------

const MARKER_PREFIX = 'thrln-marker:';
const MARKER_TOKEN_HEX_LENGTH = 16;

function computeMarker(serverSecret: string, operationKey: string): string {
  return createHmac('sha256', serverSecret)
    .update(operationKey, 'utf8')
    .digest('hex')
    .slice(0, MARKER_TOKEN_HEX_LENGTH);
}

/** ERD 7.3: deterministic repository name. Adapted from the spike's own helper. */
export function normalizeRepoName(raw: string): string {
  return raw
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function requireOwner(): string {
  if (!env.GITHUB_OWNER) {
    throw new Error(
      'GITHUB_OWNER is not configured - required to call the GitHub API (ERD 7.3, real mode).',
    );
  }
  return env.GITHUB_OWNER;
}

/**
 * Unlike the E4-T1 spike (which generates a fresh, ephemeral secret when
 * `GITHUB_MARKER_SECRET` is unset - fine for a single spike run that never
 * exercises reconciliation across a process restart), production code
 * REQUIRES a real, persistent secret: the marker must still verify after a
 * crash/redeploy puts a brand-new process in charge of `reconcile()`, and a
 * fresh-random secret would silently invalidate every marker this process
 * ever wrote as soon as it restarts.
 */
function requireServerSecret(): string {
  if (!env.GITHUB_MARKER_SECRET) {
    throw new Error(
      'GITHUB_MARKER_SECRET is not configured - required so the ownership marker (ERD 7.3) stays ' +
        'verifiable across process restarts, not just within one process lifetime.',
    );
  }
  return env.GITHUB_MARKER_SECRET;
}

function createOctokitClient(): Octokit {
  return new Octokit({
    auth: env.GITHUB_TOKEN,
    // No explicit `request.fetch` override here. @octokit/request's own
    // fetchWrapper resolves `requestOptions.request?.fetch || globalThis.fetch`
    // freshly on EVERY call (confirmed in
    // node_modules/@octokit/request/dist-src/fetch-wrapper.js) - not once at
    // construction time - so production always uses Node's native global
    // fetch, and tests can swap `globalThis.fetch` for an in-memory fake
    // GitHub (scripts/spike-github-reconciliation.mts's own technique)
    // around individual calls without this module needing a test-only
    // constructor parameter or any other seam.
    retry: { enabled: false },
    // ERD 7.2: "Retries after an ambiguous outcome are user-initiated,
    // never automatic." @octokit/plugin-retry's automatic backoff-and-retry
    // on 5xx/network errors would silently violate that from underneath
    // this module - disabled for the same reason the spike disabled it.
    throttle: { enabled: false },
    // Same ERD 7.2 rule, same violation, a DIFFERENT plugin: the `octokit`
    // "batteries-included" package also bundles @octokit/plugin-throttling,
    // enabled by default, which (a) retries automatically on 403/429 via its
    // own `onRateLimit`/`onSecondaryRateLimit` handlers - independent of
    // `retry` above, so disabling only `retry` leaves this exact same
    // "never automatic" rule violated through a second door - and (b), found
    // empirically while diagnosing this story's own T11b/T11d order-
    // dependent test timeouts: it routes every non-GET/HEAD request through
    // a Bottleneck rate limiter keyed by a constant `id: "no-id"`
    // (@octokit/plugin-throttling's own default), backed by a MODULE-SCOPE
    // singleton `Bottleneck.Group` (dist-src/index.js's top-level `groups`
    // object) that is shared across every `Octokit` instance in the process
    // for its entire lifetime - i.e. across every `createOctokitClient()`
    // call this module ever makes, test or production alike. That limiter
    // tracks its own "next allowed request" time using `Date.now()`; a test
    // that fakes `Date` forward (this file's own
    // `withClockAdvancedPastThreshold`, needed to simulate ERD 7.2's
    // reconciliation threshold T without a real 90s wait) corrupts that
    // shared clock state for the rest of the process, not just the current
    // test - the NEXT real Octokit network call anywhere in the file then
    // blocks in REAL wall-clock time until the bogus future timestamp
    // elapses (confirmed by a standalone repro: ~95s real delay on the very
    // next write call after a +95s `Date` jump, with throttling enabled;
    // zero delay with it disabled). `throttle: { enabled: false }` removes
    // both problems at once - no hidden cross-instance queue, no automatic
    // retry-on-throttle underneath a module whose own header comment
    // already promises neither.
  });
}

// ---------------------------------------------------------------------------
// FR-031/032 - scaffold vs docs-only mode decision.
// ---------------------------------------------------------------------------

/**
 * FR-032: "Throughline shall use one approved, pinned repository
 * starter/template for scaffold mode." No real starter/template repository
 * is named anywhere in the frozen ERD/TR/BRD, and this project's own
 * capstone scope explicitly excludes "any real template-repository cloning/
 * scaffolding mechanism" (this story's own instructions) - so there is
 * nothing to point a real license check (FR-032's second sentence) at
 * either. This constant is THIS story's own placeholder decision, recorded
 * the same way E4-S1 recorded `RECONCILIATION_THRESHOLD_MS`: it stands in
 * for "the one pinned starter" with this project's OWN stack shape (the
 * only concrete, unambiguous stack this codebase can point to), so
 * `previewInit`/`initRepo` have a real, testable "close enough" comparison
 * instead of an unimplemented decision. A real starter-repo choice plus its
 * license check is future work, not built here.
 */
const PINNED_REFERENCE_STACK = {
  frontend: 'next.js + typescript',
  backend: 'next.js route handlers (same app)',
  database: 'postgresql via drizzle orm',
  hosting: 'vercel + supabase',
  repositoryLayout: 'single repo, layered src/ modules',
} as const;

function normalizeForCompare(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim();
}

/**
 * FR-031: "matches the supported pinned starter/template closely enough for
 * safe initialization." Neither ERD nor TR defines "closely enough" - this
 * is this story's own judgment call: deliberately loose substring
 * containment per field (an AI-authored stack descriptor's free text will
 * never match the reference byte-for-byte), but ALL FIVE fields must match
 * for `scaffold` - any mismatch or missing field falls back to `docs-only`,
 * per FR-031's own "must not silently create a mismatched codebase."
 */
function stackMatchesPinnedReference(stack: unknown): boolean {
  if (typeof stack !== 'object' || stack === null) return false;
  const candidate = stack as Record<string, unknown>;
  return (Object.keys(PINNED_REFERENCE_STACK) as (keyof typeof PINNED_REFERENCE_STACK)[]).every(
    (field) => {
      const expectedTokens = PINNED_REFERENCE_STACK[field].split(/[\s+]+/).filter(Boolean);
      const actual = normalizeForCompare(candidate[field]);
      return expectedTokens.every((token) => actual.includes(token));
    },
  );
}

function decideMode(stack: unknown): 'scaffold' | 'docs-only' {
  return stackMatchesPinnedReference(stack) ? 'scaffold' : 'docs-only';
}

async function resolveApprovedSelection(
  architectureVersionId: string,
): Promise<SelectedArchitectureOption> {
  const selected = await getSelectedOption(architectureVersionId);
  if (!selected) {
    throw new ArchitectureOptionNotSelectedError(architectureVersionId);
  }
  if (selected.versionStatus !== 'approved') {
    throw new ArchitectureVersionNotApprovedError(architectureVersionId, selected.versionStatus);
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Repository-name availability - lets the user try names before `initRepo`.
// ---------------------------------------------------------------------------

export interface RepoNameCheck {
  /** What `initRepo` would actually create: the input run through `normalizeRepoName`. Empty when `invalid`. */
  repoName: string;
  /** `invalid` = nothing usable is left after normalization (no GitHub call is made). */
  status: 'available' | 'taken' | 'invalid';
}

/**
 * Read-only: one `GET /repos/{owner}/{name}` under the configured owner, no
 * DB and no operation row. Advisory only - `initRepo` stays the authority
 * (its create call still answers 422 `name_taken_by_other` if the name is
 * gone by then, or if the token cannot see a private repo that already uses
 * it, which reads as 404 here).
 */
export async function checkRepoName(repoName: string): Promise<RepoNameCheck> {
  const normalized = normalizeRepoName(repoName);
  if (!normalized) return { repoName: normalized, status: 'invalid' };

  try {
    await createOctokitClient().rest.repos.get({ owner: requireOwner(), repo: normalized });
    return { repoName: normalized, status: 'taken' };
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return { repoName: normalized, status: 'available' };
    }
    if (isDefinitiveRejection(error)) {
      throw new GithubLookupRejectedError(describeRejection(error, 'check the repository name'));
    }
    throw error;
  }
}

// Each attempt is one GitHub lookup, so this bounds the preview's added latency.
const MAX_SUGGESTION_ATTEMPTS = 10;

/**
 * The repository name the preview SUGGESTS, in order of preference:
 *  1. the project's own name, normalized (`ShiftSwap Verify` ->
 *     `shiftswap-verify`) - a name the user already chose and will recognize;
 *  2. that name with a numeric suffix (`-2`, `-3`, ...) when GitHub says it is
 *     already taken, for up to MAX_SUGGESTION_ATTEMPTS lookups;
 *  3. `throughline-project-<projectId>`, which cannot collide, when there is
 *     no usable project name or every attempt was taken.
 *
 * `project` is owned by artifact-lifecycle (layer 2), unreachable from this
 * layer-5 module (eslint.config.mjs's layer5-external-provider allow-list only
 * permits layer 0-4 plus this module's paired layer-3 module), so the caller -
 * the preview route, layer 6 - hands the name in. Without one, nothing here
 * touches the network. `initRepo` never recomputes this; it takes `repoName`
 * as an explicit parameter.
 *
 * A lookup that cannot be made (unusable token, GitHub down) must not break
 * the preview: a suggestion is advisory and `checkRepoName` reports the real
 * problem separately, so the unverified project-name slug is returned.
 */
async function suggestRepoName(projectId: string, projectName?: string): Promise<string> {
  const projectIdName = normalizeRepoName(`throughline-project-${projectId}`);
  const base = projectName ? normalizeRepoName(projectName) : '';
  if (!base) return projectIdName;

  try {
    for (let attempt = 1; attempt <= MAX_SUGGESTION_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      const { status } = await checkRepoName(candidate);
      if (status === 'available') return candidate;
    }
    return projectIdName;
  } catch {
    return base;
  }
}

// ---------------------------------------------------------------------------
// FR-030 - preview.
// ---------------------------------------------------------------------------

export async function previewInit(
  architectureVersionId: string,
  projectName?: string,
): Promise<{ mode: 'scaffold' | 'docs-only'; repoName: string; impact: ImpactRow[] }> {
  const selected = await resolveApprovedSelection(architectureVersionId);
  const mode = decideMode(selected.option.stack);
  const repoName = await suggestRepoName(selected.projectId, projectName);

  // TR FR-085: "Every external-write preview... shows current impact for
  // the items it would create from." There is no `external_ref` yet at
  // preview time, so `impact.getExternalDrift` (which needs a real refId)
  // cannot be used here - judgment call: the item-level analog,
  // `impact.getWarnings`, filtered down to exactly the ADR item_versions
  // this repository would be created from, is the pre-write equivalent of
  // "current impact for the items it would create from" (the same
  // filtering pattern `lineage/impact.evaluateGate` already uses for a
  // candidate's own item set). This is NOT "likely an empty array" by
  // construction - it genuinely surfaces any ADR that is already flagged
  // before the user ever confirms the write.
  const adrItems = await getArchitectureDecisionItems(architectureVersionId);
  const adrItemVersionIds = new Set(adrItems.map((row) => row.itemVersionId));
  const projectWarnings = await getWarnings(selected.projectId);
  const impact = projectWarnings.filter(
    (row) => row.subjectKind === 'item_version' && adrItemVersionIds.has(row.subjectId),
  );

  return { mode, repoName, impact };
}

// ---------------------------------------------------------------------------
// FR-031/033/034/035 + ERD 7.3/30.1 - init.
// ---------------------------------------------------------------------------

interface CreatedRepo {
  id: number;
  fullName: string;
  htmlUrl: string;
  ownerLogin: string;
}

/**
 * ERD 7.2: "`failed` is reserved for definitive provider rejections
 * (validation/4xx). Timeouts, 5xx and lost responses are never `failed`." A
 * 4xx response means GitHub read the request and refused it, so nothing was
 * created and a later retry cannot duplicate anything. 408 (request timeout)
 * is the one 4xx that says nothing about whether the request was processed.
 */
function isDefinitiveRejection(error: unknown): error is RequestError {
  return (
    error instanceof RequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
  );
}

/**
 * Stored as `external_operation.error_message` and shown to the user, so it
 * names the actual cause. Without this, an unusable `GITHUB_TOKEN` (401/403)
 * was treated as an ambiguous failure: the operation sat `pending`, then
 * `reconciliation_required` forever (reconcile finds no repo and never
 * resends), and the user only ever saw "Something went wrong."
 */
function describeRejection(error: RequestError, action: string): string {
  const data: unknown = error.response?.data;
  const githubMessage =
    typeof data === 'object' && data !== null && 'message' in data
      ? String(data.message)
      : error.message;
  const detail = `${error.status}: ${githubMessage}`;
  if (error.status === 401) {
    return `GitHub rejected the configured GITHUB_TOKEN (${detail}) - it is invalid or expired.`;
  }
  if (error.status === 403) {
    return (
      `GitHub refused to ${action} (${detail}) - the configured GITHUB_TOKEN does not have ` +
      'the access this needs. Use a token with repository access (e.g. a classic token with ' +
      'the `repo` scope).'
    );
  }
  return `GitHub rejected the request to ${action} (${detail}).`;
}

async function sendCreateRepo(args: {
  octokit: Octokit;
  repoName: string;
  marker: string;
  mode: 'scaffold' | 'docs-only';
  selected: SelectedArchitectureOption;
  architectureVersionId: string;
  adrItems: ArchitectureDecisionItem[];
}): Promise<{
  externalId: string;
  externalKey: string;
  externalUrl: string;
  metadata: { mode: 'scaffold' | 'docs-only' };
}> {
  let created: CreatedRepo;
  try {
    const response = await args.octokit.rest.repos.createForAuthenticatedUser({
      name: args.repoName,
      description: `${MARKER_PREFIX}${args.marker}`,
      // Always public: the repository exists to be shown (demoed, linked,
      // read by people without access to Throughline), and everything
      // written to it - README, ADRs, lineage.json - is architecture
      // documentation and ids, never a secret. There is deliberately no
      // visibility option (FR-030 only asks for one "if configurable"); the
      // GitHub screen tells the user up front that the repository is public.
      private: false,
    });
    created = {
      id: response.data.id,
      fullName: response.data.full_name,
      htmlUrl: response.data.html_url,
      ownerLogin: response.data.owner?.login ?? requireOwner(),
    };
  } catch (error) {
    if (error instanceof RequestError && error.status === 422) {
      // operations/index.ts's own `DefinitiveProviderError` doc comment
      // names this EXACT case ("GitHub 422 name-already-exists") as its
      // canonical example. This is the FIRST `send()` call for this exact
      // operation_key (insert-first won the row - ERD 7.2 step 2), so the
      // name cannot already be OUR OWN repo from an earlier successful
      // attempt of this same key: any existing repo at this name is, by
      // construction, someone else's (ERD 7.3 "name_taken_by_other") - no
      // marker check is needed to know this, unlike the genuinely ambiguous
      // lost-response case below, which propagates unchanged instead.
      throw new DefinitiveProviderError('name_taken_by_other');
    }
    if (isDefinitiveRejection(error)) {
      throw new DefinitiveProviderError(describeRejection(error, 'create the repository'));
    }
    throw error;
  }

  // FR-033/034/035 - written right after creation succeeds, still inside
  // `send()`. A failure here (e.g. the contents API 5xx-ing) is ALSO
  // ambiguous/retryable via the SAME reconcile()-by-marker path as a lost
  // create response, not a separate failure mode: `reconcile()` only checks
  // whether the repo exists with our marker, never whether every doc file
  // landed (ERD 7.3 doesn't make the docs part of the ownership contract).
  await writeProvenanceFiles(args.octokit, created.ownerLogin, args.repoName, {
    marker: args.marker,
    mode: args.mode,
    selected: args.selected,
    architectureVersionId: args.architectureVersionId,
    adrItems: args.adrItems,
  });

  return {
    externalId: String(created.id),
    externalKey: created.fullName,
    externalUrl: created.htmlUrl,
    metadata: { mode: args.mode },
  };
}

async function reconcileRepo(args: {
  octokit: Octokit;
  owner: string;
  repoName: string;
  marker: string;
  mode: 'scaffold' | 'docs-only';
}): Promise<
  | {
      found: true;
      externalId: string;
      externalKey: string;
      externalUrl: string;
      metadata: { mode: 'scaffold' | 'docs-only' };
    }
  | { found: false }
  | { found: 'foreign' }
> {
  let response;
  try {
    response = await args.octokit.rest.repos.get({ owner: args.owner, repo: args.repoName });
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) {
      return { found: false };
    }
    throw error;
  }
  const expected = `${MARKER_PREFIX}${args.marker}`;
  if (String(response.data.description ?? '') !== expected) {
    // ERD 7.3/30.1: exists at the deterministic name but the marker does
    // not match ours - definitively foreign, never adopt.
    return { found: 'foreign' };
  }
  return {
    found: true,
    externalId: String(response.data.id),
    externalKey: response.data.full_name,
    externalUrl: response.data.html_url,
    // Same slot `sendCreateRepo` already sets on a direct success. `mode` is
    // display-only here (no code path reads it back), but there is no
    // reason to leave it unset on the adoption path now that the shared
    // `ReconcileResult.metadata` slot exists (E4-S3 / SCRUM-52 added it for
    // Jira's load-bearing `jiraProjectKey` - this is the same fix applied
    // for consistency, not a second bug of the same severity).
    metadata: { mode: args.mode },
  };
}

function buildLineageJson(args: {
  marker: string;
  mode: 'scaffold' | 'docs-only';
  selected: SelectedArchitectureOption;
  architectureVersionId: string;
  adrItems: ArchitectureDecisionItem[];
}): unknown {
  return {
    // ERD 7.3: "docs/architecture/lineage.json repeats it as a durable
    // second marker." Same prefixed shape as the repo description, so a
    // future reconciliation strategy could check either without a special
    // case (even though only the description is actually checked today -
    // FR-035, this file is not read back by Throughline).
    marker: `${MARKER_PREFIX}${args.marker}`,
    mode: args.mode,
    architectureVersionId: args.architectureVersionId,
    architectureVersionNumber: args.selected.versionNumber,
    selectedOption: {
      key: args.selected.option.optionKey,
      title: args.selected.option.title,
      stack: args.selected.option.stack,
    },
    architectureDecisions: args.adrItems.map((item) => ({
      displayKey: item.displayKey,
      logicalItemId: item.logicalItemId,
      itemVersionId: item.itemVersionId,
    })),
    generatedAt: new Date().toISOString(),
  };
}

async function writeProvenanceFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  args: {
    marker: string;
    mode: 'scaffold' | 'docs-only';
    selected: SelectedArchitectureOption;
    architectureVersionId: string;
    adrItems: ArchitectureDecisionItem[];
  },
): Promise<void> {
  const encode = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: 'README.md',
    message: 'Throughline: add architecture rationale (FR-033)',
    content: encode(buildReadme(args)),
  });

  for (const item of args.adrItems) {
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: `docs/adr/${item.displayKey}.md`,
      message: `Throughline: add ${item.displayKey} (FR-034)`,
      content: encode(buildAdrDoc(item, args)),
    });
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: 'docs/architecture/lineage.json',
    message: 'Throughline: add lineage metadata + durable marker (ERD 7.3)',
    content: encode(JSON.stringify(buildLineageJson(args), null, 2)),
  });
}

export async function initRepo(
  architectureVersionId: string,
  repoName: string,
): Promise<ExternalRef> {
  const selected = await resolveApprovedSelection(architectureVersionId);
  const mode = decideMode(selected.option.stack);
  const normalizedRepoName = normalizeRepoName(repoName);
  const operationKey = `github:create_repo:${selected.projectId}:${normalizedRepoName}`;
  // Request fingerprint (ERD 7.2/29): same repoName + mode must round-trip
  // to the same hash so a genuine resend (same inputs) is never flagged as
  // a conflict, while a materially different request under the same key
  // (e.g. a different mode after the option changed) is.
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ repoName: normalizedRepoName, mode }))
    .digest('hex');
  const serverSecret = requireServerSecret();
  const marker = computeMarker(serverSecret, operationKey);
  const owner = requireOwner();
  const octokit = createOctokitClient();

  const adrItems = await getArchitectureDecisionItems(architectureVersionId);

  const result = await runOperation({
    projectId: selected.projectId,
    provider: 'github',
    operationType: 'create_repo',
    operationKey,
    requestHash,
    targetDescriptor: { repoName: normalizedRepoName, mode },
    sourceArtifactVersionId: architectureVersionId,
    send: () =>
      sendCreateRepo({
        octokit,
        repoName: normalizedRepoName,
        marker,
        mode,
        selected,
        architectureVersionId,
        adrItems,
      }),
    reconcile: () => reconcileRepo({ octokit, owner, repoName: normalizedRepoName, marker, mode }),
  });

  switch (result.status) {
    case 'completed':
      return result.ref;
    case 'failed':
      throw new GithubOperationFailedError(result.errorMessage);
    case 'refused':
      throw new GithubOperationRefusedError(result.reason);
    case 'reconciliation_required':
      throw new GithubReconciliationRequiredError(operationKey);
    case 'in_flight':
      throw new GithubOperationInFlightError(operationKey);
    case 'conflict':
      throw new GithubOperationConflictError(operationKey);
  }
}

// ---------------------------------------------------------------------------
// FR-036 - drift.
// ---------------------------------------------------------------------------

/**
 * FR-036: item-level drift for the repository's own `external_ref`.
 * Resolves `refId` -> `projectId` via `external-operations.getRefById`
 * (this module never queries `external_ref` itself - Module Boundaries
 * 4.5), then delegates entirely to `impact.getExternalDrift`, the one
 * impact engine (INV-025) - no separate GitHub-specific staleness logic
 * exists or should exist here.
 */
export async function checkDrift(refId: string): Promise<ImpactRow | null> {
  const ref = await getRefById(refId);
  if (!ref) return null;
  return getExternalDrift(ref.projectId, refId);
}
