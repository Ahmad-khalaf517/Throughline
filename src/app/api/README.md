# `src/app/api/`

Next.js route handlers only (module 17, layer 6). Every handler:
`getVerifiedUser` -> `requireProjectOwner` -> call exactly one layer-2/3/4/5
function -> serialize the result.

No handler imports `db` or `identity` directly. The `/api/projects` routes
(E1-S8) are the documented exception to "layer 6 calls layer 3/4/5 only"
(Module Boundaries section 4.7): `project`/`artifact` are owned by
`artifact-lifecycle` (layer 2) and there is no artifact-type module for them,
so `POST/GET /api/projects` and `GET/PATCH /api/projects/:projectId` call
`artifact-lifecycle.createProject`/`getProjectById`/`listProjectsForOwner`/
`updateProject` directly. Every other route still goes through layer 3/4/5
only.
