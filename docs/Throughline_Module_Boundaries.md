# Throughline - Module Boundaries

**Document version:** 1.10
**Status:** Derived from ERD/Data Model v1.8 and Technical Requirements & Lineage Invariants v1.4. Parent of API Contracts -> Jira Plan -> Implementation. v1.10 (E3-S10): records, in place in section 4 rather than in changelog prose only, the reads, typed errors and `generate` entry points the artifact/version API routes (API Contracts sections 4-5, all eleven) needed, and corrects section 4.7's prose, which had become too narrow. Section 4.2: `identity.getSourceVersionMembers` also returns each member's `revisionNumber` (`item_version.revision_number`, for `ItemVersionDTO.revisionNumber`) - an additive column on the same read. Section 4.3: `artifact-lifecycle` gains four reads - `getVersionRef` (resolves `:versionId` to its project/artifact/type so a route can run `requireProjectOwner` before touching anything else, API Contracts 1.4), `getArtifactId`, `listArtifactVersions`, `getArtifactVersionDetail` - and two typed errors, `VersionNotDraftError` and `ApprovalGateBlockedError`, plus a forward of `identity`'s `ItemEditError`/`RebindDiff` (layer 6 may not import `identity`; the same class object is re-exported, never a second one, so `instanceof` matches what `item-edit.ts` threw); `architecture-materialization` gains `getOptionsForVersion`; and `createDraftFromGeneration`'s `generate` callback is now stated concretely as an artifact-type module's `<type>.generate({ projectId, feedback?, contextSourceVersionIds?, baseVersionId? })` - the route threads the callback's own captured ids into the module so the prompt is built from exactly the versions the draft is recorded against (INV-006), rather than the module re-reading the project a third time (the ctx-to-prerequisite mapping is stated in 4.4). Section 4.4: every artifact-type module exports that `generate`, and Architecture's additionally returns the two `options` a route passes to `architecture.createOptions` once the draft exists; the `architecture` bullet also records its composed `approveVersion`/`approveWithOverride`, and module map row 10 its `identity`/`db` reads. Section 4.3 also states, in place, what the code actually does for approval: `approveVersion`/`approveWithOverride` take an optional `ArchitectureApproval` (`{ selectedOptionId, materialize }`, injected by the `architecture` module so layer-2 peers need not import each other) and return `ApproveVersionResult` (`{ ok: false, code }` variants for option/stack refusals), the "no per-artifact-type approve function" rule is reworded to match (the composed functions delegate and write nothing), and `materialize`'s own entry now says it is only called from inside lifecycle's approval transaction. A blocked approval now carries `displayKeys` (`item_version.id -> display_key` for every id its blocking rows name) captured INSIDE the approval transaction before it rolls back - `ApprovalGateBlockedError.displayKeys` and `ApproveVersionResult.displayKeys` - because an Architecture approval mints its ADR ItemVersions before the gate runs and the rollback un-mints them while the blocking rows still name them (ERD 3.5); this needed one more additive `identity` read, `getDisplayKeysByItemVersionId(tx, ids)` (4.2), and 4.2's `getSourceVersionMembers` entry now lists every column that read returns. Section 4.1's `auth` rule states the caveat that `:versionId`/`:operationId` routes resolve the id to its project (a read-only lookup that discloses nothing, API Contracts 1.4) before `requireProjectOwner`. Section 4.7: the artifact/version routes call `artifact-lifecycle` directly (and, for Architecture approval and options, the `architecture` layer-3 facade), because API Contracts annotates them `-> artifact-lifecycle.*` and no layer-3 wrapper exists for approve, reject, edit or the reads. That is not a new decision - it is what section 4.3's opening paragraph already says ("every route handler goes through artifact-lifecycle to change workflow state") and it is legal under `eslint.config.mjs`'s `layer6-api` allow-list; only 4.7's "the four `/api/projects*` routes" / "every other route reaches layer 2 only indirectly" prose was wrong, and is corrected: the opening paragraph and the closing sentence now agree that layer 6 calls layer 2 directly for exactly three enumerated route sets (the four `/api/projects*` routes, the six E4-S6 provider routes, the eleven E3-S10 artifact/version routes) and that every other route goes through a layer-3/4/5 function. No write path or table ownership changed. v1.9 (E3-S9): section 4.2's `identity` export list gains `getUpstreamDependencies` (`semantic_dependency` edges by downstream ItemVersion) - `backlog`'s own FR-063 quality gate and its regeneration-stability prompt both need to read that table by a dimension no existing read covered, recorded the same way v1.5/v1.8 recorded identity's/external-operations' own new reads: real signature in the Exports block, not changelog prose only. A read only; no write path or table ownership changed. This story also found `createDraftFromGeneration` (section 4.3) structurally unable to express Backlog's one-draft-two-item-type mint (ERD 3.3 step 5's "Epic rows before their Stories") under its own already-implemented `itemType: ItemType` (singular) shape - resolved as a narrow additive change to existing code, now recorded in place: `Candidate` gained optional `itemType` and `outputKey` fields (section 4.2's `matchAndPersistItems` comment) and `createDraftFromGeneration`'s `itemType` option is now optional - a default for candidates that don't set their own - with candidates grouped by effective type and persisted epic-then-story into the one draft (section 4.3's block; it describes existing code only, and the block's other already-known deviations - `artifactId`/`contextSourceVersionIds`/`actorUserId` options - are unchanged). Section 4.4's `backlog` bullet, which said `toCandidates` resolves `parentDisplayKey` via `identity.resolveDisplayKeys` before calling `matchAndPersistItems`, is rewritten to match the code: a Story's `parentDisplayKey` is the model's output-local Epic label, whose real `display_key` does not exist until the Epics are persisted (the allocator never reuses keys, so labels and real keys drift on any regeneration), so `toCandidates` (pure) tags Epic candidates with `outputKey` and `createDraftFromGeneration` rewrites each Story's label to the real key of the Epic that carried it, between the epic and story `matchAndPersistItems` calls in the same transaction; `matchAndPersistItems` itself still only ever sees real keys. Also in section 4.2: `getUpstreamDependencies`' `upstreamItemType` is `string | null` (the column is plain text), matching the code. v1.8 (E4-T3): section 4.5's `external-operations` export block now lists the six additive reads that had accumulated in code without being recorded here - `getRefById` (E4-S2), `getRefsForLogicalItem` (E4-S3), and `getOperationById`, `getOperationsForVersion`, `getDisplayKeysForItemVersions`, `getRefsForProject` (E4-S6/E4-T3). A doc-chain review caught that v1.7's own section 4.7 text cites `getRefsForProject` while section 4.5, the authoritative export list for that module, did not mention it - an internal contradiction inside one version. Recorded the same way v1.5 recorded `identity`'s two new reads in section 4.2: real signatures in the Exports block, not changelog prose only. All six are reads; no write path or table ownership changed. v1.7 (E4-T3): narrowed v1.6's section 4.7 exception from eight routes to six. The slice-4 gate found that resolving external refs through each artifact type's CURRENT approved version id lost track of a GitHub repository the moment Architecture was re-approved (the ref stays pinned to the version approved when `initRepo` ran, and there is never a second `initRepo` - ERD 4.15). `external-operations` gained `getRefsForProject(projectId)`, a read of its own owned `external_ref` table by that table's own `project_id` column, so `GET .../external-refs` and `GET .../github/ref` no longer need `artifact-lifecycle.getProjectById` at all. This also makes API Contracts section 7's normative sentence ("All GitHub/Jira/Stitch references created from this project") literally true; that section's parenthetical "called once per approved version and merged" was an implementation hint that turned out to be lossy across re-approval. v1.6 (E4-S6): named a third section 4.7 exception a boundary-auditor review flagged as real but undocumented - the eight GitHub/Jira/Stitch/external-refs routes call `artifact-lifecycle.getProjectById` directly, which 4.7's existing prose textually allowed only for the four `/api/projects*` routes. Not a new decision: no layer-3/4/5 export maps a `projectId` to its approved version ids, and API Contracts section 7's own text for `GET .../external-refs` ("called once per approved version and merged") requires exactly that mapping, so the exception was already implied by the frozen contract these routes implement - this states it in prose rather than leaving it in a story-local README. Same shape as v1.3, which recorded the `/api/projects*` exception for the same reason. v1.5 (E2-S5): resolved a self-contradiction this story's implementation surfaced - section 4.2 said `dependency-binding` calls `identity.resolveDisplayKeys`, while the module map (section 3) and the enforced eslint layer-1 peer-import ban (`eslint.config.mjs`) said `dependency-binding` depends on nothing but `db`. `checkFreshness` had the same latent problem: INV-006 "currentness" is defined entirely in terms of `identity`'s LogicalItem -> current-ItemVersion pointer (TR section 18), so both of `dependency-binding`'s functions were coupled to `identity`-owned data, not just the one the prose named. Fix: `bindUpstreamRefs` and `checkFreshness` are now pure functions - no `tx`, no `identity` import - taking already-resolved data as arguments; `identity` gains two reads (`getSourceVersionMembers`, `getCurrentItemVersionIds`) that `artifact-lifecycle` calls to compose that input before invoking either function (same shape `backlog` already uses for `resolveDisplayKeys`, section 4.4). No eslint change was needed - the peer-import ban was already correct once the module's own functions stopped needing to cross it. v1.4 (E5-S1): added section 4.8, naming a real gap a boundary-auditor review surfaced - this story's Server Components (`src/app/projects/page.tsx`, `src/app/projects/[projectId]/page.tsx`) read `artifact-lifecycle` and call `requireProjectOwner` directly, which section 4.7's existing exception textually covers only for `api` route handlers, not pages. Not a new decision: pages calling `auth.getVerifiedUser` directly already predates this story (sign-up/sign-in/forgot-password), and this just extends the same "pages read; api layer still owns the one write" shape to `artifact-lifecycle`'s read exports rather than forcing a page to self-fetch its own route over HTTP. The one mutation this story has (project creation) still goes through `POST /api/projects`, unchanged. v1.3 (E1-S8): named two exceptions this story's implementation required and a boundary-auditor review flagged as real but undocumented - `requireProjectOwner`'s direct read of `project` (section 4.1) and every `/api/projects*` route's direct call into `artifact-lifecycle`, not just the creation route (section 4.7). Neither changes a decision: both were already implied (4.1's own "NOT YET IMPLEMENTED" note anticipated the former; `eslint.config.mjs`'s own comment already flagged the latter as an intentionally-unencoded exception) - this just states them in prose instead of leaving them for the next reader to re-derive. v1.2: `auth` module's export list filled in for real (signUpWithEmail/signInWithEmail/signOut/requestPasswordReset/updatePassword/verifyEmailOtp/exchangeCodeForSession/updateSession) - it had drifted since being built, listing only the original three. v1.1: `getVerifiedUser` no longer checks an email allowlist - ERD Appendix B round 9.
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
| 10 | `architecture` | 3 | (payload shape + prompt only) | `ai-client`, `artifact-lifecycle`, `architecture-materialization`, `identity` (reads: `getSourceVersionMembers`, `getUpstreamDependencies`), `db` (`withTx`, read-only) |
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

**Rule:** every route handler in `api` calls `getVerifiedUser` then `requireProjectOwner` before calling into any other module - with one caveat for routes addressed by a version or operation id rather than a project id (`/api/artifact-versions/:versionId/*`, `/api/external-operations/:operationId*`): `requireProjectOwner` needs a `projectId`, so such a route first resolves the id to its project through a read-only lookup (`artifact-lifecycle.getVersionRef` / `external-operations.getOperationById`, API Contracts 1.4) and only then calls `requireProjectOwner`. That lookup discloses nothing and mutates nothing: a version/operation that belongs to someone else and one that does not exist both answer the identical `404` (API Contracts 1.4), and the route does no further work until ownership is proven. No other module re-checks ownership - that would be a second source of truth for an authorization decision (ERD section 2, Authorization). `@supabase/*` (the SSR/auth client) is importable from exactly one module - this one (eslint-enforced via `no-restricted-imports`); UI code calls these exports instead of constructing its own client.

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
  candidates: Candidate[];                  // { previousDisplayKey?, payload, upstreamRefs: DisplayKey[],
                                            //   parentDisplayKey?, position?, itemType?, outputKey? } - see below
  boundUpstream: Map<DisplayKey, ItemVersionId>;   // from dependency-binding; already freshness-checked
}): Promise<{ itemVersionId: string; logicalItemId: string; isNew: boolean }[]>
  // `Candidate.parentDisplayKey` (Stories only) is, at this function, a REAL display_key of an Epic already
  // in draftVersionId's membership - never a model label. `Candidate.itemType?` and `Candidate.outputKey?`
  // (E3-S9) are read ONLY by artifact-lifecycle.createDraftFromGeneration (4.3), never by this function:
  // `itemType` groups a mixed-type candidate list (Backlog's `epic` + `story`) into one call per type, and
  // `outputKey` is a model-supplied output-local label (Backlog's Epic `displayKey`) that createDraftFromGeneration
  // translates into the Story candidates' real `parentDisplayKey` after the Epic group is persisted.
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
  // membership rows for the given artifact_version ids - called by artifact-lifecycle to build the
  // `members` input to dependency-binding.bindUpstreamRefs (4.2) without dependency-binding reading
  // artifact_version_item_membership itself (principle 1: identity is its only reader)
  // Every row carries: sourceVersionId, artifactId, projectId, status (the version's), logicalItemId,
  // itemVersionId, displayKey, itemType (logical_item.item_type, added E3-S9/E4-S3), parentLogicalItemId
  // (membership.parent_logical_item_id, E4-S3), payload (item_version.payload, E4-S4) and revisionNumber
  // (item_version.revision_number - added E3-S10 for ItemVersionDTO.revisionNumber, served by
  // artifact-lifecycle.getArtifactVersionDetail from this same read rather than a second query of an
  // identity-owned table). The item columns (logicalItemId .. revisionNumber) are null when the row has
  // no item (the LEFT JOIN row of a version with no members). There is no ORDER BY: a caller that shows
  // rows to a model or a user sorts them itself (numeric-aware by displayKey).

getDisplayKeysByItemVersionId(tx: Tx, itemVersionIds: ItemVersionId[]): Promise<Map<ItemVersionId, DisplayKey>>
  // item_version.id -> logical_item.display_key, read through the caller's OPEN transaction (added by the
  // E3-S10 review-fix pass). artifact-lifecycle's approval transaction calls it when the gate blocks, to
  // capture the keys for every id the blocking ImpactRows name BEFORE the transaction rolls back - a
  // blocked Architecture approval un-mints the ADR ItemVersions `materialize` just created, so no read
  // after the rollback could resolve them (ERD 3.5). external-operations.getDisplayKeysForItemVersions
  // (4.5) is the same join on the pool, for ids that are already committed.

getCurrentItemVersionIds(tx: Tx, projectId: string, itemVersionIds: string[]): Promise<Set<ItemVersionId>>
  // which of the given ItemVersion ids are still the current ItemVersion of their LogicalItem - called
  // by artifact-lifecycle to build the `currentItemVersionIds` input to
  // dependency-binding.checkFreshness (4.2); this is what INV-006 "currentness" actually means

getUpstreamDependencies(tx: Tx, downstreamItemVersionIds: string[]): Promise<{
  downstreamItemVersionId: ItemVersionId; upstreamItemVersionId: ItemVersionId;
  dependencyProjectId: ProjectId; upstreamProjectId: ProjectId | null;
  upstreamLogicalItemId: LogicalItemId | null; upstreamItemType: string | null;
  upstreamDisplayKey: DisplayKey | null;
}[]>
  // `semantic_dependency` edges by their downstream ItemVersion (added E3-S9/SCRUM-44) - `backlog`'s own
  // qualityGate (FR-063: "Story has no source Requirement", "Requirement has no implementation Story",
  // "source item does not exist", "source reference points to an invalid project/version") and its own
  // generate()'s regeneration-stability prompt both need this; no existing read covers the
  // semantic_dependency table. LEFT JOINs onto item_version/logical_item for the upstream side - null
  // fields / a project_id mismatch are what the last two FR-063 checks read, even though both are already
  // DB-enforced unreachable in practice (item_version rows are never deleted; semantic_dependency's own
  // composite FKs force both ends into one project).
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
  itemType?: ItemType;
  // ^ in code (E3-S9): optional - the DEFAULT item type for candidates that don't set their own
  //   `Candidate.itemType` (4.2). Every artifact type except Backlog mints one item type and omits candidate
  //   itemTypes. Backlog mints `epic` then `story` into ONE draft: candidates are grouped by effective item
  //   type and identity.matchAndPersistItems is called once per group, epic before story, inside the same
  //   transaction/draft row; a candidate group whose type is unknown (or architecture_decision, ERD 5.5)
  //   is rejected before the lock is taken.
  generate: (ctx: { baseVersionId: string | null; contextSourceVersionIds: string[] }) =>
    Promise<{ payload: unknown; candidates: Candidate<TItem>[]; runId: string }>;
  // ^ supplied by the artifact-type module: loads context per TR FR-080, calls ai-client, validates shape.
  //   In code (E3-S10) this is `<type>.generate({ projectId, feedback?, contextSourceVersionIds?, baseVersionId? })`
  //   (4.4), and the route composes the two, threading the callback's own `ctx` through:
  //   `createDraftFromGeneration({ ..., generate: (ctx) => <type>.generate({ projectId, feedback,
  //   contextSourceVersionIds: ctx.contextSourceVersionIds, baseVersionId: ctx.baseVersionId }) })`.
  //   The module then builds its prompt from exactly the versions this draft is recorded against (INV-006:
  //   the model must see what generation_context_ref says it saw) instead of re-reading the project's approved
  //   ids a further time, which an approval landing in between would change. Called without them
  //   (`generate({ projectId })`) a module reads the project's current approved ids, as before.
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
approveVersion(versionId: string, actorId: string, architecture?: ArchitectureApproval): Promise<ApproveVersionResult>
  // ERD 3.4: lock -> load draft -> (Architecture only) architecture.materialize() ->
  // impact.evaluateGate() -> if blocking rows exist, rollback and return them -> else demote old approved,
  // promote draft, insert approval_event('approved'), commit
  //
  // In code (E3-S10): `ArchitectureApproval = { selectedOptionId: string | undefined; materialize: (tx, ctx) =>
  //   Promise<{ ok: true } | { ok: false; code }> }` is how layer 2 gets architecture-materialization's
  // `materialize` without importing its layer-2 peer: the layer-3 `architecture` module composes it in (4.4:
  // `architecture.approveVersion` / `architecture.approveWithOverride`, which inject `{ selectedOptionId,
  // materialize }`). For an Architecture draft the argument is REQUIRED - the plain call, with no `architecture`
  // argument, refuses with `{ ok: false, blocking: [], code: 'OPTION_NOT_SELECTED' }` rather than approve a draft
  // whose ADRs were never minted; for any other type it must be omitted (passing it is a plain Error).
  // `ApproveVersionResult = { ok: true } | { ok: false; blocking: ImpactRow[]; displayKeys?: Map<ItemVersionId,
  //   DisplayKey>; code?: 'OPTION_NOT_SELECTED' | 'OPTION_COUNT_INVALID' | 'STACK_UNCHANGED_DECISIONS' }`:
  //   - a gate block is `{ ok: false, blocking, displayKeys }` with NO `code`;
  //   - an option/stack refusal from `materialize` is `{ ok: false, blocking: [], code }` (the route maps it to
  //     422/409, not APPROVAL_BLOCKED).
  // `displayKeys` is item_version.id -> display_key for every id `blocking` names (each row's root and every
  // `path` entry), resolved by identity.getDisplayKeysByItemVersionId (4.2) INSIDE the approval transaction,
  // before the block rolls it back. This matters for Architecture: `materialize` runs BEFORE the gate, so a
  // blocked approval has already minted its ADR ItemVersions and the rollback un-mints them while the blocking
  // rows still name them as subject / last path element (ERD 3.5, "Why ids never cross the API") - nothing
  // read after the rollback could turn those ids into display keys, so the API layer serializes
  // `details.blocking` from this map instead of a fresh lookup.

approveWithOverride(versionId: string, actorId: string, note: string, architecture?: ArchitectureApproval): Promise<ApproveVersionResult>
  // TR FR-084: lock -> materialize (Architecture) -> impact.acknowledgeGateBlockers() -> evaluateGate() again
  // (now empty) -> demote/promote/insert approval_event(overrode_stale_check=true, feedback=note) -> commit.
  // Client sends ONLY the note; no row ids cross this function's boundary (ERD 3.5, closes the dead-end
  // where Architecture's ADR ids don't exist until inside this same transaction).
  // An override satisfies the gate, it does not bypass it: if the recomputed gate STILL blocks the whole
  // transaction rolls back and this THROWS ApprovalGateBlockedError (carrying the same `blocking` and
  // `displayKeys`) - unlike approveVersion, which returns the block. Option/stack refusals are still returned
  // as `{ ok: false, code }`. Empty note -> plain Error.

requestRevision(versionId: string, actorId: string, feedback?: string): Promise<void>
  // draft -> rejected, status_reason='revision_requested', approval_event('revision_requested')
rejectVersion(versionId: string, actorId: string, feedback?: string): Promise<void>
  // draft -> rejected, status_reason='user_rejected', approval_event('rejected')

// --- reads for the API layer (E3-S10; API Contracts sections 4-5). No lock, no write. ---
getVersionRef(versionId: string): Promise<{ versionId: string; artifactId: string; projectId: string; artifactType: ArtifactType } | null>
  // resolves `:versionId` to its project/artifact/type; null for an unknown id AND for a string that is not a uuid
  // (never reaches Postgres). A route calls this first, then auth.requireProjectOwner(userId, ref.projectId), so
  // another owner's version and a nonexistent one are both 404 (API Contracts 1.4).
getArtifactId(projectId: string, type: ArtifactType): Promise<string | null>
listArtifactVersions(projectId: string, type: ArtifactType): Promise<ArtifactVersionRecord[]>
  // every version of that artifact, newest (version_number) first; the row's columns plus `artifactType`, dates still Date
getArtifactVersionDetail(versionId: string): Promise<{ version: ArtifactVersionRecord & { projectId: string }; items: VersionItem[] } | null>
  // the version row plus its members (identity.getSourceVersionMembers - `items` is [] for a version with no
  // members: an Architecture draft, whose ADRs are not lineage until approval, or a stale-rejected one), each item
  // carrying its current raw, id-based `impact: ImpactRow | null` from ONE impact.getWarnings(projectId) call (INV-025).
  // Turning ids into display keys and Dates into ISO strings is the API layer's job (src/lib/serialize.ts).

// --- typed errors (E3-S10) ---
VersionNotDraftError            // approveVersion/approveWithOverride/requestRevision/rejectVersion: the version exists but is not a draft
ApprovalGateBlockedError        // `.blocking: ImpactRow[]`, `.displayKeys: Map<ItemVersionId, DisplayKey>` (captured before the
                                // rollback, see approveVersion above; empty when hand-built); thrown by approveWithOverride when
                                // the recomputed gate still blocks (approveVersion reports the same condition as
                                // `{ ok: false, blocking, displayKeys }`)
ItemEditError, type RebindDiff  // re-exported from identity for layer 6: proposeItemEdit/commitItemEdit throw it with
                                // `.code` in VERSION_NOT_DRAFT | ITEM_NOT_IN_VERSION | UPSTREAM_REMOVED | CONFIRMATION_REQUIRED
```

**Rule:** `approveVersion` and `approveWithOverride` are the only two functions in the codebase that write `artifact_version.status = 'approved'`. Every artifact-type module's "approve" button ends in one of these two - there is no per-artifact-type approve *implementation*. The one artifact-type module that exports `approveVersion`/`approveWithOverride` of its own, `architecture` (4.4), only composes: it delegates to these two, adding the `ArchitectureApproval` argument that carries `materialize`, and writes nothing itself - so this rule ("the only two functions that write `status = 'approved'`") stays true. Architecture approval must go through that composed pair; the plain lifecycle functions skip `materialize` and refuse an Architecture draft.

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

materialize(tx: Tx, opts: ArchitectureDraftContext & { selectedOptionId: string }):
  Promise<{ ok: true } | { ok: false; code: 'OPTION_NOT_SELECTED' | 'OPTION_COUNT_INVALID' | 'STACK_UNCHANGED_DECISIONS' }>
  // (in code, E3-S10 wording: `ArchitectureDraftContext` is the draft's id/artifact/project/base ids plus the
  // `bindUpstreamRefs` closure, supplied by artifact-lifecycle's `withArchitectureDraft`/approval transaction; an
  // option/stack refusal is a returned `code`, which lifecycle turns into `{ ok: false, code }` - not a throw.)
  // called ONLY inside artifact-lifecycle's approval transaction, under its lock, BEFORE the gate runs (ERD 3.4
  // step 2). It is never called by a peer directly: the layer-3 `architecture` module injects it into
  // artifact-lifecycle.approveVersion/approveWithOverride through their `ArchitectureApproval` argument (4.3,
  // 4.4), because layer-2 peers may not import each other.
  //   - requires exactly 2 options exist and selectedOptionId belongs to this version
  //   - calls identity.matchAndPersistItems for the selected option's candidate_decisions, matched against
  //     the base version's ADR members (same mechanics as generation, item_type='architecture_decision')
  //   - stack guard: if every materialized ADR was reused, selected.stack must deep-equal base-selected.stack,
  //     else throws (ERD 5.5) - artifact-lifecycle surfaces this as a blocked approval, not a 500

getOptionsForVersion(artifactVersionId: string): Promise<ArchitectureOption[]>
  // (E3-S10) a plain read of this module's own table: the version's architecture_option rows, option_key 'A'
  // then 'B'; [] for a version with none (not an Architecture version, an unknown id, or a stale-rejected
  // generation, which never persists options). Serves ArtifactVersionDTO.options; forwarded to layer 6 through
  // `architecture` like getSelectedOption.
```

**Rule:** this is the one place `identity.matchAndPersistItems` is called from outside a `createDraftFromGeneration` callback - it is called from inside `artifact-lifecycle`'s approval transaction instead (injected by the `architecture` facade, 4.3/4.4), because ADRs are minted at approval, not at draft time (ERD 5.5). This is the documented exception to "layer 2 doesn't call layer 1 primitives directly"; everywhere else, layer 2 calls layer 1 only through the callback contract in `createDraftFromGeneration`.

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

Every module also exports `generate(ctx: { projectId: string; feedback?: string; contextSourceVersionIds?: string[]; baseVersionId?: string | null }): Promise<{ payload: unknown; candidates: Candidate[]; runId: string }>` (E3-S10) - the exact callback shape `artifact-lifecycle.createDraftFromGeneration` takes (4.3): it loads the project's brief and the approved upstream items, folds the optional reviewer `feedback` into the prompt, calls `ai-client`, and returns the validated payload plus `toCandidates(...)`. It never calls `createDraftFromGeneration` itself - it has no `artifactId`/`actorUserId` - so the API route composes the two. `contextSourceVersionIds`/`baseVersionId` are the values `createDraftFromGeneration` captured for this generation and hands its callback (4.3); the route threads them in, and when present they replace the module's own read of the project's currently approved ids for loading the context (the module still loads `brief` from `getProjectById` and still runs its own FR-080 refusal against the project), so the prompt is built from exactly the versions the draft is recorded against (INV-006). `contextSourceVersionIds` is the approved versions of the type's FR-080 prerequisites in the fixed artifact order requirements -> architecture -> ui_requirements: `requirements` takes `[]`, `architecture` `[requirements]`, `ui-requirements` `[requirements, architecture]` (read by position) and `backlog` `[requirements, architecture, ui_requirements]` (classified by each member's item type, so only the count is checked); a list of any other length is a plain Error. `baseVersionId` is the type's own approved version, and `null` (a first generation) is a value, not "absent" - only an omitted field falls back to reading the project. `architecture`'s `generate` additionally returns `options: [OptionInput, OptionInput]` (its `toCandidates` is always `[]`, decisions are not lineage until approval): the route passes them to `architecture.createOptions(draft.id, options)` once `createDraftFromGeneration` returns a non-stale draft, in a second transaction (the limitation API Contracts v1.5's Status note records as its decision 5: a failure between the two transactions leaves an option-less draft that cannot be approved and is replaced by the next generate). Modules with an FR-080 prerequisite (`architecture`, `ui-requirements`, `backlog`) refuse inside `generate` before any model call; the route checks the same prerequisite first so the client gets `409 PREREQUISITE_NOT_APPROVED` rather than a 500.

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
- **Composed approval (E3-S10):** exports `approveVersion(versionId, actorId, selectedOptionId?)` and `approveWithOverride(versionId, actorId, note, selectedOptionId?)`. Each is one line of composition - it calls `artifact-lifecycle.approveVersion`/`approveWithOverride` with `{ selectedOptionId, materialize }` (`materialize` from `architecture-materialization`), which is how the layer-2 lifecycle gets its layer-2 peer's callback without importing it. They write nothing themselves, so 4.3's "only two functions write `status = 'approved'`" still holds. Approving an Architecture version must use these two: the plain `artifact-lifecycle` ones carry no `materialize` and refuse an Architecture draft (`code: 'OPTION_NOT_SELECTED'`). Their results are lifecycle's `ApproveVersionResult` unchanged - a blocked gate carries `displayKeys` captured inside the rolled-back transaction (4.3), including for the ADRs the same call minted and rolled back.

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
- Epic/Story parent resolution: `toCandidates` is pure. It tags every Epic candidate with `outputKey` (the model's output-local Epic label - the Epic's `displayKey` in that response) and every candidate with its own `itemType`; Story candidates carry that same label as `parentDisplayKey` (`outputSchema` guarantees it names an Epic in the same output). `createDraftFromGeneration` mints Epics before Stories into the one draft, and after the Epic group is persisted - before the Story group - rewrites each Story's label to the real `display_key` of the Epic that carried it (real keys don't exist earlier: the allocator never reuses keys, so labels and real keys drift on any regeneration). `matchAndPersistItems` then resolves that real key to `parent_logical_item_id`; it never sees a model label.

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

// Additive reads, recorded in v1.8. Each is a read of this module's own owned tables
// (`external_ref`, `external_operation`); none adds a write path.
getRefById(refId: string): Promise<ExternalRef | null>
  // E4-S2: github.checkDrift is handed a bare refId and must resolve its projectId before it
  // can call impact.getExternalDrift(projectId, refId).
getRefsForLogicalItem(logicalItemId: string, provider: 'github'|'jira'|'stitch'): Promise<ExternalRef[]>
  // E4-S3: ERD 7.4's Jira parent resolution and FR-074's re-export check both look PAST one exact
  // ItemVersion, across every version a LogicalItem has had. Read-only join to `item_version`.
getRefsForProject(projectId: string): Promise<ExternalRef[]>
  // E4-T3: every ref a project has, by external_ref's own project_id. Replaces merging
  // getRefsForVersion over each artifact type's CURRENT approvedVersionId, which silently dropped a
  // GitHub ref after any Architecture re-approval (the ref stays pinned to the version approved when
  // initRepo ran; there is never a second initRepo - ERD 4.15). See section 4.7 and ERD T13.
getOperationById(operationId: string): Promise<ExternalOperation | null>
  // E4-S6: GET /api/external-operations/:operationId and its retry route; layer 6 may not import db.
getOperationsForVersion(sourceArtifactVersionId: string, provider: 'github'|'jira'|'stitch'): Promise<ExternalOperation[]>
  // E4-S6: lets a route return the documented `202 { status, operationId }` for an operation it just
  // attempted.
getDisplayKeysForItemVersions(itemVersionIds: string[]): Promise<Map<string, string>>
  // E4-S6: ImpactRow carries item_version ids but ImpactRowDTO carries display keys, and layer 6
  // cannot reach `identity`. Read-only join `item_version` -> `logical_item`.
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

Next.js route handlers. Each handler: `getVerifiedUser` -> `requireProjectOwner` -> call one layer-3/4/5 function -> serialize the result (a `:versionId`/`:operationId` route first resolves that id to its project through a read-only lookup, section 4.1; the enumerated route sets below make a layer-2 call, or more than one domain call, instead). No handler imports `db` or `identity` directly. `artifact-lifecycle` (layer 2) is the one layer-2 module reachable directly from `api`, and only for the route sets enumerated in this section: the four `/api/projects*` routes (E1-S8, this paragraph), the six E4-S6 provider routes and the eleven E3-S10 artifact/version routes (the two paragraphs below). For the four `/api/projects*` routes: `project`/`artifact` have no layer-3 artifact-type module of their own to route through (there's no "project" artifact type), so `POST/GET /api/projects` and `GET/PATCH /api/projects/:projectId` call `artifact-lifecycle.createProject`/`getProjectById`/`listProjectsForOwner`/`updateProject` directly - not just creation.

A second set of routes reaches `artifact-lifecycle` directly for the same structural reason (E4-S6, narrowed by E4-T3): the six routes that must act against a specific approved artifact version - `POST .../github/preview`, `POST .../github/init`, `GET .../jira/preview`, `POST .../jira/export`, `GET .../stitch/preview` and `POST .../stitch/generate` - call `artifact-lifecycle.getProjectById` to resolve a `projectId` to its approved `architecture`/`backlog`/`ui_requirements` version id before calling their layer-5 provider function. No layer-3/4/5 export performs that mapping, and each of those routes needs it for its own `409 PREREQUISITE_NOT_APPROVED` check. The layer-5 call that follows is still the one real domain call each handler makes; the `getProjectById` read only resolves which version to make it against.

`GET .../external-refs` and `GET .../github/ref` are deliberately NOT in that list. They read every ref a project has, not the refs of one version, so they call `external-operations.getRefsForProject(projectId)` and need no layer-2 read at all - `requireProjectOwner` already proves the project exists and belongs to the caller. E4-T3's gate proved why the distinction matters: resolving those two routes through current approved version ids made an existing GitHub repository vanish from both of them after any Architecture re-approval.

A third set is the artifact/version routes of API Contracts sections 4-5 (E3-S10), all eleven: `GET .../artifacts/:type/versions`, `GET .../artifacts/:type/current`, `POST .../artifacts/:type/generate`, `POST .../artifacts/:type/revise`, `GET /api/artifact-versions/:versionId`, `GET .../:versionId/quality-gate`, `POST .../:versionId/approve`, `POST .../:versionId/request-revision`, `POST .../:versionId/reject`, `POST .../:versionId/items/:logicalItemId/edit/preview` and `PUT .../:versionId/items/:logicalItemId`. They call `artifact-lifecycle` directly (`createDraftFromGeneration`, `createManualRevisionDraft`, `approveVersion`/`approveWithOverride`, `requestRevision`, `rejectVersion`, `proposeItemEdit`, `commitItemEdit`, and the reads `getProjectById`, `getVersionRef`, `getArtifactId`, `listArtifactVersions`, `getArtifactVersionDetail`) and, for Architecture, the `architecture` layer-3 facade (`createOptions`, `getOptionsForVersion`, and the composed `approveVersion`/`approveWithOverride` that inject `materialize` - Architecture approval must never go through the plain lifecycle functions). Each still calls the artifact-type module's own `generate`/`qualityGate` for the type-specific part. API Contracts annotates every one of these `-> artifact-lifecycle.*` (or "the `:type` module's `qualityGate`"), and no layer-3 wrapper exists for approve, reject, edit or the reads: this is not a new decision - section 4.3's opening paragraph already says "every route handler goes through artifact-lifecycle to change workflow state" - and it is legal under `eslint.config.mjs`'s `layer6-api` allow-list (`layer2-artifact-lifecycle`, `layer3-artifact-types`); only this section's earlier prose, which named `artifact-lifecycle` reachable from `api` "only for the four `/api/projects*` routes", was too narrow (the opening paragraph above now enumerates all three sets). Two details differ from the one-line handler shape above: a `:versionId` route resolves the version to its project with `getVersionRef` BEFORE `requireProjectOwner` (API Contracts 1.4: another owner's version and a nonexistent one must both be `404`), and `POST .../generate` for Architecture makes two domain calls in two transactions - `createDraftFromGeneration`, then `architecture.createOptions` once the draft exists (a failure between them leaves an option-less draft that cannot be approved and is replaced by the next generate). These routes still never import `db`, `identity`, `impact` or `dependency-binding`: layer-1 types and errors they need (`ImpactRow`, `ItemEditError`, `RebindDiff`) are re-exported by `artifact-lifecycle` (4.3), and lock discipline is untouched - `withProjectLock` is still called only inside `artifact-lifecycle`.

Every route outside those three sets - `GET .../external-refs`, `GET .../github/ref`, `GET`/retry `external-operations/:operationId` and `POST /api/session/bootstrap` - goes through a layer-3/4/5 function (or, for bootstrap, `auth` alone) and reaches layer 2 only indirectly.

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
