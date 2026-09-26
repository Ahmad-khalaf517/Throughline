# `src/app/api/`

Next.js route handlers only (module 17, layer 6). Every handler:
`getVerifiedUser` -> `requireProjectOwner` -> call exactly one layer-2/3/4/5
function -> serialize the result.

No handler imports `db` or `identity` directly. Three documented exceptions to
"layer 6 calls layer 3/4/5 only" (Module Boundaries section 4.7):

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

Every other route still goes through layer 3/4/5 only.
