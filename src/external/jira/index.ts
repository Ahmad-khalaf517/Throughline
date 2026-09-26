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
// POST, the `adfDoc` helper) rather than importing it (that script is
// spike-local, per its own header comment).
//
// Reads Epic/Story LogicalItem/ItemVersion membership rows through
// `artifact-types/backlog` (this module's documented paired layer-3 module,
// Module Boundaries 4.6 / eslint.config.mjs's layer5-external-provider
// rule), never through `lineage/identity` directly - see
// `backlog.getBacklogVersionMembers`'s own header comment for why.
import { createHash } from 'node:crypto';
import { env } from '@/lib/env';
import {
  runOperation,
  getRefsForLogicalItem,
  DefinitiveProviderError,
  type ExternalRef,
} from '@/external/operations';
import { getWarnings, type ImpactRow } from '@/lineage/impact';
import { getBacklogVersionMembers, type BacklogVersionMember } from '@/artifact-types/backlog';

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

// ---------------------------------------------------------------------------
// Jira REST API v3 client - raw fetch, Basic auth (base64
// `email:api_token`), adapted from scripts/spike-jira-reconciliation.ts's
// own client shape (that script is spike-local per its own header comment -
// this is a real re-implementation of the same shape, not an import of it).
// ---------------------------------------------------------------------------

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

function requireJiraConfig(): JiraConfig {
  // Combined guard (mirrors the spike's own `!a || !b || !c || !d` shape) so
  // TypeScript's control-flow narrowing sees all four as defined strings
  // past this point, with no non-null assertions needed below.
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN || !env.JIRA_PROJECT_KEY) {
    const missing: string[] = [];
    if (!env.JIRA_BASE_URL) missing.push('JIRA_BASE_URL');
    if (!env.JIRA_EMAIL) missing.push('JIRA_EMAIL');
    if (!env.JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
    if (!env.JIRA_PROJECT_KEY) missing.push('JIRA_PROJECT_KEY');
    throw new Error(`Jira is not configured - missing ${missing.join(', ')} (ERD 7.4, real mode).`);
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

async function jiraFetch<T>(config: JiraConfig, path: string, init: RequestInit): Promise<T> {
  const url = `${config.baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(config),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...init.headers,
    },
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new JiraHttpError(
      res.status,
      `Jira API ${init.method ?? 'GET'} ${path} -> ${res.status}: ${bodyText}`,
    );
  }
  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

/** Minimal Atlassian Document Format doc - same shape as the spike's own `adfDoc`. */
function adfDoc(paragraphs: string[]) {
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
  };
}

interface JiraCreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

interface JiraSearchResponse {
  issues: Array<{ id: string; key: string }>;
}

async function searchJql(
  config: JiraConfig,
  jql: string,
  maxResults = 5,
): Promise<JiraSearchResponse> {
  return jiraFetch<JiraSearchResponse>(config, '/rest/api/3/search/jql', {
    method: 'POST',
    body: JSON.stringify({ jql, maxResults, fields: ['key'] }),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function issueUrl(config: JiraConfig, key: string): string {
  return `${config.baseUrl.replace(/\/$/, '')}/browse/${key}`;
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

async function refsInConfiguredProject(
  logicalItemId: string,
  jiraProjectKey: string,
): Promise<ExternalRef[]> {
  const refs = await getRefsForLogicalItem(logicalItemId, 'jira');
  return refs.filter((ref) => refJiraProjectKey(ref) === jiraProjectKey);
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
  jiraProjectKey: string,
): Promise<PreviewItem | null> {
  if (!member.logicalItemId || !member.itemVersionId || !member.displayKey) return null;
  const scoped = await refsInConfiguredProject(member.logicalItemId, jiraProjectKey);
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
  jiraProjectKey: string,
): Promise<string | null> {
  if (!epic.logicalItemId) return null;
  const scoped = await refsInConfiguredProject(epic.logicalItemId, jiraProjectKey);
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

export async function previewExport(
  backlogVersionId: string,
): Promise<{ epics: number; stories: number; skipped: PreviewItem[]; impact: ImpactRow[] }> {
  const { projectId, epics, stories, itemVersionIds } =
    await captureBacklogVersion(backlogVersionId);
  const { projectKey: jiraProjectKey } = requireJiraConfig();

  const skipped: PreviewItem[] = [];

  // FR-074 for Epics.
  for (const epic of epics) {
    const decisionItem = await resolveDecisionNeed(epic, jiraProjectKey);
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
    const parentKey = epic ? await resolveEpicJiraKey(epic, jiraProjectKey) : null;
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
    const decisionItem = await resolveDecisionNeed(story, jiraProjectKey);
    if (decisionItem) skipped.push(decisionItem);
  }

  // TR FR-085: impact for the item_versions this export would create from -
  // same shape as `github.previewInit`'s own impact preview.
  const itemVersionIdSet = new Set(itemVersionIds);
  const projectWarnings = await getWarnings(projectId);
  const impact = projectWarnings.filter(
    (row) => row.subjectKind === 'item_version' && itemVersionIdSet.has(row.subjectId),
  );

  return { epics: epics.length, stories: stories.length, skipped, impact };
}

// ---------------------------------------------------------------------------
// FR-071/073/074 + ERD 7.4/30.2 - export.
// ---------------------------------------------------------------------------

async function sendCreateIssue(args: {
  config: JiraConfig;
  member: BacklogVersionMember;
  itemType: 'epic' | 'story';
  marker: string;
  parentKey: string | null;
}): Promise<{
  externalId: string;
  externalKey: string;
  externalUrl: string;
  metadata: { jiraProjectKey: string };
}> {
  const { config, member, itemType, marker, parentKey } = args;
  // FR-071: no other issue-type naming scheme is named anywhere in the
  // frozen ERD/TR, and this project's own capstone scope has no Jira-schema-
  // discovery step to read the configured project's REAL issue-type names -
  // a judgment call, same spirit as `github`'s `PINNED_REFERENCE_STACK`:
  // Jira Software's own default issue-type names for "Epic"/"Story".
  const issueType = itemType === 'epic' ? 'Epic' : 'Story';
  const description = adfDoc([
    `Created by Throughline from ${itemType} ${member.displayKey} ` +
      `(item_version ${member.itemVersionId}).`,
    `Throughline marker (do not remove): ${marker}`,
  ]);
  const fields: Record<string, unknown> = {
    project: { key: config.projectKey },
    issuetype: { name: issueType },
    summary: member.displayKey,
    // Primary marker (ERD 7.4): a label, JQL-queryable without any
    // custom-field setup.
    labels: [marker],
    // Backup marker: the same complete string repeated in the description
    // footer (see adfDoc call above).
    description,
  };
  if (parentKey) fields.parent = { key: parentKey };

  let response: JiraCreateIssueResponse;
  try {
    response = await jiraFetch<JiraCreateIssueResponse>(config, '/rest/api/3/issue', {
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
    externalUrl: issueUrl(config, response.key),
    metadata: { jiraProjectKey: config.projectKey },
  };
}

async function reconcileIssue(args: { config: JiraConfig; marker: string }): Promise<
  | {
      found: true;
      externalId: string;
      externalKey: string;
      externalUrl: string;
      metadata: { jiraProjectKey: string };
    }
  | { found: false }
> {
  const { config, marker } = args;
  // Primary path: bounded re-query by label (TR 30.2 - Jira search can lag
  // behind a create).
  for (let attempt = 1; attempt <= RECONCILE_MAX_ATTEMPTS; attempt++) {
    const byLabel = await searchJql(
      config,
      `project = "${config.projectKey}" AND labels = "${marker}"`,
    );
    const foundByLabel = byLabel.issues[0];
    if (foundByLabel) {
      return {
        found: true,
        externalId: foundByLabel.id,
        externalKey: foundByLabel.key,
        externalUrl: issueUrl(config, foundByLabel.key),
        // Same slot `sendCreateIssue` already sets on a direct success -
        // without it here, a ref adopted via reconciliation would carry no
        // `jiraProjectKey` at all and `refJiraProjectKey`/
        // `resolveDecisionNeed`/`resolveEpicJiraKey` (below) could never see
        // it as "in the configured project" again (see the extended comment
        // on `ReconcileResult` in external/operations/index.ts).
        metadata: { jiraProjectKey: config.projectKey },
      };
    }
    if (attempt < RECONCILE_MAX_ATTEMPTS) await sleep(RECONCILE_DELAY_MS);
  }
  // Backup path: independent description-footer text search (TR 30.2 / the
  // spike's own two-path design) - run once, after the label loop above has
  // already given the index at least as much time to catch up.
  const byText = await searchJql(config, `project = "${config.projectKey}" AND text ~ "${marker}"`);
  const foundByText = byText.issues[0];
  if (!foundByText) return { found: false };
  return {
    found: true,
    externalId: foundByText.id,
    externalKey: foundByText.key,
    externalUrl: issueUrl(config, foundByText.key),
    metadata: { jiraProjectKey: config.projectKey },
  };
}

async function exportOneItem(args: {
  member: BacklogVersionMember;
  config: JiraConfig;
  decisions: Map<LogicalItemId, 'skip' | 'create_new'>;
  parentKey: string | null;
}): Promise<ExternalRef | null> {
  const { member, config, decisions, parentKey } = args;
  if (!member.logicalItemId || !member.itemVersionId || !member.displayKey || !member.itemType) {
    // A real membership row always has these - `captureBacklogVersion`'s own
    // `first` check already guards the "version has literally no members"
    // case that would otherwise leave these null (getSourceVersionMembers's
    // LEFT JOINs).
    throw new Error(`backlog_version ${member.sourceVersionId} has a malformed membership row`);
  }

  const decisionItem = await resolveDecisionNeed(member, config.projectKey);
  if (decisionItem) {
    const decision = decisions.get(member.logicalItemId);
    if (!decision) throw new MissingExportDecisionError(member.logicalItemId, member.displayKey);
    if (decision === 'skip') return null; // FR-074: do not touch it at all
    // 'create_new' falls through - a brand-new operation key (this
    // ItemVersion's id is already new, so no special-casing is needed here).
  }

  const itemType = member.itemType === 'epic' ? 'epic' : 'story';
  const marker = markerFor(member.itemVersionId);
  // ERD 7.4's own literal key format.
  const operationKey = `jira:create_issue:${config.projectKey}:${member.itemVersionId}`;
  const targetDescriptor = {
    jiraProjectKey: config.projectKey,
    itemType,
    displayKey: member.displayKey,
    parentKey,
  };
  const requestHash = createHash('sha256').update(JSON.stringify(targetDescriptor)).digest('hex');

  let result;
  try {
    result = await runOperation({
      projectId: member.projectId,
      provider: 'jira',
      operationType: 'create_issue',
      operationKey,
      requestHash,
      targetDescriptor,
      sourceArtifactVersionId: member.sourceVersionId,
      sourceItemVersionId: member.itemVersionId,
      send: () => sendCreateIssue({ config, member, itemType, marker, parentKey }),
      reconcile: () => reconcileIssue({ config, marker }),
    });
  } catch {
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
): Promise<ExternalRef[]> {
  const { epics, stories } = await captureBacklogVersion(backlogVersionId);
  const config = requireJiraConfig();

  const created: ExternalRef[] = [];

  // Epics before Stories (ERD 7.4) - real ordering: every Epic operation is
  // built AND AWAITED before any Story operation starts, so
  // `resolveEpicJiraKey` below can see an Epic this SAME export call just
  // created (step 1 of its own two-step resolution).
  for (const epic of epics) {
    const ref = await exportOneItem({ member: epic, config, decisions, parentKey: null });
    if (ref) created.push(ref);
  }

  for (const story of stories) {
    const epic = findEpicMember(epics, story.parentLogicalItemId);
    const parentKey = epic ? await resolveEpicJiraKey(epic, config.projectKey) : null;
    if (!parentKey) continue; // ERD 7.4: "not exported" - already surfaced by previewExport
    const ref = await exportOneItem({ member: story, config, decisions, parentKey });
    if (ref) created.push(ref);
  }

  return created;
}
