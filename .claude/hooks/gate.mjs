#!/usr/bin/env node
/**
 * Throughline feature-pipeline gate.
 *
 * The harness runs this, not Claude. It is the enforcement layer behind the
 * Opus (plan) -> Sonnet (code) -> Haiku (test) pipeline described in
 * .claude/commands/feature.md.
 *
 * State lives in .claude/state/feature.json and is written ONLY here, from hook
 * events. Claude cannot forge progress by writing the file itself, because the
 * only subcommand that unlocks editing (`record-jira`) is wired to fire after
 * the Atlassian MCP transition tool actually succeeds.
 *
 * PARTITIONED BY `cwd` (2026-09-24 fix). Hook commands run relative to a fixed
 * project root, not each agent's own pinned worktree directory - confirmed the
 * hard way: four `isolation: "worktree"` agents each ran /feature concurrently,
 * and every one of them was actually executing THIS file from the main
 * checkout the whole time (none of their worktrees ever grew their own
 * .claude/state/). A single global ticket/activeAgents scalar meant any one
 * agent's Jira transition silently re-armed (or stomped) every other agent's
 * gate. The fix does not require isolating the file - it partitions the state
 * object by the calling agent's own `cwd`, which the hook JSON payload reports
 * accurately even though the hook subprocess itself always runs from one
 * place. See docs/... no - see memory: "gate-state-shared-across-worktrees".
 *
 * Subcommands (argv[2]):
 *   precheck        PreToolUse on Edit|Write|Bash - denies out-of-order work
 *   record-jira     PostToolUse on the Atlassian transition tool
 *   subagent-start  SubagentStart - marks an agent active
 *   subagent-stop   SubagentStop  - clears it, records verifier runs
 *   stop-report     Stop - non-blocking report of what is still outstanding
 *
 * There is no jq on this machine, so every payload is parsed here with Node.
 * Every path fails OPEN with a loud systemMessage: a crashing gate that blocked
 * all editing would be worse than a gate that announces it is broken.
 */
import {
  readFileSync,
  readSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOOKS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_DIR = path.resolve(HOOKS_DIR, '..');
const REPO_ROOT = path.resolve(CLAUDE_DIR, '..');
const STATE_DIR = path.join(CLAUDE_DIR, 'state');
const STATE_FILE = path.join(STATE_DIR, 'feature.json');
const HATCH_FILE = path.join(STATE_DIR, 'gate-off');
const PAYLOAD_LOG = path.join(STATE_DIR, 'subagent-payloads.log');

const IMPLEMENTER = 'feature-implementer';
const VERIFIERS = ['feature-verifier', 'test-citation-checker'];

/** Paths the edit gate never touches: docs, agent config, prose, dotfile hygiene. */
const EXEMPT_PATH = [
  /^docs[\\/]/i,
  /^\.claude[\\/]/i,
  /^\.agents[\\/]/i,
  /\.md$/i,
  /^\.gitignore$/i,
];

/** Commands that must run inside a Haiku verifier subagent, not on the main thread. */
const TEST_COMMAND =
  /(^|[\s;&|])(pnpm|npm|npx|yarn)\s+(run\s+)?(test|test:int|test:all|vitest)\b|(^|[\s;&|])vitest\b/;

/** Substrings shaped like an issue key that are not one. */
const NOT_A_KEY = /^(UTF|ISO|SHA|MD|RFC|ES|HTTP|IPV|X|AES|RSA|CVE|WCAG|T)$/i;

const IN_PROGRESS = /in\s*progress|in\s*development|doing/i;
const IN_REVIEW = /review|ready\s*for\s*(qa|test)|testing|verif/i;

/** Fallback partition key when a payload genuinely carries no `cwd` (should not happen in practice). */
const DEFAULT_PARTITION = '(no-cwd)';

const EMPTY_STATE = {
  ticket: null,
  status: null,
  inProgress: false,
  reviewed: false,
  startedAt: null,
  activeAgents: [],
  verifierRan: false,
  verifierRuns: [],
};

/** Which cwd this hook invocation's payload says it was called from - the partition key. */
function partitionKey(p) {
  const cwd = p?.cwd;
  return typeof cwd === 'string' && cwd.trim() ? path.resolve(cwd.trim()) : DEFAULT_PARTITION;
}

function readAll() {
  try {
    if (!existsSync(STATE_FILE)) return {};
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    // Migrate a pre-partition file (flat EMPTY_STATE shape) into the default partition once.
    if (parsed && typeof parsed === 'object' && !parsed.byCwd) {
      return { [DEFAULT_PARTITION]: { ...EMPTY_STATE, ...parsed } };
    }
    return parsed?.byCwd ?? {};
  } catch {
    return {};
  }
}

function readState(key) {
  const all = readAll();
  return { ...EMPTY_STATE, ...(all[key] ?? {}) };
}

/**
 * Read-modify-write of just this partition's slice. Not lock-protected: two
 * hook processes writing at the exact same instant could lose one update.
 * Accepted tradeoff for a short-lived local pipeline, not a distributed
 * system - the next hook event self-corrects. Documented, not hidden.
 */
function writeState(key, state) {
  mkdirSync(STATE_DIR, { recursive: true });
  const all = readAll();
  all[key] = state;
  writeFileSync(STATE_FILE, JSON.stringify({ byCwd: all }, null, 2) + '\n', 'utf8');
}

/**
 * Explicit read-to-EOF loop via `readSync` rather than a single
 * `readFileSync(0, 'utf8')`. Investigated a suspected Windows piped-stdin
 * reliability issue here (2026-09-24) and it turned out to be a red herring -
 * the real cause was malformed JSON from a manual bash test harness (Git
 * Bash's `printf` collapsing `\\` to `\` inside single-quoted Windows paths,
 * producing an invalid `\w` escape) - but this loop is a harmless, slightly
 * more explicit way to drain fd 0, so it stays.
 */
function readStdin() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (err) {
      if (err?.code === 'EAGAIN') break;
      throw err;
    }
    if (!n) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function payload() {
  try {
    return JSON.parse(readStdin() || '{}');
  } catch {
    return {};
  }
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  process.exit(0);
}

/** Let the tool call through without saying anything. */
function allow() {
  process.exit(0);
}

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function hatchOn() {
  return existsSync(HATCH_FILE);
}

/**
 * Repo-relative path an Edit/Write targets, or null if it is outside the repo
 * this file lives in. NOTE: relative to REPO_ROOT (the main checkout), not the
 * calling agent's own worktree - only used for the exemption regexes (docs/
 * .md/etc.), which are path-shape checks, not existence checks, so this is
 * fine even when the real file lives in a different worktree at the same
 * relative path.
 */
function relTarget(input) {
  const raw = input?.file_path || input?.path || input?.notebook_path || '';
  if (!raw) return null;
  const abs = path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
  const rel = path.relative(REPO_ROOT, abs);
  if (rel.startsWith('..')) {
    // Absolute path outside REPO_ROOT - very likely a worktree path
    // (.claude/worktrees/<name>/src/...). Strip down to the part after the
    // worktree name so the exemption regexes still see a normal repo-relative
    // shape instead of bailing out and allowing everything through.
    const m = raw.replace(/\\/g, '/').match(/\.claude\/worktrees\/[^/]+\/(.*)$/);
    return m ? m[1] : null;
  }
  return rel;
}

/**
 * Agent identity on a Subagent event. Confirmed against real payloads: the
 * field is `agent_type` (alongside `agent_id`). The other spellings are kept as
 * a cheap hedge against the payload changing, and the blob scan below as a last
 * resort.
 *
 * `allowBlobScan` defaults on but MUST be false for SubagentStop (confirmed
 * 2026-09-24): a resumed/backgrounded agent can emit an intermediate Stop
 * event with every structured identity field blank mid-run, before its real
 * completion event (which does carry `agent_type` correctly). On that
 * malformed event the blob scan matched "feature-implementer" somewhere else
 * in the payload and evicted the still-running agent from `activeAgents`,
 * re-locking the gate on its very next edit for no real reason. A false
 * positive here is asymmetric with Start: Start only adds (idempotent,
 * harmless), Stop removes (silently blocks legitimate work) - so Stop must
 * only trust a real structured field, never a guess.
 */
function agentName(p, { allowBlobScan = true } = {}) {
  const keys = [
    'agent_type',
    'agent_name',
    'agentName',
    'subagent_type',
    'subagentType',
    'agentType',
    'agent',
    'name',
  ];
  for (const k of keys) {
    const v = p?.[k] ?? p?.tool_input?.[k] ?? p?.agent?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (!allowBlobScan) return null;
  const blob = JSON.stringify(p ?? {});
  for (const known of [IMPLEMENTER, ...VERIFIERS]) {
    if (blob.includes(known)) return known;
  }
  return null;
}

/**
 * Both of these read `tool_input` ONLY, never the response. A read of a ticket
 * that happens to already be In Progress, or a JQL search containing that
 * phrase, must never unlock the edit gate - only an outgoing transition
 * request may.
 */
function findIssueKey(p) {
  // Structured field first: transitionJiraIssue and editJiraIssue (the two
  // real tools TRANSITION_TOOL matches) both take a required, top-level
  // `issueIdOrKey` naming the issue actually being acted on - confirmed
  // against their tool schemas. That is the authoritative answer, and
  // reading it means we never mistake a ticket-shaped string ELSEWHERE in
  // the payload (an `INV-007`/`FR-080` doc citation, or another ticket
  // mentioned in an `editJiraIssue` description update) for the transition
  // target - a real risk with the blob scan below, since this repo's own
  // docs are full of hyphenated ids that look exactly like a Jira key.
  const direct = p?.tool_input?.issueIdOrKey;
  if (typeof direct === 'string') {
    const m = direct.trim().match(/^([A-Z][A-Z0-9]{0,9})-(\d+)$/);
    if (m && !NOT_A_KEY.test(m[1])) return m[1] + '-' + m[2];
  }

  // Fallback for any other transition-shaped tool (movejira/setstatus-style
  // hedges in TRANSITION_TOOL) that doesn't use that field name.
  const blob = JSON.stringify(p?.tool_input ?? {});
  for (const m of blob.matchAll(/\b([A-Z][A-Z0-9]{0,9})-(\d+)\b/g)) {
    if (!NOT_A_KEY.test(m[1])) return m[1] + '-' + m[2];
  }
  return null;
}

function findStatus(p) {
  const input = p?.tool_input ?? {};
  for (const k of ['transition', 'status', 'transitionName', 'statusName', 'to', 'target']) {
    const v = input[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && typeof v.name === 'string') return v.name.trim();
  }
  // The real transitionJiraIssue tool takes a numeric transition `id`, not a
  // name (confirmed 2026-09-24: `transition: {"id": "21"}` - a bare string
  // errors, and the object never carries `.name`) - so tool_input alone
  // can't name the resulting status for that tool, and this fell through to
  // "unrecognised transition" every time, silently never unlocking the gate.
  // Fall back to the tool's own response, which echoes the issue's new
  // `fields.status.name` after a successful transition. Safe to trust here
  // specifically (unlike a general response scan) because this function is
  // only reached for a call already matched by TRANSITION_TOOL in
  // recordJira - i.e. the tool itself reporting what it just did, not an
  // arbitrary read/search result that might mention a status in passing.
  const resp = p?.tool_response;
  if (resp) {
    // MCP tool_response arrives as a JSON-encoded STRING here (confirmed
    // 2026-09-24 via a one-off debug dump), not a parsed object - re-stringifying
    // it (the object branch's approach) double-escapes every quote and makes
    // the regex below never match. Use the string as-is; only stringify a
    // genuine object (belt-and-braces in case some other tool's client
    // delivers tool_response already parsed).
    const blob = typeof resp === 'string' ? resp : JSON.stringify(resp);
    const m = blob.match(/"status"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]+)"/);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------- subcommands

function precheck() {
  const p = payload();
  const key = partitionKey(p);
  const tool = p.tool_name || '';
  const state = readState(key);

  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = p.tool_input?.command || '';
    if (!TEST_COMMAND.test(cmd)) allow();
    if (hatchOn()) allow();
    if (state.activeAgents.some((a) => VERIFIERS.includes(a))) allow();
    deny(
      'The test suite runs on Haiku, inside a verifier subagent - not on the main thread. Delegate to the ' +
        '"feature-verifier" agent (or "test-citation-checker" for ERD T## coverage) and let it run: ' +
        cmd,
    );
  }

  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'NotebookEdit') allow();

  const rel = relTarget(p.tool_input);
  if (!rel) allow();
  if (EXEMPT_PATH.some((re) => re.test(rel))) allow();
  if (hatchOn()) allow();

  if (!state.ticket || !state.inProgress) {
    deny(
      'Code edits are gated on the feature pipeline. No Jira ticket is In Progress for this worktree, so ' +
        rel +
        ' cannot be edited yet.\n' +
        'Run /feature <TICKET-KEY> <what to build>: plan against the cited docs first, then move the ticket to ' +
        'In Progress via the Atlassian connector - that transition is what unlocks editing.\n' +
        'For deliberate ad-hoc work outside the pipeline, create .claude/state/gate-off (the Stop hook announces it).',
    );
  }

  if (!state.activeAgents.includes(IMPLEMENTER)) {
    deny(
      state.ticket +
        ' is In Progress, but code is written by Sonnet: edits must happen inside the "' +
        IMPLEMENTER +
        '" subagent, not on the Opus main thread. Delegate the implementation of ' +
        rel +
        ' to that agent.',
    );
  }

  allow();
}

/** Tool names that actually move a ticket, as opposed to reading or searching one. */
const TRANSITION_TOOL = /transition|updatejiraissue|editjiraissue|movejira|setstatus/i;

function recordJira() {
  const p = payload();
  const key = partitionKey(p);
  logPayload('PostToolUse:' + (p.tool_name || '?'), p);

  const resp = p.tool_response;
  if (resp && (resp.isError === true || resp.is_error === true)) allow();
  if (!TRANSITION_TOOL.test(p.tool_name || '')) allow();

  const issueKey = findIssueKey(p);
  if (!issueKey) allow();
  const status = findStatus(p);
  const state = readState(key);

  if (status && IN_REVIEW.test(status) && !IN_PROGRESS.test(status)) {
    writeState(key, {
      ...EMPTY_STATE,
      status,
      reviewed: true,
      verifierRan: state.verifierRan,
      verifierRuns: state.verifierRuns,
      activeAgents: state.activeAgents,
    });
    emit({
      systemMessage:
        'Pipeline: ' +
        issueKey +
        ' moved to "' +
        status +
        '". Edit gate re-armed for this worktree - you move it to Done manually.',
    });
  }

  if (status && IN_PROGRESS.test(status)) {
    writeState(key, {
      ...EMPTY_STATE,
      ticket: issueKey,
      status,
      inProgress: true,
      startedAt: new Date().toISOString(),
      activeAgents: state.activeAgents,
    });
    emit({
      systemMessage:
        'Pipeline: ' +
        issueKey +
        ' is In Progress. Edits unlocked in this worktree inside the ' +
        IMPLEMENTER +
        ' subagent.',
    });
  }

  // A transition we do not recognise: record it, change no gate.
  writeState(key, { ...state, ticket: state.ticket || issueKey, status: status || state.status });
  allow();
}

/**
 * Metadata-only audit line. Deliberately never writes tool_input or
 * tool_response: this hook sees every MCP call in the session, and those
 * payloads carry provider secrets (a Vercel env-var listing, a Supabase row).
 * Event name, tool name and agent identity are all the gate needs to be
 * debuggable.
 */
function logPayload(event, p) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const meta = {
      cwd: p?.cwd,
      tool: p?.tool_name,
      agent: p?.agent_type,
      keys: Object.keys(p?.tool_input ?? {}),
    };
    appendFileSync(
      PAYLOAD_LOG,
      new Date().toISOString() + ' ' + event + ' ' + JSON.stringify(meta) + '\n',
      'utf8',
    );
  } catch {
    /* best effort */
  }
}

function subagentStart() {
  const p = payload();
  const key = partitionKey(p);
  logPayload('SubagentStart', p);
  const name = agentName(p);
  if (!name) allow();
  const state = readState(key);
  if (!state.activeAgents.includes(name)) state.activeAgents.push(name);
  writeState(key, state);
  allow();
}

function subagentStop() {
  const p = payload();
  const key = partitionKey(p);
  logPayload('SubagentStop', p);
  const name = agentName(p, { allowBlobScan: false });
  if (!name) allow();
  const state = readState(key);
  state.activeAgents = state.activeAgents.filter((a) => a !== name);
  if (VERIFIERS.includes(name)) {
    state.verifierRan = true;
    state.verifierRuns = [...new Set([...state.verifierRuns, name])];
  }
  writeState(key, state);
  allow();
}

function stopReport() {
  const p = payload();
  const key = partitionKey(p);
  const state = readState(key);
  const notes = [];

  if (hatchOn()) {
    notes.push(
      'The edit gate is OFF (.claude/state/gate-off exists) - code changes are not being gated. Delete that file to re-arm it.',
    );
  }
  if (state.ticket && state.inProgress) {
    if (!state.verifierRan) {
      notes.push(
        state.ticket + ' is In Progress and the Haiku verifier has not run - tests are unverified.',
      );
    }
    if (!state.reviewed) {
      notes.push(
        state.ticket +
          ' has not been moved to review yet (post the implementation-summary comment first; never move it to Done).',
      );
    }
  }

  if (!notes.length) emit({ suppressOutput: true });
  emit({ systemMessage: 'Pipeline outstanding:\n- ' + notes.join('\n- ') });
}

// -------------------------------------------------------------------- dispatch

const COMMANDS = {
  precheck,
  'record-jira': recordJira,
  'subagent-start': subagentStart,
  'subagent-stop': subagentStop,
  'stop-report': stopReport,
};

const sub = process.argv[2];
try {
  const fn = COMMANDS[sub];
  if (!fn) {
    process.stderr.write('gate.mjs: unknown subcommand ' + JSON.stringify(sub) + '\n');
    process.exit(0);
  }
  fn();
} catch (err) {
  // Fail open, loudly. A broken gate must not make the repo uneditable.
  emit({
    systemMessage:
      'Feature gate (' +
      sub +
      ') errored and is FAILING OPEN - this turn is not gated. Fix .claude/hooks/gate.mjs: ' +
      (err?.message ?? err),
  });
}
