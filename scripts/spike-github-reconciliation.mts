// SCRUM-49 / Jira Plan E4-T1 - Spike C (GitHub half only): create, simulate
// lost response, reconcile via marker (TR section 42, "Spike C - GitHub +
// Jira Retry/Reconciliation" - this spike covers the GitHub half; the Jira
// half is a separate later spike, E4-T2, not this story).
//
// Proves, against the REAL hosted DATABASE_URL and the REAL
// `runOperation` (src/external/operations/index.ts, already merged,
// SCRUM-48/E4-S1):
//
//   create -> simulate ambiguous/lost response -> query deterministic repo
//   -> reconcile
//
// exactly as ERD 7.3 specifies for GitHub:
//   - operation_key = `github:create_repo:<project_id>:<normalized_repo_name>`
//   - an ownership marker written atomically at creation: the repo
//     description carries HMAC-SHA256(server_secret, operation_key),
//     truncated
//   - reconcile: GET owner/repo; adopt only if it exists AND the marker
//     matches; an existing repo WITHOUT our marker must never be adopted
//
// Explicit non-goals (this is a Task/spike, not the module it precedes -
// E4-S2 builds the real src/external/github):
//   - Does NOT modify src/external/operations/index.ts. Calls the real,
//     already-merged `runOperation` exactly as any real provider module
//     would - this script is a stand-in for the provider module E4-S2
//     builds, not a change to the shared protocol.
//   - Does NOT build src/external/github for real (still `export {}`).
//   - A real-vs-mock toggle lives at the top of main(): `realMode =
//     Boolean(env.GITHUB_TOKEN && env.GITHUB_OWNER)`. Today both stay
//     empty in .env.local, so every run still executes the ORIGINAL mock
//     path unchanged - a real `Octokit` instance constructed with a custom
//     `request.fetch` pointing at an in-process fake GitHub (a `Map` keyed
//     by `owner/repo`), so octokit's real request-building /
//     response-parsing / error-throwing code (@octokit/request,
//     @octokit/request-error) still executes - only the actual network
//     call is replaced. No nock/msw dependency added. Once
//     GITHUB_TOKEN/GITHUB_OWNER are filled in (see "Switching to real
//     mode" below), the SAME script flips to real mode with no further
//     code changes - real Octokit, real (unmodified) fetch, real repos
//     created under the real account, best-effort deleted at cleanup. The
//     real-mode path could not be exercised while writing it - there were
//     no credentials available to test it with - only the mock path above
//     is actually verified by a run.
//   - The marker secret is `env.GITHUB_MARKER_SECRET` if set, else still
//     generated fresh with `crypto.randomBytes` for THIS RUN ONLY and
//     thrown away. A fresh ephemeral secret is fine even in real mode -
//     the marker only needs to be internally consistent within this one
//     run, not match a previously-provisioned production secret. E4-S2
//     will still need to decide on a real, persistent GITHUB_MARKER_SECRET
//     (env.ts already has the optional field) before src/external/github
//     ships against the real API for good - this spike's fallback is not
//     that decision.
//   - docs/architecture/lineage.json's "durable second marker" (ERD 7.3) is
//     not exercised here - out of scope for proving the description-marker
//     + reconcile-adopt mechanism this spike targets.
//   - The 90_000ms `RECONCILIATION_THRESHOLD_MS` hardcoded for `github` in
//     src/external/operations/index.ts is NOT validated by this run as a
//     real-network-derived number - see the final report block. Real API
//     calls were explicitly declined, so no real GitHub HTTP timeout was
//     ever measured; this script only proves the protocol logic around
//     whatever threshold is configured, waiting 91s (> 90s) so the
//     hardcoded threshold is exercised as a black box.
//
// Why `.mts`, not `.ts` (a deliberate, verified deviation from a literal
// `.ts` filename): this project's package.json has no `"type": "module"`,
// so plain `.ts` files run under tsx's CommonJS-interop mode. The `octokit`
// package (v5) is pure ESM and its single entry point unconditionally
// re-exports `App`/`OAuthApp`, which pulls in `@octokit/oauth-app` ->
// `@octokit/auth-unauthenticated` - a pure-ESM package with no `require`
// exports condition. Under tsx's CJS-interop `.ts` mode this crashes with
// `ERR_PACKAGE_PATH_NOT_EXPORTED` (confirmed empirically before writing
// this file) - real Node.js/pnpm package-exports mechanics, not a bug in
// the code below (`Octokit`/`RequestError` are never even the exports that
// fail to resolve). `.mts` forces tsx/Node to load this file as real ESM,
// which resolves the SAME packages fine via their `import`/`node`
// conditions. tsconfig.json's `include` already lists `**/*.mts`, so this
// extension is already a recognized, compiled file type in this project.
// No other file in this story is affected.
//
// Switching to real mode later (no code changes needed - just fill these in
// and re-run the exact same command below):
//   1. Exactly three .env.local vars:
//        GITHUB_TOKEN=<a GitHub personal access token>
//        GITHUB_OWNER=<your own GitHub username>
//        GITHUB_MARKER_SECRET=<optional - leave empty, see above>
//   2. Token scope: needs `repo` (create/read the private repos this
//      script creates) AND `delete_repo` (this script's own cleanup at the
//      end deletes what it created). A plain `gh auth token` from an
//      already-authenticated local `gh` CLI typically does NOT carry
//      `delete_repo` (confirmed on this machine: scopes are
//      admin:public_key, gist, read:org, repo, workflow - no delete_repo).
//      Using such a token as-is will create real repos successfully but
//      FAIL to delete them at cleanup - this script logs the exact repo
//      URL when a delete fails so it can be removed by hand.
//   3. GITHUB_OWNER must be the token's OWN account (a personal account,
//      not an org) - real mode calls
//      `octokit.rest.repos.createForAuthenticatedUser`, the same call
//      mock mode uses. Org-owned repos are a future enhancement, not
//      built here.
//
// Run:
//   pnpm dotenv -e .env.local -- tsx scripts/spike-github-reconciliation.mts
//
// Do not add a package.json script for this and do not wire it into
// vitest (same convention as scripts/spike-structured-output.ts). This run
// takes ~3 minutes wall-clock (two real 91-second waits) but costs nothing
// external - everything network-shaped is mocked/local.

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Octokit, RequestError } from 'octokit';
import { db, schema } from '../src/db';
import { env } from '../src/lib/env';
import { runOperation } from '../src/external/operations';

// ---------------------------------------------------------------------------
// 1. Constants.
// ---------------------------------------------------------------------------

// ERD 7.3: "the repository description carries a short token
// HMAC-SHA256(server_secret, operation_key), truncated." The truncation
// length itself isn't pinned down by ERD/TR - 16 hex chars (64 bits) is a
// spike-local choice; E4-S2 picks the real length.
const MARKER_PREFIX = 'thrln-marker:';
const MARKER_TOKEN_HEX_LENGTH = 16;

// The hardcoded threshold for github in src/external/operations/index.ts is
// 90_000ms - wait longer than that so `decideExisting`'s
// `ageMs < thresholdMs` check really flips from `in_flight` to `reconcile`.
const RECONCILIATION_THRESHOLD_MS = 90_000;
const RECONCILE_WAIT_MS = 91_000;

// Spike-local stand-in for GITHUB_OWNER, used only in mock mode (i.e. only
// when env.GITHUB_OWNER is unset, as it is today). Real mode uses
// env.GITHUB_OWNER itself instead - see `owner` in main().
const FAKE_OWNER = 'thrln-spike-owner';

// ---------------------------------------------------------------------------
// 2. Marker + repo-name helpers (ERD 7.3).
// ---------------------------------------------------------------------------

function computeMarker(serverSecret: string, operationKey: string): string {
  return createHmac('sha256', serverSecret)
    .update(operationKey, 'utf8')
    .digest('hex')
    .slice(0, MARKER_TOKEN_HEX_LENGTH);
}

function normalizeRepoName(raw: string): string {
  return raw
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 3. Fake GitHub: an in-memory `Map<owner/repo, repo>` plus a fetch
//    implementation that only fakes the network call - real octokit
//    request-building / response-parsing / error-throwing still runs on top
//    of it (see header comment, non-goals).
// ---------------------------------------------------------------------------

interface FakeRepo {
  id: number;
  name: string;
  fullName: string;
  description: string;
  htmlUrl: string;
}

function createFakeGitHub() {
  const repos = new Map<string, FakeRepo>();
  let nextId = 9000;

  function repoKey(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  function toApiShape(repo: FakeRepo) {
    return {
      id: repo.id,
      name: repo.name,
      full_name: repo.fullName,
      description: repo.description,
      html_url: repo.htmlUrl,
      private: true,
      owner: { login: FAKE_OWNER },
    };
  }

  function jsonResponse(status: number, data: unknown): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  /** Pre-seeds a repo our own runOperation calls never created - scenario
   * 2's "a foreign, unrelated operation already owns this name" case. */
  function seedForeignRepo(repoName: string, description: string): void {
    const fullName = repoKey(FAKE_OWNER, repoName);
    repos.set(fullName, {
      id: nextId++,
      name: repoName,
      fullName,
      description,
      htmlUrl: `https://github.com/${fullName}`,
    });
  }

  async function fakeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(url);

    if (method === 'POST' && pathname === '/user/repos') {
      const parsedBody = init?.body
        ? (JSON.parse(String(init.body)) as { name: string; description?: string })
        : { name: '' };
      const fullName = repoKey(FAKE_OWNER, parsedBody.name);
      const alreadyExisted = repos.has(fullName);

      if (!alreadyExisted) {
        repos.set(fullName, {
          id: nextId++,
          name: parsedBody.name,
          fullName,
          description: parsedBody.description ?? '',
          htmlUrl: `https://github.com/${fullName}`,
        });
      }

      if (alreadyExisted) {
        return jsonResponse(422, {
          message: 'Repository creation failed.',
          errors: [
            {
              resource: 'Repository',
              code: 'custom',
              field: 'name',
              message: 'name already exists on this account',
            },
          ],
        });
      }

      const created = repos.get(fullName);
      if (!created) throw new Error('fake GitHub: repo vanished immediately after being set');
      return jsonResponse(201, toApiShape(created));
    }

    const getMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && getMatch) {
      const owner = getMatch[1];
      const repo = getMatch[2];
      if (owner && repo) {
        const found = repos.get(repoKey(owner, repo));
        if (!found) {
          return jsonResponse(404, {
            message: 'Not Found',
            documentation_url: 'https://docs.github.com/rest',
          });
        }
        return jsonResponse(200, toApiShape(found));
      }
    }

    throw new Error(`fake GitHub fetch: unhandled ${method} ${pathname}`);
  }

  return { fetch: fakeFetch, seedForeignRepo };
}

// ---------------------------------------------------------------------------
// 3b. Response dropper: a thin wrapper, shared by mock and real mode, that
//    implements "simulate a lost response" (ERD 7.2) on top of WHICHEVER
//    fetch is in play - the in-process fake above in mock mode, or the real
//    global `fetch` in real mode. Either way, the underlying call is always
//    allowed to run to completion first - its real side effect genuinely
//    happens (a fake repo recorded in the Map, or a real repo created on
//    GitHub) - only the CALLER's view of that response is then dropped, by
//    throwing instead of returning, simulating a genuinely ambiguous network
//    fault. This is the one place mock and real mode share logic; nothing
//    else about the fake-GitHub Map/fetch above was restructured for this.
// ---------------------------------------------------------------------------

type FetchFn = (url: string | URL, init?: RequestInit) => Promise<Response>;

function createResponseDropper(underlyingFetch: FetchFn) {
  const dropNextResponseFor = new Set<string>();

  /** Marks the NEXT create call for this repo name as "response lost". */
  function simulateLostResponseFor(repoName: string): void {
    dropNextResponseFor.add(repoName);
  }

  async function fetchWithDrop(url: string | URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(url);

    let dropKey: string | undefined;
    if (method === 'POST' && pathname === '/user/repos' && init?.body) {
      const parsedBody = JSON.parse(String(init.body)) as { name?: string };
      if (parsedBody.name && dropNextResponseFor.has(parsedBody.name)) {
        dropKey = parsedBody.name;
      }
    }

    // Let the call underneath (fake or real) run to completion regardless -
    // its side effect (creation, or a 422 because the name was already
    // taken) really happens either way.
    const response = await underlyingFetch(url, init);

    if (dropKey) {
      dropNextResponseFor.delete(dropKey);
      throw new TypeError(
        'spike-simulated network fault: response lost before the client could observe it',
      );
    }
    return response;
  }

  return { fetch: fetchWithDrop, simulateLostResponseFor };
}

// ---------------------------------------------------------------------------
// 4. Persistence helpers: minimal project -> artifact -> artifact_version
//    chain (FK target for runOperation's sourceArtifactVersionId), plus
//    independent SELECTs and FK-safe cleanup.
// ---------------------------------------------------------------------------

interface Chain {
  projectId: string;
  artifactId: string;
  artifactVersionId: string;
  externalOperationId?: string;
  externalRefId?: string;
}

async function createChain(ownerUserId: string, projectName: string): Promise<Chain> {
  const [project] = await db
    .insert(schema.project)
    .values({
      ownerUserId,
      name: projectName,
      brief: 'E4-T1 spike C (GitHub) - throwaway project, deleted at the end of this script.',
    })
    .returning();
  if (!project) throw new Error('project insert returned no row');

  const [artifact] = await db
    .insert(schema.artifact)
    .values({ projectId: project.id, type: 'architecture' })
    .returning();
  if (!artifact) throw new Error('artifact insert returned no row');

  const [artifactVersion] = await db
    .insert(schema.artifactVersion)
    .values({ artifactId: artifact.id, versionNumber: 1, status: 'draft', schemaVersion: 1 })
    .returning();
  if (!artifactVersion) throw new Error('artifact_version insert returned no row');

  return { projectId: project.id, artifactId: artifact.id, artifactVersionId: artifactVersion.id };
}

async function selectOperation(operationKey: string) {
  const [row] = await db
    .select()
    .from(schema.externalOperation)
    .where(eq(schema.externalOperation.operationKey, operationKey));
  return row ?? null;
}

async function selectRefByOperationId(externalOperationId: string) {
  const [row] = await db
    .select()
    .from(schema.externalRef)
    .where(eq(schema.externalRef.externalOperationId, externalOperationId));
  return row ?? null;
}

/** Deletes a chain's rows in FK-safe order. Unlike Spike A's item_version
 * (append-only by trigger - ERD Appendix A.2 T1), none of
 * project/artifact/artifact_version/external_operation/external_ref carry a
 * DELETE-blocking trigger (confirmed by reading drizzle/migrations/
 * 0004_triggers.sql before writing this script) - a real DELETE-based
 * cleanup is possible here, so this script does one instead of a rollback. */
async function cleanupChain(label: string, chain: Chain): Promise<void> {
  try {
    if (chain.externalRefId) {
      await db.delete(schema.externalRef).where(eq(schema.externalRef.id, chain.externalRefId));
    }
    if (chain.externalOperationId) {
      await db
        .delete(schema.externalOperation)
        .where(eq(schema.externalOperation.id, chain.externalOperationId));
    }
    await db
      .delete(schema.artifactVersion)
      .where(eq(schema.artifactVersion.id, chain.artifactVersionId));
    await db.delete(schema.artifact).where(eq(schema.artifact.id, chain.artifactId));
    await db.delete(schema.project).where(eq(schema.project.id, chain.projectId));
    console.log(`[spike] cleanup (${label}): all rows deleted - nothing permanent left behind.`);
  } catch (err) {
    console.error(
      `[spike] cleanup (${label}) FAILED - rows may remain in the hosted dev DB. Manual cleanup ` +
        `needed for chain: ${JSON.stringify(chain)}`,
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. main()
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    "[spike] E4-T1 Spike C (GitHub) starting - see this file's header for what this proves and " +
      'what it explicitly does NOT do.',
  );

  // Real-vs-mock toggle: auto-detected at runtime, no flag/arg needed. Both
  // stay empty in .env.local today, so `realMode` is false and every run
  // below still takes the original, fully-verified mock path. See the
  // header comment's "Switching to real mode" section for what filling
  // these in later requires.
  const realMode = Boolean(env.GITHUB_TOKEN && env.GITHUB_OWNER);

  if (realMode) {
    console.log(
      '\n' +
        '#'.repeat(72) +
        '\n# REAL MODE: GITHUB_TOKEN and GITHUB_OWNER are both set in .env.local.\n' +
        `# This run will create (and attempt to delete) REAL repositories under\n` +
        `# the REAL GitHub account "${env.GITHUB_OWNER}".\n` +
        '# Deleting a repo requires the delete_repo OAuth scope, which a plain\n' +
        '# `gh auth token` typically does NOT have. If cleanup fails for a given\n' +
        '# repo, its URL is logged below so it can be deleted by hand - a failed\n' +
        '# cleanup never crashes the rest of this script.\n' +
        '#'.repeat(72) +
        '\n',
    );
  } else {
    console.log(
      '[spike] mock mode (GITHUB_TOKEN/GITHUB_OWNER not both set in .env.local) - unchanged ' +
        'in-memory fake-GitHub behavior, nothing real is touched.',
    );
  }

  const serverSecret = env.GITHUB_MARKER_SECRET ?? randomBytes(32).toString('hex');
  console.log(
    env.GITHUB_MARKER_SECRET
      ? '[spike] Using GITHUB_MARKER_SECRET from .env.local for the marker HMAC.'
      : `[spike] GITHUB_MARKER_SECRET is not set - generated an EPHEMERAL local marker secret for ` +
          `THIS RUN ONLY (prefix ${serverSecret.slice(0, 8)}...). A fresh ephemeral secret is fine ` +
          'here even in real mode: the marker only needs to be internally consistent within this ' +
          'one run, not match a previously-provisioned production secret. E4-S2 will still need a ' +
          'real, persistent GITHUB_MARKER_SECRET provisioned before src/external/github ships ' +
          'against the real API for good.',
  );

  // Owner: FAKE_OWNER in mock mode, env.GITHUB_OWNER (assumed to be the
  // token's own personal account - see header comment) in real mode.
  const owner = realMode ? (env.GITHUB_OWNER as string) : FAKE_OWNER;

  // `fakeGitHub` only exists in mock mode; its presence is what every branch
  // below checks (rather than re-checking `realMode`) to pick the mock vs.
  // real path for anything that needs the in-memory Map.
  const fakeGitHub = realMode ? null : createFakeGitHub();
  const dropper = createResponseDropper(fakeGitHub ? fakeGitHub.fetch : fetch);

  const octokit = new Octokit({
    // Real mode: real auth token. Mock mode: no auth needed - the fake
    // fetch below doesn't check headers.
    auth: realMode ? env.GITHUB_TOKEN : undefined,
    // `dropper.fetch` is a thin pass-through wrapper (section 3b) around
    // whichever fetch is in play - the in-process fake in mock mode, or
    // the real global `fetch` in real mode. It never fakes the network
    // itself in real mode; it only implements "simulate a lost response"
    // on top of real network calls that actually complete.
    request: { fetch: dropper.fetch },
    // Disables @octokit/plugin-retry's automatic backoff-and-retry on 5xx-
    // shaped errors so each scenario's single simulated network fault
    // propagates immediately and cleanly, instead of being silently retried
    // (with real delay) by octokit itself before we ever see it.
    retry: { enabled: false },
  });

  // Short per-run suffix so repo names can't collide with a repo left over
  // from a previous real-mode run whose cleanup failed. Mock mode doesn't
  // need this (fresh in-memory store every run) but applying it there too
  // keeps naming identical between the two modes.
  const runSuffix = Date.now().toString(36);

  // Real-mode-only: names of every repo this run may have created for
  // real, so cleanup (end of main()) knows what to attempt to delete. Mock
  // mode never populates this.
  const realRepoNamesToCleanup: string[] = [];

  const [ownerUser] = await db.select().from(schema.appUser).limit(1);
  if (!ownerUser) {
    console.error('[spike] No app_user row exists to use as project.owner_user_id - stopping.');
    process.exit(1);
  }

  // Two independent chains - see header comment for why scenario 2 needs
  // its own project (ERD 4.15 GitHub-exclusivity).
  const chain1 = await createChain(
    ownerUser.id,
    'E4-T1 spike C - scenario 1 (lost response, then adopt)',
  );
  const chain2 = await createChain(
    ownerUser.id,
    'E4-T1 spike C - scenario 2 (foreign repo blocks adoption)',
  );

  let scenario1Outcome: 'adopted' | 'failed' = 'failed';
  let scenario2GapConfirmed = false;
  let scenario1Error: unknown;
  let scenario2Error: unknown;

  const INTERFACE_GAP_FINDING =
    'Interface gap in src/external/operations/index.ts: ReconcileResult only has two variants, ' +
    '{found:true,...} and {found:false}. There is no way for a reconcile() closure to report ' +
    "'I found an object at the deterministic target, but it is definitively not mine' (GitHub's " +
    "marker mismatch, ERD 7.3's name_taken_by_other). {found:false} is the only type-correct " +
    'return for that case today, so reconcileAndFinalize() treats a definitively-foreign object ' +
    "exactly like 'not found yet' and returns {status:'reconciliation_required'} - the operation " +
    'stays retryable forever, with no way for a caller to observe the definitive failure or ' +
    'prompt the user to pick a new repo name. E4-S2 (the real github module) will need a third ' +
    "ReconcileResult variant - e.g. {found:'foreign'} or {found:true, ours:false} - that " +
    "reconcileAndFinalize() maps to {status:'failed', errorMessage:'name_taken_by_other'}, " +
    "distinct from {found:false}'s 'keep retrying' semantics. This is a protocol-type change to " +
    'src/external/operations/index.ts and is out of scope for this Task (E4-T1) - it is only ' +
    "demonstrated here using the closest fit available in today's types, not patched.";

  // ================= Scenario 1: lost response, then adopt =================
  try {
    console.log('\n[spike] ===== Scenario 1: lost response, then reconcile-and-adopt =====');

    const repoName1 = `${normalizeRepoName('E4-T1 Spike Repo Scenario 1')}-${runSuffix}`;
    if (realMode) realRepoNamesToCleanup.push(repoName1);
    const operationKey1 = `github:create_repo:${chain1.projectId}:${repoName1}`;
    const marker1 = computeMarker(serverSecret, operationKey1);
    const requestHash1 = createHash('sha256')
      .update(JSON.stringify({ name: repoName1, private: true }))
      .digest('hex');

    const send1 = async (): Promise<{
      externalId: string;
      externalKey: string;
      externalUrl: string;
    }> => {
      console.log(
        `[spike] scenario 1 send(): creating "${repoName1}" (description carries our marker), ` +
          'then simulating the response being lost ...',
      );
      dropper.simulateLostResponseFor(repoName1);
      await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName1,
        description: `${MARKER_PREFIX}${marker1}`,
        private: true,
      });
      throw new Error('unreachable: fetch should have thrown before this point');
    };

    const reconcile1 = async (): Promise<
      | { found: true; externalId: string; externalKey: string; externalUrl: string }
      | { found: false }
    > => {
      console.log(
        '[spike] scenario 1 reconcile(): GET the deterministic repo, check the marker ...',
      );
      let response;
      try {
        response = await octokit.rest.repos.get({ owner, repo: repoName1 });
      } catch (err) {
        if (err instanceof RequestError && err.status === 404) {
          console.log('[spike] scenario 1 reconcile(): not found yet - {found:false}.');
          return { found: false };
        }
        throw err;
      }
      const description = String(response.data.description ?? '');
      const expected = `${MARKER_PREFIX}${marker1}`;
      if (description === expected) {
        console.log('[spike] scenario 1 reconcile(): marker MATCHES - adopting our own repo.');
        return {
          found: true,
          externalId: String(response.data.id),
          externalKey: response.data.full_name,
          externalUrl: response.data.html_url,
        };
      }
      console.log('[spike] scenario 1 reconcile(): marker MISMATCH (unexpected in this scenario).');
      return { found: false };
    };

    const sendShouldNotBeCalled = async (): Promise<never> => {
      throw new Error('assertion: send() must not be called on this runOperation call');
    };
    const reconcileShouldNotBeCalled = async (): Promise<{ found: false }> => {
      throw new Error('assertion: reconcile() must not be called on this runOperation call');
    };

    console.log(
      '[spike] scenario 1, call #1: runOperation() with a fresh operation_key - send() will throw.',
    );
    let call1Threw = false;
    try {
      await runOperation({
        projectId: chain1.projectId,
        provider: 'github',
        operationType: 'create_repo',
        operationKey: operationKey1,
        requestHash: requestHash1,
        targetDescriptor: { repoName: repoName1, marker: marker1 },
        sourceArtifactVersionId: chain1.artifactVersionId,
        send: send1,
        reconcile: reconcileShouldNotBeCalled,
      });
    } catch (err) {
      call1Threw = true;
      console.log(
        `[spike] scenario 1, call #1: runOperation() threw as expected (lost response propagated ` +
          `unchanged): ${(err as Error).message}`,
      );
    }
    if (!call1Threw) {
      throw new Error(
        'scenario 1 assertion failed: call #1 was expected to throw (lost response) but did not',
      );
    }

    const opRow1AfterCall1 = await selectOperation(operationKey1);
    if (!opRow1AfterCall1 || opRow1AfterCall1.status !== 'pending') {
      throw new Error(
        `scenario 1 assertion failed: expected external_operation.status='pending' after the lost ` +
          `response, got ${JSON.stringify(opRow1AfterCall1)}`,
      );
    }
    chain1.externalOperationId = opRow1AfterCall1.id;
    console.log(
      `[spike] scenario 1: independent SELECT confirms external_operation ${opRow1AfterCall1.id} ` +
        "is still 'pending' after the lost response - runOperation left it exactly as-is (R6/R9).",
    );

    console.log(
      `[spike] scenario 1: waiting ${RECONCILE_WAIT_MS}ms (> the hardcoded ` +
        `${RECONCILIATION_THRESHOLD_MS}ms RECONCILIATION_THRESHOLD_MS for github) before retrying ...`,
    );
    await sleep(RECONCILE_WAIT_MS);

    console.log(
      '[spike] scenario 1, call #2: runOperation() with the SAME operation_key/request_hash - ' +
        'reconcile() runs this time.',
    );
    const result1 = await runOperation({
      projectId: chain1.projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: operationKey1,
      requestHash: requestHash1,
      targetDescriptor: { repoName: repoName1, marker: marker1 },
      sourceArtifactVersionId: chain1.artifactVersionId,
      send: sendShouldNotBeCalled,
      reconcile: reconcile1,
    });
    console.log('[spike] scenario 1, call #2 result:', result1);
    if (result1.status !== 'completed') {
      throw new Error(
        `scenario 1 assertion failed: expected {status:'completed'}, got ${JSON.stringify(result1)}`,
      );
    }

    const persistedRef1 = await selectRefByOperationId(opRow1AfterCall1.id);
    if (!persistedRef1 || persistedRef1.externalId !== result1.ref.externalId) {
      throw new Error(
        'scenario 1 assertion failed: independent SELECT of external_ref did not match ' +
          "runOperation's returned ref",
      );
    }
    chain1.externalRefId = persistedRef1.id;
    console.log(
      `[spike] scenario 1: independent SELECT confirms external_ref ${persistedRef1.id} really ` +
        `persisted (external_id=${persistedRef1.externalId}, external_key=${persistedRef1.externalKey}).`,
    );

    scenario1Outcome = 'adopted';
  } catch (err) {
    scenario1Error = err;
    console.error('[spike] scenario 1 FAILED:', err);
  }

  // ================= Scenario 2: foreign repo blocks adoption =================
  try {
    console.log('\n[spike] ===== Scenario 2: foreign repo blocks adoption =====');

    const repoName2 = `${normalizeRepoName('E4-T1 Spike Repo Scenario 2 Collision')}-${runSuffix}`;
    if (realMode) realRepoNamesToCleanup.push(repoName2);
    const operationKey2 = `github:create_repo:${chain2.projectId}:${repoName2}`;
    const marker2 = computeMarker(serverSecret, operationKey2);
    const requestHash2 = createHash('sha256')
      .update(JSON.stringify({ name: repoName2, private: true }))
      .digest('hex');

    // Pre-seed a repo at the SAME deterministic name, with a marker computed
    // from a DIFFERENT (unrelated) operation_key - "something else already
    // owns this name", per the scenario's brief.
    const foreignOperationKey = `github:create_repo:${randomUUID()}:${repoName2}`;
    const foreignMarker = computeMarker(serverSecret, foreignOperationKey);
    if (fakeGitHub) {
      fakeGitHub.seedForeignRepo(repoName2, `${MARKER_PREFIX}${foreignMarker}`);
      console.log(
        `[spike] scenario 2: pre-seeded a foreign repo "${repoName2}" with a marker from an ` +
          'unrelated operation_key (simulating a name already taken by something else).',
      );
    } else {
      // Real mode: there's no Map to pre-seed - actually create a second,
      // real, separate repo first (a normal, non-lost real create call,
      // using this unrelated foreignMarker), so a genuinely pre-existing
      // foreign repo exists at this name before this scenario's own
      // create-with-lost-response and later reconcile run.
      console.log(
        `[spike] scenario 2 (real mode): creating a REAL foreign repo "${repoName2}" first (normal, ` +
          'non-lost create call, unrelated operation_key marker) ...',
      );
      const foreignCreateResponse = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName2,
        description: `${MARKER_PREFIX}${foreignMarker}`,
        private: true,
      });
      console.log(
        `[spike] scenario 2 (real mode): real foreign repo created: ${foreignCreateResponse.data.html_url}`,
      );
    }

    const send2 = async (): Promise<{
      externalId: string;
      externalKey: string;
      externalUrl: string;
    }> => {
      console.log(
        `[spike] scenario 2 send(): attempting to create "${repoName2}" (already foreign-owned), ` +
          'then simulating the response being lost ...',
      );
      dropper.simulateLostResponseFor(repoName2);
      await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName2,
        description: `${MARKER_PREFIX}${marker2}`,
        private: true,
      });
      throw new Error('unreachable: fetch should have thrown before this point');
    };

    // The interesting negative case: reconcile() finds a repo, but it is
    // definitively NOT ours. ERD 7.3 requires this to end `failed`
    // (name_taken_by_other) - a definitive outcome, never an adoption. As
    // the header comment and INTERFACE_GAP_FINDING explain, today's
    // ReconcileResult type has no slot for "found, but definitely foreign" -
    // {found:false} is the closest type-correct fit, so that's what this
    // returns; runOperation therefore returns `reconciliation_required`, not
    // `failed`. That mismatch IS the finding this scenario exists to surface
    // - it is not patched here (out of scope for this Task).
    const reconcile2 = async (): Promise<
      | { found: true; externalId: string; externalKey: string; externalUrl: string }
      | { found: false }
    > => {
      console.log(
        '[spike] scenario 2 reconcile(): GET the deterministic repo, check the marker ...',
      );
      let response;
      try {
        response = await octokit.rest.repos.get({ owner, repo: repoName2 });
      } catch (err) {
        if (err instanceof RequestError && err.status === 404) {
          return { found: false };
        }
        throw err;
      }
      const description = String(response.data.description ?? '');
      const expected = `${MARKER_PREFIX}${marker2}`;
      if (description === expected) {
        throw new Error(
          'scenario 2 assertion failed: marker unexpectedly matched a foreign repo - must never adopt it',
        );
      }
      console.log(
        '[spike] scenario 2 reconcile(): repo EXISTS at the deterministic name but its marker does ' +
          'NOT match ours - ERD 7.3\'s "name_taken_by_other", a DEFINITIVE outcome that should map ' +
          'to `failed`. ' +
          INTERFACE_GAP_FINDING,
      );
      scenario2GapConfirmed = true;
      return { found: false };
    };

    const sendShouldNotBeCalled = async (): Promise<never> => {
      throw new Error('assertion: send() must not be called on this runOperation call');
    };
    const reconcileShouldNotBeCalled = async (): Promise<{ found: false }> => {
      throw new Error('assertion: reconcile() must not be called on this runOperation call');
    };

    console.log(
      '[spike] scenario 2, call #1: runOperation() with a fresh operation_key - send() will throw.',
    );
    let call1Threw = false;
    try {
      await runOperation({
        projectId: chain2.projectId,
        provider: 'github',
        operationType: 'create_repo',
        operationKey: operationKey2,
        requestHash: requestHash2,
        targetDescriptor: { repoName: repoName2, marker: marker2 },
        sourceArtifactVersionId: chain2.artifactVersionId,
        send: send2,
        reconcile: reconcileShouldNotBeCalled,
      });
    } catch (err) {
      call1Threw = true;
      console.log(
        `[spike] scenario 2, call #1: runOperation() threw as expected (lost response propagated ` +
          `unchanged): ${(err as Error).message}`,
      );
    }
    if (!call1Threw) {
      throw new Error(
        'scenario 2 assertion failed: call #1 was expected to throw (lost response) but did not',
      );
    }

    const opRow2AfterCall1 = await selectOperation(operationKey2);
    if (!opRow2AfterCall1 || opRow2AfterCall1.status !== 'pending') {
      throw new Error(
        `scenario 2 assertion failed: expected external_operation.status='pending' after the lost ` +
          `response, got ${JSON.stringify(opRow2AfterCall1)}`,
      );
    }
    chain2.externalOperationId = opRow2AfterCall1.id;
    console.log(
      `[spike] scenario 2: independent SELECT confirms external_operation ${opRow2AfterCall1.id} ` +
        "is still 'pending' after the lost response.",
    );

    console.log(
      `[spike] scenario 2: waiting ${RECONCILE_WAIT_MS}ms (> the hardcoded ` +
        `${RECONCILIATION_THRESHOLD_MS}ms RECONCILIATION_THRESHOLD_MS for github) before retrying ...`,
    );
    await sleep(RECONCILE_WAIT_MS);

    console.log(
      '[spike] scenario 2, call #2: runOperation() with the SAME operation_key/request_hash - ' +
        'reconcile() runs this time.',
    );
    const result2 = await runOperation({
      projectId: chain2.projectId,
      provider: 'github',
      operationType: 'create_repo',
      operationKey: operationKey2,
      requestHash: requestHash2,
      targetDescriptor: { repoName: repoName2, marker: marker2 },
      sourceArtifactVersionId: chain2.artifactVersionId,
      send: sendShouldNotBeCalled,
      reconcile: reconcile2,
    });
    console.log('[spike] scenario 2, call #2 result:', result2);
    if (result2.status !== 'reconciliation_required') {
      throw new Error(
        `scenario 2 assertion failed: expected {status:'reconciliation_required'} (today's gap - ` +
          `see INTERFACE_GAP_FINDING), got ${JSON.stringify(result2)}`,
      );
    }
    if (!scenario2GapConfirmed) {
      throw new Error('scenario 2 assertion failed: reconcile2() never ran the mismatch branch');
    }

    const opRow2AfterCall2 = await selectOperation(operationKey2);
    if (!opRow2AfterCall2 || opRow2AfterCall2.status !== 'reconciliation_required') {
      throw new Error(
        `scenario 2 assertion failed: expected external_operation.status still ` +
          `'reconciliation_required' (never 'failed') after reconcile, got ` +
          `${JSON.stringify(opRow2AfterCall2)}`,
      );
    }
    const noRef2 = await selectRefByOperationId(opRow2AfterCall1.id);
    if (noRef2) {
      throw new Error(
        'scenario 2 assertion failed: an external_ref was persisted for the foreign-repo case - ' +
          'must never adopt an unrelated repository',
      );
    }
    console.log(
      `[spike] scenario 2: independent SELECT confirms external_operation ` +
        `${opRow2AfterCall2.id} is still 'reconciliation_required' (never 'failed' - the gap), and ` +
        'no external_ref was created (no foreign adoption happened).',
    );
  } catch (err) {
    scenario2Error = err;
    console.error('[spike] scenario 2 FAILED:', err);
  }

  // --- cleanup: delete every row this script created, FK-safe order ---
  await cleanupChain('scenario 1', chain1);
  await cleanupChain('scenario 2', chain2);

  // --- real-mode-only cleanup: delete every real repo this run may have
  // created (scenario 1's, and scenario 2's foreign pre-seed / own attempt -
  // same name, whichever actually landed on GitHub's side). Requires the
  // delete_repo OAuth scope - see header comment. A failed delete is logged
  // loudly with the repo's URL for manual cleanup and must NOT crash the
  // rest of this script or mask the scenario results above.
  if (realMode) {
    for (const repo of realRepoNamesToCleanup) {
      try {
        await octokit.rest.repos.delete({ owner, repo });
        console.log(`[spike] real cleanup: deleted https://github.com/${owner}/${repo}`);
      } catch (err) {
        console.error(
          `[spike] REAL CLEANUP FAILED for https://github.com/${owner}/${repo} - likely missing the ` +
            'delete_repo OAuth scope (a plain `gh auth token` typically lacks it). DELETE THIS REPO ' +
            `MANUALLY: https://github.com/${owner}/${repo}`,
          err,
        );
      }
    }
  }

  // --- report ---
  console.log('\n================= E4-T1 SPIKE C (GitHub) RESULT =================');
  console.log(
    `Scenario 1 (lost response -> reconcile -> adopt): ` +
      `${scenario1Outcome === 'adopted' && !scenario1Error ? 'PASSED end-to-end' : 'FAILED'}` +
      (scenario1Error ? ` - ${String((scenario1Error as Error)?.message ?? scenario1Error)}` : ''),
  );
  console.log(
    `Scenario 2 (foreign repo blocks adoption - gap demonstration): ` +
      `${scenario2GapConfirmed && !scenario2Error ? 'GAP CONFIRMED as expected' : 'FAILED'}` +
      (scenario2Error ? ` - ${String((scenario2Error as Error)?.message ?? scenario2Error)}` : ''),
  );
  console.log(
    '\nMarker mechanism ours-vs-foreign: ' +
      (scenario1Outcome === 'adopted' && scenario2GapConfirmed
        ? 'CORRECTLY distinguished in both directions - scenario 1 matched our own marker and ' +
          'adopted; scenario 2 detected a marker MISMATCH against a foreign repo and did NOT adopt it.'
        : 'inconclusive - see per-scenario results above.'),
  );
  console.log(`\nInterface-gap finding (E4-S2 needs this):\n${INTERFACE_GAP_FINDING}`);
  console.log(
    '\nRECONCILIATION_THRESHOLD_MS (90_000ms, hardcoded in src/external/operations/index.ts for ' +
      'github) is STILL A PROVISIONAL PLACEHOLDER after this run. Real GitHub API calls were ' +
      'explicitly declined for this spike, so no real HTTP timeout was measured - this run only ' +
      'exercised the protocol logic around whatever number is configured (waiting 91s, i.e. > the ' +
      '90s placeholder), it does NOT validate that 90s is the right value for real GitHub traffic.',
  );
  console.log('===================================================================\n');

  const overallOk =
    scenario1Outcome === 'adopted' && !scenario1Error && scenario2GapConfirmed && !scenario2Error;
  process.exit(overallOk ? 0 : 1);
}

main().catch((err) => {
  console.error('[spike] unhandled error:', err);
  process.exit(1);
});
