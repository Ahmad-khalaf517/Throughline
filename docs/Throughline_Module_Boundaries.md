# Throughline - Module Boundaries

**Document version:** 1.6
**Status:** Derived from ERD/Data Model v1.8 and Technical Requirements & Lineage Invariants v1.4. Parent of API Contracts -> Jira Plan -> Implementation. v1.6 (E4-S6): named a third section 4.7 exception a boundary-auditor review flagged as real but undocumented - the eight GitHub/Jira/Stitch/external-refs routes call `artifact-lifecycle.getProjectById` directly, which 4.7's existing prose textually allowed only for the four `/api/projects*` routes. Not a new decision: no layer-3/4/5 export maps a `projectId` to its approved version ids, and API Contracts section 7's own text for `GET .../external-refs` ("called once per approved version and merged") requires exactly that mapping, so the exception was already implied by the frozen contract these routes implement - this states it in prose rather than leaving it in a story-local README. Same shape as v1.3, which recorded the `/api/projects*` exception for the same reason. v1.5 (E2-S5): resolved a self-contradiction this story's implementation surfaced - section 4.2 said `dependency-binding` calls `identity.resolveDisplayKeys`, while the module map (section 3) and the enforced eslint layer-1 peer-import ban (`eslint.config.mjs`) said `dependency-binding` depends on nothing but `db`. `checkFreshness` had the same latent problem: INV-006 "currentness" is defined entirely in terms of `identity`'s LogicalItem -> current-ItemVersion pointer (TR section 18), so both of `dependency-binding`'s functions were coupled to `identity`-owned data, not just the one the prose named. Fix: `bindUpstreamRefs` and `checkFreshness` are now pure functions - no `tx`, no `identity` import - taking already-resolved data as arguments; `identity` gains two reads (`getSourceVersionMembers`, `getCurrentItemVersionIds`) that `artifact-lifecycle` calls to compose that input before invoking either function (same shape `backlog` already uses for `resolveDisplayKeys`, section 4.4). No eslint change was needed - the peer-import ban was already correct once the module's own functions stopped needing to cross it. v1.4 (E5-S1): added section 4.8, naming a real gap a boundary-auditor review surfaced - this story's Server Components (`src/app/projects/page.tsx`, `src/app/projects/[projectId]/page.tsx`) read `artifact-lifecycle` and call `requireProjectOwner` directly, which section 4.7's existing exception textually covers only for `api` route handlers, not pages. Not a new decision: pages calling `auth.getVerifiedUser` directly already predates this story (sign-up/sign-in/forgot-password), and this just extends the same "pages read; api layer still owns the one write" shape to `artifact-lifecycle`'s read exports rather than forcing a page to self-fetch its own route over HTTP. The one mutation this story has (project creation) still goes through `POST /api/projects`, unchanged. v1.3 (E1-S8): named two exceptions this story's implementation required and a boundary-auditor review flagged as real but undocumented - `requireProjectOwner`'s direct read of `project` (section 4.1) and every `/api/projects*` route's direct call into `artifact-lifecycle`, not just the creation route (section 4.7). Neither changes a decision: both were already implied (4.1's own "NOT YET IMPLEMENTED" note anticipated the former; `eslint.config.mjs`'s own comment already flagged the latter as an intentionally-unencoded exception) - this just states them in prose instead of leaving them for the next reader to re-derive. v1.2: `auth` module's export list filled in for real (signUpWithEmail/signInWithEmail/signOut/requestPasswordReset/updatePassword/verifyEmailOtp/exchangeCodeForSession/updateSession) - it had drifted since being built, listing only the original three. v1.1: `getVerifiedUser` no longer checks an email allowlist - ERD Appendix B round 9.
**Target stack:** Next.js / TypeScript, Drizzle ORM, Supabase Postgres.
**Primary audience:** Developer, AI coding agents implementing modules.

> **For AI agents:** every module's "Owns" list is that module's exclusive write path for the tables/behavior named. Do not write to a table from outside its owning module. Do not add a module, or move ownership of a table, without checking it against the ERD's integrity matrix (ERD section 8) first - a boundary that lets two code paths write the same table is how the lineage invariants get silently broken.

---

## 1. Principles

1. **One write path per table.** Every table in the ERD has exactly one module that is allowed to `INSERT`/`UPDATE`/`DELETE` it. Every other module reads it, if at all, through that module's exported functions - never through a raw query of its own. This is the ERD's "single write path" convention (ERD section 2) made concrete per table (section 5 below).
2. **Layering is one-directional.** A module may call into a lower layer, never a higher one, and never a peer in the same layer except through the explicitly listed exception in section 4.4. This keeps the dependency graph acyclic and matches the ERD's own requirements-before-architecture-before-ui-before-backlog order (TR FR-080).
3. **Lock discipline lives in one place.** Every transaction that touches `artifact_version.status`, allocates a `version_number`/`revision_number`/`display_key`, or mints an ItemVersion takes the project advisory lock (ERD section 3.2). Exactly one module (`artifact-lifecycle`) is allowed to open such a transaction. No other module opens a transaction that writes any of those things.
4. **The LLM never crosses a module boundary as data you trust.** Every artifact-type module treats AI output as untrusted input to be validated (Zod) and handed to `identity` for matching. No module passes a model-supplied id anywhere a database id is expected (TR Appendix A, rule 1).
5. **Modules are plain TypeScript modules, not services.** This is one Next.js application. "Module boundary" means an import boundary and a code-review rule, not a network boundary. There is no message queue, no internal HTTP call, and no reason for one in an 8-day solo build (ERD conventions: favor simplicity, NFR-008).

---

## 2. Layering

```text
Layer 0  db, auth, ai-client                         (foundation - no domain logic)
Layer 1  identity, dependency-binding, impact         (lineage core - pure + thin persistence)
Layer 2  artifact-lifecycle, architecture-materialization   (state machine + transactions)
Layer 3  requirements, architecture, ui-requirements, backlog   (artifact-type modules)
Layer 4  external-operations                          (shared external-write protocol)
Layer 5  github, jira, stitch                         (provider integrations)
Layer 6  api (Next.js route handlers)                 (thin: auth + ownership + call layer 3/5)
```

A module in layer N may import layer < N freely. It may not import layer >= N, with the single exception in 4.4 (architecture-materialization <-> identity, which is really layer 1 called from layer 2, not a cycle).

---

## 3. Module map

| # | Module | Layer | Owns (write path for) | Depends on |
|---|---|---|---|---|
| 1 | `db` | 0 | Drizzle client, connection, `withProjectLock()`, transaction helper | - |
| 2 | `auth` | 0 | `app_user` (upsert on login) | `db` |
| 3 | `ai-client` | 0 | `ai_generation_run` | `db` |
| 4 | `identity` | 1 | `logical_item`, `item_version`, `artifact_version_item_membership`, `semantic_dependency` | `db` |
| 5 | `dependency-binding` | 1 | (no table; pure functions, no database access of its own) | - |
| 6 | `impact` | 1 | `impact_acknowledgement` | `db` |
| 7 | `artifact-lifecycle` | 2 | `project`, `artifact`, `artifact_version`, `approval_event`, `generation_context_ref` | `db`, `identity`, `dependency-binding`, `impact` |
| 8 | `architecture-materialization` | 2 | `architecture_option` | `identity`, `artifact-lifecycle` (called by it) |
| 9 | `requirements` | 3 | (payload shape + prompt only; persistence via 4/7) | `ai-client`, `artifact-lifecycle`, `identity` |
| 10 | `architecture` | 3 | (payload shape + prompt only) | `ai-client`, `artifact-lifecycle`, `architecture-materialization` |
| 11 | `ui-requirements` | 3 | (payload shape + prompt only) | `ai-client`, `artifact-lifecycle`, `identity` |
| 12 | `backlog` | 3 | (payload shape + prompt only) | `ai-client`, `artifact-lifecycle`, `identity` |
| 13 | `external-operations` | 4 | `external_operation`, `external_ref` | `db`, `impact` |
| 14 | `github` | 5 | (none of its own table) | `external-operations`, `architecture` (read-only) |
| 15 | `jira` | 5 | (none of its own table) | `external-operations`, `backlog` (read-only) |
| 16 | `stitch` | 5 | `stitch_output` | `external-operations`, `ui-requirements` (read-only) |
| 17 | `api` | 6 | - | everything below it |

Every one of the 16 ERD tables appears in exactly one "Owns" cell above. Section 5 gives the full matrix with the ERD section that defines each table's rules.

---

## 4. Module specifications

### 4.1 Layer 0 - Foundation

#### `db`

**Owns:** the Drizzle client and connection, nothing domain-specific.

**Exports:**
```ts
db: DrizzleClient                                    // connects via Supavisor transaction pooler, prepare:false
withProjectLock<T>(projectId: string, fn: (tx: Tx) => Promise<T>): Promise<T>
  // runs pg_advisory_xact_lock(hashtextextended(projectId,0)) then fn, in one transaction (ERD 3.2)
withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>     // plain transaction, no lock - for read-only or single-table writes
```

**Rule:** `withProjectLock` is called from exactly one place in the whole codebase: `artifact-lifecycle`. Nothing else imports it. This is the enforcement point for principle 3.

---

#### `auth`

**Owns:** `app_user` (the upsert-on-login row only; ERD section 4.1).

**Exports:**
```ts
getVerifiedUser(request): Promise<{ id: string; email: string; displayName: string | null } | null>
  // auth.getUser() against Supabase, never getSession(); returns null if unverified. No allowlist
  // check (ERD Appendix B round 9) - sign-up is open, gated only by Supabase's own email
  // verification (mailer_autoconfirm off), not by this function. displayName is read back from
  // Supabase user_metadata.display_name (set at sign-up) - null if never set, matching ERD 4.1's
  // app_user.display_name.
upsertAppUser(supabaseUser): Promise<void>
  // INSERT ... ON CONFLICT (id) DO UPDATE, called once per authenticated request or on login
requireProjectOwner(userId: string, projectId: string): Promise<void>
  // Resolves to 404 NOT_FOUND (never 403) whether the project doesn't exist or isn't the caller's -
  // API Contracts 1.4 requires the two to be indistinguishable to the caller; the ONLY
  // project-ownership check in the codebase.
  // Implemented in slice 2 (E1-S8) as a direct SELECT of project.owner_user_id via `db`. This is a
  // second documented exception to principle 1 (the only other one is architecture-materialization
  // -> identity, section 4.4/8): `auth` is layer 0 and cannot import `artifact-lifecycle` (layer 2,
  // owner of `project`) to get this through an exported function, and the ERD's own "Authorization"
  // row (section 2) already specifies this exact check lives here. Read-only - never writes `project`.
signUpWithEmail(opts: { email: string; password: string }): Promise<{ error: string | null }>
  // starts open sign-up; Supabase emails a verification link to /auth/confirm (mandatory -
  // mailer_autoconfirm off, ERD Appendix B round 9)
signInWithEmail(opts: { email: string; password: string }): Promise<{ error: string | null }>
signOut(): Promise<void>
requestPasswordReset(email: string): Promise<{ error: string | null }>
  // starts the forgot-password flow; always returns { error: null } for an unknown email too -
  // Supabase itself doesn't distinguish "sent" from "unknown email", so this function doesn't either
  // (account-enumeration protection, same reasoning as the sign-in error message)
updatePassword(newPassword: string): Promise<{ error: string | null }>
  // sets a new password; only succeeds with a valid session (in practice the short-lived recovery
  // session /auth/confirm establishes from a reset link) - no separate flow-state check needed
verifyEmailOtp(tokenHash: string, type: string): Promise<{ error: string | null }>
  // verifies a token_hash from an email link - the pattern this project's own email templates use
  // (ERD Appendix B round 11), not tied to which browser clicks the link
exchangeCodeForSession(code: string): Promise<{ error: string | null }>
  // exchanges a PKCE `code` param - the path Supabase's DEFAULT (uncustomized) email template uses.
  // Sensitive to which browser clicks the link (Supabase ties the code to a code_verifier cookie set
  // by whoever started the flow) - kept for a template that reverts to the default; this project's
  // own templates use verifyEmailOtp above instead (ERD Appendix B round 11)
updateSession(request: NextRequest): Promise<NextResponse>
  // called only from middleware.ts (project root) to refresh the session cookie on every request;
  // never call this expecting it to authorize anything (ERD section 2: never trust getSession())
```

**Rule:** every route handler in `api` calls `getVerifiedUser` then `requireProjectOwner` before calling into any other module. No other module re-checks ownership - that would be a second source of truth for an authorization decision (ERD section 2, Authorization). `@supabase/*` (the SSR/auth client) is importable from exactly one module - this one (eslint-enforced via `no-restricted-imports`); UI code calls these exports instead of constructing its own client.

---

#### `ai-client`

**Owns:** `ai_generation_run` (the cost/usage log).

**Exports:**
```ts
generateStructured<T>(opts: {
  projectId: string; artifactVersionId?: string; purpose: 'generation'|'semantic_mapping'|'revision'|'quality_check';
  prompt: string; schema: ZodSchema<T>;
}): Promise<{ data: T; runId: string }>
  // calls the LLM, validates against schema, logs one ai_generation_run row (succeeded/failed) regardless of outcome,
  // throws on schema-validation failure (the run is still logged as failed - TR section 33)
```

**Rule:** this is the only module that calls the LLM provider's API. Artifact-type modules never call the provider directly - they build a prompt string and a Zod schema and hand both here. This keeps prompt-version/model/token logging (NFR-004) in one place and makes provider swaps a one-module change.

---

### 4.2 Layer 1 - Lineage core

This layer is pure/deterministic wherever possible and is the highest-risk, most-tested code in the project (ERD section 14). No module in this layer calls `ai-client`, `github`, `jira`, or `stitch`.

#### `identity`

**Owns:** `logical_item`, `item_version`, `artifact_version_item_membership`, `semantic_dependency`.

**Exports:**
```ts
matchAndPersistItems(tx: Tx, opts: {
  draftVersionId: string; artifactId: string; projectId: string;
  baseVersionId: string | null;             // the artifact's approved version captured at draft creation
  itemType: ItemType;
  candidates: Candidate[];                  // { previousDisplayKey?, payload, upstreamRefs: DisplayKey[] }
  boundUpstream: Map<DisplayKey, ItemVersionId>;   // from dependency-binding; already freshness-checked
}): Promise<{ itemVersionId: string; logicalItemId: string; isNew: boolean }[]>
  // ERD 5.3 steps 1-7, run INSIDE the caller's already-open, lock-held transaction:
  //   1. claim previousDisplayKey against base members (one claim per base item, same item_type)
  //   2. content-only fallback match for unclaimed candidates (INV-014)
  //   3. compute projection + sha256 including sorted upstream ids (INV-016)
  //   4. reuse if hash equals the base member's hash; else new revision under the same LogicalItem
  //   5. never reuse a non-base ItemVersion even on a hash match (no revert-reuse)
  //   6. unmatched -> new LogicalItem with an allocated display_key (max-suffix allocator, ERD 4.6)
  //   7. insert item_version + semantic_dependency rows (new items only) + membership row into draftVersionId

rebindDraftItem(tx: Tx, opts: {
  draftVersionId: string; logicalItemId: string; editedPayload: unknown;
}): Promise<{ itemVersionId: string; changedRefs: { logicalItemId: string; from: ItemVersionId; to: ItemVersionId }[] }>
  // TR FR-082 / ERD 5.3 manual-edit path: new ItemVersion, upstream refs rebound to each upstream LogicalItem's
  // CURRENT ItemVersion (not copied), returns the diff for the confirmation UI, refuses if an upstream item
  // was removed. Caller (artifact-lifecycle) is responsible for requiring confirmation before calling this
  // a second time to commit, or for treating the first call as a dry run - see 4.3.

copyMembership(tx: Tx, fromVersionId: string, toVersionId: string): Promise<void>
  // ERD 3.6 manual revision draft: bit-for-bit copy of every membership row, Epic rows first. No hashing,
  // no new ItemVersions - this is the ONLY function that writes membership without going through matching.

resolveDisplayKeys(tx: Tx, artifactId: string, keys: DisplayKey[]): Promise<Map<DisplayKey, LogicalItemId>>
  // validates model-supplied previousDisplayKey / upstreamRefs strings against real rows; used by the
  // two functions above, and by artifact-lifecycle/backlog when composing input for dependency-binding
  // or matchAndPersistItems. Never trusts a key it cannot resolve.

getSourceVersionMembers(tx: Tx, sourceVersionIds: string[]): Promise<SourceVersionMember[]>
  // membership rows (display_key, logical_item_id, item_version_id, artifact_id, project_id, status)
  // for the given artifact_version ids - called by artifact-lifecycle to build the `members` input to
  // dependency-binding.bindUpstreamRefs (4.2) without dependency-binding reading
  // artifact_version_item_membership itself (principle 1: identity is its only reader)

getCurrentItemVersionIds(tx: Tx, projectId: string, itemVersionIds: string[]): Promise<Set<ItemVersionId>>
  // which of the given ItemVersion ids are still the current ItemVersion of their LogicalItem - called
  // by artifact-lifecycle to build the `currentItemVersionIds` input to
  // dependency-binding.checkFreshness (4.2); this is what INV-006 "currentness" actually means
```

**Rule:** every function above takes an already-open `tx` and never opens its own transaction or takes the lock - it is always called from inside `artifact-lifecycle`'s locked transaction. `identity` has no concept of "commit"; it only ever participates in someone else's.

---

#### `dependency-binding`

**Owns:** nothing (no table of its own). Every function here is pure - no `tx` parameter, no database access, no import from `identity` or `db`. All input is data the caller already resolved.

**Exports:**
```ts
bindUpstreamRefs(opts: {
  members: SourceVersionMember[];           // from identity.getSourceVersionMembers(tx, contextSourceVersionIds) (4.2)
  candidates: { upstreamRefs: DisplayKey[] }[];
}): Map<DisplayKey, ItemVersionId>
  // resolves each ref to the EXACT ItemVersion as it exists inside the supplied members -
  // never to a newer version the model did not see (INV-006). Unresolvable ref -> throws a validation error.

checkFreshness(opts: {
  approvedVersionId: string | null;         // artifact's current approved version, read by the caller
  baseVersionId: string | null;
  boundUpstream: Map<DisplayKey, ItemVersionId>;
  currentItemVersionIds: Set<ItemVersionId>; // from identity.getCurrentItemVersionIds(tx, projectId, [...boundUpstream.values()]) (4.2)
}): { stale: true; reason: 'base_changed' | 'dependency_superseded' } | { stale: false }
  // ERD 3.3 steps 2 and 4: is baseVersionId still the artifact's approved version, and is every bound
  // upstream ItemVersion still current? This is the ONLY freshness check in the codebase (INV-006).
```

**Rule:** this module is deliberately separate from `identity` even though it is small, because it is the exact seam where TR INV-006 (generation freshness) lives, and it is the one piece of section 3.3 that has nothing to do with hashing or matching. Being pure - not just separate - is what makes the layer-1 peer-import ban (section 1, principle 2) hold without an exception here: `identity` stays the only reader of `artifact_version_item_membership`/`item_version` (principle 1), and `dependency-binding` stays independently unit-testable against the freshness scenarios (ERD T7, T20) with plain fixtures, no `tx` or real matching run needed. `artifact-lifecycle` is responsible for calling `identity.getSourceVersionMembers`/`getCurrentItemVersionIds` and assembling both functions' input - see 4.3.

---

#### `impact`

**Owns:** `impact_acknowledgement`.

**Exports:**
```ts
getWarnings(projectId: string): Promise<ImpactRow[]>
  // impact(project) - the warning panel; no candidate

evaluateGate(tx: Tx, projectId: string, candidateVersionId: string): Promise<ImpactRow[]>
  // impact(project, candidate) filtered to subject_id IN (candidate's own members) AND NOT acknowledged
  // (ERD 6.5). Called only from inside artifact-lifecycle's locked approval transaction.

getExternalDrift(projectId: string, refId: string): Promise<ImpactRow | null>
  // impact() filtered to subject_kind='external_ref' AND subject_id=refId - used by external-write previews
  // (TR FR-085) and by the GitHub/Jira/Stitch drift badges.

acknowledge(tx: Tx, opts: {
  projectId: string; subject: { itemVersionId: string } | { externalRefId: string };
  obsoleteUpstreamItemVersionId: string; userId: string; note?: string;
}): Promise<void>
  // one impact_acknowledgement row; root_logical_item_id and acknowledged_against are computed by
  // re-reading the root's current ItemVersion at call time (ERD 4.12), never passed in by the caller.

acknowledgeGateBlockers(tx: Tx, projectId: string, candidateVersionId: string, note: string, userId: string): Promise<void>
  // ERD 3.5 / TR FR-084: re-runs evaluateGate itself and writes one acknowledgement per blocking row.
  // The ONLY entry point for the "approve anyway" override. Callers never pass row ids - see 4.3.
```

**Rule:** `impact` never mutates `artifact_version.status`. It reports and it acknowledges; approving is `artifact-lifecycle`'s job. This keeps the SQL `impact()` function's single consumer boundary intact (ERD 6.3: "nothing else may compute staleness").

---

### 4.3 Layer 2 - Artifact lifecycle

#### `artifact-lifecycle`

**Owns:** `project`, `artifact`, `artifact_version`, `approval_event`, `generation_context_ref`.

This is the module every artifact-type module and every route handler goes through to change workflow state. It is the only module that calls `withProjectLock`.

**Exports:**
```ts
createProject(userId: string, name: string, brief: string, inputContext?: unknown): Promise<Project>
  // inserts project + its 4 artifact rows in one transaction (ERD 4.2)

// --- generation (AI) ---
createDraftFromGeneration<TItem>(opts: {
  projectId: string; artifactType: ArtifactType;
  generate: (ctx: { baseVersionId: string | null; contextSourceVersionIds: string[] }) =>
    Promise<{ payload: unknown; candidates: Candidate<TItem>[]; runId: string }>;
  // ^ supplied by the artifact-type module: loads context per TR FR-080, calls ai-client, validates shape
}): Promise<{ version: ArtifactVersion; stale: false } | { version: ArtifactVersion; stale: true }>
  // ERD 3.3 in full: take lock -> capture base/context -> call generate() OUTSIDE any open transaction for
  // the LLM part, then re-open the persist transaction -> bind every candidate's upstreamRefs
  // (identity.getSourceVersionMembers + dependency-binding.bindUpstreamRefs, ERD 3.3 step 3) ->
  // checkFreshness (identity.getCurrentItemVersionIds + dependency-binding.checkFreshness, ERD 3.3 step 4)
  // -> if stale, insert rejected version with raw_output, no items, still-recorded generation_context_ref,
  // commit, return stale:true -> else mark old draft rejected, insert new draft, call
  // identity.matchAndPersistItems per candidate (passing the already-bound boundUpstream map), insert
  // generation_context_ref rows, commit.

// --- manual revision (no AI call) ---
createManualRevisionDraft(projectId: string, artifactType: ArtifactType): Promise<ArtifactVersion>
  // ERD 3.6 / TR FR-081: lock -> reject existing draft if any -> insert draft copying payload/schema_version
  // -> identity.copyMembership(approved, draft) -> commit. No generation_context_ref rows.

// --- manual item edit ---
proposeItemEdit(draftVersionId: string, logicalItemId: string, editedPayload: unknown):
  Promise<{ itemVersionId: string; changedRefs: RebindDiff[] }>
  // dry-run: computes the rebind (identity.rebindDraftItem) inside a transaction that is ROLLED BACK,
  // returns the diff for the UI to show ("S-12 will now depend on R-07 v3 instead of v2" - TR FR-082)
commitItemEdit(draftVersionId: string, logicalItemId: string, editedPayload: unknown, confirmed: boolean):
  Promise<ItemVersion>
  // requires confirmed=true when changedRefs was non-empty on the dry run; re-runs rebindDraftItem for real,
  // inside the lock, and swaps the draft's membership row (only legal while draft - DB trigger backstop)

// --- approval ---
approveVersion(versionId: string, actorId: string): Promise<{ ok: true } | { ok: false; blocking: ImpactRow[] }>
  // ERD 3.4: lock -> load draft -> (Architecture only) architecture-materialization.materialize() ->
  // impact.evaluateGate() -> if blocking rows exist, rollback and return them -> else demote old approved,
  // promote draft, insert approval_event('approved'), commit

approveWithOverride(versionId: string, actorId: string, note: string): Promise<{ ok: true }>
  // TR FR-084: lock -> materialize (Architecture) -> impact.acknowledgeGateBlockers() -> evaluateGate() again
  // (now empty) -> demote/promote/insert approval_event(overrode_stale_check=true, feedback=note) -> commit.
  // Client sends ONLY the note; no row ids cross this function's boundary (ERD 3.5, closes the dead-end
  // where Architecture's ADR ids don't exist until inside this same transaction).

requestRevision(versionId: string, actorId: string, feedback?: string): Promise<void>
  // draft -> rejected, status_reason='revision_requested', approval_event('revision_requested')
rejectVersion(versionId: string, actorId: string, feedback?: string): Promise<void>
  // draft -> rejected, status_reason='user_rejected', approval_event('rejected')
```

**Rule:** `approveVersion` and `approveWithOverride` are the only two functions in the codebase that write `artifact_version.status = 'approved'`. Every artifact-type module's "approve" button calls one of these two - there is no per-artifact-type approve function.

---

#### `architecture-materialization`

**Owns:** `architecture_option`.

**Exports:**
```ts
createOptions(draftVersionId: string, options: [OptionInput, OptionInput]): Promise<ArchitectureOption[]>
  // called by the `architecture` module right after createDraftFromGeneration returns; inserts exactly 2
  // rows (option_key A/B) - the DB CHECK/UNIQUE is the backstop, this is the primary enforcement point

selectOption(draftVersionId: string, optionId: string): Promise<void>
  // records the user's choice as a request-scoped value; NOT persisted until approval (ERD section 11
  // limitation: the selection is a parameter of the approve call, not a stored draft field)

materialize(tx: Tx, opts: { draftVersionId: string; selectedOptionId: string; baseVersionId: string | null }):
  Promise<void>
  // called ONLY by artifact-lifecycle.approveVersion, inside its lock, BEFORE the gate runs (ERD 3.4 step 2):
  //   - requires exactly 2 options exist and selectedOptionId belongs to this version
  //   - calls identity.matchAndPersistItems for the selected option's candidate_decisions, matched against
  //     the base version's ADR members (same mechanics as generation, item_type='architecture_decision')
  //   - stack guard: if every materialized ADR was reused, selected.stack must deep-equal base-selected.stack,
  //     else throws (ERD 5.5) - artifact-lifecycle surfaces this as a blocked approval, not a 500
```

**Rule:** this is the one place `identity.matchAndPersistItems` is called from outside a `createDraftFromGeneration` callback - it is called from inside `artifact-lifecycle.approveVersion`'s transaction instead, because ADRs are minted at approval, not at draft time (ERD 5.5). This is the documented exception to "layer 2 doesn't call layer 1 primitives directly"; everywhere else, layer 2 calls layer 1 only through the callback contract in `createDraftFromGeneration`.

---

### 4.4 Layer 3 - Artifact-type modules

All four modules share one shape. Each owns no table of its own - persistence goes through `artifact-lifecycle` + `identity`, per principle 1. What each module actually owns is: **the prompt, the output schema, and the type-specific quality gate.**

```ts
// shared shape, one per artifact type
interface ArtifactTypeModule<TPayload, TItem> {
  buildPrompt(ctx: GenerationContext): string;              // TR FR-002/010/020/040/060
  outputSchema: ZodSchema<{ payload: TPayload; items: TItem[] }>;  // TR section 33
  toCandidates(items: TItem[]): Candidate[];                // shapes model output into identity's Candidate type
  qualityGate(versionId: string): Promise<QualityIssue[]>;  // FR-012 / FR-063, deterministic, read-only
}
```

#### `requirements`
- **Item type:** `requirement`, including `payload.type='constraint'` items (TR FR-010).
- **Quality gate (FR-012):** missing acceptance criteria, duplicate/invalid reference, malformed item, unresolved assumption, required field missing.
- **Generation prerequisite (FR-080):** none - this is the root artifact.
- **Manual revision:** supported (TR FR-081).

#### `architecture`
- **Item type:** `architecture_decision` (via `architecture-materialization`, not directly).
- **Quality gate:** none specified for P0 (architecture semantic quality checks are P1, TR section 37).
- **Generation prerequisite:** approved Requirements.
- **Manual revision:** **not supported** - regeneration only (ERD 3.6), because decisions only become items at approval.
- Owns the option-count/selection UI flow via `architecture-materialization.createOptions`/`selectOption`.

#### `ui-requirements`
- **Item type:** `ui_requirement`.
- **Quality gate:** none specified for P0.
- **Generation prerequisite:** approved Requirements + Architecture.
- **Manual revision:** supported.

#### `backlog`
- **Item type:** `epic`, `story`.
- **Quality gate (FR-063):** Story has no source Requirement, Requirement has no implementation Story, Story has no acceptance criteria, source item does not exist, source reference points to an invalid project/version.
- **Generation prerequisite:** approved Requirements + Architecture + UI Requirements.
- **Manual revision:** supported.
- Candidates carry `parentDisplayKey` for Stories; `toCandidates` resolves it to `parent_logical_item_id` via `identity.resolveDisplayKeys` before calling `matchAndPersistItems`.

**Rule:** artifact-type modules never import each other. A Backlog Story's dependency on a UI Requirement item is expressed only as a `upstreamRefs` display key resolved by `dependency-binding` against `ui-requirements`'s already-approved output - `backlog` never imports `ui-requirements`'s code.

---

### 4.5 Layer 4 - Shared external-write protocol

#### `external-operations`

**Owns:** `external_operation`, `external_ref`.

**Exports:**
```ts
runOperation<TResult>(opts: {
  projectId: string; provider: 'github'|'jira'|'stitch'; operationType: string;
  operationKey: string; requestHash: string; targetDescriptor: unknown;
  sourceArtifactVersionId: string; sourceItemVersionId?: string;
  send: () => Promise<{ externalId: string; externalKey?: string; externalUrl?: string; metadata?: unknown }>;
  reconcile: () => Promise<{ found: true; externalId: string; externalKey?: string; externalUrl?: string } | { found: false }>;
}): Promise<{ status: 'completed'; ref: ExternalRef } | { status: 'reconciliation_required' } | { status: 'conflict' } | { status: 'in_flight' }>
  // ERD 7.2 in full: insert-first (committed before send), ON CONFLICT DO NOTHING, FOR UPDATE + hash check
  // BEFORE status dispatch, T derived from provider timeout (passed in by the caller's `send` timeout),
  // never holds a DB lock across `send()` or `reconcile()`. On success, inserts external_ref in one
  // transaction with status='completed'. `send` and `reconcile` are supplied by github/jira/stitch.

getRefsForVersion(sourceArtifactVersionId: string): Promise<ExternalRef[]>
getRefForItem(sourceItemVersionId: string): Promise<ExternalRef | null>
```

**Rule:** `github`, `jira`, and `stitch` never write `external_operation` or `external_ref` directly - they only ever call `runOperation` with a provider-specific `send`/`reconcile` pair. This is what makes the insert-first/lock/decide protocol (ERD 7.2) exist in exactly one place instead of three slightly-different copies.

---

### 4.6 Layer 5 - Provider integrations

#### `github`
```ts
previewInit(architectureVersionId: string): Promise<{ mode: 'scaffold'|'docs-only'; repoName: string; impact: ImpactRow[] }>
  // reads the selected option's stack (via `architecture`, read-only) to choose mode; calls
  // impact.getExternalDrift-shaped preview per TR FR-085 before any write
initRepo(architectureVersionId: string, repoName: string): Promise<ExternalRef>
  // builds operationKey/requestHash/targetDescriptor, calls external-operations.runOperation with
  // send() = create repo + write HMAC marker + README/ADRs/lineage.json (FR-033/034),
  // reconcile() = GET repo, adopt only if the marker matches (TR 30.1)
checkDrift(refId: string): Promise<ImpactRow | null>   // FR-036, delegates to impact.getExternalDrift
```

#### `jira`
```ts
previewExport(backlogVersionId: string): Promise<{ epics: number; stories: number; skipped: PreviewItem[]; impact: ImpactRow[] }>
exportBacklog(backlogVersionId: string, decisions: Map<LogicalItemId, 'skip'|'create_new'>): Promise<ExternalRef[]>
  // exports Epics before Stories (ERD 7.4); Story parent resolved by Epic's LogicalItem, not just its
  // current membership row (TR FR-074 extended); each item is one external-operations.runOperation call
  // with reconcile() = search-by-label with bounded re-query (TR 30.2)
```

#### `stitch`
```ts
previewPrompt(uiRequirementsVersionId: string): Promise<{ prompt: string; impact: ImpactRow[] }>
generate(uiRequirementsVersionId: string): Promise<StitchOutput>
  // external-operations.runOperation; on definitive failure, writes/updates stitch_output(mode='manual_fallback')
  // directly (not through runOperation, since there is no external object on failure) with the preserved prompt
```

**Rule:** these three modules are the only ones with network calls to third parties (besides `ai-client`'s LLM call). They read artifact-type modules' output read-only (to build previews) and never write into layers 0-3.

---

### 4.7 Layer 6 - API

Next.js route handlers. Each handler: `getVerifiedUser` -> `requireProjectOwner` -> call exactly one layer-3/4/5 function -> serialize the result. No handler imports `db` or `identity` directly. `artifact-lifecycle` (layer 2) is the one layer-2 module reachable directly from `api`, and only for the four `/api/projects*` routes (E1-S8): `project`/`artifact` have no layer-3 artifact-type module of their own to route through (there's no "project" artifact type), so `POST/GET /api/projects` and `GET/PATCH /api/projects/:projectId` call `artifact-lifecycle.createProject`/`getProjectById`/`listProjectsForOwner`/`updateProject` directly - not just creation.

A second set of routes reaches `artifact-lifecycle` directly for the same structural reason (E4-S6): `GET /api/projects/:projectId/external-refs`, the three `.../github/*` routes, the two `.../jira/*` routes and the two `.../stitch/*` routes all call `artifact-lifecycle.getProjectById` to resolve a `projectId` to its approved `architecture`/`backlog`/`ui_requirements` version id (and, for `external-refs`, all four) before calling their layer-5 provider function. No layer-3/4/5 export performs that mapping, and API Contracts section 7's own text for `GET .../external-refs` - "called once per approved version and merged" - requires it. The layer-5 call that follows is still the one real domain call each handler makes; the `getProjectById` read only resolves which version to make it against.

Every other route still reaches layer 2 only indirectly, through a layer-3/4/5 function.

---

### 4.8 UI reads (pages, outside `api`)

Not a module - this section exists because sections 1-7 modeled `src/app/api/**` and never said anything about `src/app/**` outside it, and E5-S1 is where that silence first became a real, load-bearing decision rather than a hypothetical.

**Rule:** a Server Component (a page, not a route handler) may call a layer's *read-only* exports directly - the same way `sign-up`/`sign-in`/`forgot-password` already call `auth.getVerifiedUser()` directly rather than fetching `/api/session/bootstrap` - instead of self-fetching the app's own API route over HTTP for data it needs to render. This is deliberately narrower than `eslint-plugin-boundaries`' actual `app` element type, which permits any import (`eslint.config.mjs`'s `{ from: ['app'], allow: elementTypes }` has no per-layer restriction and will not catch a violation of this rule) - the lint config is a backstop against layer *cycles*, not a substitute for this prose.

What this does **not** license:
- **No write.** Every mutation still goes through its documented `api` route (E5-S1: project creation is `POST /api/projects`, called by `new-project-form.tsx` with a real browser `fetch`, not a direct `artifact-lifecycle.createProject` call from a Server Action or page). A page may read a lower layer directly; only `api` (or, inside it, `artifact-lifecycle` itself) writes one.
- **No new ownership check.** `requireProjectOwner` is still the one project-ownership check in the codebase (section 4.1) - a page calling it directly (`src/app/projects/[projectId]/page.tsx`) is the same check, called from a second legitimate call site, not a second implementation of it.
- **Not a license to reach past layer 2.** `layer0-db` or `layer1-identity` directly from a page is still out of bounds - nothing about this section extends the exception past what layer-2's own read exports (`artifact-lifecycle.listProjectsForOwner`/`getProjectById`, `auth.getVerifiedUser`/`requireProjectOwner`) already surface.

E5-S1 is the first concrete instance: `src/app/projects/page.tsx` calls `listProjectsForOwner`; `src/app/projects/[projectId]/page.tsx` calls `requireProjectOwner` then `getProjectById`. Later E5 stories reading further into layer 3 (artifact-type modules) from a page follow this same shape - read directly, write through `api` - rather than each re-deriving it.

---

## 5. Table ownership matrix

| Table | Owning module | ERD section |
|---|---|---|
| `app_user` | `auth` | 4.1 |
| `project` | `artifact-lifecycle` | 4.2 |
| `artifact` | `artifact-lifecycle` | 4.3 |
| `artifact_version` | `artifact-lifecycle` | 4.4 |
| `approval_event` | `artifact-lifecycle` | 4.5 |
| `logical_item` | `identity` | 4.6 |
| `item_version` | `identity` | 4.7 |
| `artifact_version_item_membership` | `identity` | 4.8 |
| `architecture_option` | `architecture-materialization` | 4.9 |
| `generation_context_ref` | `artifact-lifecycle` | 4.10 |
| `semantic_dependency` | `identity` | 4.11 |
| `impact_acknowledgement` | `impact` | 4.12 |
| `ai_generation_run` | `ai-client` | 4.13 |
| `external_operation` | `external-operations` | 4.14 |
| `external_ref` | `external-operations` | 4.15 |
| `stitch_output` | `stitch` | 4.16 |

Every table is covered exactly once. If a future change needs a second module to write a table, that is a signal to re-examine the boundary, not to add a second write path.

---

## 6. Transaction and lock discipline

Only `artifact-lifecycle` calls `db.withProjectLock`. The full list of operations that must happen inside it (ERD section 3.2's trigger list - anything that changes `artifact_version.status`, allocates a `version_number`/`revision_number`/`display_key`, or mints an ItemVersion) maps onto `artifact-lifecycle`'s exports exactly:

| Locked operation | Function |
|---|---|
| Allocate `version_number`, mint items, write context refs | `createDraftFromGeneration` |
| Allocate `version_number`, copy membership | `createManualRevisionDraft` |
| Mint one item (rebind) | `commitItemEdit` |
| Materialize ADRs, run gate, promote/demote | `approveVersion` |
| Materialize ADRs, acknowledge, run gate, promote/demote | `approveWithOverride` |
| Demote to rejected | `requestRevision`, `rejectVersion` |

`identity`'s functions never call `withProjectLock` themselves - they receive an open `tx` from whichever `artifact-lifecycle` function called them. This is what makes the "materialize ADRs inside the approval transaction" requirement (ERD 3.4 step 2, 5.5) fall out of the layering automatically instead of needing a special case.

`external-operations.runOperation` never takes the project lock and never holds any DB transaction open across `send()`/`reconcile()` (ERD 7.2) - external-write concurrency is handled by the operation row's own `INSERT ... ON CONFLICT` + `FOR UPDATE`, deliberately independent of the project lock so a slow GitHub call can never block an unrelated approval.

---

## 7. Folder layout

```text
src/
  db/                       # module 1: schema.ts, client.ts, lock.ts
  auth/                     # module 2
  ai-client/                # module 3
  lineage/
    identity/               # module 4
    dependency-binding/     # module 5
    impact/                 # module 6
  artifact-lifecycle/        # module 7
  architecture-materialization/   # module 8
  artifact-types/
    requirements/            # module 9
    architecture/            # module 10
    ui-requirements/         # module 11
    backlog/                 # module 12
  external/
    operations/              # module 13
    github/                  # module 14
    jira/                    # module 15
    stitch/                  # module 16
  app/api/                  # module 17: Next.js route handlers only
```

Each module folder exports its public surface from an `index.ts`; nothing outside the folder imports a file that is not re-exported there. This is the enforcement mechanism for principle 1 in a single Next.js app with no build-time module boundary of its own.

---

## 8. Cross-reference to ERD build slices

| ERD slice (section 14) | Modules built |
|---|---|
| 1 | `db`, `auth`, `artifact-lifecycle` (tables + guards only, no generation yet) |
| 2 | `identity`, `dependency-binding`, `impact`, `artifact-lifecycle.createDraftFromGeneration`/`createManualRevisionDraft` |
| 3 | `architecture-materialization`, `artifact-lifecycle.approveVersion`/`approveWithOverride`, all four artifact-type modules |
| 4 | `external-operations`, `github`, `jira`, `stitch` |

This matches the ERD's own risk ordering: the lineage core (layers 1-2) is built and tested against the Appendix C suite before any artifact-type module exists to generate real data for it.

---

## 9. Traceability

| Business Objective | Business Requirement | Realized by module(s) |
|---|---|---|
| BO-005 (humans in control) | BR-002 | `artifact-lifecycle` (approval gate, override) |
| BO-003 (traceability) | BR-003, BR-004 | `identity`, `dependency-binding`, `impact` |
| BO-006 (meaningful AI) | BR-009 | `ai-client` (AI boundary), `identity` (code owns identity) |
| BO-001 (reduce repetitive work) | BR-005, BR-006, BR-007 | `github`, `stitch`, `jira` |
| BO-004 (actionable impact) | BR-004 | `impact` |
| BO-005 (retry-safe writes) | BR-008 | `external-operations` |

---

## 10. Assumptions made in this draft

These are engineering judgment calls consistent with the ERD/TR but not literally specified by either. Flag if any should change before API contracts are drafted:

1. **`proposeItemEdit`/`commitItemEdit` two-step shape.** The ERD specifies the rebind-with-confirmation behavior (TR FR-082) but not the API shape. A dry-run-then-commit pair was chosen over a single call with a `confirmed` flag on the first call, so the UI can show the diff before the user has committed to anything - consistent with "shown to and confirmed by the user" (ERD 5.3) but the two-call split is this document's choice.
2. **`architecture-materialization.selectOption` as request-scoped, not persisted.** This follows directly from ERD section 11 limitation 11 (the selection cannot be persisted before approval, by CHECK) - `selectOption` is shown here as a function for clarity but in the API layer it is realistically just a field on the `approveVersion` request body, not a separate persisted call.
3. **`runOperation`'s `send`/`reconcile` closure shape.** The ERD describes the protocol's steps (7.2) but not how provider-specific code plugs in. A pair of async closures was chosen so `external-operations` stays provider-agnostic without a plugin registry, which would be over-engineering for three providers.
