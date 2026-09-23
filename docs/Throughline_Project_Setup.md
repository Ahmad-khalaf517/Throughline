# Throughline - Project Setup & Configuration Plan

**Document version:** 1.7
**Status:** Slice 1 (steps 1-4) and the auth access gate are done and merged to `main`. Slice 2's schema is now also done: all 16 ERD tables, every trigger, and `impact()` are applied to the live `throughline` Supabase project and verified (section 13). v1.7 additionally records pinning `search_path` on all 7 functions (ERD Appendix B round 10). v1.6 recorded the slice-2 schema. v1.5 changed the auth access gate to open sign-up + mandatory email verification (ERD Appendix B round 9). v1.4 recorded the auth-only schema cut. v1.1 added the house code-hygiene conventions. Derived from ERD/Data Model v1.7 (FROZEN), Technical Requirements & Lineage Invariants v1.4, and Module Boundaries v1.1.
**Primary audience:** Developer, AI coding agents doing slice 1.

> **For AI agents:** this document decides *how the repository is set up*; it does not decide behavior. Every stack choice below traces to a decision already frozen in the ERD (section 15) or TR (section 5.1), or to a decision recorded in section 11 of this document. Do not add a dependency that is not in section 4 without recording it there first - NFR-008 (simplicity) is a requirement, not a preference.

---

## 1. Decisions taken for this document

Four choices were open after the ERD/TR/Modules chain. All four are now closed:

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D-1 | LLM provider (TR 5.1 "one LLM provider") | **OpenAI**, via the official `openai` SDK, using strict structured outputs (`zodResponseFormat`) **plus** a second Zod parse inside `ai-client` | Schema is enforced by the provider *and* re-validated locally, so `generateStructured` keeps its Module Boundaries §4.1 contract (throw on validation failure, log the run as failed either way). Model output stays untrusted data (NFR-005). |
| D-2 | UI layer | **Tailwind CSS + shadcn/ui** (components copied into the repo, not a runtime dependency) | The screens are artifact review, diff confirmation, impact panel, approval dialogs. shadcn gives dialog/table/badge/toast without a UI runtime dep to fight with the App Router. |
| D-3 | Test harness | **Vitest**, with the Appendix C behaviour suite run against a throwaway **`postgres:15-alpine` container** (Testcontainers) | Matches how Appendix A DDL was already verified. Unit tests for the lineage core need no container and stay fast (ERD 14 risk 1 - build it headless). |
| D-4 | Hosting / CI | **Vercel** for the app, **GitHub Actions** for typecheck + lint + tests on every PR | ERD 14 risk 2: "Keep the Appendix C suite running on every change" needs an automated runner, not discipline. |

No schema, invariant, or module boundary changes. These are build-environment decisions only.

---

## 2. Runtime baseline

| Concern | Pin | Note |
|---|---|---|
| Node | **22.x LTS** | Pinned in `.nvmrc` and `package.json#engines`; Vercel and GitHub Actions both read it. |
| Package manager | **pnpm** (`packageManager` field in `package.json`) | Corepack-enabled, lockfile committed. |
| Language | **TypeScript 5.x**, `strict: true`, `noUncheckedIndexedAccess: true` | The lineage core is where an `undefined` slips through silently. |
| Framework | **Next.js 16.3.5, App Router**, React 19.2.8, server-side only for data | TR 5.1: every read and write goes through the application server. Bumped from the originally planned "15" - 16 was current stable when `create-next-app` scaffolded slice 1 (section 13); nothing in the ERD/TR pins a Next.js major. |
| Database | **PostgreSQL 15+ on Supabase** | ERD section 2.1 for connection rules. |
| Module system | ESM throughout | |

**Version pinning rule:** every dependency is installed with an exact version (no `^`). `drizzle-orm` and `drizzle-kit` must be installed as an exactly-matching pair and **must not be upgraded during the build** (ERD 2.1). The majors listed in section 4 are the expected ones; resolve exact patch versions at install time and commit the lockfile.

---

## 3. Repository layout

The Module Boundaries §7 folder layout is the spine. This adds the pieces that document doesn't cover (app shell, migrations, tests, config):

```text
Throughline/
  .github/workflows/ci.yml
  docs/                              # BRD, ERD, TR, Module Boundaries, this document
  drizzle/
    migrations/                      # drizzle-kit output; 0000_*.sql, 0001_*.sql, ... (section 6)
      meta/                          # drizzle-kit snapshots - nested here by drizzle-kit itself
                                      # (not a sibling of migrations/ - corrected after slice 1
                                      # scaffolding found the real default). COMMITTED, never
                                      # hand-edited except a migration's journal tag on a deliberate
                                      # rename of its .sql file.
  scripts/
    verify-ddl.ts                    # diff generated SQL against ERD Appendix A (slice 1 gate)
  src/
    db/                              # module 1  - schema/, client.ts, lock.ts, index.ts
      schema/                        #            one file per table group, re-exported
    auth/                            # module 2
    ai-client/                       # module 3
    lineage/
      identity/                      # module 4
      dependency-binding/            # module 5
      impact/                        # module 6
    artifact-lifecycle/              # module 7
    architecture-materialization/    # module 8
    artifact-types/
      requirements/                  # module 9
      architecture/                  # module 10
      ui-requirements/               # module 11
      backlog/                       # module 12
    external/
      operations/                    # module 13
      github/                        # module 14
      jira/                          # module 15
      stitch/                        # module 16
    app/
      api/                           # module 17 - route handlers ONLY
      (routes)/                      # pages: projects, artifact review, impact panel
      layout.tsx, globals.css
    components/                      # shadcn/ui output + app components (no domain logic)
    lib/                             # env.ts, errors.ts, serialize.ts - no domain logic
  tests/
    unit/                            # lineage core: hashing, matching, freshness (no DB)
    integration/                     # Appendix C behaviour suite T1-T43 (container)
    fixtures/                        # canonical flow fixtures (ERD Appendix C flow)
  .husky/
    pre-commit                       # pnpm exec lint-staged
    pre-push                         # pnpm typecheck && pnpm test
  .vscode/
    settings.json                    # formatOnSave, eslint fixAll, files.eol = \n
    extensions.json                  # prettier + eslint recommendations
  .env.example                       # committed; real .env.local never committed
  .gitattributes                     # * text=auto eol=lf
  .npmrc  .nvmrc  .gitignore
  .prettierrc.json  .prettierignore
  eslint.config.mjs  vitest.config.ts
  drizzle.config.ts  next.config.ts  tsconfig.json  components.json
```

**Rules that the layout encodes:**

1. Each module folder has an `index.ts`; nothing outside the folder imports a non-re-exported file (Module Boundaries §7). Enforced mechanically in section 5.3.
2. `src/app/api/` contains route handlers and nothing else - no domain logic, no direct `db` import (except the project-creation route, per Module Boundaries §4.7).
3. `src/lib/` is for framework glue. If something in `lib/` starts knowing about `artifact_version.status`, it belongs in a module.
4. `drizzle/migrations/meta/` is committed. Deleting a snapshot makes the next `generate` re-emit objects that custom migrations already created.

---

## 4. Dependencies

Grouped by the module that needs them, so an unused group is a signal the dependency is unnecessary.

### 4.1 Runtime

| Package | For | Notes |
|---|---|---|
| `next`, `react`, `react-dom` | app shell, module 17 | App Router, React Server Components for reads |
| `drizzle-orm` | module 1 | **exact pin**, paired with `drizzle-kit` |
| `postgres` (postgres.js) | module 1 | `prepare: false` - required behind the Supavisor transaction pooler (ERD 2.1) |
| `zod` | every module | the single validation boundary for AI output, `impact()` rows, request bodies, env |
| `@supabase/supabase-js`, `@supabase/ssr` | module 2 | `auth.getUser()` only, never `getSession()` (ERD section 2). Also the Storage client for the private Stitch bucket. |
| `openai` | module 3 | `zodResponseFormat` from `openai/helpers/zod` for strict structured output (D-1) |
| `octokit` | module 14 | repo create + contents API (FR-033/034) |
| `jira.js` *(or plain `fetch`)* | module 15 | decide at slice 4; a thin `fetch` wrapper is acceptable and drops a dependency |
| `tailwindcss`, `@tailwindcss/postcss` | UI | Tailwind v4, CSS-first config |
| `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/*` | UI | pulled in by shadcn/ui components as they are added - do not pre-install the whole set |

**Deliberately not installed:** any state-management library, any data-fetching library (TanStack Query/SWR - server components + server actions cover the read paths), any queue, any logging framework beyond `console` + structured JSON, any ORM other than Drizzle, Playwright (no E2E layer in an 8-day build).

### 4.2 Dev

| Package | For |
|---|---|
| `drizzle-kit` | `generate` / `migrate` / `generate --custom` (never `push`) |
| `typescript`, `@types/node`, `@types/react`, `@types/react-dom` | types |
| `vitest`, `@vitest/coverage-v8` | unit + integration runner |
| `@testcontainers/postgresql` | throwaway `postgres:15-alpine` for the Appendix C suite (D-3) |
| `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-next` | lint |
| `eslint-plugin-boundaries` | **enforces the layer graph** - see 5.3 |
| `prettier`, `eslint-config-prettier` | formatting |
| `prettier-plugin-tailwindcss` | deterministic Tailwind class order (as in `BillBoard-Hub`) |
| `husky` | git hooks (5.6) |
| `lint-staged` | staged-file lint/format on commit (5.6) |
| `dotenv` / `dotenv-cli` | load `.env.local` for drizzle-kit and tests |
| `tsx` | run `scripts/*.ts` |

---

## 5. Configuration files

### 5.1 `tsconfig.json`

Strict mode plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`. Path alias `@/*` -> `src/*`. `verbatimModuleSyntax` on so type-only imports are explicit (matters when a boundary rule inspects imports).

### 5.2 `drizzle.config.ts`

```text
schema:        ./src/db/schema
out:           ./drizzle/migrations
dialect:       postgresql
schemaFilter:  ['public']          # never touch Supabase's auth/storage schemas (ERD 2.1)
dbCredentials: { url: DIRECT_DATABASE_URL }   # session pooler / direct, NOT 6543
```

Two different connection strings by design: **migrations** run over the session pooler or the direct connection as `postgres` so every object is owned by the role the app connects as; **application traffic** uses the transaction pooler on 6543 with `prepare: false` (ERD 2.1 point 3).

### 5.3 `eslint.config.mjs` - the boundary enforcement

This is the highest-value configuration file in the repo. `eslint-plugin-boundaries` encodes Module Boundaries §2 as a lint rule:

- element types declared per folder: `layer0` (`db`, `auth`, `ai-client`), `layer1` (`lineage/*`), `layer2` (`artifact-lifecycle`, `architecture-materialization`), `layer3` (`artifact-types/*`), `layer4` (`external/operations`), `layer5` (`external/{github,jira,stitch}`), `layer6` (`app/api`)
- rule: a layer may import strictly lower layers only; peers in the same layer are **disallowed** (this is what stops `backlog` importing `ui-requirements`, Module Boundaries §4.4)
- documented exception: `architecture-materialization` -> `identity`
- `no-restricted-imports`: `db/lock` (i.e. `withProjectLock`) importable **only** from `artifact-lifecycle` (Module Boundaries principle 3); `openai` importable only from `ai-client`; `@supabase/*` auth client only from `auth`
- deep-import ban: modules may be imported only via their `index.ts`

If a boundary needs an eslint-disable, that is the signal to re-examine the boundary (Module Boundaries §5), not to add the disable.

### 5.4 `vitest.config.ts`

Two projects in one config:

- `unit` - `tests/unit/**`, no setup file, no DB, runs in milliseconds. This is where hashing/projection/matching/freshness tests live (the ERD's headless-first instruction).
- `integration` - `tests/integration/**`, a global setup that starts one `postgres:15-alpine` container, applies the four migrations in order, and exposes the connection string; `singleThread` so advisory-lock behaviour is observable and deterministic.

Coverage thresholds are set on `src/lineage/**` and `src/artifact-lifecycle/**` only. Coverage elsewhere is not a goal for an 8-day build.

### 5.5 Other

- `next.config.ts` - minimal; `serverExternalPackages: ['postgres']`.
- `components.json` - shadcn/ui config pointing at `src/components/ui`.
- `.gitignore` - `.env*.local`, `.next`, `node_modules`, coverage. **Not** `drizzle/migrations/` (including its nested `meta/`).
- `.npmrc` - copied verbatim from `luxe-sofa-shop` (peer-dep and fetch-retry settings):

```ini
auto-install-peers=true
strict-peer-dependencies=false
fetch-timeout=30000
fetch-retries=5
fetch-retry-mintimeout=5000
fetch-retry-maxtimeout=20000
network-concurrency=4
```

### 5.6 Formatting - Prettier

`.prettierrc.json` - identical to `BillBoard-Hub`'s:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

> `luxe-sofa-shop` sets `"singleQuote": false`; **`true` is the house rule** and was confirmed for this project. `BillBoard-Hub` is therefore the closer reference for Prettier specifically; luxe-sofa-shop remains the reference for husky, lint-staged and `.npmrc`.

`.prettierignore` - same shape as luxe-sofa-shop, with the paths corrected for this repo's layout:

```text
# dependencies
node_modules

# next.js
.next
out
build

# generated - drizzle-kit nests its meta/ snapshots under migrations/, so one
# entry covers both
drizzle/migrations
pnpm-lock.yaml
next-env.d.ts
*.tsbuildinfo

# public assets
public

# env
.env*
```

Note `drizzle/migrations` (its nested `meta/` included) is ignored: generated SQL must be diffed against ERD Appendix A byte-for-byte (section 6), and a formatter rewriting it would defeat `db:verify`.

### 5.7 Git hooks - husky + lint-staged

`"prepare": "husky"` in `package.json` installs the hooks on `pnpm install`. Two hooks, same as `luxe-sofa-shop`:

| Hook | Command | Why |
|---|---|---|
| `.husky/pre-commit` | `pnpm exec lint-staged` | format + autofix only what is staged |
| `.husky/pre-push` | `pnpm typecheck && pnpm test` | typecheck plus the **unit** suite |

`lint-staged` config in `package.json`, same as luxe-sofa-shop:

```json
"lint-staged": {
  "*.{js,jsx,ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,css,md}": ["prettier --write"]
}
```

**Deliberate difference from luxe-sofa-shop:** `pre-push` runs `pnpm test` (the unit project - milliseconds, no Docker), **not** `test:all`. The Appendix C container suite is a CI job (section 9), not a push hook: it needs a Docker daemon, and a hook slow enough to be bypassed with `--no-verify` is a hook that gets bypassed. The `eslint --fix` step in `pre-commit` means a layer-boundary violation (5.3) is caught at commit time, not at CI.

### 5.8 Line endings and editor settings

Windows dev machine, Linux CI and Vercel runtime - so line endings are normalized in the repository, not left to the checkout.

`.gitattributes` (same single line as `AuthFlow` and `BillBoard-Hub`):

```text
* text=auto eol=lf
```

This commits LF for every text file regardless of the working-tree checkout, and is what makes Prettier's `"endOfLine": "lf"` agree with git instead of fighting it. It also stops the `.sh`-style husky hook files and the verbatim ERD SQL in `drizzle/migrations` from acquiring CRLF, which would break both the hooks and the `db:verify` diff.

`.vscode/settings.json` - adapted from `AuthFlow` (its `eslint.workingDirectories` entry is dropped; this repo is single-root):

```json
{
  "files.eol": "\n",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "[javascript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[javascriptreact]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[typescript]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[typescriptreact]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[json]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[jsonc]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[css]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[html]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[markdown]": { "editor.defaultFormatter": "esbenp.prettier-vscode" },
  "[yaml]": { "editor.defaultFormatter": "esbenp.prettier-vscode" }
}
```

`.vscode/extensions.json` - verbatim from `AuthFlow`:

```json
{ "recommendations": ["esbenp.prettier-vscode", "dbaeumer.vscode-eslint"] }
```

Both `.vscode` files are **committed** - they are project configuration, not personal preference, and they are what keeps a formatOnSave from producing a diff that lint-staged then re-formats.

---

## 6. Database setup and migration order

Slice 1's deliverable. The order is fixed by ERD Appendix A ("Apply it in this order: A.1 -> A.2 -> `impact()` -> A.3"):

| # | Migration | Produced by | Contents |
|---|---|---|---|
| 0000 | `init_tables` | `drizzle-kit generate` from `src/db/schema` | the 16 tables, PKs, FKs, uniques, CHECKs (ERD A.1) |
| 0001 | `triggers` | `drizzle-kit generate --custom` | every trigger from ERD A.2, verbatim |
| 0002 | `impact_function` | `--custom` | `impact()` from ERD section 6.3, verbatim |
| 0003 | `supabase_hardening` | `--custom` | ERD A.3: revoke anon/authenticated grants, RLS enabled with **no policies** on all 16 tables, `EXECUTE` revoked |

**Workflow rules (ERD 2.1):**

1. `drizzle-kit push` is never run. Only `generate` + `migrate`.
2. Every generated file is read and diffed against Appendix A before it is committed - `scripts/verify-ddl.ts` automates the comparison and is the slice-1 exit gate.
3. Any future table or function gets its own A.3-style hardening in the same migration that creates it. Test **T34** is what catches a miss.
4. Constraint names: name them explicitly in the Drizzle schema so error messages are stable.

**Supabase project setup (manual, once):** create the project; enable email sign-up with mandatory email verification (Supabase Auth settings - `mailer_autoconfirm` off, public sign-up on; ERD Appendix B round 9); create the **private** Storage bucket for Stitch assets; copy the two connection strings and the service-role key into `.env.local`.

---

## 7. Environment variables

`.env.example` is committed with every key and no values. `src/lib/env.ts` parses `process.env` through a Zod schema **at startup** and throws on a missing key - a missing credential must fail at boot, not mid-approval.

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | module 1 | Supavisor **transaction** pooler, port 6543 |
| `DIRECT_DATABASE_URL` | drizzle-kit, tests | session pooler / direct connection |
| `NEXT_PUBLIC_SUPABASE_URL` | module 2 | public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | module 2 | public by design - A.3 is why this is safe |
| `SUPABASE_SERVICE_ROLE_KEY` | module 2 (server only) | never imported from a client component |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | module 3 | model id logged per run (NFR-004) |
| `GITHUB_TOKEN`, `GITHUB_OWNER` | module 14 | server-side credential; never the Supabase `provider_token` (ERD 7.3) |
| `GITHUB_MARKER_SECRET` | module 14 | HMAC repo marker (TR 30.1) |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | module 15 | one configured Jira project per instance |
| `STITCH_*` | module 16 | pending Spike; manual-fallback path must work without it |
| `SUPABASE_STORAGE_BUCKET` | module 16 | private bucket, signed URLs only |

No credential is ever a database column, and `metadata`/`target_descriptor` carry whitelisted fields only (ERD section 2).

---

## 8. npm scripts

```text
dev              next dev
build            next build
typecheck        tsc --noEmit
lint             eslint .
format           prettier --write .
format:check     prettier --check .
prepare          husky                             # installs git hooks on pnpm install
db:generate      drizzle-kit generate
db:custom        drizzle-kit generate --custom
db:migrate       dotenv -e .env.local -- drizzle-kit migrate
db:studio        drizzle-kit studio
db:verify        tsx scripts/verify-ddl.ts          # diff generated SQL vs ERD Appendix A
test             vitest run --project unit
test:int         vitest run --project integration   # starts the container
test:all         vitest run
```

There is deliberately no `db:push` script, although `luxe-sofa-shop` has one. Its absence here is the guardrail for ERD 2.1 ("Never run `drizzle-kit push`") - the custom migrations carrying the triggers, `impact()` and the A.3 hardening are invisible to `push`, so one `push` would silently produce a database without them.

---

## 9. CI (GitHub Actions)

One workflow, on PR and on push to `main`:

```text
setup pnpm + Node 22 (cached)
  -> pnpm install --frozen-lockfile
  -> pnpm typecheck
  -> pnpm lint                      (boundary violations fail the build)
  -> pnpm format:check              (hooks can be bypassed with --no-verify; CI cannot)
  -> pnpm test                      (unit)
  -> pnpm test:int                  (Appendix C suite against a service container)
```

The integration job uses a `postgres:15-alpine` **service container** in CI (Testcontainers locally, service container in Actions - same image, same migrations). T34's anon-role assertions run here against the local container; the ERD additionally requires running T34 **once against the real Supabase project** - that is a manual slice-1 checklist item, not a CI step.

Vercel: connected to the repo, preview deploys per PR, production on `main`. Environment variables set in the Vercel project, not in the repo.

---

## 10. Setup sequence (what slice 1 actually does)

Ordered so that each step is verifiable before the next one depends on it:

1. `pnpm create next-app` (TypeScript, App Router, Tailwind, ESLint) into the existing repo; delete the sample content.
2. Add `tsconfig` strictness, `eslint-plugin-boundaries` config, `.nvmrc`, `engines`, exact-pin policy.
2b. **Code hygiene, before the first real commit:** `.gitattributes`, `.npmrc`, `.prettierrc.json`, `.prettierignore`, `.vscode/`, then `pnpm add -D husky lint-staged` + `pnpm exec husky init` and write the two hooks. Doing this first means the repo never contains a CRLF file or an unformatted commit that a later `format` turns into a noise diff across every file.
3. Create the 17 empty module folders with stub `index.ts` files, then **verify the boundary lint fails on a deliberate bad import** before writing any real code. A boundary rule you never saw fail is a boundary rule you do not have.
4. `.env.example` + `src/lib/env.ts` (Zod-parsed, throws at boot).
5. Supabase project provisioning (section 6, manual steps).
6. Drizzle schema for all 16 tables -> `db:generate` -> `db:verify` diff against Appendix A -> fix the schema until the diff is clean.
7. The three custom migrations (triggers, `impact()`, A.3), pasted verbatim from the ERD.
8. `db:migrate` against the Supabase project **and** against a container.
9. Port ERD Appendix C (T1-T43) into `tests/integration` as the first integration test. **T14, T27, T28, T34 first** (ERD section 14, slice 1 notes).
10. `auth` module: `getVerifiedUser`, `upsertAppUser`, `requireProjectOwner`; verify T35 (re-created user, idempotent upsert).
11. CI workflow; confirm it goes red on a deliberately broken test before trusting it green.
12. Vercel project + env vars; deploy once, confirm the access gate blocks an unauthenticated visitor (NFR-005).

Exit criteria for slice 1: `db:verify` clean, the Appendix C suite green in CI, T34 additionally green against the real Supabase project, and an authenticated round-trip that creates a project + its 4 artifact rows.

Slices 2-4 then follow Module Boundaries §8 unchanged - no further setup work is expected after slice 1 except adding shadcn components on demand and the provider SDKs at the start of slice 4.

---

## 11. Assumptions and things to flag

1. **`jira.js` vs plain `fetch`** is left open until slice 4. Jira's REST v3 is simple enough that a typed `fetch` wrapper may be fewer moving parts than the SDK; the `external-operations.runOperation` contract is identical either way.
2. **Tailwind v4** is assumed (CSS-first config, no `tailwind.config.ts`). If `create-next-app` scaffolds v3, keep v3 rather than migrating mid-build.
3. **No E2E test layer.** The Appendix C suite plus unit tests on the lineage core is the whole safety net. This is a deliberate NFR-008 trade; the demo path is exercised by hand.
4. **`scripts/verify-ddl.ts` is a normalizing text diff**, not a semantic SQL comparison - it lowercases, strips comments and collapses whitespace, and a human reads the remaining diff. Building a real SQL AST comparison is out of scope.
5. **Testcontainers needs a working Docker daemon on the dev machine.** If Docker is unavailable, the fallback is the Supabase CLI local stack, at the cost of slower runs.
6. **`pnpm@9` vs `pnpm@10`.** `luxe-sofa-shop` pins `pnpm@9.15.0` in `packageManager`. Pin whichever is current at scaffold time; nothing here depends on the major.
7. **No `ALLOWLISTED_EMAILS`.** Removed - ERD Appendix B round 9 dropped the allowlist gate in favor of open sign-up + mandatory email verification. If an allowlist is ever reintroduced, it goes back into `getVerifiedUser`/env the same way it was structured before.

---

## 12. Traceability

| Setup decision | Traces to |
|---|---|
| Next.js / TS / Drizzle / Supabase / Postgres 15+ | TR 5.1, ERD sections 2, 2.1, 15 |
| Transaction pooler + `prepare: false`; separate migration connection | ERD 2.1 point 3 |
| `generate` + `migrate` only, never `push`; `schemaFilter: ['public']` | ERD 2.1 points 2 and 3 |
| Migration order A.1 -> A.2 -> `impact()` -> A.3 | ERD Appendix A preamble |
| Boundary lint rules; `withProjectLock` importable from one module | Module Boundaries principles 1 and 3, §6 |
| `openai` importable only from `ai-client` | Module Boundaries §4.1 rule |
| Zod at every AI/DB/request boundary | Module Boundaries principle 4, TR Appendix A rule 1, NFR-005 |
| Env parsed at boot; credentials server-side only | NFR-005, ERD section 2 |
| Appendix C suite in CI on every change | ERD section 14 risk 2 |
| husky + lint-staged, Prettier config, `.npmrc` | house convention, `luxe-sofa-shop` |
| `.gitattributes` (`* text=auto eol=lf`), `.vscode/` | house convention, `AuthFlow` / `BillBoard-Hub` |
| `prettier-plugin-tailwindcss` | house convention, `BillBoard-Hub` |
| `drizzle/` excluded from Prettier; no `db:push` | ERD 2.1, so `db:verify` diffs against Appendix A byte-for-byte |
| Container-based integration tests on `postgres:15-alpine` | ERD header (verified on 15 and 17) |
| Open sign-up + mandatory email verification (no allowlist) | NFR-005, ERD sections 2 and 4.1, Appendix B round 9 |
| Private Storage bucket, signed URLs | ERD 4.16, TR 5.1 |

---

## 13. Slice-1 scaffolding log

What actually happened, kept here so this document stays accurate rather than aspirational (same discipline as the ERD's Appendix B).

**Where:** branch `chore/project-setup`, in a separate worktree at `../Throughline-project-setup` (not the `main` checkout).

**Done (section 10 steps 1-4):**

1. `create-next-app` scaffolded TypeScript/Tailwind v4/ESLint/App Router/`src/`. Landed as **Next.js 16.3.5 / React 19.2.8** - current stable at scaffold time, not the "15" this document originally pinned in section 2. Nothing in the ERD or TR pins a Next.js major, so 16 was kept rather than fighting the installer down to 15; section 2's table now reflects this.
2. `tsconfig.json` strictness (`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), `package.json#engines` (`node >=22 <23`), all npm scripts from section 8.
3. Code hygiene (2b): `.gitattributes`, `.npmrc`, `.prettierrc.json`, `.prettierignore`, `.vscode/`, husky hooks (`pre-commit`/`pre-push`, executable bit set via `git update-index --chmod=+x` since Windows doesn't persist `chmod` - confirm this survives a real clone), `lint-staged` config. Default `create-next-app` boilerplate (public SVGs, sample `page.tsx`/README copy) removed per step 1's "delete the sample content."
4. All 17 module folders with stub `index.ts` files (plus `src/db/client.ts`, `src/db/lock.ts`, `src/db/schema/index.ts`, and a README in `src/app/api/` in place of a stub, since route handlers don't share one barrel file). `eslint.config.mjs` written with `eslint-plugin-boundaries` encoding Module Boundaries §2's layer graph, plus `no-restricted-imports` pinning `withProjectLock` to `artifact-lifecycle` and the `openai` SDK to `ai-client`. A deliberate `src/artifact-types/backlog/_boundary-violation-test.ts` was added per step 3 but **not yet run** - see the blocker below. Delete that file once `pnpm lint` has been confirmed to fail on it and then to pass without it.
5. `drizzle.config.ts`, `vitest.config.ts` (unit/integration projects), `next.config.ts` (`serverExternalPackages: ['postgres']`), `components.json` (shadcn), `scripts/verify-ddl.ts` (a skeleton that prints normalized generated SQL for manual comparison - the auto-diff-against-a-pasted-Appendix-A behavior described in section 5 is not yet implemented; see the script's own TODO), `.github/workflows/ci.yml`, `src/lib/env.ts` (Zod-parsed env, throws at import time - uses `.string().url()`/`.string().email()` rather than the newer `z.url()`/`z.email()` top-level helpers, since the installed Zod major couldn't be confirmed against the registry).

**Resolved - the install throttle was not persistent.** `pnpm install` initially stalled at the ~1-1.5 KB/s throughput described below; on retry (same session, no environment change) it completed normally - 651 packages, ~4.5 minutes including a native build step. Treat that throttle as intermittent on this sandbox, not a fixed ceiling: if it recurs, retry before assuming it needs a different machine.

**Done since (still section 10, verification pass):**

6. `pnpm install` succeeded: `pnpm-lock.yaml` committed, `node_modules` populated. Four native-build packages needed explicit approval in `pnpm-workspace.yaml`'s `allowBuilds` (a pnpm 10+ default): `cpu-features`, `ssh2`, `protobufjs` (all pulled in by `@testcontainers/postgresql`'s Docker/gRPC plumbing) and `esbuild` (needed by `tsx`/`vite`/`drizzle-kit`). `sharp` and `unrs-resolver` stay disabled - `create-next-app`'s own default, not needed without image optimization.
7. Step 3's boundary-lint self-test actually run: with `_boundary-violation-test.ts` in place, `pnpm lint` correctly rejected `backlog` (layer3) importing `ui-requirements` (layer3 peer) via `eslint-plugin-boundaries`. File deleted now that the rule is proven to fire.
8. `pnpm typecheck` clean - but only after `pnpm build` ran once to generate `.next/types/**`, which supplies the ambient `LayoutProps<"/">` type `layout.tsx` uses. This is a Next.js App Router chicken-and-egg: the scaffolded code references a generated type that doesn't exist until the first build. Note it if `tsc --noEmit` ever fails on `LayoutProps` again after a clean checkout.
9. `pnpm format` / `format:check` clean. `.prettierignore` gained a `docs` entry - Prettier was about to mass-reformat the hand-authored design docs (this file included) on line-width/list-style grounds unrelated to any real edit, which fights the ERD's own living-doc discipline of "a diff is a decision." Docs stay hand-formatted; code stays Prettier-formatted.
10. `pnpm test` (unit project) correctly reports no test files - `tests/unit` has no `.test.ts` yet because the lineage core it would test doesn't exist (slice 2).

**Not yet run:** `pnpm test:int` (the Appendix C suite doesn't exist yet either - same slice-2 dependency), anything needing Docker.

**Done since (auth-only first cut of steps 5-6, by request - not the full 16-table slice 2):**

11. Fixed a real bug found while doing this: `drizzle.config.ts` hard-threw when `DIRECT_DATABASE_URL` was unset, which would have blocked `pnpm db:generate` on a machine with no `.env.local` yet, even though `generate` never opens a connection. Now defaults to an empty string; only `migrate`/`studio`/`push` (never used per section 2's rule) need it to be real.
12. Corrected a layout mistake from step 4/5 above: drizzle-kit nests its `meta/` snapshots **inside** `drizzle/migrations/`, not as a sibling folder. Section 3's tree, `.gitignore`'s comment, `.prettierignore`, and `eslint.config.mjs`'s `globalIgnores` all referenced a `drizzle/meta/` that drizzle-kit never creates; all four fixed to `drizzle/migrations/**` (which already covers the nested `meta/`).
13. `src/db/schema/app-user.ts` written to match ERD section 4.1 / Appendix A exactly (verified: `timestamptz` and `timestamp with time zone` are the same type, quoted vs unquoted identifiers and explicit `NOT NULL` on a `PRIMARY KEY` are cosmetic - the generated DDL is semantically identical to Appendix A). `pnpm db:generate` produced `drizzle/migrations/0000_app_user.sql`; renamed from drizzle-kit's random name to something legible, with the matching `tag` updated in `drizzle/migrations/meta/_journal.json` (renaming a migration file requires updating its journal tag, or `migrate` can't find it).
14. `drizzle/migrations/0001_app_user_hardening.sql` written by hand: the two schema-wide `REVOKE` statements from ERD A.3 plus `ALTER TABLE app_user ENABLE ROW LEVEL SECURITY` - the per-table pattern section 6 already specified for any table added incrementally. Triggers (A.2) and `impact()` (section 6.3) are correctly **not** included; they operate on lineage tables that don't exist in this auth-only cut.
15. A Supabase project was created for Throughline (none existed - the two prior projects in the account are unrelated and inactive): `throughline`, ref `olqxqsfowewvyrpwvepr`, `eu-west-2`, free tier ($0/month, confirmed before creation). Both migrations applied via the Supabase MCP's `apply_migration` (not `drizzle-kit migrate` - no DB password was available through any MCP tool to build a connection string; same SQL, same order, so the result is identical to what `migrate` would have produced).
16. Verified against the live database, not just asserted: `list_tables` confirms `app_user` exists with `rls_enabled: true`; `get_advisors(type: security)` returns exactly one INFO-level finding - "RLS enabled, no policies" - which is the intended deny-all posture, not a problem; `information_schema.columns` matches Appendix A column-for-column.
17. `.env.local` created (gitignored, never committed) with what the Supabase MCP could supply: project URL and the public anon key (both public by design). `DATABASE_URL`/`DIRECT_DATABASE_URL` have the pooler hostnames but a `[YOUR-DB-PASSWORD]` placeholder, and `SUPABASE_SERVICE_ROLE_KEY` is empty - neither the DB password nor the service-role key is retrievable through any Supabase MCP tool, by design. Get both from the dashboard: Project Settings -> Database (password) and Project Settings -> API (service_role secret key).

**Done since (auth access gate, NFR-005 - ERD Appendix B round 9):** Supabase Auth confirmed configured for open sign-up with mandatory email verification (verified live via the project's `/auth/v1/settings` endpoint: `disable_signup: false`, `mailer_autoconfirm: false`, `external.email: true`) - not invite-only + allowlist as originally specified through round 8; that was a user decision ("I'll let anyone create an account and signup"), and the allowlist has been removed from every document that referenced it (TR NFR-005, ERD sections 2/4.1/12/15, Module Boundaries `auth`, API Contracts, Jira Plan E1-S6, this document) rather than left silently stale in only one.

**Done since (`auth` module code + sign-up/sign-in UI, live-tested against the real project):** `getVerifiedUser`, `upsertAppUser`, `signUpWithEmail`, `signInWithEmail`, `signOut`, `verifyEmailOtp`, `exchangeCodeForSession`, `updateSession` all implemented in `src/auth`; `requireProjectOwner` deliberately throws (the `project` table didn't exist yet at that point). `db` module (`client.ts`/`lock.ts`) implemented for real. `/sign-up`, `/sign-in`, `/auth/confirm` built and exercised end-to-end against Supabase: a real account was created, verified via the actual email link, signed in, `app_user` upserted, signed out - each step confirmed by querying `auth.users`/`app_user` directly, not by trusting the UI. Two real bugs found this way: `eslint.config.mjs` never let any layer import `lib` (env.ts) at all, and `/auth/confirm` assumed the wrong Supabase link format (`token_hash` instead of the PKCE `code` Supabase's default email template actually sends).

**Done since (slice 2 schema - section 10 steps 6-9, the full 16-table version this time):**

18. All 15 remaining ERD tables written as Drizzle schema (`src/db/schema/*.ts`), one file per table except `artifact-version.ts`, which holds both `artifactVersion` and `architectureOption` - the ERD's one real FK cycle. Getting that cycle right in Drizzle needed a specific ordering: a column's own `.references()` callback is lazy (Drizzle's documented pattern for circular/self references), but a table's `foreignKey()`/`unique()`/`check()` config callback (the array-returning second argument to `pgTable`) is **eager**, invoked synchronously as part of the `pgTable()` call. So `architectureOption` is declared first with a lazy column-level reference forward to `artifactVersion`; `artifactVersion` is declared second with an ordinary eager `foreignKey()` closing the cycle back to `architectureOption`. Reversed, this throws "Cannot access before initialization" - got it wrong once while writing it, caught before generating anything.
19. `pnpm db:generate` produced `drizzle/migrations/0002_remaining_tables.sql` (16 tables detected, including `app_user`). Every table, column, CHECK, FK (including the circular one and the self-referential `artifact_version_item_membership.parent_logical_item_id` one) and index verified by hand against ERD Appendix A.1 before going anywhere near the live database - this is the highest-risk code in the project (ERD section 14 risk 1; throughline-lineage-invariants skill).
20. One real tooling gap found: `ack_item_unique`/`ack_ref_unique` (partial + `NULLS NOT DISTINCT` unique indexes on `impact_acknowledgement`) aren't expressible in this drizzle-orm version's schema builder - `.where()` and `.nullsNotDistinct()` aren't supported together on an index (only a plain, non-partial unique constraint supports `.nullsNotDistinct()`, and Postgres constraints can't carry a `WHERE` clause at all). Moved to their own custom migration (`0003_lineage_partial_indexes.sql`) rather than silently dropping the NULLS NOT DISTINCT semantics to make the schema builder happy. This changed the migration file count from the plan's original four (tables/triggers/impact/hardening) to six, not the DDL itself.
21. `0004_triggers.sql` (ERD A.2) and `0005_impact_function.sql` (ERD section 6.3) copied verbatim. `0006_remaining_tables_hardening.sql` extends A.3 to the 15 new tables and `impact()`, re-running the schema-wide `REVOKE` statements (idempotent, but necessary - Supabase grants its own default privileges to anon/authenticated on every newly created table/function, so each slice needs this in its own migration, exactly as the ERD's A.3 note says).
22. All six migrations applied to the live `throughline` project via the Supabase MCP, in order. Verified against the live database, not just asserted: `list_tables` shows all 16 tables with `rls_enabled: true`; `get_advisors(security)` returns exactly 16 INFO-level "RLS enabled, no policies" findings (the intended deny-all posture) plus two WARN findings unrelated to this slice's correctness (function `search_path` not pinned on the 7 new functions; leaked-password protection, a pre-existing Auth setting) - see the open item below. A full transactional test (rolled back, zero rows left behind) confirmed the append-only trigger actually fires with the exact ERD error message, not just that the trigger exists in `pg_trigger`. `impact()` was called against a non-existent project and returned cleanly with no error.

**Resolved:** the `search_path` item above - confirmed with the user. `ALTER FUNCTION ... SET search_path = public` applied live for all 7 functions (`0007_pin_function_search_path.sql`, not `CREATE OR REPLACE` - no function body touched), and the ERD's own Appendix A.2/6.3 `CREATE FUNCTION` text updated to include it, so a fresh deployment gets the hardening from the start. `get_advisors(security)` re-checked: the `function_search_path_mutable` WARN is gone, only the expected 16 `rls_enabled_no_policy` INFO findings and one pre-existing, unrelated Auth WARN (leaked-password protection) remain. Recorded as ERD Appendix B round 10 (v1.6 -> v1.7) - it edits frozen DDL text even though it changes no behavior, so it gets the same round treatment as any other frozen-DDL edit.

**Still not started:** CI has still never actually run (the workflow file exists but no push/PR has triggered it). Vercel deploy (step 12). Everything above layer 1 (identity/dependency-binding/impact modules, artifact-lifecycle, and beyond) - the schema exists now, but no module code writes to any of these 15 tables yet.
