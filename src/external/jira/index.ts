// Module 15: external/jira
// Owns: Jira Epic/Story export - no table of its own
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// ERD 7.4, TR FR-070..074, TR 30.2 (E4-S3 / SCRUM-52). Never writes
// `external_operation`/`external_ref` directly (Module Boundaries 4.5's own
// rule) - every real object mutation goes through
// `external-operations.runOperation`, supplying only the Jira-specific
// `send`/`reconcile` closures (the marker mechanism below).
//
// Marker mechanism is DECIDED, not this story's call to redesign (ERD 7.4 /
// TR 30.2, confirmed final by Spike C - scripts/spike-jira-reconciliation.ts
// - validated live during planning against project SCRUM, issue SCRUM-75):
// a Jira label `tl-<item_version_id>` as the primary marker, the same
// complete string repeated in the issue's description footer as a backup,
// reconciled by a bounded label re-query (Jira search can lag) then an
// independent description-text check, both always matching the COMPLETE
// marker string. The spike itself was never run live in THIS environment
// (no Jira credentials configured here - see its own header) - it only
// proves its credential guard stops cleanly; this module re-implements the
// spike's raw-fetch Jira REST v3 client SHAPE for real (Basic auth, base64
// `email:api_token`, `/rest/api/3/issue` POST, `/rest/api/3/search/jql`
// POST, the ADF description shape) rather than importing it (that script is
// spike-local, per its own header comment).
//
// Reads Epic/Story LogicalItem/ItemVersion membership rows through
// `artifact-types/backlog` (this module's documented paired layer-3 module,
// Module Boundaries 4.6 / eslint.config.mjs's layer5-external-provider
// rule), never through `lineage/identity` directly - see
// `backlog.getBacklogVersionMembers`'s own header comment for why.
//
// Round 14 (SCRUM-97, ERD 7.4 / 7.6): a NEW operation uses the acting user's own
// Atlassian 3LO connection (`connections.getCredential(ctx.userId, 'jira')`,
// resolved BEFORE `runOperation`) against the target the route passes in `ctx`
// (site cloudId + project key); every call goes to
// `https://api.atlassian.com/ex/jira/<cloudId>/rest/api/3/...` with a Bearer
// token. Anything that touches an EXISTING operation (its send, its reconcile,
// a retry) takes its credential from the connection recorded on that row
// (`getCredentialForOperation`); only `{ kind: 'legacy' }` (no recorded
// connection) falls back to the optional JIRA_* environment credential (Basic
// auth against JIRA_BASE_URL), exactly as before round 14.
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import { legacyCredentialAvailable } from '@/lib/legacy-credentials';
import {
  getCredential,
  getCredentialForOperation,
  listConnections,
  reportAuthFailure,
  ConnectionRequiredError,
  ReconnectRequiredError,
  type ConnectionStatus,
  type Credential,
} from '@/connections';
import {
  runOperation,
  getRefsForLogicalItem,
  getRefById,
  getOperationById,
  DefinitiveProviderError,
  type ExternalRef,
  type RunOperationResult,
} from '@/external/operations';
import { getWarnings, getExternalDrift, type ImpactRow } from '@/lineage/impact';
import { getBacklogVersionMembers, type BacklogVersionMember } from '@/artifact-types/backlog';
import { buildIssueDescription, buildIssueSummary } from './issue-content';

// ---------------------------------------------------------------------------
// Module Boundaries 4.6 documents `previewExport`'s `skipped: PreviewItem[]`
// and `exportBacklog`'s `decisions: Map<LogicalItemId, 'skip'|'create_new'>`
// verbatim, without ever defining `PreviewItem`/`LogicalItemId` - the same
// kind of documented-interface gap Module Boundaries section 10 already
// names (its own example: `RunOperationResult`'s `failed`/`refused`
// variants, added in E4-S1). Filled in here, disclosed:
//
// - `LogicalItemId`: a plain `string` alias - `logical_item.id` is already a
//   `uuid` primary key; this only gives the signature's own literal type
//   name a real definition, it is not a new validated/branded type.
// - `PreviewItem`: this story's own instructions name TWO distinct preview
//   line-item shapes for `previewExport`'s single documented `skipped`
//   field - "list Stories whose Epic has no resolvable Jira ref anywhere as
//   `skipped`" and, separately, "a LogicalItem with an existing jira ref
//   from a DIFFERENT ItemVersion... needs a Skip/Create-New decision".
//   Modeled here as ONE discriminated union (by `kind`) so both fit in the
//   single `skipped: PreviewItem[]` array Module Boundaries 4.6 literally
//   documents, rather than widening that signature. `docs/
//   Throughline_API_Contracts.md` section 9 (not cited by this story, E4-S6
//   scope) shows a future route splitting these into separate `skipped`/
//   `needsDecision` response fields by filtering on exactly this kind of
//   discriminant - that splitting is that route's own "serialize the
//   result" job (Module Boundaries 4.7), not redone here.
// ---------------------------------------------------------------------------

export type LogicalItemId = string;

export type PreviewItem =
  | { kind: 'skipped'; logicalItemId: string; displayKey: string; reason: 'epic_has_no_jira_ref' }
  | { kind: 'needs_decision'; logicalItemId: string; displayKey: string; existingRef: ExternalRef };

export class MissingExportDecisionError extends Error {
  constructor(logicalItemId: string, displayKey: string) {
    super(
      `${displayKey} (${logicalItemId}) needs a Skip / Create New Jira Issue decision ` +
        '(TR FR-074) before exportBacklog can proceed for it',
    );
    this.name = 'MissingExportDecisionError';
  }
}

/**
 * Judgment call, same shape as `github`'s
 * `ArchitectureVersionNotApprovedError`: Jira export is a one-shot action per
 * captured version (ERD 7.4's own "capture the Backlog version once") that
 * must always be driven from whatever is authoritative NOW, i.e.
 * `status = 'approved'` specifically - matches `impact()`'s own `current_m`
 * definition (ERD 6.1) and `docs/Throughline_API_Contracts.md` section 9's
 * "against the current approved Backlog" / `409 PREREQUISITE_NOT_APPROVED`.
 */
export class BacklogVersionNotApprovedError extends Error {
  constructor(backlogVersionId: string, actualStatus: string) {
    super(
      `artifact_version ${backlogVersionId} is '${actualStatus}', not 'approved' - Jira export ` +
        'only ever runs from the current, authoritative Backlog version',
    );
    this.name = 'BacklogVersionNotApprovedError';
  }
}

/**
 * Round 14 (Module Boundaries 4.6, D1): what a layer-6 route passes in - the
 * verified project owner and the project's chosen Jira site + project key. This
 * module cannot read `project` or resolve users itself. A missing target (either
 * half) is the API's `TARGET_REQUIRED`.
 */
export type JiraCtx = { userId: string; jiraCloudId?: string; jiraProjectKey?: string };

/**
 * Round 14 (FR-088): the project has no Jira site + project chosen, so there is
 * nowhere to create issues. -> API 409 `TARGET_REQUIRED` `{ target: 'jira' }`.
 * Thrown before any operation row exists.
 */
export class JiraTargetRequiredError extends Error {
  readonly target = 'jira' as const;

  constructor() {
    super('This project has no Jira site and project chosen yet. Choose where issues go first.');
    this.name = 'JiraTargetRequiredError';
  }
}

/** `listProjects`: the requested `cloudId` is not one of the caller's accessible sites. -> API 422 `TARGET_NOT_ACCESSIBLE`. */
export class JiraSiteNotAccessibleError extends Error {
  constructor() {
    super('That Jira site is not available to your connected Atlassian account.');
    this.name = 'JiraSiteNotAccessibleError';
  }
}

export class JiraOperationFailedError extends Error {
  constructor(reason: string) {
    super(`Jira operation failed: ${reason}`);
    this.name = 'JiraOperationFailedError';
  }
}

export class JiraOperationRefusedError extends Error {
  constructor(reason: string) {
    super(`Jira operation refused: ${reason}`);
    this.name = 'JiraOperationRefusedError';
  }
}

export class JiraOperationConflictError extends Error {
  constructor(operationKey: string) {
    super(
      `Jira operation ${operationKey} already exists with a different request (R11) - ` +
        'never a silent resend or reuse',
    );
    this.name = 'JiraOperationConflictError';
  }
}

/**
 * Round 14 (API Contracts `PreviewConnectionDTO`, FR-089): whether the caller
 * can write to Jira right now, carried in the preview so the screen shows the
 * connect-to-continue prompt instead of the preview failing.
 */
export interface PreviewConnection {
  status: ConnectionStatus['status'];
  /** `project.jira_cloud_id` and `project.jira_project_key` are both set. */
  targetReady: boolean;
}

// ---------------------------------------------------------------------------
// Jira REST API v3 client - raw fetch. Two credentials (see the header):
//  - the acting user's Atlassian 3LO token: Bearer, against
//    https://api.atlassian.com/ex/jira/<cloudId>;
//  - the legacy environment credential: Basic auth (base64 `email:api_token`)
//    against JIRA_BASE_URL, adapted from scripts/spike-jira-reconciliation.ts's
//    own client shape (that script is spike-local per its own header comment -
//    this is a real re-implementation of the same shape, not an import of it).
// ---------------------------------------------------------------------------

const ATLASSIAN_API = 'https://api.atlassian.com';

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

interface JiraTarget {
  cloudId: string;
  projectKey: string;
}

type JiraAuth =
  | { kind: 'user'; credential: Credential; target: JiraTarget }
  | { kind: 'legacy'; config: JiraConfig };

function requireTarget(ctx: JiraCtx): JiraTarget {
  if (!ctx.jiraCloudId || !ctx.jiraProjectKey) throw new JiraTargetRequiredError();
  return { cloudId: ctx.jiraCloudId, projectKey: ctx.jiraProjectKey };
}

/**
 * `recorded` is the credential a NEW operation just resolved with
 * `getCredential`, or the one recorded on an existing operation
 * (`getCredentialForOperation`); only `{ kind: 'legacy' }` reads JIRA_* env.
 */
function authFor(recorded: Credential | { kind: 'legacy' }, ctx: JiraCtx): JiraAuth {
  if ('kind' in recorded) return { kind: 'legacy', config: requireJiraConfig() };
  return { kind: 'user', credential: recorded, target: requireTarget(ctx) };
}

function projectKeyOf(auth: JiraAuth): string {
  return auth.kind === 'user' ? auth.target.projectKey : auth.config.projectKey;
}

function requireJiraConfig(): JiraConfig {
  // A legacy operation (connection_id NULL) whose JIRA_* environment credential
  // is gone cannot continue: RECONNECT_REQUIRED with the legacy hint, never a
  // failed operation (ERD 7.6, Module Boundaries 4.9 rule 6). The error names no
  // variable and carries no value. `legacyCredentialAvailable` (src/lib) is the
  // one definition of "configured"; the combined guard below only narrows types.
  if (
    !legacyCredentialAvailable('jira') ||
    !env.JIRA_BASE_URL ||
    !env.JIRA_EMAIL ||
    !env.JIRA_API_TOKEN ||
    !env.JIRA_PROJECT_KEY
  ) {
    throw new ReconnectRequiredError('jira', 'legacy_credential_missing', null);
  }
  return {
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    projectKey: env.JIRA_PROJECT_KEY,
  };
}

function authHeader(config: JiraConfig): string {
  return `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')}`;
}

/** Thrown for any non-2xx Jira response - `sendCreateIssue` classifies 4xx as definitive, everything else as ambiguous (ERD 7.2). */
class JiraHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'JiraHttpError';
  }
}

/**
 * One request. Atlassian answered 401 to the user's token: it is invalid
 * (revoked at Atlassian, or expired past what a refresh can repair). Marks the
 * connection `needs_reauth` (and nothing else) and stops with
 * `ReconnectRequiredError` - never a `failed` operation (ERD 7.6). The legacy
 * credential (`credential` null) keeps its old handling: a plain JiraHttpError.
 */
async function requestJson<T>(args: {
  url: string;
  label: string;
  authorization: string;
  init: RequestInit;
  credential: Credential | null;
}): Promise<T> {
  const { init, credential } = args;
  const res = await fetch(args.url, {
    ...init,
    headers: {
      Authorization: args.authorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  });
  const bodyText = await res.text();
  if (res.status === 401 && credential) {
    await reportAuthFailure(credential.connectionId);
    throw new ReconnectRequiredError('jira', 'needs_reauth', credential.connectionId);
  }
  if (!res.ok) {
    // Status + a fixed label only: Atlassian's error body can echo request
    // content (issue text, JQL) and must never reach a log or a stored message
    // (NFR-005). Classification reads `status` alone.
    throw new JiraHttpError(res.status, `Jira API ${args.label} -> ${res.status}`);
  }
  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

/** A Jira REST call for an operation target: `/ex/jira/<cloudId>` + Bearer for a user, JIRA_BASE_URL + Basic for legacy. */
async function jiraFetch<T>(auth: JiraAuth, path: string, init: RequestInit): Promise<T> {
  const label = `${init.method ?? 'GET'} ${path}`;
  if (auth.kind === 'user') {
    return requestJson<T>({
      url: `${ATLASSIAN_API}/ex/jira/${encodeURIComponent(auth.target.cloudId)}${path}`,
      label,
      authorization: `Bearer ${auth.credential.accessToken}`,
      init,
      credential: auth.credential,
    });
  }
  return requestJson<T>({
    url: `${auth.config.baseUrl.replace(/\/$/, '')}${path}`,
    label,
    authorization: authHeader(auth.config),
    init,
    credential: null,
  });
}

interface JiraCreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

interface JiraSearchResponse {
  issues: Array<{ id: string; key: string }>;
}

async function searchJql(auth: JiraAuth, jql: string, maxResults = 5): Promise<JiraSearchResponse> {
  return jiraFetch<JiraSearchResponse>(auth, '/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, maxResults, fields: ['key'] }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AccessibleResource {
  id: string;
  url: string;
  name: string;
}

/** `GET /oauth/token/accessible-resources` with the user's own token: every Atlassian site it may act on. */
async function fetchAccessibleResources(credential: Credential): Promise<AccessibleResource[]> {
  const body = await requestJson<unknown>({
    url: `${ATLASSIAN_API}/oauth/token/accessible-resources`,
    label: 'GET /oauth/token/accessible-resources',
    authorization: `Bearer ${credential.accessToken}`,
    init: { method: 'GET' },
    credential,
  });
  if (!Array.isArray(body)) return [];
  const sites: AccessibleResource[] = [];
  for (const entry of body) {
    const site = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    if (typeof site.id === 'string' && site.id !== '') {
      sites.push({
        id: site.id,
        url: typeof site.url === 'string' ? site.url : '',
        name: typeof site.name === 'string' ? site.name : '',
      });
    }
  }
  return sites;
}

/**
 * The human-facing `.../browse/KEY` link. For a user credential the site URL
 * comes from the connection's stored default site when it is the target site,
 * otherwise from accessible-resources; if neither is available the ref simply
 * has no URL (best effort - it must never fail an issue that already exists).
 */
async function issueUrl(auth: JiraAuth, key: string): Promise<string | undefined> {
  if (auth.kind === 'legacy') return `${auth.config.baseUrl.replace(/\/$/, '')}/browse/${key}`;
  const { credential, target } = auth;
  let siteUrl: string | undefined =
    credential.meta.cloudId === target.cloudId ? credential.meta.siteUrl : undefined;
  if (!siteUrl) {
    try {
      siteUrl = (await fetchAccessibleResources(credential)).find(
        (site) => site.id === target.cloudId,
      )?.url;
    } catch (error) {
      if (error instanceof ReconnectRequiredError) throw error;
      siteUrl = undefined;
    }
  }
  return siteUrl ? `${siteUrl.replace(/\/$/, '')}/browse/${key}` : undefined;
}

function markerFor(itemVersionId: string): string {
  return `tl-${itemVersionId}`;
}

// TR 30.2: "a few attempts over about ten seconds" - same cadence as the
// spike (RECONCILE_MAX_ATTEMPTS=4, RECONCILE_DELAY_MS=3000 -> last attempt
// at ~9s elapsed).
const RECONCILE_MAX_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 3000;

// ---------------------------------------------------------------------------
// FR-074 (extended to Epics, ERD 7.4) + project-scoped ref lookups.
//
// `external-operations.getRefsForLogicalItem` returns EVERY jira ref a
// LogicalItem has ever had, across EVERY Jira project this Throughline
// instance has ever been configured with (T26's own scenario: re-export
// after reconfiguring JIRA_PROJECT_KEY) - ERD 7.4 says "already has a Jira
// ref (IN THE CONFIGURED JIRA PROJECT)", so every read below re-filters to
// the CURRENTLY configured project key before using a ref for anything.
// `external_ref` has no `jira_project_key` column of its own (Module
// Boundaries section 5's table ownership matrix - adding one is a schema
// change this story doesn't make); `sendCreateIssue` below stores it in
// `metadata.jiraProjectKey` instead (an already-`jsonb`, already
// provider-owned-content column - `github` does the same with `mode`).
// ---------------------------------------------------------------------------

function refJiraProjectKey(ref: ExternalRef): string | null {
  const metadata = ref.metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).jiraProjectKey;
  return typeof value === 'string' ? value : null;
}

/**
 * Round 14: which refs count as "already exported here". A user target
 * (`cloudId` + `projectKey`) is matched on the OPERATION's `target_descriptor`
 * by `getRefsForLogicalItem` itself (ERD 7.4), so a ref made in another site or
 * project never counts. A legacy (environment-credential) operation has no
 * site, so it keeps the pre-round-14 filter on `metadata.jiraProjectKey`.
 */
type RefScope = { kind: 'target'; target: JiraTarget } | { kind: 'legacy'; projectKey: string };

function scopeOf(auth: JiraAuth): RefScope {
  return auth.kind === 'user'
    ? { kind: 'target', target: auth.target }
    : { kind: 'legacy', projectKey: auth.config.projectKey };
}

async function refsInScope(logicalItemId: string, scope: RefScope): Promise<ExternalRef[]> {
  if (scope.kind === 'target') {
    return getRefsForLogicalItem(logicalItemId, 'jira', scope.target);
  }
  const refs = await getRefsForLogicalItem(logicalItemId, 'jira');
  return refs.filter((ref) => refJiraProjectKey(ref) === scope.projectKey);
}

/**
 * FR-074 (Epics and Stories): does this member's LogicalItem need a
 * Skip/Create-New decision before it can be exported? `null` when no
 * decision is needed - either brand new in this project (no ref at all), or
 * this EXACT ItemVersion already has a ref here (idempotent reuse via
 * `runOperation`'s own `completed` branch, ERD 7.2 step 3.b - re-exporting
 * an unchanged item is never a silent duplicate, it is the same object).
 */
async function resolveDecisionNeed(
  member: BacklogVersionMember,
  scope: RefScope,
): Promise<PreviewItem | null> {
  if (!member.logicalItemId || !member.itemVersionId || !member.displayKey) return null;
  const scoped = await refsInScope(member.logicalItemId, scope);
  if (!scoped.length) return null;
  const currentRef = scoped.find((ref) => ref.sourceItemVersionId === member.itemVersionId);
  if (currentRef) return null;
  return {
    kind: 'needs_decision',
    logicalItemId: member.logicalItemId,
    displayKey: member.displayKey,
    existingRef: scoped[0]!,
  };
}

/**
 * ERD 7.4's two-step Story-parent resolution, scoped to the configured Jira
 * project. `null` when the Epic has no resolvable ref there at all.
 */
async function resolveEpicJiraKey(
  epic: BacklogVersionMember,
  scope: RefScope,
): Promise<string | null> {
  if (!epic.logicalItemId) return null;
  const scoped = await refsInScope(epic.logicalItemId, scope);
  // Step 1 (ERD 7.4): the Epic's CURRENT ItemVersion's own ref, if any -
  // i.e. this same captured version's own Epic membership row already has a
  // Jira ref (either from an earlier call, or one this same export call just
  // created - exportBacklog always finishes every Epic before any Story).
  const currentRef = scoped.find((ref) => ref.sourceItemVersionId === epic.itemVersionId);
  if (currentRef) return currentRef.externalKey ?? null;
  // Step 2: otherwise the most recent ref of ANY ItemVersion of this Epic's
  // LogicalItem (the "user chose Skip for a changed Epic" case, T41) -
  // `scoped` is already ordered most-recent-first
  // (`getRefsForLogicalItem`'s own contract).
  return scoped[0]?.externalKey ?? null;
}

function findEpicMember(
  epics: BacklogVersionMember[],
  logicalItemId: string | null,
): BacklogVersionMember | undefined {
  if (!logicalItemId) return undefined;
  return epics.find((epic) => epic.logicalItemId === logicalItemId);
}

// ---------------------------------------------------------------------------
// Capture-once (ERD 7.4: "A Backlog re-approval during a long export then
// cannot mix versions within one export run") + Epic/Story split.
// ---------------------------------------------------------------------------

interface CapturedBacklogVersion {
  projectId: string;
  epics: BacklogVersionMember[];
  stories: BacklogVersionMember[];
  itemVersionIds: string[];
}

async function captureBacklogVersion(backlogVersionId: string): Promise<CapturedBacklogVersion> {
  const members = await getBacklogVersionMembers(backlogVersionId);
  const [first] = members;
  if (!first) {
    // getBacklogVersionMembers (via identity.getSourceVersionMembers) throws
    // its own "Unknown context source version" when the id doesn't exist at
    // all - reaching here with zero rows would mean a real backlog_version
    // with literally no members, which callers never construct in practice.
    throw new Error(`backlog artifact_version ${backlogVersionId} has no members`);
  }
  if (first.status !== 'approved') {
    throw new BacklogVersionNotApprovedError(backlogVersionId, first.status);
  }
  const epics = members.filter((member) => member.itemType === 'epic');
  const stories = members.filter((member) => member.itemType === 'story');
  const itemVersionIds = members.flatMap((member) =>
    member.itemVersionId ? [member.itemVersionId] : [],
  );
  return { projectId: first.projectId, epics, stories, itemVersionIds };
}

// ---------------------------------------------------------------------------
// FR-070 - preview.
// ---------------------------------------------------------------------------

/**
 * Round 14 (FR-089): built from local state only - it makes no Jira call and
 * needs no credential, so it never throws `ConnectionRequiredError` /
 * `ReconnectRequiredError`; `connection` tells the screen whether to show the
 * connect-to-continue prompt. Until the project has a Jira target (`ctx`), the
 * FR-074 checks have no site/project to be scoped to, so `skipped` is empty and
 * `connection.targetReady` is false.
 */
export async function previewExport(
  backlogVersionId: string,
  ctx: JiraCtx,
): Promise<{
  epics: number;
  stories: number;
  skipped: PreviewItem[];
  impact: ImpactRow[];
  connection: PreviewConnection;
}> {
  const { projectId, epics, stories, itemVersionIds } =
    await captureBacklogVersion(backlogVersionId);
  const target =
    ctx.jiraCloudId && ctx.jiraProjectKey
      ? { cloudId: ctx.jiraCloudId, projectKey: ctx.jiraProjectKey }
      : null;

  const skipped: PreviewItem[] = [];

  if (target) {
    const scope: RefScope = { kind: 'target', target };

    // FR-074 for Epics.
    for (const epic of epics) {
      const decisionItem = await resolveDecisionNeed(epic, scope);
      if (decisionItem) skipped.push(decisionItem);
    }

    // Stories: parent resolvability first (ERD 7.4: "A Story whose Epic has no
    // Jira ref at all is not exported and is listed in the preview") - a Story
    // that can't be exported either way this call is listed ONCE, as
    // `epic_has_no_jira_ref`, not also flagged for its own FR-074 decision
    // (which would be moot: `exportBacklog` never even reaches that check for
    // an unresolvable-parent Story, see its own loop below).
    for (const story of stories) {
      const epic = findEpicMember(epics, story.parentLogicalItemId);
      const parentKey = epic ? await resolveEpicJiraKey(epic, scope) : null;
      if (!parentKey) {
        if (story.logicalItemId && story.displayKey) {
          skipped.push({
            kind: 'skipped',
            logicalItemId: story.logicalItemId,
            displayKey: story.displayKey,
            reason: 'epic_has_no_jira_ref',
          });
        }
        continue;
      }
      const decisionItem = await resolveDecisionNeed(story, scope);
      if (decisionItem) skipped.push(decisionItem);
    }
  }

  // TR FR-085: impact for the item_versions this export would create from -
  // same shape as `github.previewInit`'s own impact preview.
  const itemVersionIdSet = new Set(itemVersionIds);
  const projectWarnings = await getWarnings(projectId);
  const impact = projectWarnings.filter(
    (row) => row.subjectKind === 'item_version' && itemVersionIdSet.has(row.subjectId),
  );

  // Read last, as github.previewInit does, so the status is as current as it can be.
  const jira = (await listConnections(ctx.userId)).find((c) => c.provider === 'jira');
  const connection: PreviewConnection = {
    status: jira?.status ?? 'none',
    targetReady: target !== null,
  };

  return { epics: epics.length, stories: stories.length, skipped, impact, connection };
}

// ---------------------------------------------------------------------------
// FR-071/073/074 + ERD 7.4/30.2 - export.
// ---------------------------------------------------------------------------

async function sendCreateIssue(args: {
  auth: JiraAuth;
  member: BacklogVersionMember;
  itemType: 'epic' | 'story';
  // `exportOneItem` has already rejected a member with no display key.
  displayKey: string;
  marker: string;
  parentKey: string | null;
}): Promise<{
  externalId: string;
  externalKey: string;
  externalUrl?: string;
  metadata: IssueRefMetadata;
}> {
  const { auth, member, itemType, displayKey, marker, parentKey } = args;
  const projectKey = projectKeyOf(auth);
  // FR-071: no other issue-type naming scheme is named anywhere in the
  // frozen ERD/TR, and this project's own capstone scope has no Jira-schema-
  // discovery step to read the configured project's REAL issue-type names -
  // a judgment call, same spirit as `github`'s `PINNED_REFERENCE_STACK`:
  // Jira Software's own default issue-type names for "Epic"/"Story".
  const issueType = itemType === 'epic' ? 'Epic' : 'Story';
  // The item's own content (title / user story / behavior / acceptance
  // criteria) leads; the provenance footer - carrying the backup marker - is
  // always last. See issue-content.ts.
  const description = buildIssueDescription({
    itemType,
    payload: member.payload,
    footer: [
      `Created by Throughline from ${itemType} ${displayKey} ` +
        `(item_version ${member.itemVersionId}).`,
      `Throughline marker (do not remove): ${marker}`,
    ],
  });
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    issuetype: { name: issueType },
    summary: buildIssueSummary({ itemType, displayKey, payload: member.payload }),
    // Primary marker (ERD 7.4): a label, JQL-queryable without any
    // custom-field setup.
    labels: [marker],
    // Backup marker: the same complete string repeated in the description
    // footer (see buildIssueDescription's `footer` above).
    description,
  };
  if (parentKey) fields.parent = { key: parentKey };

  let response: JiraCreateIssueResponse;
  try {
    response = await jiraFetch<JiraCreateIssueResponse>(auth, '/rest/api/3/issue', {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  } catch (error) {
    if (error instanceof JiraHttpError && error.status >= 400 && error.status < 500) {
      // ERD 7.2: "`failed` is reserved for DEFINITIVE provider rejections
      // (validation/4xx)."
      throw new DefinitiveProviderError(`jira_create_issue_rejected:${error.status}`);
    }
    throw error; // ambiguous - propagates unchanged (ERD 7.2 R6/R9)
  }

  return {
    externalId: response.id,
    externalKey: response.key,
    ...(await urlField(auth, response.key)),
    metadata: refMetadata(auth),
  };
}

/**
 * `metadata.jiraProjectKey` is what the legacy FR-074 scoping reads (and what
 * refs made before round 14 carry), so it is kept on every ref; a user ref also
 * records its site as `cloudId` (informational - the scoping of a user target
 * reads the operation's `target_descriptor`, ERD 7.4).
 */
type IssueRefMetadata = { jiraProjectKey: string; cloudId?: string };

function refMetadata(auth: JiraAuth): IssueRefMetadata {
  return auth.kind === 'user'
    ? { jiraProjectKey: auth.target.projectKey, cloudId: auth.target.cloudId }
    : { jiraProjectKey: auth.config.projectKey };
}

async function urlField(auth: JiraAuth, key: string): Promise<{ externalUrl?: string }> {
  const externalUrl = await issueUrl(auth, key);
  return externalUrl === undefined ? {} : { externalUrl };
}

async function reconcileIssue(args: { auth: JiraAuth; marker: string }): Promise<
  | {
      found: true;
      externalId: string;
      externalKey: string;
      externalUrl?: string;
      metadata: IssueRefMetadata;
    }
  | { found: false }
> {
  const { auth, marker } = args;
  const projectKey = projectKeyOf(auth);
  // Primary path: bounded re-query by label (TR 30.2 - Jira search can lag
  // behind a create). Searched within the OPERATION's project (ERD 7.4).
  for (let attempt = 1; attempt <= RECONCILE_MAX_ATTEMPTS; attempt++) {
    const byLabel = await searchJql(auth, `project = "${projectKey}" AND labels = "${marker}"`);
    const foundByLabel = byLabel.issues[0];
    if (foundByLabel) {
      return {
        found: true,
        externalId: foundByLabel.id,
        externalKey: foundByLabel.key,
        ...(await urlField(auth, foundByLabel.key)),
        // Same slot `sendCreateIssue` already sets on a direct success -
        // without it here, a ref adopted via reconciliation would carry no
        // `jiraProjectKey` at all and `refJiraProjectKey` (the legacy scoping)
        // could never see it as "in the configured project" again (see the
        // extended comment on `ReconcileResult` in external/operations/index.ts).
        metadata: refMetadata(auth),
      };
    }
    if (attempt < RECONCILE_MAX_ATTEMPTS) await sleep(RECONCILE_DELAY_MS);
  }
  // Backup path: independent description-footer text search (TR 30.2 / the
  // spike's own two-path design) - run once, after the label loop above has
  // already given the index at least as much time to catch up.
  const byText = await searchJql(auth, `project = "${projectKey}" AND text ~ "${marker}"`);
  const foundByText = byText.issues[0];
  if (!foundByText) return { found: false };
  return {
    found: true,
    externalId: foundByText.id,
    externalKey: foundByText.key,
    ...(await urlField(auth, foundByText.key)),
    metadata: refMetadata(auth),
  };
}

/**
 * One Epic/Story = one `runOperation`. `recorded` is the credential the caller
 * resolved for the request (a NEW export: the user's own, via `getCredential`;
 * a retry: the one recorded on the operation). The request itself (key, hash,
 * descriptor) is built from `ctx`; every send/reconcile of THIS row re-resolves
 * its credential from the row itself (`getCredentialForOperation`), so a retry
 * never silently switches account.
 */
async function runItemOperation(args: {
  member: BacklogVersionMember;
  recorded: Credential | { kind: 'legacy' };
  ctx: JiraCtx;
  parentKey: string | null;
}): Promise<RunOperationResult> {
  const { member, recorded, ctx, parentKey } = args;
  if (!member.logicalItemId || !member.itemVersionId || !member.displayKey || !member.itemType) {
    // A real membership row always has these - `captureBacklogVersion`'s own
    // `first` check already guards the "version has literally no members"
    // case that would otherwise leave these null (getSourceVersionMembers's
    // LEFT JOINs).
    throw new Error(`backlog_version ${member.sourceVersionId} has a malformed membership row`);
  }
  const requestAuth = authFor(recorded, ctx);
  const credential = requestAuth.kind === 'user' ? requestAuth.credential : null;
  const projectKey = projectKeyOf(requestAuth);

  const itemType = member.itemType === 'epic' ? 'epic' : 'story';
  const displayKey = member.displayKey; // narrowed by the guard above; a closure would lose it
  const marker = markerFor(member.itemVersionId);
  // ERD 7.4's own literal key format.
  const operationKey = `jira:create_issue:${projectKey}:${member.itemVersionId}`;
  // A connection-backed request carries its site and project (ERD 7.4/4.14),
  // under the names `getRefsForLogicalItem` filters on; the legacy shape is
  // unchanged so a legacy operation's stored hash still matches.
  const targetDescriptor =
    requestAuth.kind === 'user'
      ? {
          cloudId: requestAuth.target.cloudId,
          projectKey,
          itemType,
          displayKey: member.displayKey,
          parentKey,
        }
      : { jiraProjectKey: projectKey, itemType, displayKey: member.displayKey, parentKey };
  const requestHash = createHash('sha256').update(JSON.stringify(targetDescriptor)).digest('hex');

  const authForOperation = async (operationId: string): Promise<JiraAuth> =>
    authFor(await getCredentialForOperation(operationId), ctx);

  return runOperation({
    projectId: member.projectId,
    provider: 'jira',
    operationType: 'create_issue',
    operationKey,
    requestHash,
    targetDescriptor,
    sourceArtifactVersionId: member.sourceVersionId,
    sourceItemVersionId: member.itemVersionId,
    connectionId: credential?.connectionId ?? null,
    accountId: credential?.accountId ?? null,
    send: async ({ operationId }) =>
      sendCreateIssue({
        auth: await authForOperation(operationId),
        member,
        itemType,
        displayKey,
        marker,
        parentKey,
      }),
    reconcile: async ({ operationId }) =>
      reconcileIssue({ auth: await authForOperation(operationId), marker }),
  });
}

async function exportOneItem(args: {
  member: BacklogVersionMember;
  recorded: Credential;
  ctx: JiraCtx;
  scope: RefScope;
  decisions: Map<LogicalItemId, 'skip' | 'create_new'>;
  parentKey: string | null;
}): Promise<ExternalRef | null> {
  const { member, recorded, ctx, scope, decisions, parentKey } = args;
  if (!member.logicalItemId || !member.itemVersionId || !member.displayKey || !member.itemType) {
    throw new Error(`backlog_version ${member.sourceVersionId} has a malformed membership row`);
  }

  const decisionItem = await resolveDecisionNeed(member, scope);
  if (decisionItem) {
    const decision = decisions.get(member.logicalItemId);
    if (!decision) throw new MissingExportDecisionError(member.logicalItemId, member.displayKey);
    if (decision === 'skip') return null; // FR-074: do not touch it at all
    // 'create_new' falls through - a brand-new operation key (this
    // ItemVersion's id is already new, so no special-casing is needed here).
  }

  let result;
  try {
    result = await runItemOperation({ member, recorded, ctx, parentKey });
  } catch (error) {
    // A lapsed credential is not one item's outcome (ERD 7.6): every remaining
    // item would hit the same wall, so it stops the batch and reaches the route
    // as 409 RECONNECT_REQUIRED. The row itself was left exactly as it was.
    if (error instanceof ReconnectRequiredError || error instanceof ConnectionRequiredError) {
      throw error;
    }
    // ERD 7.1: "13 Stories = 13 external_operation rows. Partial failure is
    // then representable per object." A thrown, non-`DefinitiveProviderError`
    // exception here is `runOperation`'s own "ambiguous/network/timeout"
    // case (external-operations/index.ts's own doc comment) - step 1 of ERD
    // 7.2 already committed a `pending` row before any network call, so the
    // attempt is durably recorded; a later `exportBacklog` call (unchanged
    // inputs) reconciles or retries it through the SAME deterministic
    // operationKey. One item's ambiguous failure must never abort the rest
    // of a ~13-issue batch - judgment call, matching this file's own
    // documented `exportBacklog` return-type discipline below.
    return null;
  }

  if (result.status === 'completed') return result.ref;
  // Every other outcome (`reconciliation_required`/`conflict`/`in_flight`/
  // `failed`/`refused`) is the SAME "don't abort the batch" call as the
  // catch above - durably recorded on this item's own `external_operation`
  // row (retryable later), not silently lost, just not part of THIS call's
  // return value.
  return null;
}

/**
 * Module Boundaries 4.6's own literal return type is `Promise<ExternalRef[]>`
 * - a flat list, not a richer per-item result union. Read together with ERD
 * 7.1 ("13 Stories = 13 external_operation rows. Partial failure is then
 * representable per object") that means: this function itself must never
 * let one item's skip/decision/ambiguous-failure abort the rest of the
 * batch (`exportOneItem` above returns `null` for all of those, never
 * throws, except `MissingExportDecisionError` - a genuine caller/validation
 * error, not a provider outcome, which DOES abort the whole call, the same
 * way a malformed request should). Every non-`completed` outcome stays
 * durably recorded on its own `external_operation` row (ERD 7.1) rather than
 * surfaced through this return value - a future route (E4-S6) that wants a
 * `{created, skipped, failures}` shape (`docs/Throughline_API_Contracts.md`
 * section 9) re-derives `skipped`/`failures` from those rows plus the
 * `previewExport` list that was already shown to the user before this call,
 * not from a redesign of this signature.
 */
export async function exportBacklog(
  backlogVersionId: string,
  decisions: Map<LogicalItemId, 'skip' | 'create_new'>,
  ctx: JiraCtx,
): Promise<ExternalRef[]> {
  // Round 14 (ERD 7.2 step 0): the caller's own connection, resolved BEFORE any
  // operation row exists - `ConnectionRequiredError` / `ReconnectRequiredError`
  // and `JiraTargetRequiredError` therefore leave no `external_operation` behind.
  const recorded = await getCredential(ctx.userId, 'jira');
  const target = requireTarget(ctx);
  const scope: RefScope = { kind: 'target', target };
  const { epics, stories } = await captureBacklogVersion(backlogVersionId);

  const created: ExternalRef[] = [];

  // Epics before Stories (ERD 7.4) - real ordering: every Epic operation is
  // built AND AWAITED before any Story operation starts, so
  // `resolveEpicJiraKey` below can see an Epic this SAME export call just
  // created (step 1 of its own two-step resolution).
  for (const epic of epics) {
    const ref = await exportOneItem({
      member: epic,
      recorded,
      ctx,
      scope,
      decisions,
      parentKey: null,
    });
    if (ref) created.push(ref);
  }

  for (const story of stories) {
    const epic = findEpicMember(epics, story.parentLogicalItemId);
    const parentKey = epic ? await resolveEpicJiraKey(epic, scope) : null;
    if (!parentKey) continue; // ERD 7.4: "not exported" - already surfaced by previewExport
    const ref = await exportOneItem({ member: story, recorded, ctx, scope, decisions, parentKey });
    if (ref) created.push(ref);
  }

  return created;
}

/**
 * Round 14: the retry route's entry point for ONE existing Jira operation. The
 * request is rebuilt from current inputs using `ctx` (so the request-hash check
 * still catches a changed site or project), but the CREDENTIAL is the one
 * recorded on the operation (`getCredentialForOperation`), never the user's
 * current connection. A recorded connection that is not usable, or that now
 * belongs to a different Atlassian account, throws `ReconnectRequiredError`
 * before any network call and leaves the operation exactly as it was; an
 * operation with no recorded connection retries with the optional environment
 * credential.
 */
export async function retryOperation(
  operationId: string,
  ctx: JiraCtx,
): Promise<
  { status: 'completed'; ref: ExternalRef } | { status: 'reconciliation_required' | 'pending' }
> {
  const operation = await getOperationById(operationId);
  if (!operation || operation.provider !== 'jira') {
    throw new Error(`external_operation ${operationId} is not a Jira operation`);
  }
  if (!operation.sourceItemVersionId) {
    // external_operation_jira_requires_item_check guarantees this can't happen.
    throw new Error(`jira external_operation ${operationId} has no source_item_version_id`);
  }
  const recorded = await getCredentialForOperation(operationId);
  const scope = scopeOf(authFor(recorded, ctx));

  const { epics, stories } = await captureBacklogVersion(operation.sourceArtifactVersionId);
  const member = [...epics, ...stories].find(
    (candidate) => candidate.itemVersionId === operation.sourceItemVersionId,
  );
  if (!member) {
    throw new Error(`jira external_operation ${operationId} no longer matches a backlog member`);
  }
  let parentKey: string | null = null;
  if (member.itemType === 'story') {
    const epic = findEpicMember(epics, member.parentLogicalItemId);
    parentKey = epic ? await resolveEpicJiraKey(epic, scope) : null;
    if (!parentKey) {
      throw new Error(`jira external_operation ${operationId} has no resolvable parent Epic`);
    }
  }

  const result = await runItemOperation({ member, recorded, ctx, parentKey });
  switch (result.status) {
    case 'completed':
      return { status: 'completed', ref: result.ref };
    case 'reconciliation_required':
      return { status: 'reconciliation_required' };
    case 'in_flight':
      return { status: 'pending' };
    case 'failed':
      throw new JiraOperationFailedError(result.errorMessage);
    case 'refused':
      throw new JiraOperationRefusedError(result.reason);
    case 'conflict':
      throw new JiraOperationConflictError(operation.operationKey);
  }
}

// ---------------------------------------------------------------------------
// Round 14 (FR-088, D2): the site and project pickers and the PATCH
// .../targets validation. Read-only Atlassian calls with the caller's own
// connection; no table is touched, no operation exists yet, and only
// `ctx.userId` is used. `ConnectionRequiredError` / `ReconnectRequiredError`
// propagate (a 401 also marks the connection `needs_reauth`).
// ---------------------------------------------------------------------------

export async function listSites(
  ctx: Pick<JiraCtx, 'userId'>,
): Promise<{ cloudId: string; url: string; name: string }[]> {
  const credential = await getCredential(ctx.userId, 'jira');
  return (await fetchAccessibleResources(credential)).map((site) => ({
    cloudId: site.id,
    url: site.url,
    name: site.name,
  }));
}

const PROJECT_PAGE_SIZE = 50;
// A bound, not a limit anyone should hit: 40 pages is 2000 projects on one site.
const PROJECT_MAX_PAGES = 40;

interface JiraProjectSearchResponse {
  values?: Array<{ key?: unknown; name?: unknown }>;
  isLast?: boolean;
}

/**
 * The projects the caller can see on `cloudId`. `JiraSiteNotAccessibleError`
 * when `cloudId` is not one of the caller's own sites (checked against
 * accessible-resources first, so a foreign site id is never sent a project
 * request).
 */
export async function listProjects(
  ctx: Pick<JiraCtx, 'userId'>,
  cloudId: string,
): Promise<{ key: string; name: string }[]> {
  const credential = await getCredential(ctx.userId, 'jira');
  const sites = await fetchAccessibleResources(credential);
  if (!sites.some((site) => site.id === cloudId)) throw new JiraSiteNotAccessibleError();

  const auth: JiraAuth = { kind: 'user', credential, target: { cloudId, projectKey: '' } };
  const projects: { key: string; name: string }[] = [];
  for (let page = 0; page < PROJECT_MAX_PAGES; page++) {
    const response = await jiraFetch<JiraProjectSearchResponse>(
      auth,
      `/rest/api/3/project/search?startAt=${page * PROJECT_PAGE_SIZE}&maxResults=${PROJECT_PAGE_SIZE}&orderBy=key`,
      { method: 'GET' },
    );
    const values = response.values ?? [];
    for (const value of values) {
      if (typeof value.key === 'string' && value.key !== '') {
        projects.push({ key: value.key, name: typeof value.name === 'string' ? value.name : '' });
      }
    }
    if (response.isLast !== false || values.length === 0) break;
  }
  return projects;
}

/**
 * Round 14 (D2, FR-088): can the caller's own Jira connection see `projectKey`
 * on `cloudId`? `false` when the site is not one of theirs, or the project does
 * not exist or is not visible to them (404/403). `PATCH .../targets` calls this
 * BEFORE any project lock is taken.
 */
export async function checkProjectAccessible(
  ctx: Pick<JiraCtx, 'userId'>,
  cloudId: string,
  projectKey: string,
): Promise<boolean> {
  const credential = await getCredential(ctx.userId, 'jira');
  const sites = await fetchAccessibleResources(credential);
  if (!sites.some((site) => site.id === cloudId)) return false;

  try {
    await jiraFetch<unknown>(
      { kind: 'user', credential, target: { cloudId, projectKey } },
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
      { method: 'GET' },
    );
    return true;
  } catch (error) {
    if (error instanceof JiraHttpError && (error.status === 404 || error.status === 403)) {
      return false;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Drift - the missing counterpart to `github.checkDrift` (Module Boundaries
// 4.6). Added by E4-S6 (SCRUM-55): API Contracts section 7's
// `GET .../external-refs` calls `impact.getExternalDrift` per ref, but
// `eslint.config.mjs`'s `layer6-api` allow-list has no `layer1-impact` entry
// - a route handler cannot call it directly. `github.checkDrift` is already
// the documented layer-5 delegator for exactly this case; `jira` was simply
// missing its own copy. Byte-for-byte the same shape: resolve `refId` ->
// `projectId` via `external-operations.getRefById` (this module never
// queries `external_ref` itself, Module Boundaries 4.5), then delegate
// entirely to `impact.getExternalDrift` - the one impact engine (INV-025),
// no separate Jira-specific staleness logic.
// ---------------------------------------------------------------------------

export async function checkDrift(refId: string): Promise<ImpactRow | null> {
  const ref = await getRefById(refId);
  if (!ref) return null;
  return getExternalDrift(ref.projectId, refId);
}
