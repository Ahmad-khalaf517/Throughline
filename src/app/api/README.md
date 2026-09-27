# `src/app/api/`

Next.js route handlers only (module 17, layer 6). Every handler:
`getVerifiedUser` -> `requireProjectOwner` -> call one layer-3/4/5 function ->
serialize the result. The route sets enumerated below call layer 2
(`artifact-lifecycle`) directly, or make more than one domain call, instead; and
a `:versionId`/`:operationId` route first resolves that id to its project with a
read-only lookup, then runs `requireProjectOwner` (Module Boundaries section 4.1);
`POST /api/impact/acknowledgements` does the same from the ids in its body.

No handler imports `db` or `identity` directly. Five documented exceptions to
that shape (Module Boundaries section 4.7) - four route sets that call
`artifact-lifecycle` directly (1, 3, 4 and 5) and one that is not project-scoped (2):

1. **`/api/projects` routes (E1-S8)**: `project`/`artifact` are owned by
   `artifact-lifecycle` (layer 2) with no artifact-type module, so `POST/GET
/api/projects` and `GET/PATCH /api/projects/:projectId` call
   `artifact-lifecycle.createProject`/`getProjectById`/`listProjectsForOwner`/
   `updateProject` directly.

2. **`POST /api/session/bootstrap` (E1-S6)**: Skips `requireProjectOwner` —
   it is not project-scoped (API Contracts section 2).

3. **`POST .../github/preview`, `POST .../github/init`,
   `GET .../jira/preview`, `POST .../jira/export`, `GET .../stitch/preview`,
   `POST .../stitch/generate` (E4-S6, narrowed by E4-T3)**: no layer-3/4/5
   export maps a `projectId` to its approved version ids, and each of these
   six needs that mapping for its own `409 PREREQUISITE_NOT_APPROVED` check -
   so they call `artifact-lifecycle.getProjectById` directly to resolve the
   `architecture`/`backlog`/`ui_requirements` approved version id before ever
   calling the layer-5 provider function.

   `GET .../external-refs` and `GET .../github/ref` were in this list until
   E4-T3. They are not any more: they read every ref a project has, not the
   refs of one version, so they call
   `external-operations.getRefsForProject(projectId)` and need no layer-2
   read - `requireProjectOwner` already proves the project exists and is the
   caller's. Resolving them through current approved version ids was a real
   defect: a GitHub ref stays pinned to the Architecture version approved
   when `initRepo` ran, so any later re-approval made an existing repository
   disappear from both routes (ERD T13, closed by E4-T3).

4. **The artifact/version routes, all eleven (E3-S10; API Contracts sections
   4-5)**: API Contracts annotates each one `-> artifact-lifecycle.*` (or "the
   `:type` module's `qualityGate`"), and no layer-3 wrapper exists for approve,
   reject, edit or the reads, so they call `artifact-lifecycle` directly. That is
   already what Module Boundaries 4.3 says ("every route handler goes through
   artifact-lifecycle to change workflow state"), and it is lint-legal. The routes:

   - `GET .../artifacts/:type/versions` and `GET .../artifacts/:type/current`
   - `POST .../artifacts/:type/generate` and `POST .../artifacts/:type/revise`
   - `GET /api/artifact-versions/:versionId` and `GET .../:versionId/quality-gate`
   - `POST .../:versionId/approve`, `.../request-revision` and `.../reject`
   - `POST .../:versionId/items/:logicalItemId/edit/preview` and
     `PUT .../:versionId/items/:logicalItemId`

   What they call: `createDraftFromGeneration`, `createManualRevisionDraft`,
   `approveVersion`/`approveWithOverride`, `requestRevision`, `rejectVersion`,
   `proposeItemEdit`, `commitItemEdit`, and the reads `getProjectById`,
   `getVersionRef`, `getArtifactId`, `listArtifactVersions`,
   `getArtifactVersionDetail`. For Architecture they call the layer-3
   `architecture` facade instead of lifecycle's plain functions for approval
   (its `approveVersion`/`approveWithOverride` inject `materialize`) and for
   `createOptions`/`getOptionsForVersion`; the type-specific parts (`generate`,
   `qualityGate`) still come from the `:type` module. A `:versionId` route runs
   `getVersionRef` BEFORE `requireProjectOwner`, so another owner's version and a
   nonexistent one are both `404`.

   Shared glue lives in `_shared/artifacts.ts` (type/id parsing, the FR-080
   prerequisite table, the `:type` -> module dispatch table, the lifecycle-error
   mapper, `loadVersionDTO`) and `_shared/body.ts` (the optional-JSON-body
   reader); neither holds lineage, matching, hashing or transaction logic.

5. **The two impact routes (E3-S11; API Contracts section 6)**: API Contracts
   annotates them `-> impact.getWarnings` / `-> impact.acknowledge`, but layer 6
   may not import `impact` (or `identity`), and an acknowledgement must be written
   inside the project lock, which only `artifact-lifecycle` takes - so they call
   `artifact-lifecycle` directly (Module Boundaries 4.3, 4.7):

   - `GET /api/projects/:projectId/impact` calls `getImpactWarnings` (rows in a
     deterministic order) and serializes them with `toImpactRowDTOs`.
   - `POST /api/impact/acknowledgements` has no `:projectId`, so it resolves one
     from the ids in its body first: `getItemVersionProjectIds` for an
     item-version subject and for the obsolete root, `getRefById` (from
     `external-operations`) for an external-ref subject. A missing id, a subject
     and root in different projects, and a project the caller does not own all answer ONE
     identical `404` (same code and message, as `resolveOwnedVersion` does for a
     version), then `requireProjectOwner`, then `acknowledgeImpactWarning`, which
     re-checks the warning under the lock (`409 NOT_CURRENTLY_FLAGGED` if it is not
     flagged) and writes nothing for an already-acknowledged pair (still `201`).
     Its request schema is `impact/schemas.ts`; the resolution helpers stay in the
     route file because nothing else uses them.

Every other route still goes through layer 3/4/5 only.
