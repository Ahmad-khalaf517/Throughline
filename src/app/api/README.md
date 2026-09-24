# `src/app/api/`

Next.js route handlers only (module 17, layer 6). Every handler:
`getVerifiedUser` -> `requireProjectOwner` -> call exactly one layer-2/3/4/5
function -> serialize the result.

No handler imports `db` or `identity` directly. Two documented exceptions to
"layer 6 calls layer 3/4/5 only" (Module Boundaries section 4.7):

1. **`/api/projects` routes (E1-S8)**: `project`/`artifact` are owned by
   `artifact-lifecycle` (layer 2) with no artifact-type module, so `POST/GET
/api/projects` and `GET/PATCH /api/projects/:projectId` call
   `artifact-lifecycle.createProject`/`getProjectById`/`listProjectsForOwner`/
   `updateProject` directly.

2. **`POST /api/session/bootstrap` (E1-S6)**: Skips `requireProjectOwner` —
   it is not project-scoped (API Contracts section 2).

Every other route still goes through layer 3/4/5 only.
