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

3. **`GET .../external-refs`, `POST/GET .../github/*`, `GET/POST .../jira/*`,
   `GET/POST .../stitch/*` (E4-S6)**: no layer-3/4/5 export maps a
   `projectId` to its approved version ids, and API Contracts section 7's own
   text for `GET .../external-refs` ("called once per approved version and
   merged") requires exactly that mapping - these routes call
   `artifact-lifecycle.getProjectById` directly to resolve the
   `architecture`/`backlog`/`ui_requirements` approved version id (and, for
   `external-refs`, all four) before ever calling the layer-5 provider
   function.

Every other route still goes through layer 3/4/5 only.
