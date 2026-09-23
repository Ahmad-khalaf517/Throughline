# Throughline - API Contracts

**Document version:** 1.1
**Status:** Derived from ERD/Data Model v1.7, Technical Requirements & Lineage Invariants v1.4, and Module Boundaries v1.1. Parent of Jira Plan -> Implementation. v1.1: dropped the allowlist gate/`403 NOT_ALLOWLISTED` - ERD Appendix B round 9 (sign-up is open, gated by email verification only).
**Style:** REST over HTTPS, JSON bodies, implemented as Next.js Route Handlers under `app/api/` (Module Boundaries layer 6).
**Primary audience:** Developer, AI coding agents implementing route handlers.

> **For AI agents:** every route below calls exactly one Module Boundaries layer-2/4/5 export (cited per route as `-> module.function`). A route handler must not contain lineage, matching, hashing, transaction, or external-write logic itself - that logic already exists in the cited module. If an endpoint seems to need new domain logic, the logic belongs in the module, not in `app/api/`.

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

Every route that takes an id belonging to some project (`versionId`, `logicalItemId`, `refId`, `operationId`, ...) resolves that id to its project **first**, then calls `requireProjectOwner`. If the id belongs to a project the caller does not own, the response is `404 NOT_FOUND` - identical to the id not existing at all. This never confirms to a caller that an object exists in a project they cannot access (ERD section 2, Authorization; TR NFR-002).

### 1.5 Idempotency

No client-supplied `Idempotency-Key` header exists anywhere in this API. The external-write endpoints (section 8-10) are idempotent by construction: `external-operations.runOperation` derives a deterministic, target-specific operation key from the request itself (ERD section 7), so a double-click or a retried POST after a timeout is handled server-side and returns the same result, never a duplicate. A client-supplied key would be a second, redundant idempotency mechanism.

### 1.6 Pagination

None. P0 data size is tens to low hundreds of rows per project (ERD "Performance"); every list route returns its full result set.

### 1.7 The `:type` path segment

Routes parameterized by artifact type use exactly the `artifact.type` CHECK values from the ERD: `requirements`, `architecture`, `ui_requirements`, `backlog`. There is no separate API-level naming for artifact types, to avoid a translation layer that could drift from the database enum.

### 1.8 Common DTOs

```ts
type ArtifactType = 'requirements' | 'architecture' | 'ui_requirements' | 'backlog';
type ArtifactVersionStatus = 'draft' | 'approved' | 'superseded' | 'rejected';

interface ProjectDTO {
  id: string; name: string; brief: string; inputContext: unknown | null;
  createdAt: string;
  artifacts: Record<ArtifactType, { approvedVersionId: string | null; draftVersionId: string | null }>;
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
  createdAt: string; updatedAt: string;
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

---

## 4. Artifacts and versions

These routes are generic across all four artifact types; the type-specific parts (prompt, schema, quality gate) live in the cited artifact-type module (Module Boundaries 4.4), selected by the `:type` path segment.

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

AI generation. Requires the prerequisite artifacts to be approved (TR FR-080): `architecture` needs `requirements`; `ui_requirements` needs `requirements` + `architecture`; `backlog` needs all three.

`-> artifact-lifecycle.createDraftFromGeneration`, using the `:type` module's `buildPrompt`/`outputSchema`/`toCandidates`

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
**Errors:** `409 PREREQUISITE_NOT_APPROVED`, `409 NO_APPROVED_VERSION` (nothing to revise yet), `422 MANUAL_REVISION_UNSUPPORTED` for `architecture` (ERD 3.6: Architecture has no manual revision path)

### `GET /api/artifact-versions/:versionId/quality-gate`

`-> the :type module's qualityGate` (TR FR-012 for `requirements`, FR-063 for `backlog`; empty for `architecture`/`ui_requirements` in P0)

**Response `200`:** `{ issues: QualityIssueDTO[] }`

### `POST /api/artifact-versions/:versionId/approve`

Approval, with the gate and the optional override folded into one endpoint (Module Boundaries assumption #2: the architecture selection is a request field, never persisted before this call).

`-> artifact-lifecycle.approveVersion`, or `.approveWithOverride` when `overrideNote` is present

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
- `409 APPROVAL_BLOCKED` `{ details: { blocking: ImpactRowDTO[] } }` - the gate found unacknowledged warnings among the draft's own items (ERD 6.5) and `overrideNote` was not supplied. The client shows the blocking rows and an "approve anyway" note field; resubmitting the same request with `overrideNote` set retries via `approveWithOverride`.
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

`-> impact.getWarnings`

**Response `200`:** `{ warnings: ImpactRowDTO[] }`

### `POST /api/impact/acknowledgements`

Acknowledge one warning directly from the panel (independent of approval; the approval-time override uses `overrideNote` on the approve route instead and never calls this route - Module Boundaries 4.2, `acknowledgeGateBlockers` vs `acknowledge`).

`-> impact.acknowledge`

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

`-> external-operations.getRefsForVersion` (called once per approved version and merged) plus `impact.getExternalDrift` per ref

**Response `200`:** `{ refs: ExternalRefDTO[] }`

### `GET /api/external-operations/:operationId`

Polling target for an operation left `pending` or `reconciliation_required` after its initiating call returned (section 1.5's idempotency note: this is the rare path, not the common one).

**Response `200`:** `ExternalOperationDTO`
**Errors:** `404 NOT_FOUND`

### `POST /api/external-operations/:operationId/retry`

User-initiated retry only - never automatic (ERD 7.2).

`-> external-operations.runOperation`, re-invoked for the stored operation's provider/target via the owning provider module (`github`/`jira`/`stitch`, dispatched by `provider`)

**Response `200`:** `{ status: 'completed'; ref: ExternalRefDTO } | { status: 'reconciliation_required' | 'pending' }`
**Errors:** `409 REQUEST_CONFLICT` (operation's `request_hash` would differ from a retry built from current inputs - e.g. the configured Jira project changed; ERD 7.2/TR section 29), `404 NOT_FOUND`

---

## 8. GitHub

### `POST /api/projects/:projectId/github/preview`

`-> github.previewInit`, which reads the selected option's `stack` and calls `impact.getExternalDrift`-shaped checks per the architecture version's items (TR FR-085: impact shown before any write)

**Request:** `{ repoName: string }`
**Response `200`:** `{ mode: 'scaffold' | 'docs-only'; repoName: string; impact: ImpactRowDTO[] }`
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved Architecture), `409 GITHUB_ALREADY_INITIALIZED` (ERD: one repository per project)

### `POST /api/projects/:projectId/github/init`

`-> github.initRepo` -> `external-operations.runOperation`

**Request:** `{ repoName: string; impactAcknowledged: boolean }` (`impactAcknowledged` must be `true` if the preview's `impact` array was non-empty - the confirmation TR FR-085 requires; server re-checks impact and rejects if the flag is missing rather than trusting the client)
**Response `200`:** `{ status: 'completed'; ref: ExternalRefDTO }`
**Response `202`:** `{ status: 'reconciliation_required' | 'pending'; operationId: string }` - client polls `GET /api/external-operations/:operationId`
**Errors:**
- `409 GITHUB_ALREADY_INITIALIZED`
- `409 NAME_TAKEN_BY_OTHER` - reconciliation found an existing repository whose ownership marker does not match (TR 30.1); the user must choose a different `repoName`, which is a new operation with a new key
- `409 IMPACT_NOT_ACKNOWLEDGED` `{ details: { impact: ImpactRowDTO[] } }` - `impactAcknowledged` was not `true` while warnings exist

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
}
```
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved Backlog)

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

**Errors:** `409 PREREQUISITE_NOT_APPROVED`, `400 VALIDATION_ERROR` (a `needsDecision` item missing from `decisions`), `409 IMPACT_NOT_ACKNOWLEDGED`

---

## 10. Stitch

### `GET /api/projects/:projectId/stitch/preview`

`-> stitch.previewPrompt`

**Response `200`:** `{ prompt: string; impact: ImpactRowDTO[] }`
**Errors:** `409 PREREQUISITE_NOT_APPROVED` (no approved UI Requirements)

### `POST /api/projects/:projectId/stitch/generate`

`-> stitch.generate` -> `external-operations.runOperation`, or a direct `manual_fallback` write on definitive failure (Module Boundaries 4.6)

**Request:** `{ impactAcknowledged: boolean }`
**Response `200`:** `{ mode: 'api'; ref: ExternalRefDTO; htmlUrl: string; screenshotUrl: string } | { mode: 'manual_fallback'; promptText: string }` (URLs are short-lived signed Supabase Storage URLs, generated per request - never stored as permanent links, ERD 4.16)
**Errors:** `409 PREREQUISITE_NOT_APPROVED`, `409 ALREADY_GENERATED` (one Stitch output per UI Requirements version), `409 IMPACT_NOT_ACKNOWLEDGED`

A `manual_fallback` result is `200`, not an error: FR-054 requires the workflow to continue.

---

## 11. Error code reference

| Code | HTTP status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body failed schema validation |
| `UNAUTHENTICATED` | 401 | No verified Supabase session (includes an account that has not completed email verification) |
| `NOT_FOUND` | 404 | Object does not exist, or belongs to another project (section 1.4) |
| `PREREQUISITE_NOT_APPROVED` | 409 | TR FR-080 - an upstream artifact is not yet approved |
| `DRAFT_EXISTS` | 409 | Reserved; default behavior replaces the draft instead (ERD `draft_replaced`) |
| `NO_APPROVED_VERSION` | 409 | Manual revision attempted with nothing approved yet |
| `MANUAL_REVISION_UNSUPPORTED` | 422 | Architecture has no manual revision path (ERD 3.6) |
| `VERSION_NOT_DRAFT` | 409 | Action requires `status='draft'` |
| `ITEM_NOT_IN_VERSION` | 409 | `logicalItemId` is not a member of the version |
| `UPSTREAM_REMOVED` | 409 | Manual edit cannot rebind: an upstream item was removed |
| `CONFIRMATION_REQUIRED` | 409 | Item edit changes dependencies; resubmit with `confirmed: true` |
| `APPROVAL_BLOCKED` | 409 | Approval gate found unacknowledged warnings (ERD 6.5) |
| `STACK_UNCHANGED_DECISIONS` | 409 | Architecture stack changed with no changed decision (ERD 5.5) |
| `OPTION_NOT_SELECTED` / `OPTION_COUNT_INVALID` | 422 | Architecture approval guard-trigger conditions |
| `NOT_CURRENTLY_FLAGGED` | 409 | Direct acknowledgement of a warning that no longer exists |
| `GITHUB_ALREADY_INITIALIZED` | 409 | One repository per project (ERD, decided) |
| `NAME_TAKEN_BY_OTHER` | 409 | GitHub name collision without a matching ownership marker (TR 30.1) |
| `IMPACT_NOT_ACKNOWLEDGED` | 409 | External write attempted without confirming shown impact (TR FR-085) |
| `ALREADY_GENERATED` | 409 | One Stitch output per UI Requirements version |
| `REQUEST_CONFLICT` | 409 | A retry's inputs no longer match the stored operation's request hash |

---

## 12. Route summary

| Method | Path | Module function |
|---|---|---|
| POST | `/api/session/bootstrap` | `auth.upsertAppUser` |
| POST | `/api/projects` | `artifact-lifecycle.createProject` |
| GET | `/api/projects` | (read) |
| GET | `/api/projects/:projectId` | (read) |
| PATCH | `/api/projects/:projectId` | (read/write, guarded by `project_seed_frozen`) |
| GET | `/api/projects/:projectId/artifacts/:type/versions` | (read) |
| GET | `/api/projects/:projectId/artifacts/:type/current` | (read) |
| GET | `/api/artifact-versions/:versionId` | (read) |
| POST | `/api/projects/:projectId/artifacts/:type/generate` | `artifact-lifecycle.createDraftFromGeneration` |
| POST | `/api/projects/:projectId/artifacts/:type/revise` | `artifact-lifecycle.createManualRevisionDraft` |
| GET | `/api/artifact-versions/:versionId/quality-gate` | `<type>.qualityGate` |
| POST | `/api/artifact-versions/:versionId/approve` | `artifact-lifecycle.approveVersion` / `.approveWithOverride` |
| POST | `/api/artifact-versions/:versionId/request-revision` | `artifact-lifecycle.requestRevision` |
| POST | `/api/artifact-versions/:versionId/reject` | `artifact-lifecycle.rejectVersion` |
| POST | `/api/artifact-versions/:versionId/items/:logicalItemId/edit/preview` | `artifact-lifecycle.proposeItemEdit` |
| PUT | `/api/artifact-versions/:versionId/items/:logicalItemId` | `artifact-lifecycle.commitItemEdit` |
| GET | `/api/projects/:projectId/impact` | `impact.getWarnings` |
| POST | `/api/impact/acknowledgements` | `impact.acknowledge` |
| GET | `/api/projects/:projectId/external-refs` | `external-operations.getRefsForVersion` + `impact.getExternalDrift` |
| GET | `/api/external-operations/:operationId` | (read) |
| POST | `/api/external-operations/:operationId/retry` | `external-operations.runOperation` |
| POST | `/api/projects/:projectId/github/preview` | `github.previewInit` |
| POST | `/api/projects/:projectId/github/init` | `github.initRepo` |
| GET | `/api/projects/:projectId/github/ref` | (read) |
| GET | `/api/projects/:projectId/jira/preview` | `jira.previewExport` |
| POST | `/api/projects/:projectId/jira/export` | `jira.exportBacklog` |
| GET | `/api/projects/:projectId/stitch/preview` | `stitch.previewPrompt` |
| POST | `/api/projects/:projectId/stitch/generate` | `stitch.generate` |

28 routes, all traceable to a Module Boundaries export or an explicitly-noted read. No route bypasses a module boundary.

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
| BR-006 (Stitch, non-authoritative) | `POST .../stitch/preview`, `.../stitch/generate` |
| BR-007 (Jira preview/create with provenance) | `GET .../jira/preview`, `POST .../jira/export` |
| BR-008 (previewed, retry-aware writes) | every `preview` route paired with its write route; `POST .../external-operations/:id/retry` |
