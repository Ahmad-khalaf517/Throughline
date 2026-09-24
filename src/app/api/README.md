# `src/app/api/`

Next.js route handlers only (module 17, layer 6). Every handler:
`getVerifiedUser` -> `requireProjectOwner` -> call exactly one layer-3/4/5
function -> serialize the result.

No handler imports `db`, `identity`, or `artifact-lifecycle` directly except
the project-creation route, which calls `artifact-lifecycle.createProject`
(Module Boundaries section 4.7).

Exception: `POST /api/session/bootstrap` skips `requireProjectOwner` - it is
not project-scoped (API Contracts section 2).
