---
name: throughline-module-boundaries
description: Load before adding a new file under src/, adding or changing an import, deciding which module should own a piece of logic or a table write, or reviewing a diff for layering. Triggers on module, layer, boundary, index.ts, import, "which module owns", withProjectLock, table ownership, or any path under src/db, src/auth, src/ai-client, src/lineage, src/artifact-lifecycle, src/architecture-materialization, src/artifact-types, src/external, src/app/api.
---

# Throughline module boundaries

Source: `docs/Throughline_Module_Boundaries.md`. Frozen, derived from the frozen ERD. `eslint-plugin-boundaries` (Project Setup section 5.3) enforces most of the import-direction rules below **mechanically** - this skill exists for the part ESLint cannot see (table ownership, principle 4) and to stop you writing the wrong import *before* you write it, not after a lint failure.

## The layer graph

```
Layer 0  db, auth, ai-client                                 foundation, no domain logic
Layer 1  identity, dependency-binding, impact                lineage core: pure + thin persistence
Layer 2  artifact-lifecycle, architecture-materialization     state machine + transactions
Layer 3  requirements, architecture, ui-requirements, backlog artifact-type modules
Layer 4  external-operations                                  shared external-write protocol
Layer 5  github, jira, stitch                                 provider integrations
Layer 6  api (Next.js route handlers)                          thin: auth + ownership + call layer 3/5
```

**Rule:** a module in layer N may import layer < N freely. It may never import layer >= N. **One documented exception**: `architecture-materialization` (layer 2) calls into `identity` (layer 1) - this is layer 2 calling layer 1, not a cycle, and it is the *only* cross-layer exception in the codebase. If you think you need a second one, you don't - restructure instead.

Peers in the same layer never import each other. This is what stops `backlog` importing `ui-requirements`, or `github` importing `jira`.

## Who owns which table (the part lint can't check)

| Module | Layer | Owns (exclusive write path) |
|---|---|---|
| `db` | 0 | Drizzle client, connection, `withProjectLock()`, tx helper |
| `auth` | 0 | `app_user` |
| `ai-client` | 0 | `ai_generation_run` |
| `identity` | 1 | `logical_item`, `item_version`, `artifact_version_item_membership`, `semantic_dependency` |
| `dependency-binding` | 1 | no table of its own - pure + reads `generation_context_ref` |
| `impact` | 1 | `impact_acknowledgement` |
| `artifact-lifecycle` | 2 | `project`, `artifact`, `artifact_version`, `approval_event`, `generation_context_ref` |
| `architecture-materialization` | 2 | `architecture_option` |
| `requirements` / `architecture` / `ui-requirements` / `backlog` | 3 | payload shape + prompt only - no table of their own; persistence goes through `identity` / `artifact-lifecycle` |
| `external-operations` | 4 | `external_operation`, `external_ref` |
| `github` / `jira` | 5 | no table of their own |
| `stitch` | 5 | `stitch_output` |
| `api` | 6 | none - route handlers only |

**Every one of the 16 ERD tables has exactly one owning module.** If you're about to write an `INSERT`/`UPDATE`/`DELETE` to a table, check this list first. A second code path that can write the same table is exactly how a lineage invariant gets silently broken (Module Boundaries section 1, principle 1) - this is a correctness bug, not a style nit, and it will not show up in a normal code review because the second write path usually "looks reasonable" in isolation.

Everything else reads a table only through that owning module's exported functions - never a raw query of its own into someone else's table.

## The five principles, in one line each

1. One write path per table (above).
2. Layering is one-directional; no peer imports; the one named exception.
3. Lock discipline lives in exactly one place: `withProjectLock` is called only from `artifact-lifecycle`. Nothing else opens a transaction that touches `artifact_version.status`, allocates a `version_number`/`revision_number`/`display_key`, or mints an `item_version`.
4. The LLM never crosses a module boundary as trusted data. Every artifact-type module Zod-validates AI output and hands it to `identity` for matching - no model-supplied id is ever used where a database id is expected.
5. Modules are plain TypeScript import boundaries, not services. No message queue, no internal HTTP call, no network boundary between them - this is one Next.js app (NFR-008, simplicity).

## Enforcement specifics (from Project Setup section 5.3)

- `no-restricted-imports`: `db/lock` (i.e. `withProjectLock`) importable only from `artifact-lifecycle`; `openai` importable only from `ai-client`; `@supabase/*` auth client only from `auth`.
- Deep-import ban: a module is imported only via its `index.ts` - never `src/lineage/identity/matcher.ts` directly from outside the folder.
- `src/app/api/` contains route handlers only - no domain logic, no direct `db` import (one named exception: the project-creation route, Module Boundaries section 4.7).
- `src/lib/` is framework glue only. The moment something in `lib/` starts knowing about `artifact_version.status`, it belongs in a module, not `lib/`.

**If a boundary needs an `eslint-disable` to pass, that is the signal to re-examine the boundary (Module Boundaries section 5), not to add the disable.**
