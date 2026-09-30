# Throughline - API Contracts

**Document version:** 1.21
**Status:** v1.21: incorporates the Jira project-creation scope correction (`manage:jira-configuration`) and retains BRD/ERD contracts. v1.20: adds BRD/ERD artifact types and source-currentness responses. Derived from ERD/Data Model v1.18, Technical Requirements & Lineage Invariants v1.14, and Module Boundaries v1.24. Parent of Jira Plan -> Implementation. v1.19 (UC-S11, TR FR-092): new route `POST /api/connections/jira/projects` (create a Jira project; a setup action, no operation or ref row); new error codes `PROJECT_KEY_TAKEN` (409) and `JIRA_ADMIN_REQUIRED` (403); `RECONNECT_REQUIRED` gains reason `missing_scope`; the Jira OAuth scope string gains `manage:jira-project`. v1.18: `DELETE .../github` corrected - the in-flight check (`UNLINK_BLOCKED`) precedes the nothing-linked `404`, and the same repository name is reusable only after the old repository is deleted on GitHub. v1.17 (UC-S10, TR FR-091): new route `DELETE /api/projects/:projectId/github` (section 8) that removes the project's GitHub repository record - never the repository on GitHub - and new error code `UNLINK_BLOCKED` (409). The user-facing name of the connections screen is now "Integrations" (the `/connections` routes are unchanged). v1.16 (UC-S9, product feedback): `PreviewConnectionDTO` gains `accountName` and GitHub's `targetReady` is true whenever the connection is active (the repository owner defaults to the connected account's login); `PATCH .../targets { githubOwner: null }` means "back to the default"; `TARGET_REQUIRED` for GitHub is defensive only; `POST .../github/init` gains optional `visibility: 'public' | 'private'` (default `'public'`) and the preview returns `visibility: 'public'`, superseding v1.10's "visibility is not configurable". Additive; no route added or removed. v1.15 (round 14, per-user provider connections, BR-012 / FR-086..FR-090; reason for reopening the shared-credential model: project owner request - users must act with their own provider accounts): adds section 10A (11 routes: `GET /api/connections`, GitHub and Jira OAuth start/callback, `GET .../github/owners`, `GET .../jira/sites`, `GET .../jira/projects`, `POST /api/connections/stitch`, `DELETE /api/connections/:provider`, `PATCH /api/projects/:projectId/targets`); adds error codes `CONNECTION_REQUIRED` and `RECONNECT_REQUIRED` (both 409) to `github/init`, `jira/export`, `stitch/generate`, the retry route and the provider-network parts of the preview routes, plus `TARGET_REQUIRED`, `TARGET_LOCKED`, `TARGET_NOT_ACCESSIBLE` and `PROVIDER_KEY_REJECTED`; `ProjectDTO` gains `targets`; the three preview responses gain a `connection` block; `ExternalOperationDTO` gains `needsReconnect`. No existing field was removed or renamed, and no token, ciphertext or key appears in any request or response except the pasted Stitch key in the one request that submits it. v1.1: dropped the allowlist gate/`403 NOT_ALLOWLISTED` - ERD Appendix B round 9 (sign-up is open, gated by email verification only). v1.2: added the missing `BRIEF_FROZEN` (409) row to the section 11 error code table (E1-S8) - already documented inline on `PATCH /api/projects/:projectId` (section 3) but omitted from the reference table; no behavior change. v1.3: added the missing `INTERNAL_ERROR` (500) row to section 11 - `src/lib/errors.ts`'s `errorResponse` has always emitted it for any caught error that isn't an `ApiError`, but it was never in the table; no behavior change. v1.4 (E4-T3): corrected section 7's and section 12's `-> module.function` annotation for `GET /api/projects/:projectId/external-refs` from `external-operations.getRefsForVersion` ("called once per approved version and merged") to `external-operations.getRefsForProject`. The route's normative behaviour is unchanged - "All GitHub/Jira/Stitch references created from this project, each with its own drift flag" - and is now literally true rather than approximately so. The old annotation named a mechanism the E4-T3 slice gate proved lossy: a GitHub `external_ref` is pinned to the Architecture version approved when `initRepo` ran, so resolving refs through each artifact type's CURRENT approved version dropped an existing repository from this route and from `GET .../github/ref` after any re-approval (ERD T13, which could not pass until it was fixed). Corrected rather than left stale because this document's own header promises the annotation is exact, so a wrong one actively points the next implementer back at the bug; no request/response shape changed. v1.5 (E3-S10): records the decisions implementing sections 4-5 (all eleven artifact/version/item-edit routes) had to make where this document was silent; no request or response shape changed. (1) An unknown `:type` path segment (anything but the four `artifact.type` values, section 1.7) is `404 NOT_FOUND`, decided only AFTER the caller has been authenticated and `requireProjectOwner` has passed, so an unknown type on someone else's project answers exactly what a valid type on it would. (2) An empty request body is valid, and means `{}`, wherever every field of the body is optional: `POST .../generate`, `POST .../request-revision`, `POST .../reject`, and `POST .../approve` for a non-Architecture version (approving an Architecture version still needs `selectedArchitectureOptionId` - `400 VALIDATION_ERROR` without it); malformed JSON is still `400 VALIDATION_ERROR`. `POST .../revise` takes no body at all. (3) `payload` on `PUT .../items/:logicalItemId` and `POST .../edit/preview` is `unknown` above but must be a JSON object (an item's payload never is anything else); a string, number, array, `null` or missing `payload` is `400 VALIDATION_ERROR`, and `confirmed` on the PUT must be a boolean. No per-artifact-type item schema is applied at this layer. (4) A malformed `:versionId` or `:projectId` (not a uuid) is `404 NOT_FOUND`, the same as an unknown one, never a database error; and for `:versionId` the whole `404` (message included) is identical for a version that does not exist and for one in a project the caller does not own (section 1.4). A `:logicalItemId` is different: a well-formed one that is simply not in the version is `409 ITEM_NOT_IN_VERSION` (section 5), and only a malformed one (not a uuid) is `404 NOT_FOUND`. (5) `POST .../generate` for `architecture` persists the draft and its two options in two transactions (`createDraftFromGeneration`, then `architecture.createOptions`), so a failure between them can leave an option-less Architecture draft: it cannot be approved (`approve` answers `422 OPTION_COUNT_INVALID`) and the next generate replaces it. (6) A model failure during `generate` has no code in section 11, so it is deliberately not mapped: it is the generic `500 INTERNAL_ERROR`. It persists no `artifact_version`, item or option - but the failed `ai_generation_run` row IS written (`ai-client` logs it before the error propagates, ERD 4.13), so the failure is auditable. (7) `APPROVAL_BLOCKED`'s `details.blocking` display keys come from the approval transaction itself (Module Boundaries 4.3), not from a later lookup: an Architecture approval mints its ADR ItemVersions before the gate runs and a block rolls them back, so such a row's `subjectId` (and its last `path` entry's item version) names an ItemVersion that no longer exists - the display keys in the row are what the client can use, and no id from it is ever sent back (the override takes only a note). (8) Two known limitations, recorded rather than papered over; neither changes a request or response shape. A stale Architecture result stores `raw_output = { payload, candidates }` only, and `candidates` is `[]` for Architecture - the two options are NOT part of the recorded raw output; they exist only in the discarded in-memory `generate` result, because options are written by a second call (decision 5) that a stale result never makes. And `confirmed: true` on `PUT .../items/:logicalItemId` confirms "the diff the server recomputes at commit", not a specific diff the client previewed: the contract's single boolean cannot bind to one, so the server never trusts the client's copy of the preview (section 5) and commits against its own fresh recomputation. v1.6 (E3-S11): records the decisions implementing section 6 (`GET /api/projects/:projectId/impact`, `POST /api/impact/acknowledgements`) had to make where this document was silent; no request or response shape changed. (1) An acknowledgement of a (subject, root) pair that is already acknowledged answers `201 { acknowledged: true }` again and writes nothing - the route is idempotent, so a double-click or a retry after a timeout is not an error. `note` is stored exactly as sent (no trimming, no length limit), and may be omitted or empty; the one exception is a NUL character (U+0000), which Postgres cannot store in text, so a `note` containing one is `400 VALIDATION_ERROR`. (2) Ids in the body: one that is not a uuid is `400 VALIDATION_ERROR`; a well-formed one that names nothing, a subject and a root that are in different projects, and a project the caller does not own are all `404 NOT_FOUND` with one identical body - same code, same message - so nothing tells the caller which of them it hit (section 1.4). The project is resolved from the body's ids first, then `requireProjectOwner` runs, exactly as for a `:versionId` route. (3) `409 NOT_CURRENTLY_FLAGGED` is answered whenever no row `impact.getWarnings` reports at that moment matches BOTH the subject and `obsoleteUpstreamItemVersionId`. That includes a subject that is a draft or otherwise not current (the engine never reports one, INV-022; a draft at approval time is handled by `overrideNote`, section 4) and a root that is not the one the subject's warning traces to. A pair whose earlier acknowledgement stopped matching because the root moved again is flagged again (ERD 4.12), and acknowledging it again writes a new acknowledgement. (4) `warnings` is returned in a deterministic order: `depth` ascending, then root item version id, then subject kind, then subject id. (5) Layer 6 may not import `impact`, so sections 6 and 12 keep naming `impact.getWarnings` / `impact.acknowledge` as the principal domain calls, but the routes reach them through `artifact-lifecycle.getImpactWarnings` / `.acknowledgeImpactWarning` (the latter re-checks the warning and writes under the project lock; Module Boundaries 4.3, 4.7). v1.7: added `502 GITHUB_REQUEST_REJECTED` (section 8 `POST .../github/init`, section 11). ERD 7.2 already says `failed` is for definitive provider rejections (4xx), but `github.initRepo` only treated a 422 name collision that way; any other 4xx from GitHub's create call (a `GITHUB_TOKEN` that is invalid or not allowed to create repositories answers 401/403) was handled as an ambiguous outcome, so the operation stayed `pending`/`reconciliation_required`, no repository was created, and the route answered the generic `500 INTERNAL_ERROR` with no cause. Such a rejection now ends the operation `failed` with GitHub's own reason as `external_operation.error_message`, and the route answers `502 GITHUB_REQUEST_REJECTED` carrying that reason as `message`; retrying the same `repoName` resends the failed operation in place (ERD 7.2 step 3.b). No request or response shape of an existing code changed; 5xx, timeouts and lost responses remain ambiguous. v1.8: added `POST /api/projects/:projectId/github/check-name` (section 8, and the section 12 map) so the GitHub screen can show whether the repository name the user typed is free before `github/init` is submitted. It is advisory, read-only (one GitHub lookup, no `external_operation`), and `github/init` still decides for real; it adds no error code of its own - a refused lookup reuses `502 GITHUB_REQUEST_REJECTED`, whose section 11 meaning now covers both the create call and this lookup. `github/preview` is unchanged, including that it ignores the request's `repoName`. v1.9: the `repoName` in `POST .../github/preview`'s response is now a suggestion based on the project's own name (`ShiftSwap Verify` -> `shiftswap-verify`, or the first free `-2`/`-3`/... variant when GitHub says it is taken; a project-id-derived name only when there is no usable project name or every variant is taken) instead of always `throughline-project-<projectId>`. No request or response shape changed, the request's `repoName` is still ignored, and a lookup that cannot be made (e.g. an unusable `GITHUB_TOKEN`) never fails the preview - the unverified name is returned and `github/check-name` reports the real problem. v1.10: `POST .../github/init` now always creates a **public** repository (it was private). Visibility is a fixed decision, not an option - TR FR-030 asks for it in the preview only "if configurable" - so no request or response shape changed; the GitHub screen states it before the user submits. Everything written to the repository is architecture documentation and Throughline ids (README, ADRs, `lineage.json`), never a secret. v1.11: `POST .../github/preview`'s response gains `starter` (TR FR-030/032): the pinned starter that will generate code files (`id`, `label`, the exact `files` paths, and the `notScaffolded` layers it does not cover), or `null` for docs-only. `mode` is `scaffold` exactly when `starter` is set. Additive - no existing field changed - and `POST .../github/init` is unchanged in shape; it now writes the starter's files before the ADRs when the stack matches. v1.12: added `DELETE /api/projects/:projectId` (section 3, and the section 12 map): permanently deletes a project and all of its Throughline data (ERD 4.2 "Deletion", round 13), `204` with no body, `401`/`404` only - no new error code. Nothing on GitHub, Jira or Stitch is deleted. No existing request or response shape changed. v1.13: `409 GITHUB_ALREADY_INITIALIZED` from `POST .../github/preview` now carries `details: { repository: { url: string | null; name: string | null } }` for the repository the project already has (its stored `external_url` and `owner/name`), so the GitHub screen can link to it instead of only saying one exists. Additive - the code, status and message are unchanged, and `github/init` is unaffected (its refusal can mean an operation is still in progress, when there is no repository or URL yet). v1.14 (SCRUM-91): adds `GET /api/projects/:projectId/stitch/output` (section 10, `-> stitch.getOutput`) so a page can show an already-generated, in-flight or manual-fallback Stitch result after navigation or a refresh instead of re-offering the generate form; purely additive - no existing request or response shape changed.
**Style:** REST over HTTPS, JSON bodies, implemented as Next.js Route Handlers under `app/api/` (Module Boundaries layer 6).
**Primary audience:** Developer, AI coding agents implementing route handlers.

> **For AI agents:** every route below makes one principal domain call into a Module Boundaries layer-2/4/5 export (cited per route as `-> module.function`), with two honest exceptions: `POST .../artifacts/architecture/generate` makes two domain calls, in two transactions (`artifact-lifecycle.createDraftFromGeneration`, then `architecture.createOptions` - see the v1.5 note, decision 5), and every route addressed by a `:versionId` or `:operationId` first resolves that id to its project through a read (`artifact-lifecycle.getVersionRef` / `external-operations.getOperationById`) before `requireProjectOwner` (section 1.4) - as does `POST /api/impact/acknowledgements`, from the ids in its body (`artifact-lifecycle.getItemVersionProjectIds` / `external-operations.getRefById`). The two impact routes' `-> impact.*` annotations (section 6) name the layer-1 call; the principal call each handler actually makes is `artifact-lifecycle.getImpactWarnings` / `.acknowledgeImpactWarning`, because layer 6 may not import `impact` (see the v1.6 note). A route handler must not contain lineage, matching, hashing, transaction, or external-write logic itself - that logic already exists in the cited module. If an endpoint seems to need new domain logic, the logic belongs in the module, not in `app/api/`.

---

## 1. Conventions

### 1.1 Authentication

Supabase Auth session, read server-side via `auth.getVerifiedUser()` (Module Boundaries 4.1) from the httpOnly session cookie set by the Supabase SSR client. No custom `Authorization` header is required for browser calls. Every route below additionally accepts `Authorization: Bearer <supabase access token>` for scripted testing (spikes, curl), verified the same way.

Every route (except session bootstrap, section 2) requires:
1. A verified user (`auth.getVerifiedUser`) - else `401 UNAUTHENTICATED`. Sign-up is open; verification (not an allowlist) is the gate (ERD Appendix B round 9).
2. Where the route touches a project, `auth.requireProjectOwner(userId, projectId)` - else `404 NOT_FOUND` (section 1.4, not `403`).

### 1.2 Versioning

No `/v1/` prefix. This is one evolving API for a solo capstone (NFR-008); this document's own version number is the contract's version.

### 1.3 Error shape

Every non-2xx response body:

```ts
{ error: { code: string; message: string; details?: unknown } }
```

`code` is a stable machine-readable string (section 11 lists all of them). `message` is human-readable and safe to show the user. `details` is present only where a specific shape is documented on the route (e.g. blocking impact rows).

### 1.4 Cross-project safety: 404, never 403

Every route that takes an id belonging to some project (`versionId`, `logicalItemId`, `refId`, `operationId`, ...) resolves that id to its project **first** (a read-only lookup: `artifact-lifecycle.getVersionRef` for a `:versionId`, `external-operations.getOperationById` for an `:operationId`), then calls `requireProjectOwner`. If the id belongs to a project the caller does not own, the response is `404 NOT_FOUND` - identical to the id not existing at all. This never confirms to a caller that an object exists in a project they cannot access (ERD section 2, Authorization; TR NFR-002).

### 1.5 Idempotency

No client-supplied `Idempotency-Key` header exists anywhere in this API. The external-write endpoints (section 8-10) are idempotent by construction: `external-operations.runOperation` derives a deterministic, target-specific operation key from the request itself (ERD section 7), so a double-click or a retried POST after a timeout is handled server-side and returns the same result, never a duplicate. A client-supplied key would be a second, redundant idempotency mechanism.

### 1.6 Pagination

None. P0 data size is tens to low hundreds of rows per project (ERD "Performance"); every list route returns its full result set.

### 1.7 The `:type` path segment

Routes parameterized by artifact type use exactly the `artifact.type` CHECK values from the ERD: `requirements`, `architecture`, `ui_requirements`, `backlog`, `brd`, `erd`. There is no separate API-level naming for artifact types, to avoid a translation layer that could drift from the database enum. Any other `:type` value is `404 NOT_FOUND`, decided only after the caller is authenticated and `requireProjectOwner` has passed, so an unknown type on someone else's project answers exactly what a valid type on it would. Likewise a path id that is not a uuid (`:projectId`, `:versionId`, `:logicalItemId`) is `404 NOT_FOUND`, never a database error; a well-formed `:logicalItemId` that is not in the version is `409 ITEM_NOT_IN_VERSION` (section 5).

### 1.8 Common DTOs

```ts
type ArtifactType = 'requirements' | 'architecture' | 'ui_requirements' | 'backlog' | 'brd' | 'erd';
type ArtifactVersionStatus = 'draft' | 'approved' | 'superseded' | 'rejected';

interface ProjectDTO {
  id: string; name: string; brief: string; inputContext: unknown | null;
  createdAt: string;
  artifacts: Record<ArtifactType, { approvedVersionId: string | null; draftVersionId: string | null }>;
  targets: {                                       // round 14 (FR-088)
    githubOwner: string | null;                    // UC-S9: nullable OVERRIDE; null = the connected account's own login
    jira: { cloudId: string; projectKey: string } | null;   // both or neither
  };
}

interface ItemVersionDTO {
  itemVersionId: string; logicalItemId: string; displayKey: string;   // e.g. "R-07"
  itemType: 'requirement' | 'architecture_decision' | 'ui_requirement' | 'epic' | 'story';
  revisionNumber: number; payload: unknown;
  parentLogicalItemId: string | null;     // Story -> Epic, this version's membership only
  impact: ImpactRowDTO | null;            // populated whenever the version is fetched via an endpoint that embeds impact (see per-route notes)
}

interface ArtifactVersionDTO {
  id: string; artifactId: string; artifactType: ArtifactType; versionNumber: number;
  status: ArtifactVersionStatus; statusReason: string | null; schemaVersion: number;
  baseApprovedVersionId: string | null; payload: unknown;
  rawOutput: unknown | null;              // only present when statusReason='stale_generation_context'
  items: ItemVersionDTO[];
  options: ArchitectureOptionDTO[] | null;              // architecture only, else null
  selectedArchitectureOptionId: string | null;           // architecture only, set once approved
  sourceCurrent: boolean | null;              // BRD/ERD only: captured source versions still approved; null for other types
  createdAt: string; updatedAt: string;
}

interface ArchitectureOptionDTO {
  id: string; optionKey: 'A' | 'B'; title: string; summary: string;
  stack: unknown; candidateDecisions: unknown[]; tradeoffs: unknown[];
}

interface ImpactRowDTO {
  subjectKind: 'item_version' | 'external_ref'; subjectId: string;
  rootItemVersionId: string; rootDisplayKey: string;    // display key resolved server-side for readability
  depth: number; path: string[];                        // display keys, root to subject, in traversal order
  acknowledged: boolean;
}

interface ExternalRefDTO {
  id: string; provider: 'github' | 'jira' | 'stitch'; externalId: string;
  externalKey: string | null; externalUrl: string | null;
  sourceArtifactVersionId: string; sourceItemVersionId: string | null;
  metadata: unknown; createdAt: string;
  impact: ImpactRowDTO | null;   // drift warning, if any (TR FR-036, section 6.2 of the ERD)
}

interface ExternalOperationDTO {
  id: string; provider: 'github' | 'jira' | 'stitch'; operationType: string;
  status: 'pending' | 'completed' | 'failed' | 'reconciliation_required';
  externalId: string | null; errorMessage: string | null;
  needsReconnect: { provider: 'github' | 'jira' | 'stitch'; reason: 'needs_reauth' | 'revoked' | 'different_account' | 'legacy_credential_missing' } | null;   // round 14 (FR-090): the recorded connection cannot be used; the operation itself is unchanged
  createdAt: string; updatedAt: string;
}

// Round 14. Status and identity only - never a token, ciphertext or key (NFR-005).
interface ConnectionDTO {
  provider: 'github' | 'jira' | 'stitch';
  status: 'none' | 'active' | 'needs_reauth' | 'revoked';
  displayName: string | null; scopes: string[]; connectedAt: string | null;
}

// Round 14. Returned by the three preview routes so the screen can render the guided step list (FR-089; UC-S9: connect is step 1 at the top).
interface PreviewConnectionDTO {
  status: ConnectionDTO['status'];
  targetReady: boolean;   // github: true whenever the connection is active (owner defaults to the connected account, UC-S9); jira: cloudId + projectKey set; stitch: always true
  accountName: string | null;   // UC-S9, github: the connected account's display name (non-secret); null without a connection. Jira/Stitch may fill it likewise
}

interface QualityIssueDTO { code: string; message: string; logicalItemId: string | null }
```

---

## 2. Session

### `POST /api/session/bootstrap`

Called once by the client right after Supabase sign-in. Not project-scoped.

`-> auth.upsertAppUser`

**Request:** none (user comes from the verified session).
**Response `200`:** `{ user: { id: string; email: string; displayName: string | null } }`
**Errors:** `401 UNAUTHENTICATED` (no valid session - includes an unverified email, since Supabase does not issue a usable session until verification completes).

---

## 3. Projects

### `POST /api/projects`

`-> artifact-lifecycle.createProject`

**Request:** `{ name: string; brief: string; inputContext?: unknown }`
**Response `201`:** `ProjectDTO`
**Errors:** `400 VALIDATION_ERROR`. After this call, `brief`/`inputContext` are still editable (ERD INV-007 applies only once a Requirements version exists, which this call does not create).

### `GET /api/projects`

Lists the caller's own projects (filtered by `owner_user_id`, not a cross-project listing).

**Response `200`:** `{ projects: ProjectDTO[] }`

### `GET /api/projects/:projectId`

**Response `200`:** `ProjectDTO`
**Errors:** `404 NOT_FOUND`

### `PATCH /api/projects/:projectId`

Edits `name` (always) and `brief`/`inputContext` (only while editable).

**Request:** `{ name?: string; brief?: string; inputContext?: unknown }`
**Response `200`:** `ProjectDTO`
**Errors:** `409 BRIEF_FROZEN` if `brief`/`inputContext` is included and a Requirements version already exists (ERD INV-007; the underlying `project_seed_frozen` trigger is the backstop, this check exists so the error is a clean `409` instead of a raw DB exception).

### `DELETE /api/projects/:projectId`

`-> artifact-lifecycle.deleteProject`

Permanently deletes the project and everything that hangs off it - every artifact and version, item, dependency edge, approval event, acknowledgement, AI run, external operation/reference and Stitch output (ERD 4.2 "Deletion", one transaction: all of it or none). It cannot be undone. The caller's `app_user` row is not touched, and **nothing outside Throughline is deleted**: a GitHub repository, Jira issues or Stitch screens the project created remain, and Throughline stops tracking them.

**Request:** no body. (The UI asks the user to type the project's name before it sends this; the API does not require a confirmation value.)
**Response `204`:** no body.
**Errors:** `401 UNAUTHENTICATED`; `404 NOT_FOUND` for a project that does not exist or is not the caller's (section 1.4), and for a project a concurrent request has just deleted, so a repeated `DELETE` answers `404`, not `204`.

---

## 4. Artifacts and versions

These routes are generic across all six artifact types; the type-specific parts (prompt, schema, quality gate) live in the cited artifact-type module (Module Boundaries 4.4), selected by the `:type` path segment. BRD and ERD are post-P0 terminal document artifacts (TR FR-093..095): their `items` are always `[]`, `options` is `null`, and `sourceCurrent` reports whether their captured source versions remain the current approved versions.

For BRD and ERD, `POST .../approve` returns `409 SOURCE_VERSION_CHANGED` when a captured source version is no longer the current approved version. Regeneration is the repair path; an impact override note does not bypass this guard. `GET .../versions`, `GET .../current`, and `GET /api/artifact-versions/:versionId` all include `sourceCurrent` in each returned version DTO.

### `GET /api/projects/:projectId/artifacts/:type/versions`

**Response `200`:** `{ versions: Omit<ArtifactVersionDTO, 'items' | 'options'>[] }` (summary list, no item bodies - fetch a version individually for full detail)

### `GET /api/projects/:projectId/artifacts/:type/current`

The artifact's approved version, or `null` if none exists yet.

**Response `200`:** `{ version: ArtifactVersionDTO | null }`

### `GET /api/artifact-versions/:versionId`

Full detail including items (each with `impact` populated from `impact.getWarnings`) and, for Architecture, `options`.

**Response `200`:** `ArtifactVersionDTO`
**Errors:** `404 NOT_FOUND`

### `POST /api/projects/:projectId/artifacts/:type/generate`

AI generation. Requires the prerequisite artifacts to be approved (TR FR-080): `architecture` needs `requirements`; `ui_requirements` needs `requirements` + `architecture`; `backlog` needs all three; `brd` needs `requirements`; `erd` needs `requirements` + `architecture`.

`-> artifact-lifecycle.createDraftFromGeneration`, using the `:type` module's `buildPrompt`/`outputSchema`/`toCandidates` (its `generate` is the callback; the route threads the callback's own captured `baseVersionId`/`contextSourceVersionIds` into it, Module Boundaries 4.4). For `architecture` only, a second domain call follows a non-stale result: `-> architecture.createOptions(draft.id, options)` (Module Boundaries 4.4), in a second transaction (v1.5 note, decision 5).

**Request:** `{ feedback?: string }` (feedback text folded into the prompt for an AI revision of an existing approved version; omitted for a first generation)
**Response `200`:** `{ status: 'ok'; version: ArtifactVersionDTO } | { status: 'stale'; version: ArtifactVersionDTO; reason: 'base_changed' | 'dependency_superseded' }`

A `stale` result is not an error (`200`, not `4xx`): the call succeeded exactly as designed (ERD 3.3 step 4) by recording a rejected version for audit. The client shows "regenerate" rather than a failure toast.

**Errors:**
- `409 PREREQUISITE_NOT_APPROVED` `{ details: { missing: ArtifactType[] } }` - TR FR-080
- `409 DRAFT_EXISTS` only if the implementation chooses not to silently replace an existing draft on this call (default behavior is to replace it per ERD 3.1 `draft_replaced`, so this code is reserved but not expected to fire from this route)

### `POST /api/projects/:projectId/artifacts/:type/revise`

Manual revision: a new draft with every item unchanged, no model call (ERD 3.6, TR FR-081).

`-> artifact-lifecycle.createManualRevisionDraft`

**Request:** none
**Response `200`:** `{ version: ArtifactVersionDTO }`
**Errors:** `409 PREREQUISITE_NOT_APPROVED`, `409 NO_APPROVED_VERSION` (nothing to revise yet), `422 MANUAL_REVISION_UNSUPPORTED` for `architecture`, `brd`, and `erd` (these types have no manual item revision path)

### `GET /api/artifact-versions/:versionId/quality-gate`

`-> the :type module's qualityGate` (TR FR-012 for `requirements`, FR-063 for `backlog`; empty for `architecture`/`ui_requirements` in P0)

**Response `200`:** `{ issues: QualityIssueDTO[] }`

### `POST /api/artifact-versions/:versionId/approve`

Approval, with the gate and the optional override folded into one endpoint (Module Boundaries assumption #2: the architecture selection is a request field, never persisted before this call).

`-> artifact-lifecycle.approveVersion`, or `.approveWithOverride` when `overrideNote` is present. For an `architecture` version the route calls the `architecture` module's composed `architecture.approveVersion` / `architecture.approveWithOverride` instead (Module Boundaries 4.4): they inject `materialize` into those same lifecycle calls, and the plain lifecycle functions skip it (they refuse an Architecture draft).

**Request:**
```ts
{
  selectedArchitectureOptionId?: string;   // required if and only if the version's artifact type is 'architecture'
  overrideNote?: string;                   // present only on a resubmission after a 409 APPROVAL_BLOCKED
}
```
**Response `200`:** `{ version: ArtifactVersionDTO }`
**Errors:**
- `400 VALIDATION_ERROR` - `selectedArchitectureOptionId` missing for an architecture version, or present for a non-architecture one
- `409 APPROVAL_BLOCKED` `{ details: { blocking: ImpactRowDTO[] } }` - the gate found unacknowledged warnings among the draft's own items (ERD 6.5) and `overrideNote` was not supplied. The client shows the blocking rows and an "approve anyway" note field; resubmitting the same request with `overrideNote` set retries via `approveWithOverride`. It is also returned when `overrideNote` WAS supplied but the gate recomputed inside the override transaction still blocks (an override satisfies the gate, it does not bypass it - FR-084): `approveWithOverride` throws, the whole transaction rolls back, and the body is the same `details.blocking`.
- `409 STACK_UNCHANGED_DECISIONS` (architecture only) - every ADR was reused but the selected option's `stack` differs from the base's (ERD 5.5 stack guard)
- `422 OPTION_NOT_SELECTED` / `422 OPTION_COUNT_INVALID` (architecture only, DB guard-trigger backstop surfaced as a clean error)
- `409 VERSION_NOT_DRAFT` - already approved, rejected, or superseded

An empty `overrideNote` (missing or blank) is rejected client-side and also server-side by the DB CHECK if it somehow arrives blank - surfaced as `400 VALIDATION_ERROR`.

### `POST /api/artifact-versions/:versionId/request-revision`

`-> artifact-lifecycle.requestRevision`

**Request:** `{ feedback?: string }`
**Response `200`:** `{ version: ArtifactVersionDTO }` (the now-rejected draft)

### `POST /api/artifact-versions/:versionId/reject`

`-> artifact-lifecycle.rejectVersion`

**Request:** `{ feedback?: string }`
**Response `200`:** `{ version: ArtifactVersionDTO }`

---

## 5. Item edit

Manual edit of one item inside a draft (ERD 5.3, TR FR-082). Two calls, resolving Module Boundaries assumption #1: a non-persisting preview, then a commit that **re-validates** the diff server-side rather than trusting the client's copy of the preview (guards the window between preview and commit, however small, in which an upstream item could itself change).

### `POST /api/artifact-versions/:versionId/items/:logicalItemId/edit/preview`

`-> artifact-lifecycle.proposeItemEdit` (its own transaction is opened and rolled back; nothing persists)

**Request:** `{ payload: unknown }`
**Response `200`:** `{ changedRefs: { logicalItemId: string; displayKey: string; from: string; to: string }[] }` (empty array means the edit can be committed with `confirmed: false`)
**Errors:** `409 VERSION_NOT_DRAFT`, `409 ITEM_NOT_IN_VERSION`, `409 UPSTREAM_REMOVED` `{ details: { logicalItemId: string; displayKey: string } }` - an upstream item the edited item depends on has been removed from current Requirements/Architecture/UI Requirements, so there is nothing to rebind to (ERD 5.3)

### `PUT /api/artifact-versions/:versionId/items/:logicalItemId`

`-> artifact-lifecycle.commitItemEdit`

**Request:** `{ payload: unknown; confirmed: boolean }`
**Response `200`:** `{ item: ItemVersionDTO; changedRefs: ... }` (same shape as the preview's `changedRefs`)
**Errors:**
- `409 CONFIRMATION_REQUIRED` `{ details: { changedRefs: [...] } }` - the server recomputed a non-empty `changedRefs` and `confirmed` was not `true`. The client re-runs preview (the diff may have changed) and asks the user to confirm again.
- `409 VERSION_NOT_DRAFT`, `409 UPSTREAM_REMOVED` (same as preview)

---

## 6. Impact and acknowledgements

### `GET /api/projects/:projectId/impact`

The warning panel and the dependency visualization's data source (ERD 6.3/6.4; TR INV-025 - one engine, no candidate).

`-> impact.getWarnings` (layer 6 may not import `impact`: reached through `artifact-lifecycle.getImpactWarnings`, which returns the rows in a deterministic order - depth, root, subject kind, subject id)

**Response `200`:** `{ warnings: ImpactRowDTO[] }`

### `POST /api/impact/acknowledgements`

Acknowledge one warning directly from the panel (independent of approval; the approval-time override uses `overrideNote` on the approve route instead and never calls this route - Module Boundaries 4.2, `acknowledgeGateBlockers` vs `acknowledge`).

`-> impact.acknowledge` (reached through `artifact-lifecycle.acknowledgeImpactWarning`, which re-checks the warning and writes inside the project lock; an already-acknowledged pair is `201` again and writes nothing - see the v1.6 note)

**Request:**
```ts
{
  subjectItemVersionId?: string; subjectExternalRefId?: string;   // exactly one of these two
  obsoleteUpstreamItemVersionId: string; note?: string;
}
```
**Response `201`:** `{ acknowledged: true }`
**Errors:** `400 VALIDATION_ERROR` (zero or both subject fields present), `409 NOT_CURRENTLY_FLAGGED` - the pair does not correspond to a row currently returned by `impact.getWarnings` (the server re-checks; it never trusts the client's belief that something is flagged), `404 NOT_FOUND` (subject or root not in caller's project)

---

## 7. External references (shared read routes)

### `GET /api/projects/:projectId/external-refs`

All GitHub/Jira/Stitch references created from this project, each with its own drift flag.

`-> external-operations.getRefsForProject` (every ref the project has, by `external_ref`'s own `project_id`) plus, per ref, the owning provider module's `checkDrift` (`github`/`jira`/`stitch`, dispatched by `provider`), each delegating to `impact.getExternalDrift` - layer 6 may not import `impact` directly

**Response `200`:** `{ refs: ExternalRefDTO[] }`

### `GET /api/external-operations/:operationId`

Polling target for an operation left `pending` or `reconciliation_required` after its initiating call returned (section 1.5's idempotency note: this is the rare path, not the common one).

**Response `200`:** `ExternalOperationDTO`
**Errors:** `404 NOT_FOUND`

### `POST /api/external-operations/:operationId/retry`

User-initiated retry only - never automatic (ERD 7.2).

`-> external-operations.runOperation`, re-invoked for the stored operation's provider/target via the owning provider module (`github`/`jira`/`stitch`, dispatched by `provider`)

**Response `200`:** `{ status: 'completed'; ref: ExternalRefDTO } | { status: 'reconciliation_required' | 'pending' }`
**Errors:** `409 REQUEST_CONFLICT` (operation's `request_hash` would differ from a retry built from current inputs - e.g. the Jira project chosen for the Throughline project changed; ERD 7.2/TR section 29), `409 RECONNECT_REQUIRED` (round 14: the connection recorded on the operation is `needs_reauth`/`revoked`, or the connected provider account is no longer the recorded one; the operation is left exactly as it was - not `failed`, no warning; `details: { provider, reason, operationId }`), `404 NOT_FOUND`

The retry always uses the connection **recorded on the operation** (`external_operation.connection_id`), never the user's current one; an operation with no recorded connection (legacy) is retried with the optional environment credential (ERD 7.6).

---

## 8. GitHub

### `POST /api/projects/:projectId/github/preview`

`-> github.previewInit`, which reads the selected option's `stack` and calls `impact.getExternalDrift`-shaped checks per the architecture version's items (TR FR-085: impact shown before any write)

The request's `repoName` is ignored. The response's `repoName` is a suggestion the user can edit: the project's name, normalized, or the first free `-2`/`-3`/... variant if that name is already taken on the GitHub account (falling back to `throughline-project-<projectId>`, which cannot collide, when there is no usable project name or every variant is taken). Use `github/check-name` to test any name the user types instead.

`starter` lists what will be generated (FR-030): a pinned starter (Django or Next.js) is chosen from the selected option's stack descriptor, and `files` is the exact set of paths `github/init` will add, alongside the README, ADRs and `lineage.json`. A stack no starter fits gets `starter: null` and `mode: 'docs-only'`. `notScaffolded` names the layers the stack has that the starter does not generate (for example the front-end application of a Django + React stack), so the screen never implies more than will be written.

**Request:** `{ repoName: string }`
**Response `200`:** `{ mode: 'scaffold' | 'docs-only'; repoName: string; visibility: 'public'; starter: { id: 'django' | 'nextjs'; label: string; files: string[]; notScaffolded: string[] } | null; impact: ImpactRowDTO[]; connection: PreviewConnectionDTO }`
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved Architecture), `409 GITHUB_ALREADY_INITIALIZED` `{ details: { repository: { url: string | null; name: string | null } } }` (ERD: one repository per project; `url`/`name` are the existing repository's stored link and `owner/name`, `null` if the ref stored none - the screen links to it when `url` is an `https://` URL)

### `POST /api/projects/:projectId/github/init`

`-> github.initRepo` -> `external-operations.runOperation`

The repository is created **public by default**; since v1.16 (UC-S9) the caller may ask for `private` (v1.10 had fixed it as public; TR FR-030's "visibility if configurable"). The visibility is recorded with the operation and a retry reuses it; the same operation key with a different visibility is `409 REQUEST_CONFLICT`. Operations that use the legacy environment credential stay public. The repository owner is `project.github_owner` when set, otherwise the connected account's own login.

**Request:** `{ repoName: string; visibility?: 'public' | 'private'; impactAcknowledged: boolean }` (`visibility` defaults to `'public'`) (`impactAcknowledged` must be `true` if the preview's `impact` array was non-empty - the confirmation TR FR-085 requires; server re-checks impact and rejects if the flag is missing rather than trusting the client)
**Response `200`:** `{ status: 'completed'; ref: ExternalRefDTO }`
**Response `202`:** `{ status: 'reconciliation_required' | 'pending'; operationId: string }` - client polls `GET /api/external-operations/:operationId`
**Errors:**
- `409 GITHUB_ALREADY_INITIALIZED`
- `409 NAME_TAKEN_BY_OTHER` - reconciliation found an existing repository whose ownership marker does not match (TR 30.1); the user must choose a different `repoName`, which is a new operation with a new key
- `502 GITHUB_REQUEST_REJECTED` - GitHub refused the create call with a 4xx other than a name collision (e.g. `403` because the account may not create repositories under the chosen owner; since round 14 an *invalid credential* is `409 RECONNECT_REQUIRED` instead); `message` carries GitHub's own reason. The operation is `failed`, nothing was created, and retrying the same `repoName` (after the cause is fixed) resends it (ERD 7.2)
- `409 IMPACT_NOT_ACKNOWLEDGED` `{ details: { impact: ImpactRowDTO[] } }` - `impactAcknowledged` was not `true` while warnings exist
- `409 CONNECTION_REQUIRED` `{ details: { provider: 'github' } }` (round 14) - the caller has no active GitHub connection. Returned **before** any operation row is written. The repository is created with the caller's own GitHub account, never a shared one
- `409 RECONNECT_REQUIRED` `{ details: { provider: 'github', reason } }` (round 14) - the caller's GitHub connection is `needs_reauth`/`revoked`. Nothing was written and no operation was changed
- `409 TARGET_REQUIRED` `{ details: { target: 'githubOwner' } }` (round 14; defensive only since UC-S9) - neither a `project.github_owner` override nor a connected GitHub login exists to name the owner; in practice a missing connection fails first with `CONNECTION_REQUIRED`

The preview stays readable without a connection, shown locked (TR FR-089): `POST .../github/preview` always answers `200` and carries `connection: PreviewConnectionDTO` in its body (added in v1.15); only its optional name-availability lookup needs the provider and, when the connection is missing or lapsed, is skipped exactly like any refused lookup (the unverified slug is returned).

### `POST /api/projects/:projectId/github/check-name`

*Round 14:* this route makes a provider call with the caller's GitHub connection, so it can answer `409 CONNECTION_REQUIRED` or `409 RECONNECT_REQUIRED` (the two codes documented on `github/init`); unlike the preview it has nothing useful to return without the provider.

`-> github.checkRepoName`

Advisory availability check for the repository name being typed on the GitHub screen. Read-only: it never creates anything or writes an `external_operation`, and it is not a reservation - `github/init` can still answer `409 NAME_TAKEN_BY_OTHER` (the name was taken meanwhile, or is a private repository the caller's GitHub account cannot see). Project-scoped and owner-checked like its siblings, because it spends the caller's own GitHub quota (round 14).

**Request:** `{ repoName: string }`
**Response `200`:** `{ repoName: string; status: 'available' | 'taken' | 'invalid' }` - `repoName` is the input run through the same normalization `github/init` applies (lowercase letters, digits and hyphens), i.e. what would actually be created; `invalid` means nothing usable is left after normalization (`repoName` is then `''`) and GitHub is not called
**Errors:** `502 GITHUB_REQUEST_REJECTED` - GitHub refused the lookup with a 4xx other than not-found (e.g. `403` for an account without access; an *invalid credential* is `409 RECONNECT_REQUIRED`, round 14); `message` carries GitHub's own reason. `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `404 NOT_FOUND` as elsewhere

### `DELETE /api/projects/:projectId/github`

`-> external-operations.unlinkGithubRepository` (TR FR-091, ERD 7.7). Removes the project's GitHub repository **record** so a new repository can be created. **It never deletes or changes anything on GitHub and makes no GitHub call**; the repository still exists there and the user deletes it manually (`https://github.com/<owner>/<name>/settings`, Danger Zone) - the UI says so before and after. Deletes the project's GitHub ref and the completed operation that produced it; failed operations are kept; nothing else (other projects, Jira/Stitch refs, lineage tables) is touched. Owner-checked like its siblings; needs no connection.

**Request:** none (no body). After a successful unlink a new `github/init` may not reuse the old repository name while that repository still exists on GitHub (`github/check-name` reports `taken`; a submitted create answers `409 NAME_TAKEN_BY_OTHER`); use another name or delete the old repository first.
**Response `200`:** `{ removed: { name: string | null; url: string | null }; note: string }` - `note` states that the repository still exists on GitHub and must be deleted there manually.
**Errors:** `409 UNLINK_BLOCKED` (a GitHub operation of the project is `pending` or `reconciliation_required`; nothing was changed; checked **first**, so it is returned even when no repository record exists yet), `404 NOT_FOUND` (nothing is linked and nothing is in flight, or as elsewhere), `401 UNAUTHENTICATED`

### `GET /api/projects/:projectId/github/ref`

Convenience read (the one-per-project GitHub ref, if any), equivalent to filtering `GET .../external-refs` by `provider='github'`.

**Response `200`:** `{ ref: ExternalRefDTO | null }`

---

## 9. Jira

### `GET /api/projects/:projectId/jira/preview`

`-> jira.previewExport`, against the current approved Backlog

**Response `200`:**
```ts
{
  epics: number; stories: number;
  skipped: { logicalItemId: string; displayKey: string; reason: 'epic_has_no_jira_ref' }[];   // TR section 16
  needsDecision: { logicalItemId: string; displayKey: string; existingRef: ExternalRefDTO }[];  // FR-074 candidates (Epics and Stories)
  impact: ImpactRowDTO[];
  connection: PreviewConnectionDTO;   // round 14
}
```
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved Backlog)

*Round 14:* the response also carries `connection: PreviewConnectionDTO` (Jira connection status and whether the project's site + project key are chosen). The preview is built from local state only and stays readable without a connection (TR FR-089); it never returns `CONNECTION_REQUIRED`/`RECONNECT_REQUIRED`.

### `POST /api/projects/:projectId/jira/export`

`-> jira.exportBacklog`

**Request:**
```ts
{
  decisions: { logicalItemId: string; decision: 'skip' | 'create_new' }[];   // one entry per item in the preview's needsDecision
  impactAcknowledged: boolean;
}
```
**Response `200`:** `{ created: ExternalRefDTO[]; skipped: { logicalItemId: string }[]; failures: { logicalItemId: string; operationId: string; status: ExternalOperationDTO['status'] }[] }`

Because a Backlog can be ~13+ issues and each is one `runOperation` call, this endpoint runs them in sequence server-side and returns the full batch result in one response (no job queue - deliberately simple for P0 data size, ERD "Performance"; if this becomes too slow in practice, the fix is one background job, not a redesign of this contract). A per-item failure does not fail the whole call; it appears in `failures` with its operation id for `GET /api/external-operations/:operationId` polling/retry.

**Errors:** `409 PREREQUISITE_NOT_APPROVED`, `400 VALIDATION_ERROR` (a `needsDecision` item missing from `decisions`), `409 IMPACT_NOT_ACKNOWLEDGED`, and (round 14) `409 CONNECTION_REQUIRED` `{ details: { provider: 'jira' } }` (no active Jira connection; no operation row written), `409 RECONNECT_REQUIRED` `{ details: { provider: 'jira', reason } }` (connection `needs_reauth`/`revoked`, or its refresh was rejected; nothing changed), `409 TARGET_REQUIRED` `{ details: { target: 'jira' } }` (site + project key not chosen). All three are answered before the first issue is attempted. If the connection lapses **during** the batch, the issue in flight and every later one appear in `failures` with their operation ids and `status` unchanged (never `failed` because of it), and the response is `409 RECONNECT_REQUIRED` only when **no** issue was attempted; otherwise `200` with the partial result and `needsReconnect` on each affected operation (`GET /api/external-operations/:operationId`).

---

## 10. Stitch

### `GET /api/projects/:projectId/stitch/preview`

`-> stitch.previewPrompt`

**Response `200`:** `{ prompt: string; impact: ImpactRowDTO[]; connection: PreviewConnectionDTO }`
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved UI Requirements)

*Round 14:* the response also carries `connection: PreviewConnectionDTO`; the prompt preview stays readable without a Stitch connection and never returns the connection codes.

### `POST /api/projects/:projectId/stitch/generate`

`-> stitch.generate` -> `external-operations.runOperation`, or a direct `manual_fallback` write on definitive failure (Module Boundaries 4.6)

**Request:** `{ impactAcknowledged: boolean }`
**Response `200`:** `{ mode: 'api'; ref: ExternalRefDTO; htmlUrl: string; screenshotUrl: string } | { mode: 'manual_fallback'; promptText: string }` (URLs are short-lived signed Supabase Storage URLs, generated per request - never stored as permanent links, ERD 4.16)
**Errors:** `409 PREREQUISITE_NOT_APPROVED`, `409 ALREADY_GENERATED` (one Stitch output per UI Requirements version), `409 IMPACT_NOT_ACKNOWLEDGED`, and (round 14) `409 CONNECTION_REQUIRED` `{ details: { provider: 'stitch' } }` / `409 RECONNECT_REQUIRED` `{ details: { provider: 'stitch', reason } }`. **Neither is a `manual_fallback`:** the fallback is for a generation that ran and failed (FR-054); a missing or lapsed key means nothing was attempted, so no operation row and no `stitch_output` row is written and the preview/prompt remain available.

A `manual_fallback` result is `200`, not an error: FR-054 requires the workflow to continue.

### `GET /api/projects/:projectId/stitch/output`

`-> stitch.getOutput` (read-only; the persisted result for the current approved UI Requirements version)

**Response `200`:** `{ state: 'none' } | { state: 'generated'; mode: 'api'; ref: ExternalRefDTO; htmlUrl: string; screenshotUrl: string } | { state: 'manual_fallback'; mode: 'manual_fallback'; promptText: string } | { state: 'in_progress'; operationId: string; status: 'pending' | 'reconciliation_required' }`. The `generated` variant is exactly `POST .../stitch/generate`'s `mode: 'api'` body plus `state`, with fresh short-lived signed URLs minted on every request (ERD 4.16). Precedence: an `api` output wins; else an unfinished operation is `in_progress` (even over an earlier `manual_fallback` row - a retry in flight is more current; poll `GET /api/external-operations/:operationId`); else a `manual_fallback` row; else `none`.
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved UI Requirements)

---

## 10A. Provider connections and project targets (round 14)

The provider routes of sections 8-10 read the project (`artifact-lifecycle.getProjectById`) and pass the provider module a context (`ctx: { userId, githubOwner? }` for GitHub, `{ userId, jiraCloudId, jiraProjectKey }` for Jira, `{ userId }` for Stitch - Module Boundaries 4.6); the modules never read `project` themselves.

Per-user, not per-project: these routes need a verified user (`401 UNAUTHENTICATED` otherwise) but no `requireProjectOwner`, except `PATCH .../targets`. No response ever contains a token, ciphertext or key. Only `provider` values `github`, `jira`, `stitch` exist; any other `:provider` segment is `404 NOT_FOUND`.

### `GET /api/connections`

`-> connections.listConnections`

**Response `200`:** `{ connections: ConnectionDTO[] }` - always exactly three entries (`github`, `jira`, `stitch`), `status: 'none'` for a provider the user has not connected.

### `GET /api/connections/github/start`

`-> connections.beginOAuth('github')`

Browser navigation. Optional query `returnTo` - a **relative** path on this site (anything else is ignored). `beginOAuth` returns the authorize URL and a PKCE verifier; **the route** sets the verifier in a short-lived `httpOnly`, `SameSite=Lax` cookie and answers `302` to GitHub's authorize URL with a `state` signed with `OAUTH_STATE_SECRET` (an HMAC key of its own - not `GITHUB_MARKER_SECRET`) and bound to the user, provider and `returnTo` (CSRF), the PKCE challenge, scopes `repo read:org` (`read:org` so org membership and the owner picker work; amended in UC-S4), and a `redirect_uri` taken from an allowlist derived from `NEXT_PUBLIC_SITE_URL`.
**Response:** `302`. **Errors:** `401 UNAUTHENTICATED`.

### `GET /api/connections/github/callback`

`-> connections.completeOAuth('github')`

**Query:** `code`, `state`. The route reads the PKCE cookie and passes it to `completeOAuth`, which verifies the signed `state` (user, provider, expiry), exchanges the code, reads the account identity, encrypts and saves the connection (`saveConnection`, an upsert - a reconnect revives the same connection), clears the cookie.
**Response:** `302` to `returnTo` or `/connections?connected=github`; on any failure `302` to `/connections?error=<code>` where `<code>` is one of `invalid_state`, `access_denied`, `exchange_failed` (no provider text, no token). **Errors:** `401 UNAUTHENTICATED`.

### `GET /api/connections/github/owners`

`-> github.listOwners`

The optional owner picker behind "Repository owner: @login - Change" (FR-088, UC-S9): the user's own login and the organizations they can create repositories in. Picking is never required - the default owner is the connected account.
**Response `200`:** `{ owners: { login: string; kind: 'user' | 'org' }[] }`
**Errors:** `409 CONNECTION_REQUIRED`, `409 RECONNECT_REQUIRED`

### `GET /api/connections/jira/start`

`-> connections.beginOAuth('jira')`

As the GitHub start route, against Atlassian's authorize URL (`https://auth.atlassian.com/authorize`), scopes `read:jira-work write:jira-work manage:jira-configuration offline_access read:me`, `audience=api.atlassian.com`, `prompt=consent`.
**Response:** `302`. **Errors:** `401 UNAUTHENTICATED`.

### `GET /api/connections/jira/callback`

`-> connections.completeOAuth('jira')`

As the GitHub callback: exchanges the code, stores the access **and** refresh token (both encrypted), records the account identity and the default site (`cloudId`, `siteUrl`, `siteName`) in `provider_meta`.
**Response / Errors:** as the GitHub callback (`?connected=jira`).

### `GET /api/connections/jira/sites`

`-> jira.listSites`

**Response `200`:** `{ sites: { cloudId: string; url: string; name: string }[] }` - live from Atlassian's accessible-resources for the user's own connection.
**Errors:** `409 CONNECTION_REQUIRED`, `409 RECONNECT_REQUIRED`

### `GET /api/connections/jira/projects`

`-> jira.listProjects`

**Query:** `cloudId` (required; must be one of the caller's sites). **Response `200`:** `{ projects: { key: string; name: string }[] }`
**Errors:** `400 VALIDATION_ERROR` (missing `cloudId`), `422 TARGET_NOT_ACCESSIBLE` (the `cloudId` is not one of the caller's sites), `409 CONNECTION_REQUIRED`, `409 RECONNECT_REQUIRED`

### `POST /api/connections/jira/projects`

`-> jira.validateProjectKey`, then `jira.createProject` (TR FR-092, ERD 7.8). Creates a Jira project in one of the caller's sites with the caller's **own** credential; the caller becomes the project lead. A provider **setup action**: it writes no `external_operation`, `external_ref` or lineage row, and is idempotent by Jira key uniqueness (a repeated submit answers `PROJECT_KEY_TAKEN`). On success the UI sets the new project as the Throughline project's Jira target through `PATCH /api/projects/:projectId/targets`.

**Request:** `{ cloudId: string; name: string; key: string; template: 'scrum' | 'kanban' }` - `key`: uppercase letters and digits, 2-10 characters, starting with a letter.
**Response `201`:** `{ project: { id: string; key: string; name: string } }`
**Errors:** `400 VALIDATION_ERROR`, `409 PROJECT_KEY_TAKEN` (the key exists in Jira or is invalid), `403 JIRA_ADMIN_REQUIRED` (Jira refused: the account lacks the Administer Jira global permission - message: ask a Jira admin, or create the project in Jira and refresh), `422 TARGET_NOT_ACCESSIBLE` (the `cloudId` is not reachable by the connection), `409 CONNECTION_REQUIRED`, `409 RECONNECT_REQUIRED` (including `details.reason = 'missing_scope'` when the stored scopes lack `manage:jira-configuration`; existing connections reconnect once; also returned when Jira answers this route with a 401 containing 'scope does not match', in which case the connection stays active), `401 UNAUTHENTICATED`

### `POST /api/connections/stitch`

`-> stitch.validateApiKey` -> `connections.saveConnection`

**Request:** `{ apiKey: string }` - the only request in the API that carries a provider secret. It is validated with one cheap read-only call (list projects) **before** anything is stored, encrypted, and never echoed, logged or returned.
**Response `200`:** `ConnectionDTO` (`provider: 'stitch'`)
**Errors:** `400 VALIDATION_ERROR` (empty or absurdly long), `422 PROVIDER_KEY_REJECTED` (Stitch rejected the key; nothing stored; the message carries no key material)

### `DELETE /api/connections/:provider`

`-> connections.disconnect`

Revokes the credential at the provider where an API exists (GitHub grant, Atlassian refresh token; Stitch has none), then removes it locally: the row is deleted, or - when an existing `external_operation` still references it - replaced by a tombstone (ERD 4.17). Objects already created in the provider are untouched, and operations that used this connection resolve as reconnect-required afterwards.
**Response `200`:** `{ providerRevoked: boolean | null }` (`null` = the provider has no revocation API). The local credential is removed even when the provider call fails (`providerRevoked: false`).
**Errors:** `404 NOT_FOUND` (unknown provider segment, or nothing connected)

### `PATCH /api/projects/:projectId/targets`

`-> artifact-lifecycle.updateProjectTargets`, after the route has (1) validated a non-null target with the caller's connection (`github.checkOwnerAccessible` / `jira.checkProjectAccessible`) **before any project lock**, and (2) for a `githubOwner` change asked `external-operations.hasOperationsFor(projectId, 'github')` (Module Boundaries 4.7). `updateProjectTargets` itself only takes the project lock and writes the columns. Between (2) and the write a concurrent operation may be inserted; that is benign, because every operation snapshots its target into `target_descriptor` and so still reconciles against the target it was created with.

Sets where the project's external outputs go (FR-088). A dedicated route rather than an extension of `PATCH /api/projects/:projectId`: that route's contract is `name`/`brief`/`inputContext` with the `BRIEF_FROZEN` rule, and targets are not covered by the brief freeze (ERD 4.2). Absent field = unchanged; `null` = clear. For `githubOwner`, clearing means **back to the default** (the connected account's own login, UC-S9); it is not an error and needs no provider validation.

**Request:** `{ githubOwner?: string | null; jira?: { cloudId: string; projectKey: string } | null }` - the Jira pair is set together or cleared together.
**Response `200`:** `ProjectDTO` (with `targets`)
**Errors:** `400 VALIDATION_ERROR` (blank value, or half a Jira pair), `404 NOT_FOUND`, `409 TARGET_LOCKED` (`githubOwner` change attempted while a GitHub operation for the project is `pending`, `reconciliation_required` or `completed`, ERD 4.2), `422 TARGET_NOT_ACCESSIBLE` (a chosen owner, site or project is not visible to the caller's connection), `409 CONNECTION_REQUIRED` / `409 RECONNECT_REQUIRED` (a non-null target has to be validated against the provider, so the matching connection must be usable)

---

## 11. Error code reference

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `UNAUTHENTICATED` | 401 | No verified Supabase session (includes an account that has not completed email verification) |
| `NOT_FOUND` | 404 | Object does not exist, or belongs to another project (section 1.4); on the artifact/version routes also an unknown `:type` segment (section 1.7) and a path id that is not a uuid (`:projectId`, `:versionId`, `:logicalItemId`) |
| `BRIEF_FROZEN` | 409 | `PATCH /api/projects/:projectId` attempted to change `brief`/`inputContext` after a Requirements `artifact_version` already exists (ERD INV-007; `project_seed_frozen` trigger is the backstop) |
| `PREREQUISITE_NOT_APPROVED` | 409 | TR FR-080 - an upstream artifact is not yet approved |
| `DRAFT_EXISTS` | 409 | Reserved; default behavior replaces the draft instead (ERD `draft_replaced`) |
| `NO_APPROVED_VERSION` | 409 | Manual revision attempted with nothing approved yet |
| `MANUAL_REVISION_UNSUPPORTED` | 422 | Architecture has no manual revision path (ERD 3.6) |
| `VERSION_NOT_DRAFT` | 409 | Action requires `status='draft'` |
| `ITEM_NOT_IN_VERSION` | 409 | `logicalItemId` is not a member of the version |
| `UPSTREAM_REMOVED` | 409 | Manual edit cannot rebind: an upstream item was removed |
| `CONFIRMATION_REQUIRED` | 409 | Item edit changes dependencies; resubmit with `confirmed: true` |
| `APPROVAL_BLOCKED` | 409 | Approval gate found unacknowledged warnings (ERD 6.5) |
| `SOURCE_VERSION_CHANGED` | 409 | A BRD or ERD draft's captured source version changed before approval (FR-088) |
| `STACK_UNCHANGED_DECISIONS` | 409 | Architecture stack changed with no changed decision (ERD 5.5) |
| `OPTION_NOT_SELECTED` / `OPTION_COUNT_INVALID` | 422 | Architecture approval guard-trigger conditions |
| `NOT_CURRENTLY_FLAGGED` | 409 | `POST /api/impact/acknowledgements`: no row `impact.getWarnings` reports at that moment matches BOTH the subject and `obsoleteUpstreamItemVersionId` - the warning is gone, or was never this pair's (includes a subject that is a draft or otherwise non-current item, and a root the subject's warning does not trace to) |
| `GITHUB_ALREADY_INITIALIZED` | 409 | One repository per project (ERD, decided). From `github/preview` it carries `details.repository` (`url`, `name`) of the existing repository |
| `NAME_TAKEN_BY_OTHER` | 409 | GitHub name collision without a matching ownership marker (TR 30.1) |
| `GITHUB_REQUEST_REJECTED` | 502 | GitHub refused `POST /user/repos` (`github/init`) or the name lookup behind `github/check-name` with a definitive 4xx other than a name collision / not-found - e.g. the account lacks permission to create repositories under the chosen owner (ERD 7.2: `failed` = definitive provider rejection). Since round 14 an *invalid credential* is `RECONNECT_REQUIRED`, not this code |
| `CONNECTION_REQUIRED` | 409 | Round 14 (FR-086). The caller has no active connection for `details.provider`. Returned before any `external_operation` row or `stitch_output` row is written; the legacy environment credential is never used as a substitute. UI: step 1 (Connect) of the guided step list (FR-089) |
| `RECONNECT_REQUIRED` | 409 | Round 14 (FR-090). The connection that must be used (the caller's for a new write, the one recorded on the operation for a retry) is `needs_reauth`/`revoked`, its refresh was rejected, the provider rejected the credential, or the connected account differs from the one the operation was created with (`details.reason`). **Never** turns an operation `failed`, never raises or clears an impact warning, never marks a ref stale |
| `TARGET_REQUIRED` | 409 | Round 14 (FR-088). `jira/export` without the Jira site + project key (`details.target`); `github/init` only defensively, when neither a `project.github_owner` override nor a connected GitHub login exists (UC-S9) |
| `PROJECT_KEY_TAKEN` | 409 | Round 17 (FR-092). `POST /api/connections/jira/projects`: the Jira project key already exists or is invalid; nothing was created |
| `JIRA_ADMIN_REQUIRED` | 403 | Round 17 (FR-092). Jira refused project creation: the connected account lacks the Administer Jira global permission |
| `UNLINK_BLOCKED` | 409 | Round 16 (FR-091). `DELETE .../github` while a GitHub operation for the project is `pending` or `reconciliation_required`; nothing was changed |
| `TARGET_LOCKED` | 409 | Round 14. `PATCH .../targets` tried to change `githubOwner` while a non-failed GitHub operation exists for the project |
| `TARGET_NOT_ACCESSIBLE` | 422 | Round 14. A chosen GitHub owner, Jira site or Jira project is not visible to the caller's connection |
| `PROVIDER_KEY_REJECTED` | 422 | Round 14. `POST /api/connections/stitch`: Stitch rejected the pasted key; nothing was stored |
| `IMPACT_NOT_ACKNOWLEDGED` | 409 | External write attempted without confirming shown impact (TR FR-085) |
| `ALREADY_GENERATED` | 409 | One Stitch output per UI Requirements version |
| `REQUEST_CONFLICT` | 409 | A retry's inputs no longer match the stored operation's request hash |
| `INTERNAL_ERROR` | 500 | Every route's catch-all for a caught error that is not one of the above - logged server-side, never leaks internals into the response body |

---

## 12. Route summary

| Method | Path | Module function |
|---|---|---|
| POST | `/api/session/bootstrap` | `auth.upsertAppUser` |
| POST | `/api/projects` | `artifact-lifecycle.createProject` |
| GET | `/api/projects` | (read) |
| GET | `/api/projects/:projectId` | (read) |
| PATCH | `/api/projects/:projectId` | (read/write, guarded by `project_seed_frozen`) |
| DELETE | `/api/projects/:projectId` | `artifact-lifecycle.deleteProject` |
| GET | `/api/projects/:projectId/artifacts/:type/versions` | (read) |
| GET | `/api/projects/:projectId/artifacts/:type/current` | (read) |
| GET | `/api/artifact-versions/:versionId` | (read) |
| POST | `/api/projects/:projectId/artifacts/:type/generate` | `artifact-lifecycle.createDraftFromGeneration` (+ `architecture.createOptions` for `architecture`) |
| POST | `/api/projects/:projectId/artifacts/:type/revise` | `artifact-lifecycle.createManualRevisionDraft` |
| GET | `/api/artifact-versions/:versionId/quality-gate` | `<type>.qualityGate` |
| POST | `/api/artifact-versions/:versionId/approve` | `artifact-lifecycle.approveVersion` / `.approveWithOverride` (`architecture.approveVersion` / `.approveWithOverride` for an `architecture` version) |
| POST | `/api/artifact-versions/:versionId/request-revision` | `artifact-lifecycle.requestRevision` |
| POST | `/api/artifact-versions/:versionId/reject` | `artifact-lifecycle.rejectVersion` |
| POST | `/api/artifact-versions/:versionId/items/:logicalItemId/edit/preview` | `artifact-lifecycle.proposeItemEdit` |
| PUT | `/api/artifact-versions/:versionId/items/:logicalItemId` | `artifact-lifecycle.commitItemEdit` |
| GET | `/api/projects/:projectId/impact` | `impact.getWarnings` (via `artifact-lifecycle.getImpactWarnings`) |
| POST | `/api/impact/acknowledgements` | `impact.acknowledge` (via `artifact-lifecycle.acknowledgeImpactWarning`) |
| GET | `/api/projects/:projectId/external-refs` | `external-operations.getRefsForProject` + `<provider>.checkDrift` |
| GET | `/api/external-operations/:operationId` | (read) |
| POST | `/api/external-operations/:operationId/retry` | `external-operations.runOperation` |
| POST | `/api/projects/:projectId/github/preview` | `github.previewInit` |
| POST | `/api/projects/:projectId/github/check-name` | `github.checkRepoName` |
| POST | `/api/projects/:projectId/github/init` | `github.initRepo` |
| GET | `/api/projects/:projectId/github/ref` | (read) |
| GET | `/api/projects/:projectId/jira/preview` | `jira.previewExport` |
| POST | `/api/projects/:projectId/jira/export` | `jira.exportBacklog` |
| GET | `/api/projects/:projectId/stitch/preview` | `stitch.previewPrompt` |
| POST | `/api/projects/:projectId/stitch/generate` | `stitch.generate` |
| GET | `/api/projects/:projectId/stitch/output` | `stitch.getOutput` |
| GET | `/api/connections` | `connections.listConnections` |
| GET | `/api/connections/github/start` | `connections.beginOAuth` |
| GET | `/api/connections/github/callback` | `connections.completeOAuth` |
| GET | `/api/connections/github/owners` | `github.listOwners` |
| GET | `/api/connections/jira/start` | `connections.beginOAuth` |
| GET | `/api/connections/jira/callback` | `connections.completeOAuth` |
| GET | `/api/connections/jira/sites` | `jira.listSites` |
| GET | `/api/connections/jira/projects` | `jira.listProjects` |
| POST | `/api/connections/stitch` | `stitch.validateApiKey` -> `connections.saveConnection` |
| DELETE | `/api/connections/:provider` | `connections.disconnect` |
| PATCH | `/api/projects/:projectId/targets` | `github.checkOwnerAccessible` / `jira.checkProjectAccessible` -> `external-operations.hasOperationsFor` -> `artifact-lifecycle.updateProjectTargets` |

42 routes (31 + the 11 of section 10A, round 14), all traceable to a Module Boundaries export or an explicitly-noted read. No route bypasses a module boundary.

---

## 13. Resolved assumptions from Module Boundaries v1.0 section 10

1. **Item-edit dry-run/commit shape** - resolved as two HTTP calls (section 5), with the refinement that `PUT` re-validates the diff itself rather than trusting the `POST .../preview` result, closing the (small) window where an upstream item could change between the two calls.
2. **Architecture option selection as request-scoped** - resolved as a field on `POST .../approve` (section 4), never a separate persisted call, exactly matching the ERD's "not persisted before approval" limitation.
3. **`runOperation`'s `send`/`reconcile` closures** - confirmed to have no API-contract surface of their own; what the API layer needed to decide instead was how slow/ambiguous external calls surface to the client, resolved here as synchronous `200` for the common case and `202` + polling (`GET /api/external-operations/:id`) for the `pending`/`reconciliation_required` case (section 7).

---

## 14. Traceability

| Business Requirement | Routes |
|---|---|
| BR-002 (human approval authoritative) | `POST .../approve`, `.../request-revision`, `.../reject` |
| BR-003 (exact lineage) | `GET /api/artifact-versions/:versionId` (items carry `logicalItemId`/`itemVersionId`), `GET .../external-refs` |
| BR-004 (specific, inspectable impact) | `GET /api/projects/:projectId/impact`, every route's embedded `impact` field |
| BR-005 (honest GitHub init) | `POST .../github/preview`, `.../github/init` |
| BR-006 (Stitch, non-authoritative) | `GET .../stitch/preview`, `POST .../stitch/generate`, `GET .../stitch/output` |
| BR-007 (Jira preview/create with provenance) | `GET .../jira/preview`, `POST .../jira/export` |
| BR-008 (previewed, retry-aware writes) | every `preview` route paired with its write route; `POST .../external-operations/:id/retry` |
| BR-012 (writes made with the user's own provider accounts) | section 10A (all eleven routes); `CONNECTION_REQUIRED` / `RECONNECT_REQUIRED` / `TARGET_*` on `github/init`, `jira/export`, `stitch/generate` and the retry route |
