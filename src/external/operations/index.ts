// Module 13: external/operations
// Owns: external_operation, external_ref
// See docs/Throughline_Module_Boundaries.md section 3 (module map) and the
// matching subsection of section 4 for this module's exports and rules.
//
// Nothing outside this folder may import a file that is not re-exported here
// (Module Boundaries section 7).
//
// Implements the insert-first/lock/decide protocol (ERD 7.2) exactly once,
// so github/jira/stitch (layer 5, Module Boundaries 4.6) never touch
// external_operation/external_ref directly - they only ever call
// `runOperation` with a provider-specific `send`/`reconcile` pair (Module
// Boundaries 4.5's own "Rule"). This story (Jira SCRUM-48 / E4-S1) builds
// only 7.1/7.2; 7.3 (GitHub), 7.4 (Jira) and 7.5 (Stitch) reconciliation
// mechanics belong to their own provider modules in later stories.
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, schema, withTx } from '@/db';

export type ExternalRef = typeof schema.externalRef.$inferSelect;

// Not part of Module Boundaries 4.5's literal opts type (which inlines the
// union), but every caller needs this same literal union, so it's exported
// once here rather than repeated - harmless, additive extraction, not a
// change to the documented shape.
export type ExternalProvider = 'github' | 'jira' | 'stitch';

/**
 * Thrown by a provider's `send()` (or `reconcile()`) closure for a
 * DEFINITIVE rejection - e.g. GitHub 422 name-already-exists, a Jira 400
 * validation error. ERD 7.2: "`failed` is reserved for definitive provider
 * rejections (validation/4xx). Timeouts, 5xx and lost responses are never
 * `failed`." ANY other thrown error is therefore treated as
 * ambiguous/network/timeout here - it is NOT classified further, it just
 * propagates out of `runOperation` unchanged, and the already-committed
 * `pending` row is left for a later call's step 3 to reconcile (R6, R9).
 */
export class DefinitiveProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DefinitiveProviderError';
  }
}

type SendResult = {
  externalId: string;
  externalKey?: string;
  externalUrl?: string;
  metadata?: unknown;
};

type ReconcileResult =
  | { found: true; externalId: string; externalKey?: string; externalUrl?: string }
  | { found: false };

// Module Boundaries 4.5's exported interface, verbatim except `provider`
// pulled out to the named `ExternalProvider` union above.
export interface RunOperationOptions {
  projectId: string;
  provider: ExternalProvider;
  operationType: string;
  operationKey: string;
  requestHash: string;
  targetDescriptor: unknown;
  sourceArtifactVersionId: string;
  sourceItemVersionId?: string;
  send: () => Promise<SendResult>;
  reconcile: () => Promise<ReconcileResult>;
}

// Module Boundaries 4.5 documents a 4-variant return union (completed /
// reconciliation_required / conflict / in_flight). Section 10 point 3
// flags the whole send/reconcile closure shape as "engineering judgment...
// not literally specified by either [ERD or TR]... flag if any should
// change" - this is exactly that: the documented union has two real gaps
// this story's own source material requires filling in, not a redesign of
// the protocol:
//   - `failed`: ERD 7.2 step 3.b's own bullet list has
//     "failed -> user may retry; set pending, commit, resend", i.e. a
//     `failed` status that the caller must be able to observe and later
//     retry. The documented 4-variant union has no slot for it.
//   - `refused`: ERD 4.15's GitHub-exclusivity note (line ~515) requires an
//     app-level refusal of a second concurrent GitHub operation for the
//     same project ("under the project lock, refuse to start a new GitHub
//     operation while another one for the project is pending,
//     reconciliation_required or completed") - also absent from the
//     documented union.
export type RunOperationResult =
  | { status: 'completed'; ref: ExternalRef }
  | { status: 'reconciliation_required' }
  | { status: 'conflict' }
  | { status: 'in_flight' }
  | { status: 'failed'; errorMessage: string }
  | { status: 'refused'; reason: string };

// Per-provider reconciliation threshold T = provider_timeout + margin (ERD
// 7.2 "Choosing T": "every provider client has a hard HTTP timeout, and
// T = provider_timeout + margin (e.g. 30s timeout -> T = 90s). T must never
// be shorter than the timeout"). These are PROVISIONAL placeholders - the
// real per-provider HTTP timeouts come out of the E4-T1 (GitHub) and E4-T2
// (Jira) integration spikes, which are explicitly out of this story's scope.
// Stitch has no spike scheduled yet, so it borrows the same 30s-timeout
// assumption. Record the derivation next to the constant, per ERD 7.2.
const RECONCILIATION_THRESHOLD_MS: Record<ExternalProvider, number> = {
  // GitHub REST API: assumed 30s HTTP timeout -> T = 90s (ERD 7.2's own
  // worked example). Refine once E4-T1 measures the real client timeout.
  github: 90_000,
  // Jira REST API: same 30s-timeout assumption -> T = 90s. Jira's own
  // search-index lag (ERD 7.4/TR 30.2) is handled separately, inside
  // reconcile() itself (a bounded re-query over ~10s), not by widening T.
  // Refine once E4-T2 measures the real client timeout.
  jira: 90_000,
  // Stitch: no dedicated spike scoped in the plan; same provisional 30s +
  // margin assumption as the other two until one is added.
  stitch: 90_000,
};

/**
 * `runOperation` - the insert-first/lock/decide protocol (ERD 7.2 in full).
 *
 * Step 1 inserts `external_operation(status='pending', ...)` with
 * `ON CONFLICT (operation_key) DO NOTHING`, which for every provider except
 * GitHub is a single auto-committed statement (Postgres commits a bare
 * single-statement write on its own - no explicit transaction wrapper is
 * needed for that to be "its own transaction that commits before any
 * network call"). GitHub additionally wraps step 1 in its own short-lived
 * transaction holding a SEPARATE advisory lock (never `withProjectLock` -
 * this module never imports it, and never will: that import is single-
 * importer-restricted to `artifact-lifecycle`, Module Boundaries principle
 * 3, enforced by `no-restricted-imports`) so the project-exclusivity check
 * (ERD 4.15 line ~515) and the insert happen atomically together. Either
 * way, step 1 always commits and releases every lock BEFORE `send()` is
 * ever called - the DB write and the network call never overlap (ERD 7.2's
 * hard rule, repeated at Module Boundaries line ~517).
 */
export async function runOperation(opts: RunOperationOptions): Promise<RunOperationResult> {
  const inserted = await insertOperationRow(opts);
  if ('refused' in inserted) {
    return { status: 'refused', reason: inserted.reason };
  }
  if (inserted.id) {
    // This call's insert won the row - it owns the write (ERD 7.2 step 2).
    return sendAndFinalize(inserted.id, opts);
  }

  // This call's insert lost to ON CONFLICT DO NOTHING - a row with this
  // operation_key already exists. ERD 7.2 step 3: SELECT ... FOR UPDATE it
  // and decide.
  const decision = await decideExisting(opts);
  switch (decision.kind) {
    case 'conflict':
      return { status: 'conflict' };
    case 'completed':
      return { status: 'completed', ref: decision.ref };
    case 'in_flight':
      return { status: 'in_flight' };
    case 'reconcile':
      // decideExisting's own transaction already committed the
      // reconciliation_required status update before returning - reconcile()
      // runs with no lock/tx held (ERD 7.2, Module Boundaries line ~517).
      return reconcileAndFinalize(decision.operationId, opts);
    case 'retry':
      // Same rule: the pending status update already committed.
      return sendAndFinalize(decision.operationId, opts);
  }
}

/**
 * ERD 7.2 step 1. Returns the winning row's id, `{ id: null }` if this call
 * lost `ON CONFLICT DO NOTHING`, or `{ refused: true, reason }` for the
 * GitHub-exclusivity case (ERD 4.15 line ~515) - refused without ever
 * attempting the insert.
 */
async function insertOperationRow(
  opts: RunOperationOptions,
): Promise<{ id: string | null } | { refused: true; reason: string }> {
  const values = {
    projectId: opts.projectId,
    provider: opts.provider,
    operationType: opts.operationType,
    operationKey: opts.operationKey,
    status: 'pending' as const,
    requestHash: opts.requestHash,
    sourceArtifactVersionId: opts.sourceArtifactVersionId,
    sourceItemVersionId: opts.sourceItemVersionId ?? null,
    targetDescriptor: opts.targetDescriptor,
  };

  if (opts.provider !== 'github') {
    // Non-GitHub: a single INSERT statement is its own auto-committed
    // transaction (ERD 7.2 step 1) - no explicit transaction wrapper.
    const [row] = await db
      .insert(schema.externalOperation)
      .values(values)
      .onConflictDoNothing({ target: schema.externalOperation.operationKey })
      .returning({ id: schema.externalOperation.id });
    return { id: row?.id ?? null };
  }

  // GitHub: check-then-insert under a SEPARATE advisory lock scoped to
  // (projectId, 'github') - a different key AND a different salt from
  // withProjectLock's own `hashtextextended(projectId, 0)` (src/db/lock.ts),
  // so this lock's keyspace can never collide with the project lock's. This
  // is a local, one-off `tx.execute(sql...)` call in this file only - not a
  // second copy of withProjectLock, and not importable from anywhere else
  // that would want one (the whole point of the single-importer rule).
  return withTx(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${opts.projectId} || ':external:github', 1))`,
    );

    // ERD 4.15 line ~515: "one repository per project in P0 (decided)...
    // under the project lock, refuse to start a new GitHub operation while
    // another one for the project is pending, reconciliation_required or
    // completed (otherwise two names could both succeed on GitHub and only
    // the second external_ref insert would fail, after its repository
    // already exists)." A DIFFERENT operation_key means a genuinely new
    // attempt (different repo name); the SAME key is not a second operation
    // - it falls through to the insert below, which then loses to
    // ON CONFLICT DO NOTHING and is handled by decideExisting (R5's
    // double-click path), not refused here.
    const [active] = await tx
      .select({ id: schema.externalOperation.id })
      .from(schema.externalOperation)
      .where(
        and(
          eq(schema.externalOperation.projectId, opts.projectId),
          eq(schema.externalOperation.provider, 'github'),
          inArray(schema.externalOperation.status, [
            'pending',
            'reconciliation_required',
            'completed',
          ]),
          ne(schema.externalOperation.operationKey, opts.operationKey),
        ),
      )
      .limit(1);
    if (active) {
      return { refused: true as const, reason: 'github_operation_already_active' };
    }

    const [row] = await tx
      .insert(schema.externalOperation)
      .values(values)
      .onConflictDoNothing({ target: schema.externalOperation.operationKey })
      .returning({ id: schema.externalOperation.id });
    return { id: row?.id ?? null };
    // Transaction commits here, releasing both the advisory lock (xact-
    // scoped) and any row locks - strictly BEFORE this function's caller
    // ever calls send().
  });
}

type ExistingDecision =
  | { kind: 'conflict' }
  | { kind: 'completed'; ref: ExternalRef }
  | { kind: 'in_flight' }
  | { kind: 'reconcile'; operationId: string }
  | { kind: 'retry'; operationId: string };

/** ERD 7.2 step 3: `SELECT ... FOR UPDATE` the existing row, then decide. */
async function decideExisting(opts: RunOperationOptions): Promise<ExistingDecision> {
  return withTx(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.externalOperation)
      .where(eq(schema.externalOperation.operationKey, opts.operationKey))
      .for('update');

    if (!row) {
      // insertOperationRow's ON CONFLICT DO NOTHING lost because a row with
      // this operation_key exists - it must therefore be selectable here.
      // external_operation rows are never deleted (append-only protocol,
      // ERD 7.2); this would only fire on a bug elsewhere.
      throw new Error(`external_operation ${opts.operationKey} vanished between insert and select`);
    }

    // R11 / ERD 7.2 step 3.a: hash checked BEFORE any status dispatch, for
    // EVERY status including completed - never a silent resend, never a
    // silent reuse.
    if (row.requestHash !== opts.requestHash) {
      return { kind: 'conflict' };
    }

    if (row.status === 'completed') {
      const [ref] = await tx
        .select()
        .from(schema.externalRef)
        .where(eq(schema.externalRef.externalOperationId, row.id))
        .limit(1);
      if (!ref) {
        // external_operation_completed_has_external_id_check plus the
        // UNIQUE(external_operation_id) on external_ref together mean a
        // completed operation always has exactly one ref - a missing one
        // here is a data-integrity bug, not a normal runtime path.
        throw new Error(`external_operation ${row.id} is completed but has no external_ref`);
      }
      return { kind: 'completed', ref };
    }

    if (row.status === 'pending') {
      const thresholdMs = RECONCILIATION_THRESHOLD_MS[opts.provider];
      const ageMs = Date.now() - row.updatedAt.getTime();
      if (ageMs < thresholdMs) {
        // R5: double-click / concurrent retry while the original send() may
        // still genuinely be in flight - reject, don't resend.
        return { kind: 'in_flight' };
      }
      // R10: T is derived from the provider timeout, so "older than T"
      // implies the original call's own HTTP timeout has already elapsed -
      // safe to move to reconciliation_required.
      await tx
        .update(schema.externalOperation)
        .set({ status: 'reconciliation_required' })
        .where(eq(schema.externalOperation.id, row.id));
      return { kind: 'reconcile', operationId: row.id };
    }

    if (row.status === 'reconciliation_required') {
      return { kind: 'reconcile', operationId: row.id };
    }

    // status === 'failed': ERD 7.2 step 3.b - "user may retry; set pending,
    // commit, resend." Retries after an ambiguous outcome are always
    // user-initiated, never automatic - this function is only ever reached
    // from a fresh `runOperation` call, so that requirement is the caller's
    // responsibility, not enforced here.
    //
    // Design note (not spelled out by the story): a retry of a `failed`
    // GitHub row does NOT re-run the project-exclusivity check above - that
    // check only guards a brand-new operation_key at insertOperationRow.
    // A `failed` row was, by definition, not "active" when any other
    // GitHub operation for this project was created, so this retry cannot
    // by itself be the thing that lets two ACTIVE GitHub operations coexist
    // - the only way that could still happen is if a second, unrelated
    // GitHub operation for the same project completed while this one sat
    // failed, and this retry's send() then also succeeds. That double-
    // success race is backstopped by the real DB constraint
    // (`UNIQUE (project_id) WHERE provider = 'github'` on `external_ref`,
    // ERD 4.15), not by an app-level check here - the story's exclusivity
    // scenarios (a NEW operation while one is active; unblocked once the
    // active one fails) don't cover a retry racing a since-completed
    // sibling, so this is left to that DB backstop rather than added scope.
    await tx
      .update(schema.externalOperation)
      .set({ status: 'pending' })
      .where(eq(schema.externalOperation.id, row.id));
    return { kind: 'retry', operationId: row.id };
  });
}

/**
 * Calls `opts.send()` with no lock/tx held, then handles its three possible
 * outcomes (ERD 7.2 step 2 / step 3.b's "resend"):
 *  - success -> finalize as completed.
 *  - `DefinitiveProviderError` -> finalize as failed.
 *  - anything else -> rethrow unchanged; the row is left exactly as it was
 *    (`pending`) for a later call to reconcile (R6, R9).
 */
async function sendAndFinalize(
  operationId: string,
  opts: RunOperationOptions,
): Promise<RunOperationResult> {
  let result: SendResult;
  try {
    result = await opts.send();
  } catch (error) {
    if (error instanceof DefinitiveProviderError) {
      await db
        .update(schema.externalOperation)
        .set({ status: 'failed', errorMessage: error.message })
        .where(eq(schema.externalOperation.id, operationId));
      return { status: 'failed', errorMessage: error.message };
    }
    throw error;
  }

  const ref = await finalizeCompleted(operationId, opts, result);
  return { status: 'completed', ref };
}

/**
 * Calls `opts.reconcile()` with no lock/tx held (the operation row was
 * already committed as `reconciliation_required` by `decideExisting`).
 * `found: false` leaves the row as-is - a further retry is user-initiated
 * (ERD TR 30.2), never automatic here.
 */
async function reconcileAndFinalize(
  operationId: string,
  opts: RunOperationOptions,
): Promise<RunOperationResult> {
  const result = await opts.reconcile();
  if (!result.found) {
    return { status: 'reconciliation_required' };
  }
  // Built up with conditional assignment, never an explicit `key: undefined`
  // - tsconfig's `exactOptionalPropertyTypes` treats "property present with
  // value undefined" as distinct from "property absent" for an optional
  // field, and `SendResult.externalKey`/`externalUrl` are the latter.
  const sendResult: SendResult = { externalId: result.externalId };
  if (result.externalKey !== undefined) sendResult.externalKey = result.externalKey;
  if (result.externalUrl !== undefined) sendResult.externalUrl = result.externalUrl;
  const ref = await finalizeCompleted(operationId, opts, sendResult);
  return { status: 'completed', ref };
}

/**
 * ERD 7.2 step 4: "after the response: in one transaction insert
 * external_ref and set status='completed'." Shared by the winner path, the
 * failed-retry path and the reconciliation-found path - all three finalize
 * identically once a real external object is confirmed.
 */
async function finalizeCompleted(
  operationId: string,
  opts: RunOperationOptions,
  result: { externalId: string; externalKey?: string; externalUrl?: string; metadata?: unknown },
): Promise<ExternalRef> {
  return withTx(async (tx) => {
    const [ref] = await tx
      .insert(schema.externalRef)
      .values({
        projectId: opts.projectId,
        provider: opts.provider,
        externalId: result.externalId,
        externalKey: result.externalKey ?? null,
        externalUrl: result.externalUrl ?? null,
        sourceArtifactVersionId: opts.sourceArtifactVersionId,
        sourceItemVersionId: opts.sourceItemVersionId ?? null,
        externalOperationId: operationId,
        metadata: result.metadata ?? {},
      })
      .returning();
    if (!ref) {
      throw new Error(`external_ref insert for operation ${operationId} returned no row`);
    }

    await tx
      .update(schema.externalOperation)
      .set({ status: 'completed', externalId: result.externalId })
      .where(eq(schema.externalOperation.id, operationId));

    return ref;
  });
}

/** All `external_ref` rows for one artifact version (GitHub/Stitch: their one ref; Jira: one per exported Epic/Story). */
export async function getRefsForVersion(sourceArtifactVersionId: string): Promise<ExternalRef[]> {
  return db
    .select()
    .from(schema.externalRef)
    .where(eq(schema.externalRef.sourceArtifactVersionId, sourceArtifactVersionId));
}

/** The `external_ref` for one exact Epic/Story ItemVersion (Jira only - GitHub/Stitch never set `source_item_version_id`), or `null`. */
export async function getRefForItem(sourceItemVersionId: string): Promise<ExternalRef | null> {
  const [ref] = await db
    .select()
    .from(schema.externalRef)
    .where(eq(schema.externalRef.sourceItemVersionId, sourceItemVersionId))
    .limit(1);
  return ref ?? null;
}
