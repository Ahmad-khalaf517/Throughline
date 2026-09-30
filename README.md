# Throughline

> From brief to repo and backlog, with every artifact traceable to the decision it came from.

Throughline is an AI-assisted project-initialization platform. It takes a project brief and walks it through structured requirements, an approved architecture, UI requirements, and an executable backlog, then hands the results off to GitHub, Google Stitch, and Jira.

The point is not just generating documents. Every generated item keeps **lineage** to the exact upstream item versions it came from. When an approved requirement or architecture decision changes, Throughline flags the specific dependent items that need review, not the whole project. AI proposes; deterministic code owns identity, versioning, approval, and impact; a human approves every major artifact and every external write.

## How it works

1. **Requirements** - AI drafts them from the brief. You review, edit items, and approve.
2. **Architecture** - AI proposes options. You pick one, and approval materializes ADRs.
3. **UI requirements** - derived from the approved requirements and architecture. Optionally previewed as a Google Stitch prototype.
4. **Backlog** - Epics and Stories linked back to the items they implement.
5. **Outputs** - GitHub repository (scaffolded from a pinned Django or Next.js starter, or docs-only), Stitch prototype, and Jira export. Each one is previewed first and written only on explicit action.
6. **Change impact** - editing an approved item produces a warning list of exactly which downstream items and external refs are affected, which you acknowledge or regenerate.

Artifacts are immutable once approved; changes create new versions.

## Stack

- Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS 4
- Postgres on Supabase (Auth, Storage), Drizzle ORM
- OpenAI for structured generation, Octokit (GitHub), Jira REST, `@google/stitch-sdk`
- Vitest, Testcontainers, ESLint (`eslint-plugin-boundaries`), Prettier, Husky, pnpm

## Getting started

**Prerequisites:** Node 22 (see `.nvmrc`), pnpm, a Supabase project, and Docker (integration tests only).

```bash
pnpm install
cp .env.example .env.local   # fill in real values
pnpm db:migrate              # apply migrations to your dev database
pnpm dev
```

Then open <http://localhost:3000>.

Supabase needs email sign-up enabled with mandatory verification, a private Storage bucket for Stitch assets, and your site origin (`NEXT_PUBLIC_SITE_URL`) added under Authentication -> URL Configuration -> Redirect URLs, or verification links will fail.

### Environment variables

Defined in [`.env.example`](.env.example), grouped by module.

| Group    | Variables                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Database | `DATABASE_URL` (transaction pooler, port 6543), `DIRECT_DATABASE_URL` (migrations, tests)                        |
| Auth     | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL` |
| AI       | `OPENAI_API_KEY`, `OPENAI_MODEL`                                                                                 |
| GitHub   | `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_MARKER_SECRET`                                                           |
| Jira     | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`                                              |
| Stitch   | `STITCH_API_KEY`, `SUPABASE_STORAGE_BUCKET`                                                                      |

## Scripts

| Script                           | What it does                                                  |
| -------------------------------- | ------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`   | Next.js dev server, production build, production server       |
| `pnpm typecheck`                 | `tsc --noEmit`                                                |
| `pnpm lint`                      | ESLint, including module-boundary enforcement                 |
| `pnpm format` / `format:check`   | Prettier write / check                                        |
| `pnpm test`                      | Unit tests                                                    |
| `pnpm test:int`                  | Integration tests against a Postgres container (needs Docker) |
| `pnpm test:all`                  | Everything                                                    |
| `pnpm db:generate` / `db:custom` | Generate a Drizzle migration / an empty custom SQL migration  |
| `pnpm db:migrate`                | Apply migrations using `.env.local`                           |
| `pnpm db:verify`                 | Diff generated DDL against ERD Appendix A                     |
| `pnpm db:studio`                 | Drizzle Studio                                                |

There is deliberately no `db:push`. Never run `drizzle-kit push`: the triggers, the `impact()` function, and the Supabase hardening live in custom migrations that `push` cannot see (ERD section 2.1).

## Architecture

Code is split into modules with a strict layer graph. A module may import only from lower layers, and each database table has exactly one owning module that may write it.

```text
Layer 0  db, auth, ai-client
Layer 1  lineage/identity, dependency-binding, impact
Layer 2  artifact-lifecycle, architecture-materialization
Layer 3  artifact-types: requirements, architecture, ui-requirements, backlog
Layer 4  external/operations
Layer 5  external/github, jira, stitch
Layer 6  app/api (thin route handlers)
```

```text
src/
  app/                          pages and API route handlers
  db/  auth/  ai-client/        foundation
  lineage/                      identity, dependency-binding, impact
  artifact-lifecycle/           drafts, approval, revision, project lock
  architecture-materialization/ ADR creation on approval
  artifact-types/               requirements, architecture, ui-requirements, backlog
  external/                     operations, github, jira, stitch
  components/  lib/             UI and shared helpers
tests/                          unit/ and integration/
drizzle/                        migrations
docs/                           design documents
```

Boundaries are enforced by `eslint-plugin-boundaries` in `eslint.config.mjs`. A lint failure there is a design violation, not a false positive.

## Documentation

The design docs in `docs/` are the source of truth and are updated after every decision.

| Document                                                                                | Contents                                    |
| --------------------------------------------------------------------------------------- | ------------------------------------------- |
| [BRD](docs/Throughline_BRD.md)                                                          | Business objectives and requirements        |
| [Technical Requirements](docs/Throughline_Technical_Requirements_Lineage_Invariants.md) | FR/NFR and the lineage invariants (INV-xxx) |
| [ERD](docs/Throughline_ERD.md)                                                          | Data model (frozen) and decision log        |
| [Module Boundaries](docs/Throughline_Module_Boundaries.md)                              | Module map, layering, table ownership       |
| [API Contracts](docs/Throughline_API_Contracts.md)                                      | Route contracts                             |
| [Jira Plan](docs/Throughline_Jira_Plan.md)                                              | Epics, stories, definition of done          |
| [Project Setup](docs/Throughline_Project_Setup.md)                                      | Repo setup, config, dependency plan         |
| [DESIGN.md](DESIGN.md), [brand/](brand/README.md)                                       | Design system and logo kit                  |

## Contributing

- Husky and lint-staged run on commit and push. `pnpm format` and `pnpm lint` run the same checks by hand.
- A change to one design doc can contradict another downstream (ERD -> Technical Requirements -> Module Boundaries -> API Contracts). Check the chain before calling a schema or invariant change done.
- Tests cite ERD test ids (`T##`); a story is done only when every id it cites passes.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint, and tests.
