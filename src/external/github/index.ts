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
  constructor(reason: string) {
    super(`GitHub operation failed: ${reason}`);
    this.name = 'GithubOperationFailedError';
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

/**
 * A safe, always-available SUGGESTED repository name for the preview.
 * Judgment call: derived from `projectId` alone, not `project.name` -
 * `project` is owned by artifact-lifecycle (layer 2), unreachable from this
 * layer-5 module (eslint.config.mjs's layer5-external-provider allow-list
 * only permits layer 0-4 plus this module's paired layer-3 module).
 * `initRepo` never recomputes this - it takes `repoName` as an explicit
 * parameter (Module Boundaries 4.6's own signature) - so the future API
 * route (E4-S6, layer 6, which CAN read `project.name` via
 * artifact-lifecycle) is free to show the user a prettier suggestion before
 * calling `initRepo`; this is only a safe fallback, not the only name ever
 * used.
 */
function suggestRepoName(projectId: string): string {
  return normalizeRepoName(`throughline-project-${projectId}`);
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
// FR-030 - preview.
// ---------------------------------------------------------------------------

export async function previewInit(
  architectureVersionId: string,
): Promise<{ mode: 'scaffold' | 'docs-only'; repoName: string; impact: ImpactRow[] }> {
  const selected = await resolveApprovedSelection(architectureVersionId);
  const mode = decideMode(selected.option.stack);
  const repoName = suggestRepoName(selected.projectId);

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
      private: true,
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
}): Promise<
  | { found: true; externalId: string; externalKey: string; externalUrl: string }
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
  };
}

function buildReadme(args: {
  selected: SelectedArchitectureOption;
  mode: 'scaffold' | 'docs-only';
  architectureVersionId: string;
  adrItems: ArchitectureDecisionItem[];
}): string {
  const { option } = args.selected;
  const adrLines = args.adrItems
    .map((item) => `- [${item.displayKey}](./docs/adr/${item.displayKey}.md)`)
    .join('\n');
  return `# ${option.title}

_Generated by Throughline (FR-033) - initialization mode: **${args.mode}**._

${option.summary}

## Architecture decisions

${adrLines || '_No architecture decisions were materialized for this version._'}

## Provenance

This repository was initialized from Throughline architecture_version
\`${args.architectureVersionId}\` (v${args.selected.versionNumber}), option
\`${option.optionKey}\`. See \`docs/architecture/lineage.json\` for the
machine-readable lineage record and ownership marker (ERD 7.3).

Throughline does not import this repository's metadata back into its own
database (FR-035 - self-describing, not round-trippable): editing these
files never changes Throughline's own lineage.
`;
}

function buildAdrDoc(
  item: ArchitectureDecisionItem,
  args: { selected: SelectedArchitectureOption; architectureVersionId: string },
): string {
  // TR FR-034's YAML example also shows a `depends_on` (exact upstream
  // Requirement item versions) and `requirements_version` field. Both would
  // require reading `semantic_dependency` (owned by `identity`), which is
  // not among the two narrow read exports this story's own instructions
  // authorize (architecture-materialization.getSelectedOption,
  // external-operations.getRefById) - deliberately NOT added here to avoid
  // a third, unauthorized cross-module read. What FR-034 actually requires
  // ("cite the exact Throughline item versions... plus the artifact
  // versions for context") is satisfied by the fields below: the ADR's own
  // exact LogicalItem/ItemVersion ids and the Architecture artifact version
  // - this is a deliberate, documented scope narrowing, not an oversight.
  return `# ${item.displayKey}

\`\`\`yaml
adr: ${item.displayKey}
adr_logical_item_id: ${item.logicalItemId}
adr_item_version_id: ${item.itemVersionId}
architecture_version_id: ${args.architectureVersionId}
architecture_version_number: ${args.selected.versionNumber}
selected_option: ${args.selected.option.optionKey}
\`\`\`

This decision is part of "${args.selected.option.title}". See the parent
project's Throughline workspace for the full decision text - this file
exists to give the repository durable, inspectable provenance (FR-034), not
to duplicate Throughline's own database.
`;
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
    reconcile: () => reconcileRepo({ octokit, owner, repoName: normalizedRepoName, marker }),
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
