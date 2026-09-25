// SCRUM-50 / Jira Plan E4-T2 - Spike C (Jira half): create real Jira issue +
// simulate ambiguous/lost response + search-marker reconcile (TR section 42,
// "Spike C - GitHub + Jira Retry/Reconciliation", the Jira half; TR section
// 30.2 "Jira Reconciliation").
//
// Proves, against the REAL Jira Cloud REST API v3:
//
//   create real Jira issue with Throughline marker
//     -> simulate ambiguous/lost response (never trust/forward the create
//        result into the reconcile path)
//     -> search Jira by marker (bounded re-query, JQL can lag a create)
//     -> reconcile: the found issue is the one that was actually created,
//        with no duplicate created along the way
//
// THE MARKER MECHANISM IS ALREADY DECIDED - this script implements and
// encodes that decision, it does not invent a new one. ERD section 7.4 and
// TR section 30.2 (both updated in this same change - see the doc-sync
// commit) specify: a Jira LABEL `tl-<item_version_id>` (JQL-queryable
// without any custom-field setup) as the primary marker, repeated in the
// issue's DESCRIPTION FOOTER as a backup, reconciled by searching within the
// configured Jira project with a bounded re-query (Jira search can lag - "a
// few attempts over ~10s" per TR 30.2).
//
// This has already been empirically validated live during planning, against
// a real Jira Cloud instance - project SCRUM, issue SCRUM-75
// (https://ahmadyaserkhalaf.atlassian.net/browse/SCRUM-75), via the
// Atlassian API directly (not through this script - this script did not
// exist yet at that point). Findings that this script's design reflects:
//   - Label creation at issue-creation time works directly (`labels` in the
//     create call) - no follow-up edit needed. The create response does NOT
//     echo `labels` back even though it was set (Jira's create response only
//     returns {id, key, self} by default) - this script does not treat that
//     omission as a failure signal; only a search confirms the label stuck.
//   - JQL label search (`project = SCRUM AND labels = "tl-<uuid>"`) found
//     the issue on the first re-query attempt, ~18s after creation in that
//     experiment - but that ~18s was dominated by tool-call round-trip
//     overhead in that experiment's own client, not pure Jira indexing
//     latency, so it is "consistent with, but not a tight bound on" the
//     documented ~10s assumption. This script's own retry budget (below)
//     still targets ~10s, per TR 30.2, and simply keeps retrying past it if
//     the marker is not yet found within that window.
//   - Full-text description search (`text ~ "tl-<uuid>"`) also found it
//     cleanly, independently of the label path.
//   - IMPORTANT CONSTRAINT: Jira treated the full hyphenated marker as one
//     atomic token on both paths. A partial/truncated marker (a UUID
//     fragment without the `tl-` prefix, and a truncated label) matched
//     ZERO results on both paths in that experiment. Therefore the reconcile
//     logic below always searches using the COMPLETE marker string - never a
//     substring, never a truncated form - on both the label path and the
//     description-text fallback path. Do not "optimize" this later by
//     matching on a prefix.
//   - No label character-restriction issues with the `tl-<uuid>` format
//     (lowercase hex + hyphens).
//
// Explicit non-goals for this spike (E4-T2 is a Task, not the module it
// precedes - see the Jira Plan row and TR section 42):
//   - src/external/jira (`previewExport`/`exportBacklog`, Module Boundaries
//     section 4.6) is E4-S3's job, a later story that depends on this one.
//     That module's index.ts stays `export {}` - this script does not touch
//     it and does not build a reusable Jira client for it to import; the
//     fetch-based client below is spike-local, same discipline as Spike A
//     calling the `openai` package directly instead of building
//     src/ai-client early.
//   - The marker here is `tl-<crypto.randomUUID()>`, a stand-in for a real
//     `item_version_id`. This spike does not run through the real
//     identity/backlog pipeline (src/lineage/identity, src/artifact-types/
//     backlog) to produce one - same kind of spike-local simplification
//     Spike A used for its own matching logic.
//   - No `external_operation`/`external_ref` rows are read or written. The
//     insert-first/lock/decide protocol that those tables implement is
//     E4-S1's job (already merged - src/external/operations) and this
//     script's whole point is to validate the Jira-side reconcile mechanism
//     in isolation before that protocol is asked to drive it. No DB
//     connection is opened by this script at all.
//   - No SDK dependency: a raw `fetch`-based Jira REST API v3 client (Basic
//     auth, base64 `email:api_token`), matching how Spike A called the
//     `openai` package directly rather than building a wrapper module early.
//
// Engineering-judgment calls made here, disclosed:
//   - Search endpoint: Atlassian has been migrating Jira Cloud off the
//     classic `/rest/api/3/search` GET/POST endpoint toward
//     `/rest/api/3/search/jql`. This script targets the newer
//     `/rest/api/3/search/jql` POST endpoint for forward-compatibility.
//     Unlike the label/create mechanics above, this specific endpoint choice
//     was NOT itself exercised in the live SCRUM-75 experiment (that
//     experiment went through the Atlassian API directly, not through this
//     script) and this environment has no Jira credentials configured (see
//     below) - so this script's own fetch-based search call has not yet been
//     run live by anyone. It is written to the documented v3 request/
//     response shape ({ jql, maxResults, fields } -> { issues: [...] }) in
//     good faith; the first real run against live credentials is the actual
//     validation of this specific code path, not this comment.
//   - Issue type: hardcoded to "Task" for the throwaway spike-test issue -
//     the SCRUM project's default issue type in the SCRUM-75 experiment.
//   - Retry cadence: 4 attempts, ~3s apart (0s, ~3s, ~6s, ~9s elapsed),
//     matching TR 30.2's "a few attempts over about ten seconds".
//   - Cleanup: this script does NOT delete the issue it creates (Jira issues
//     are not truly destroyed by the REST API without admin-level
//     permanent-delete config, and silently deleting is its own footgun) -
//     the created issue is clearly labeled as a throwaway spike-test issue
//     in its own summary/description so a human can bulk-close/delete it
//     later. Every run creates one new real issue - see the cost-discipline
//     note below.
//
// Cost/side-effect discipline (mirrors Spike A's OpenAI budget discipline,
// here for Jira issue creation instead of LLM completions): exactly ONE real
// `POST /issue` call per run. Do not add a package.json script for this and
// do not wire it into vitest - re-running it creates one more real Jira
// issue every time.
//
// Environment guard: env.JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN /
// JIRA_PROJECT_KEY (src/lib/env.ts) are all optional (module 15 "not built
// yet"). They are UNSET in this worktree's .env.local. Running this script
// here therefore exercises the guard path below (a clean stop before any
// network call, matching Spike A's OPENAI_API_KEY guard) - NOT a live round
// trip. That is expected and correct, and is reported plainly in the
// console output rather than being papered over.
//
// Run (exactly like `db:migrate` loads env - see package.json), once real
// Jira credentials are configured in .env.local:
//   pnpm dotenv -e .env.local -- tsx scripts/spike-jira-reconciliation.ts

import { randomUUID } from 'node:crypto';
import { env } from '../src/lib/env';

// ---------------------------------------------------------------------------
// 1. Spike-local Jira REST API v3 client (raw fetch, no SDK - see header).
// ---------------------------------------------------------------------------

interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

function authHeader(config: JiraConfig): string {
  const token = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
  return `Basic ${token}`;
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
    throw new Error(`Jira API ${init.method ?? 'GET'} ${path} -> ${res.status}: ${bodyText}`);
  }
  return bodyText ? (JSON.parse(bodyText) as T) : ({} as T);
}

/** Minimal Atlassian Document Format doc: one or more plain-text paragraphs. */
function adfDoc(paragraphs: string[]) {
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  };
}

interface JiraCreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

/** Step 2 of the round trip: POST-create a real issue with the marker as
 * both a label and a description-footer line. */
async function createSpikeIssue(
  config: JiraConfig,
  marker: string,
): Promise<JiraCreateIssueResponse> {
  const summary = `[Throughline spike, safe to delete] SCRUM-50 Jira reconciliation test`;
  const description = adfDoc([
    'This is a throwaway test issue created by scripts/spike-jira-reconciliation.ts ' +
      '(SCRUM-50 / Jira Plan E4-T2, the Jira marker-mechanism spike). It is safe to close ' +
      'or delete.',
    `Throughline marker (do not remove): ${marker}`,
  ]);
  return jiraFetch<JiraCreateIssueResponse>(config, '/rest/api/3/issue', {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        project: { key: config.projectKey },
        issuetype: { name: 'Task' },
        summary,
        // Primary marker (ERD 7.4 / TR 30.2): a label, JQL-queryable without
        // any custom-field setup.
        labels: [marker],
        // Backup marker: the same complete string repeated in the
        // description footer (see adfDoc call above).
        description,
      },
    }),
  });
}

interface JiraSearchResponse {
  issues: Array<{ id: string; key: string }>;
}

/** JQL search restricted to the configured project (TR 30.2: "search ...
 * within the configured Jira project"). `jql` must already contain the
 * COMPLETE marker string - callers never pass a substring (see header). */
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

// ---------------------------------------------------------------------------
// 2. Reconcile: bounded re-query by label (primary), one-shot check by
//    description text (backup, independent agreement check).
// ---------------------------------------------------------------------------

const RECONCILE_MAX_ATTEMPTS = 4;
const RECONCILE_DELAY_MS = 3000; // ~3s apart -> last attempt at ~9s elapsed, per TR 30.2

interface ReconcileAttempt {
  attempt: number;
  elapsedMs: number;
  foundKey: string | null;
}

/** Complete-marker-string label search (JQL `labels = "<marker>"`), retried
 * a few times over ~10s - Jira search can lag behind a create (TR 30.2). */
async function reconcileByLabel(config: JiraConfig, marker: string): Promise<ReconcileAttempt[]> {
  const attempts: ReconcileAttempt[] = [];
  const start = Date.now();
  for (let attempt = 1; attempt <= RECONCILE_MAX_ATTEMPTS; attempt++) {
    const elapsedMs = Date.now() - start;
    const jql = `project = "${config.projectKey}" AND labels = "${marker}"`;
    let foundKey: string | null = null;
    try {
      const result = await searchJql(config, jql);
      foundKey = result.issues[0]?.key ?? null;
    } catch (err) {
      console.error(`[spike] reconcile (label) attempt ${attempt}: search request failed:`, err);
    }
    attempts.push({ attempt, elapsedMs, foundKey });
    console.log(
      `[spike] reconcile (label) attempt ${attempt}/${RECONCILE_MAX_ATTEMPTS} @ +${elapsedMs}ms: ` +
        (foundKey ? `FOUND ${foundKey}` : 'not found yet'),
    );
    if (foundKey) return attempts;
    if (attempt < RECONCILE_MAX_ATTEMPTS) await sleep(RECONCILE_DELAY_MS);
  }
  return attempts;
}

/** Independent backup path: complete-marker-string full-text search over the
 * description footer (JQL `text ~ "<marker>"`). One-shot, run after the
 * label loop above so the index has had at least as much time to catch up. */
async function checkByDescriptionText(config: JiraConfig, marker: string): Promise<string | null> {
  const jql = `project = "${config.projectKey}" AND text ~ "${marker}"`;
  try {
    const result = await searchJql(config, jql);
    return result.issues[0]?.key ?? null;
  } catch (err) {
    console.error('[spike] reconcile (description text): search request failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. main()
// ---------------------------------------------------------------------------

async function main() {
  // Single combined guard condition (rather than checking `missing.length`
  // from four separate pushes) so TypeScript's control-flow narrowing can
  // see, past this point, that all four vars are defined strings - matching
  // Spike A's `!env.OPENAI_API_KEY || !env.OPENAI_MODEL` guard shape.
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN || !env.JIRA_PROJECT_KEY) {
    const missing: string[] = [];
    if (!env.JIRA_BASE_URL) missing.push('JIRA_BASE_URL');
    if (!env.JIRA_EMAIL) missing.push('JIRA_EMAIL');
    if (!env.JIRA_API_TOKEN) missing.push('JIRA_API_TOKEN');
    if (!env.JIRA_PROJECT_KEY) missing.push('JIRA_PROJECT_KEY');
    console.error(
      '[spike] Jira credentials are not fully configured in .env.local - stopping before making ' +
        'any live Jira API call (no issue will be created).',
    );
    console.error('[spike] missing:', missing.join(', '));
    console.error(
      "[spike] This is the expected state in this worktree right now (see this script's header " +
        'comment) - the marker mechanism itself was already validated live, separately, against ' +
        'project SCRUM issue SCRUM-75. This run only proves the guard stops cleanly rather than ' +
        'faking a result.',
    );
    process.exit(1);
  }

  const config: JiraConfig = {
    baseUrl: env.JIRA_BASE_URL,
    email: env.JIRA_EMAIL,
    apiToken: env.JIRA_API_TOKEN,
    projectKey: env.JIRA_PROJECT_KEY,
  };

  // --- Step 1: marker (stand-in for a real item_version_id - see header) --
  const marker = `tl-${randomUUID()}`;
  console.log(`[spike] generated marker (stand-in for a real item_version_id): ${marker}`);

  // --- Step 2: create the real issue ---------------------------------------
  let sideChannelKey: string;
  try {
    console.log(
      `\n[spike] -> creating issue in project ${config.projectKey} with label "${marker}" ...`,
    );
    const created = await createSpikeIssue(config, marker);
    // Side-channel ONLY: used exclusively for this script's own final
    // self-verification/report below, NEVER as an input to reconcile (see
    // header - "simulate the ambiguous/lost response").
    sideChannelKey = created.key;
    console.log(
      `[spike] <- create request returned (side-channel only, NOT passed to reconcile below): ` +
        `${sideChannelKey}`,
    );
  } catch (err) {
    console.error('\n[spike] RESULT: issue creation failed - cannot proceed.', err);
    process.exit(1);
  }

  // --- Step 3: simulate the ambiguous/lost response ------------------------
  console.log(
    '\n[spike] Simulating an ambiguous/lost create response: from here on, the create outcome ' +
      'is treated as UNKNOWN. Reconciliation below uses ONLY the marker - the key above is not ' +
      'read again until the final self-verification step.\n',
  );

  // --- Step 4: reconcile - label search (bounded re-query) + text search ---
  const labelAttempts = await reconcileByLabel(config, marker);
  const labelFoundKey = labelAttempts.at(-1)?.foundKey ?? null;

  console.log('\n[spike] -> independently checking the description-footer backup path ...');
  const textFoundKey = await checkByDescriptionText(config, marker);
  console.log(
    `[spike] <- description-text search: ${textFoundKey ? `FOUND ${textFoundKey}` : 'not found'}`,
  );

  // --- Step 5: confirm no duplicate risk ------------------------------------
  const labelMatchesCreated = labelFoundKey !== null && labelFoundKey === sideChannelKey;
  const textMatchesCreated = textFoundKey !== null && textFoundKey === sideChannelKey;
  const pathsAgree = labelFoundKey !== null && labelFoundKey === textFoundKey;

  // --- Step 6: PASS/FAIL summary -------------------------------------------
  const pass = labelMatchesCreated && textMatchesCreated && pathsAgree;

  console.log('\n================= E4-T2 SPIKE C (JIRA) RESULT =================');
  console.log(`Marker:                          ${marker}`);
  console.log(`Created issue (side-channel):     ${sideChannelKey}`);
  console.log(
    `Label reconcile:                  ${labelFoundKey ? `FOUND ${labelFoundKey} after ${labelAttempts.length} attempt(s)` : `NOT FOUND after ${labelAttempts.length} attempt(s)`}`,
  );
  console.log(
    `Description-text reconcile:       ${textFoundKey ? `FOUND ${textFoundKey}` : 'NOT FOUND'}`,
  );
  console.log(`Label result == created key:      ${labelMatchesCreated}`);
  console.log(`Text result == created key:       ${textMatchesCreated}`);
  console.log(`Label path and text path agree:   ${pathsAgree}`);
  console.log(`\nNo-duplicate-risk proven:         ${pass}`);
  console.log('=================================================================\n');

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[spike] unhandled error:', err);
  process.exit(1);
});
