# Throughline - Claude Skills & Agents Plan

**Document version:** 1.3
**Status:** Recommendation + operating guide, now fully applied. v1.1 recorded the first removal pass (4 skills deleted). v1.2 recorded section 6's four skills and section 7.3's four agents as **written and committed** (2026-09-23) - the ~2h30 setup checklist (section 11) is complete. v1.3 records a second removal pass, same day, on request: the five originally-"Demote" skills were also deleted after their individual rationale was reviewed in chat. Active skill count: **9 -> 4** third-party skills.
**Derived from:** BRD v2.2, Technical Requirements & Lineage Invariants v1.3, ERD/Data Model v1.4 (FROZEN), Module Boundaries v1.0, API Contracts v1.0, Project Setup & Configuration Plan v1.1, Jira Implementation Plan v1.0.
**Primary audience:** Developer (you), and any AI coding agent doing E1-E6 work.

> **For AI agents:** this document decides *which tooling assists the build*. It does not decide product behavior and it does not add a runtime dependency. Nothing here may override Project Setup section 4 (dependency list), NFR-008 (simplicity), or a frozen decision in the ERD. If a skill tells you to install a package that is not in Project Setup section 4, the skill is wrong for this repo - record the decision there first, or do not install it.

---

## 0. The budget rule this document obeys

Jira Plan section 1.6 is blunt: P0 sizes to ~147h against an ~80h budget - **84% over** before a single skill is installed. That number governs everything below.

So every recommendation here is held to one rule:

> **A skill or agent earns its place only if it removes more hours than it costs, or it prevents a defect class the ERD says is fatal.**

Total setup budget proposed: **~2.5 hours**, once, before Epic 5 starts. Everything rejected is named on the record in section 5, so a later "should I add X?" does not get re-litigated.

The second rule matters more than it sounds:

> **Tooling that feels like progress is the most expensive thing in an over-budget plan.** Installing eleven design skills is not designing. Writing an agent that audits module boundaries is not writing the lineage core.

---

## 1. What is already installed (audit, as of this document)

| Location | Contents | Notes |
|---|---|---|
| `.claude/skills/` (project) | **4** skills from `emilkowalski/skill`: `animate`, `ask-sonner`, `emil-design-eng`, `prototype` | Pinned by `skills-lock.json` with content hashes. Was 13, then 9 after the first removal pass, then 4 after the second (section 2) |
| `.agents/skills/` (project) | Byte-identical mirror of the same 4 | Feeds the non-Claude agent runtime configured in `.codex/config.toml` |
| `~/.claude/skills/` (user) | `ui-ux-pro-max` | Applies to every project on this machine, not only Throughline |
| `~/.claude/plugins/` (user) | `code-review@claude-plugins-official`, `frontend-design@claude-plugins-official` | |
| This desktop session | `design:*`, `engineering:*`, `product-management:*`, `productivity:*`, `anthropic-skills:*`, `dataviz`, `artifact-design`, `artifact-diagramming`, plus built-in `/code-review`, `/security-review`, `/simplify`, `/init` | Bundled with the app - **no install needed**, invoke by name |
| MCP servers, connected | Supabase, Vercel, Google Drive/Docs/Gmail/Calendar, Claude Browser | Usable right now |
| MCP servers, need OAuth | GitHub, Atlassian (Jira), Figma, Linear, Notion, Slack, and others | Cannot be authorized from this session - see section 8.4 |

**Finding:** the pack as originally installed was a *mobile / animation / Apple-platform* set. Throughline is a **desktop-first, dense, read-heavy artifact-review tool**: tables of items, diffs, status badges, a dependency graph, approval dialogs, and preview-before-external-write gates. Four of the thirteen could not fire usefully here at all and have been removed (section 2); five more remain but are demoted. Unused skills are not free - see section 10.1.

---

## 2. Verdict on each installed skill, for *this* project

| Skill | Verdict | Why, against this repo |
|---|---|---|
| `ui-ux-pro-max` | **Keep - primary** | The general design pass: hierarchy, spacing, density, component consistency. The right default reviewer for E5's ten screens. |
| `emil-design-eng` | **Keep - primary** | Judgment about polish and the invisible details. Its bias toward restraint is exactly right for a tool where the content, not the chrome, is the product. |
| `ask-sonner` | **Keep** | Directly load-bearing. Project Setup D-2 names **toast** as one of four shadcn primitives the screens need, and shadcn's toast *is* Sonner. Approve / reject / export / retry all need a toast that survives a route change. |
| `animate` | **Keep - narrow** | Useful in exactly three places (section 4.3). Its first question is "should this animate at all" - the right question in an 8-day build. Must not introduce a motion library; Project Setup section 4 has none. |
| `frontend-design` (plugin) | **Keep - with a correction** | Stops generic AI-template output. But it optimizes for *distinctive*; Throughline needs *dense and calm*. Always prompt it with "dense internal data tool, not a marketing page". |
| `code-review` (plugin) + built-in `/code-review` | **Keep** | Generic correctness review of the lineage core. It will not know your invariants - that gap is closed by section 6.1, not by a better generic reviewer. |
| `prototype` | **Keep - sandbox only** | Fine for exploring a layout in a scratch file. Its output must not land in `src/` unchecked: it does not know Project Setup section 4 or the module layer graph. |
| `review-animations` | **Removed** ✔ (was Demote) | Only meaningful once motion exists. You will have ~3 transitions; reviewing them is a five-minute job, not a skill invocation. |
| `find-animation-opportunities` | **Removed** ✔ (was Demote) | Asks "what else could move?" in a project whose stated NFR is simplicity. Its honest answer here is "almost nothing". |
| `improve-animations` | **Removed** ✔ (was Demote) | Produces a motion roadmap. E5 is 27h for ten screens; there is no room for one. |
| `apple-design` | **Removed** ✔ (was Demote) | Gestures, sheets, momentum, translucency - Throughline has none of these. Its typography/restraint material is good, but `emil-design-eng` covers that without the gesture content. |
| `animation-vocabulary` | **Removed** ✔ (was Demote) | A naming lookup. Costs nothing to keep, contributes nothing here. |
| `mobile-native` | **Removed** ✔ | Throughline's own UI has no mobile requirement. "Responsive" appears in the requirement set **only as a content field of the generated `ui_requirement` artifact** (TR line 508; ERD `ui_requirement` row) - a constraint Throughline writes *about someone else's project*, never a constraint on its own screens. |
| `animate-expo` | **Removed** ✔ | React Native / Expo. Not this stack. |
| `write-swift` | **Removed** ✔ | Swift. Not this stack. |
| `pick-ui-library` | **Removed** ✔ | Frozen: Project Setup **D-2 = Tailwind + shadcn/ui**. A skill whose job is to reopen a closed decision is a liability in a repo built on frozen decisions. |

**Applied 2026-09-23, in two passes.** First pass: the four originally-verdict **Removed** skills were deleted from `.claude/skills/`, the `.agents/skills/` mirror, and `skills-lock.json` (13 entries -> 9). Second pass, same day, on request: the five originally-verdict **Demote** skills were reviewed (their individual "why" restated above, requested and given in chat before deletion) and then also deleted, on the reasoning that "irrelevant but harmless" is still selection-space noise (section 10.1) once the four `throughline-*` skills exist to do the load-bearing work - 9 entries -> 4. **Active set is now 4 third-party skills** (`animate`, `ask-sonner`, `emil-design-eng`, `prototype`) **+ 4 `throughline-*` skills** (section 6) **+ user-level `ui-ux-pro-max`** (not in this repo's lock file - see section 1's location table).

**How to reverse it:** `.claude/`, `.agents/` and `skills-lock.json` are gitignored, so this deletion is *not* recoverable from git history. Re-running `npx skills add emilkowalski/skill` restores the full pack from source, then delete again what you do not want. Nothing else in the repo referenced these four.

**The residual cost of the five kept skills** is description-space collision at selection time (section 10.1). The mitigation, if it ever bites, is section 10.2 - a project `CLAUDE.md` naming which skills apply here.

---

## 3. Tier A - add these (high value, low risk)

All six are **already available in this desktop session**. Nothing to install; invoke by name.

### 3.1 `dataviz` - for the dependency/version visualization (E5-S7)

E5-S7 ("Dependency/version visualization - simple view, same data as the warning panel") is the screen the capstone thesis is judged on. It is also the screen most likely to come out as an unreadable hairball.

`dataviz` supplies a color formula, mark specs, legend and axis rules, and light/dark consistency - a design method, not a library.

**Trade-off, and it is real:** `dataviz` will happily reach for a charting library. **Project Setup section 4 has none, and "Deliberately not installed" is a recorded decision.** Use the method, render with inline SVG plus Tailwind. Say so in the prompt:

```text
Use the dataviz method but render as inline SVG - no chart library.
Project Setup section 4 forbids new runtime dependencies.
Graph: ~40 nodes max (ItemVersions), edges = lineage,
node state = fresh / stale / acknowledged, and state must not be
carried by color alone.
```

ERD section 14's "build it headless first" still applies: the graph must be *correct* out of `impact()` before it is pretty.

### 3.2 `design:accessibility-review` - closes a genuine, documented gap

**There is no accessibility NFR for Throughline's own UI.** NFR-001..008 cover explainability, integrity, history, reproducibility, security, reliability, performance, simplicity. Accessibility is absent.

That is a defensible 8-day scope call, and this document does not propose adding an NFR. But note the demo-day exposure: Throughline *generates accessibility constraints for other people's projects*. A reviewer who tabs through your approval dialog and finds no focus ring will ask about that, and it is a hard question to answer well.

**Recommendation - bounded, not a WCAG programme.** Run it **once**, on the E5 screens as a batch, scoped to four things:

1. Every interactive control reachable and operable by keyboard - the approve / approve-anyway dialog above all. FR-083/FR-084 is a decision gate, and a decision gate you cannot reach by keyboard is a broken decision gate.
2. A visible focus indicator.
3. Contrast on the status badges, and `draft` / `approved` / `rejected` / `superseded` / `stale` distinguished by **more than color**.
4. Labelled form controls, and the impact panel's "why is this flagged" path readable as prose, not only as graph geometry. NFR-001 is explainability; a screen reader is the cheapest test of whether your explanation actually works as text.

**Trade-off:** full WCAG 2.1 AA across ten screens is 8-12h you do not have. The subset above is ~2h and covers what a reviewer will actually hit. Anything beyond it is P1 - record it as a known limitation in E6-S8 rather than half-doing it.

### 3.3 `artifact-design` + `artifact-diagramming` - for the graded deliverables

E6-S6 (evaluation write-up), E6-S8 (final documentation pass), and demo day are graded artifacts. These two produce the shareable page: lineage diagrams, the before/after of the controlled change test (E6-S4 / BRD 10.3), the manual-baseline comparison from E6-S5.

**Zero risk to the codebase** - nothing touches `src/` - and the highest grade-per-hour item in this document.

### 3.4 `engineering:architecture` - for ADR shape, not for your decisions

FR-033/034 has Throughline writing README + **ADR** + `lineage.json` into every generated repo. That ADR template and rubric should be good, because every generated repo carries it.

**Trade-off:** use it for the ADR **shape** only. Do not let it reopen your own architecture - those decisions are frozen across ERD section 15, TR 5.1 and Project Setup section 1.

### 3.5 `anthropic-skills:skill-creator` - to build section 6's skills

The meta-skill. One ~45-minute session produces the four project-specific skills that are the actual leverage here.

### 3.6 Supabase MCP (already connected) - satisfies your own ERD verification rule

Not a skill, but Tier A because it closes a standing rule of yours: *execute the SQL before calling the ERD verified*.

- `execute_sql` / `apply_migration` - run Appendix A DDL and the Appendix C suite against the real project (E1-S5).
- `get_advisors` - Supabase's own security and performance lints. Run after E1-S4 (hardening) and again in E6-S3. It independently checks what T34 checks: that the Data API is closed to public roles.
- `list_tables` / `generate_typescript_types` - cross-check Drizzle's schema against what is actually in Postgres.

**Trade-off:** MCP writes against the hosted project are real writes. Keep migrations flowing through `drizzle-kit` and committed SQL (Project Setup section 6); use MCP to **verify and inspect**, never as a second write path. A second write path into the schema is precisely the failure Module Boundaries section 5 exists to prevent - it would be ironic to introduce one at the tooling layer.

---

## 4. Tier B - add only when a specific thing happens

### 4.1 Browser inspection instead of the Playwright plugin

Project Setup section 4.1 lists Playwright under **"Deliberately not installed"** - "no E2E layer in an 8-day build". That decision stands.

You still need to *look* at a running screen: confirm the Stitch iframe really is sandboxed (E5-S10 / FR-053), read console errors, watch a slow impact query.

**Use the browser already in this session** (`preview_start`, `read_page`, `read_console_messages`, `read_network_requests`). Zero install, zero repo dependency, no decision reversed. The `playwright` and `chrome-devtools-mcp` plugins do the same job and cost you a recorded decision - skip both.

### 4.2 Vercel MCP (already connected)

Adopt at E1-T2 (first deployment), not before: `list_deployments`, `get_runtime_logs`, `get_runtime_errors` when a build or a server action fails.

### 4.3 `animate` - the three places motion earns its place

Bound it to these and no others:

1. **The impact panel appearing** after an approval reveals downstream warnings. Motion here carries meaning: something changed *as a consequence of what you just did*. ~150ms fade plus a 4px rise.
2. **A row changing state** in the review table when an item goes stale. A color crossfade, not a slide.
3. **Dialog enter/exit** for approve / approve-anyway. shadcn's Radix dialog already ships this - do not rebuild it.

Everything else on these screens is a table, a diff or a graph, and the correct amount of motion on a diff is zero. **No motion library**: CSS transitions plus Radix defaults cover all three.

### 4.4 Atlassian (Jira) MCP - almost certainly not worth it

Tempting for creating the 62 issues from `Throughline_Jira_Import.csv`. Reject it:

- It needs OAuth you cannot complete from this session (section 8.4).
- 62 issues over MCP is 62 round trips with epic-link ordering to get right by hand; the CSV import is one action and is already written.
- The **product's** Jira integration (FR-070..074, E4-S3) must be built by you against the real Jira API, with the insert-first/lock/decide protocol and the reconciliation marker. An MCP server that creates issues for you teaches you nothing about the duplicate-prevention behavior E4-T2's spike exists to decide.

Use the CSV. Skip the connector.

### 4.5 `productivity:task-management` / `product-management:sprint-planning`

Only if the Jira board stops reflecting reality. You already have a 62-issue plan with dependencies and estimates; a second planning layer is overhead until the first is stale.

---

## 5. Tier C - explicitly rejected (so this is not re-litigated)

| Candidate | Rejected because |
|---|---|
| Framer Motion / any motion library | Project Setup section 4 has no such dependency, and section 4.3 needs none |
| TanStack Query / SWR / any state library | "Deliberately not installed" - server components plus server actions cover every read path |
| Storybook | A component workshop cannot be absorbed by a 27h, ten-screen epic |
| A second UI kit (MUI, Mantine, Chakra, Park UI) | D-2 is frozen. Mixing kits is how a 27h epic becomes 40h |
| `superdesign` / canvas design tools | Produces designs you then re-implement. You need implementation, and shadcn already supplies the vocabulary |
| Multi-agent workflow runs / `ultracode` | Dozens of agents re-deriving six documents. The docs are the expensive context here; fan-out multiplies that cost |
| Figma MCP | BRD section 9: "Figma integration" is explicitly out of scope |
| A generic "Next.js best practices" skill | Stack decisions are frozen and written down. A generic skill will contradict them and you will spend time arbitrating |
| `sentry` / Datadog plugins | No production users, an 8-day life, no error budget to observe |
| `write-swift`, `animate-expo`, `mobile-native` | Wrong platform (section 2) |

---

## 6. The real leverage: four skills you write yourself

Nothing above knows your invariants. These four do, and they are worth more than every installed skill combined, because they encode decisions that already exist in six documents and are currently enforced only by you remembering them.

Build them with `anthropic-skills:skill-creator`, or just write the files - the format is small.

**Location:** `.claude/skills/<name>/SKILL.md` in this repo (committed, so any agent on any machine gets them).

**Format:**

```markdown
---
name: throughline-lineage-invariants
description: <one line - this is the ONLY thing used to decide whether to load the skill, so it must contain the words that appear in a relevant request>
---

<the instructions>
```

The `description` is a trigger, not a summary. Write it with the vocabulary that actually shows up in your prompts and file paths.

### 6.1 `throughline-lineage-invariants` - the highest-value skill in the repo

**Triggers on:** lineage, matching, hashing, projection, freshness, impact, staleness, approve, revision, `src/lineage/**`, `artifact-lifecycle`.

**Contents:**
- The INV list that applies to the write path (INV-006, INV-010..016, INV-020..026), each with its ERD test id.
- The four rules that a generic reviewer cannot infer:
  1. Only `artifact-lifecycle` may call `withProjectLock`.
  2. A module never writes a table it does not own (Module Boundaries section 5).
  3. Model output is untrusted data - it never supplies identifiers, statuses or queries (NFR-005).
  4. Staleness is detected only **after** the new artifact version is approved (BRD section 8), never on draft creation.
- The ordering rule from ERD section 14: T21 passes against a real LLM call before any other test in Epic 2 counts.

**Why this beats a generic code reviewer:** `/code-review` will find a null deref. It will not notice that you wrote to `item_version` from `backlog` instead of `identity`, because that is a *boundary* fact living in a different document from the code.

### 6.2 `throughline-module-boundaries` - the layer graph as prose

**Triggers on:** new file under `src/`, import, module, layer, boundary, `index.ts`.

**Contents:** the layer table from Project Setup 5.3 (`layer0` db/auth/ai-client, through `layer6` app/api), the "peers in the same layer may not import each other" rule, the single documented exception (`architecture-materialization` -> `identity`), the `no-restricted-imports` list, and the deep-import ban.

**Trade-off, stated honestly:** `eslint-plugin-boundaries` already enforces most of this *mechanically*, and a lint rule beats a skill every time. The skill earns its place in two ways: it applies **before** the code is written (so you do not write an import you then have to unwind), and it covers the semantic half lint cannot see - table ownership. Keep the skill short and let it defer to ESLint for the syntactic rules rather than duplicating them.

### 6.3 `throughline-doc-sync` - your own traceability rule, applied to your own docs

**Triggers on:** ERD, BRD, TR, requirements, invariant, API contract, schema change, doc update.

**Contents:**
- The ERD is one living document - update `docs/Throughline_ERD.md` **in place**, never as a new file.
- Execute the SQL before calling any DDL change verified.
- The downstream chain: BRD -> TR -> ERD -> Module Boundaries -> API Contracts -> Jira Plan. An edit to any of them puts every document to its right at risk, and the edit is not done until each has been checked.
- The identifier namespaces are separate and must not be mixed: `BO-` business objectives, `BR-` business requirements, `FR-`/`NFR-` requirements, `INV-` invariants, `T##` ERD tests.

This is Throughline's own thesis applied to its own documentation, which is worth saying out loud on demo day: the six-document chain has exactly the change-impact problem the product is built to solve.

### 6.4 `throughline-screen-kit` - design consistency *and* a security invariant in one file

**Triggers on:** screen, page, component, review UI, badge, diff, dialog, panel, `src/app/(routes)/**`, `src/components/**`.

**Contents:**
- **The four `artifact_version.status` values and their exact visual treatment** - `draft`, `approved`, `superseded`, `rejected` (ERD line 1079's CHECK constraint) - each with shape or icon as well as color, never color alone (the accessibility subset from 3.2, enforced at authoring time instead of audited later). **"Stale" is not a fifth status** - INV-020 stores no `isStale` field; flagged/not-flagged is a separate, computed-on-read dimension (impact rows) layered on top of a `draft`/`approved` item, most visibly on `approved`. Conflating the two is an easy, wrong shortcut - keep the badge and the impact indicator visually distinct.
- **Every screen needs four states**: loading, empty, error, and the "no impact found" case, which is a *success* state and must not look like an error.
- **The rendering rule, which is security, not style:** generated text is rendered as **escaped text or sanitized Markdown, never as raw HTML** (NFR-005). Any `dangerouslySetInnerHTML` outside the sandboxed Stitch iframe is a bug.
- **The Stitch preview is a separate-origin iframe without `allow-same-origin`** (FR-053, E5-S10).
- **Every external-write preview shows impact before the confirm button** (FR-085). This is not a nicety - it is a requirement, and it is the kind of requirement that quietly goes missing when three preview screens are built on three different days.
- The one-generic-review-screen decision from Jira Plan 1.6 option 2, if you take it, so that agents build the parameterized screen rather than four bespoke ones.

**Why this one pays for itself fastest:** it is read by every E5 story, and it converts four separate "remember to..." rules into a file.

---

## 7. Agents

### 7.1 What an agent is, and when it is the wrong tool

A **skill** is instructions loaded into the conversation you are already having: same context, same files, no hand-off. An **agent** is a separate Claude with its own context window and its own tool set, which does a job and returns a report.

The cost is the difference: **an agent starts cold.** It has not read your ERD, does not know which slice you are in, and will re-derive context you already have. That makes the economics clear:

| Good agent work | Bad agent work |
|---|---|
| Read-only audits over many files | Writing the lineage core |
| Fan-out search ("where is X referenced?") | Anything where the invariants live in three documents the agent has not read |
| A review that should *not* be biased by your reasoning | Work you would have to re-explain in full to delegate |
| Long jobs you want running while you keep coding | Quick single-file edits |

The lineage core in particular should be written **by you, in the main session, with the skills from section 6 loaded.** It is 28h of the highest-risk work in the plan (ERD section 14), its rules span the ERD, TR and Module Boundaries, and a subagent will approximate them convincingly. Approximately-correct lineage is worse than obviously-broken lineage, because it passes a demo and fails the controlled change test.

### 7.2 Built-in agents worth using

| Agent | Use it for | Do not use it for |
|---|---|---|
| `Explore` | "Which files touch `item_version`?", "where is `withProjectLock` called?" - broad read-only sweeps that would otherwise dump a lot of file content into your context | Reviewing or judging code - it locates, it does not audit |
| `Plan` | A per-slice implementation plan for E2 or E3 before you start typing, with the trade-offs named | Planning the project - that already exists in six documents |
| `general-purpose` | Multi-step research with a clear, self-contained brief | Anything touching lineage writes |

### 7.3 Custom agents worth writing

**Location:** `.claude/agents/<name>.md`, committed.

**Format:**

```markdown
---
name: boundary-auditor
description: Audits src/ against the Module Boundaries layer graph and table-ownership rules. Read-only - reports violations, does not fix them.
tools: Read, Grep, Glob
model: sonnet
---

You audit this repository against two documents you must read first:
- docs/Throughline_Module_Boundaries.md sections 2, 5 and 7
- docs/Throughline_Project_Setup.md section 5.3

Report, as a table: file, violated rule, the exact import or write, the
document section it violates. Do not fix anything. Do not report style
opinions. If you find no violations, say so in one line.
```

Four worth having:

#### 1. `boundary-auditor` (read-only, sonnet)

Walks `src/` and reports layer-graph violations and - the part ESLint cannot see - **a module writing a table it does not own**. Run at the end of each slice.

*Trade-off:* overlaps `eslint-plugin-boundaries` for the import rules. Keep it anyway for table ownership, and run it on a schedule (end of slice) rather than continuously.

#### 2. `invariant-reviewer` (read-only, opus)

Reviews a diff against the INV list and the ERD test ids. Output format: one row per finding with the invariant id, the test id that would catch it, and whether that test currently exists.

*Trade-off:* the most expensive agent here, and the one worth the money. Run it on the E2 and E3 diffs only - the slices where a silent invariant break survives to demo day.

#### 3. `test-citation-checker` (read-only, haiku - cheap)

Jira Plan section 1.5: a story is Done only when **every cited ERD test id passes**. This agent takes a story id or a branch, extracts the cited `T##` ids, and confirms each one exists in `tests/integration/` and actually ran.

*Trade-off:* small and boring, which is the point. It runs in seconds on the cheapest model and enforces the single discipline most likely to erode on day 6 when you are 20h over.

#### 4. `doc-chain-checker` (read-only, sonnet)

After an ERD or TR edit, reports every downstream document that now contradicts it. Pairs with the skill in 6.3 - the skill reminds you of the rule while you edit, the agent verifies afterwards.

*Trade-off:* the six documents total ~340KB. Give the agent the *changed section* plus the target document, not the whole corpus, or it will spend its context reading and have none left for reasoning.

#### Deliberately not an agent

- **A "UI builder" agent.** E5's screens must match section 6.4's kit and the API Contracts shapes. An agent that has read neither will produce screens you rewrite.
- **A "fix the failing test" agent.** In this repo a failing Appendix C test usually means the *lineage rule* is wrong, not the test. An agent optimizing for green is optimizing for the wrong thing.

### 7.4 How to run them

```text
Use the boundary-auditor agent on src/lineage and src/artifact-types.
```

Or by capability if you have not written a custom one:

```text
Use the Explore agent to find every call site of withProjectLock.
```

Agents run in the background by default and notify you when done - useful for the end-of-slice audits, which you can start and then keep coding through. They do not see your conversation, so the prompt must name the documents and sections they need.

---

## 8. Installing and configuring

### 8.1 Skills - directory layout

| Scope | Path | Applies to |
|---|---|---|
| Project | `<repo>/.claude/skills/<name>/SKILL.md` | This repo only. **Commit these** - the section 6 skills belong here |
| User | `~/.claude/skills/<name>/SKILL.md` | Every project on this machine (where `ui-ux-pro-max` lives) |
| Plugin | installed under `~/.claude/plugins/` | Invoked as `<plugin>:<skill>` |

A skill is just a folder with `SKILL.md` and optional reference files beside it (`RECIPES.md`, `API.md` - the installed pack uses this pattern). No build step, no registration.

#### What is and is not committed

`.gitignore` originally excluded `.claude/`, `.agents/`, `.codex/` and `skills-lock.json` wholesale, as *"AI agent tooling (local, machine-specific - not part of the product)"*. That is right for a third-party pack. It is **wrong for section 6's four skills**, which encode frozen ERD and Module Boundaries decisions and must be identical for every agent on every machine.

Amended 2026-09-23 to split the two cases:

```gitignore
# AI agent tooling.
# Third-party skills and machine-local config stay out of the repo; the project's
# OWN skills and agents are committed - they encode frozen ERD / Module Boundaries
# decisions and must be identical for every agent on every machine.
.claude/*
!.claude/skills/
.claude/skills/*
!.claude/skills/throughline-*/
!.claude/agents/
.agents/*
!.agents/skills/
.agents/skills/*
!.agents/skills/throughline-*/
.codex/
skills-lock.json
```

The `throughline-` prefix on section 6's skill names is therefore **load-bearing, not decorative** - it is what the negation rule matches. A project skill named without it will be silently ignored by git.

Consequences to know:

- Third-party skills (`animate`, `ask-sonner`, ...) and `skills-lock.json` stay untracked, so **deleting one is not recoverable from git** - only by re-running `npx skills add`.
- `.claude/settings.local.json` and anything else machine-local under `.claude/` stays ignored, as it should.
- A fresh clone gets the four project skills and the agents, and gets the third-party pack only after `npx skills add emilkowalski/skill`. Worth one line in the README at E6-S8.

### 8.2 Installing third-party skills

The `skills-lock.json` in this repo was produced by the `skills` CLI:

```bash
npx skills add emilkowalski/skill
```

Related commands:

```bash
npx skills list
```

```bash
npx skills update
```

Manual installation is equally valid and is what you will do for section 6's skills - create the folder, write `SKILL.md`, commit. Hand-written skills do not need a lock entry.

**Note on the `.agents/` mirror:** `.agents/skills/` duplicates `.claude/skills/` for the runtime configured in `.codex/config.toml`. If you add a skill to one, add it to both, or the two agent runtimes will behave differently on the same repo - a confusing class of bug to debug at day 6. The `.gitignore` above mirrors the same split, so `.agents/skills/throughline-*/` is committed alongside its `.claude/` twin.

### 8.3 Installing plugins

Plugins bundle skills, agents, commands and MCP servers. Installation is an interactive terminal dialog, so run it from a real `claude` terminal, not from this desktop session:

```bash
claude
```

then, inside it:

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install <name>@claude-plugins-official
```

The marketplace carries ~297 plugins. Relevant names, if you ever want them: `supabase`, `vercel`, `typescript-lsp`, `chrome-devtools-mcp`, `playwright`. Per sections 4 and 5, you need none of them installed - Supabase, Vercel and a browser are already available in this session.

### 8.4 MCP servers that need authorization

Several connectors in this session are configured but unauthenticated: **GitHub, Atlassian (Jira), Figma, Linear, Notion, Slack** and others. **They cannot be authorized from this session** - it is non-interactive, so the OAuth flow cannot run here.

To authorize: for claude.ai connectors, use your claude.ai connector settings; for others, run `claude mcp` or `/mcp` from an interactive terminal. Until then those tools are unavailable, not missing.

Also note: `similarweb` is currently configured but failing to connect (DNS). Not relevant to this project - ignore it.

For Throughline specifically: **GitHub MCP is the one worth authorizing**, and only during E4. FR-033/034 has you creating repos and writing README/ADR/`lineage.json` through Octokit in the product; having the MCP available lets you *inspect* what the product created without leaving the session. Jira MCP - see 4.4, skip it.

### 8.5 Verifying a skill is live

Ask in-session:

```text
List the skills available in this project.
```

If a skill you wrote never fires, the cause is nearly always the `description` line - it did not contain the words your request contained. Rewrite the description with the exact vocabulary you use, including file paths (`src/lineage/`, `artifact_version`) and document ids (`INV-`, `FR-`, `T##`).

---

## 9. Which skills and agents apply, by epic

| Epic | Skills | Agents | Notes |
|---|---|---|---|
| **E1** Foundation, schema, auth | `throughline-doc-sync`, Supabase MCP | - | `get_advisors` after E1-S4; it independently checks what T34 checks |
| **E2** Lineage core | `throughline-lineage-invariants`, `throughline-module-boundaries`, `/code-review` | `Plan` before starting; `invariant-reviewer` + `boundary-auditor` at the slice gate | The highest-risk epic. Write it yourself, in the main session, with the invariant skill loaded |
| **E3** Approval, architecture, generation | same as E2, plus `engineering:architecture` for ADR shape | `invariant-reviewer` on the diff; `test-citation-checker` per story | The approval gate (FR-083/084) is where invariants get quietly bypassed under time pressure |
| **E4** External integrations | `/security-review` (credentials stay server-side, NFR-005), GitHub MCP for inspection | `test-citation-checker` | Do not delegate the insert-first/lock/decide protocol - E4-T1/T2 spikes exist to decide it |
| **E5** UI and visualization | `throughline-screen-kit`, `ui-ux-pro-max`, `emil-design-eng`, `dataviz` (E5-S7), `ask-sonner`, `animate` (three places only), `frontend-design`, then `design:accessibility-review` **once** at the end | Browser tools to check the sandboxed iframe (E5-S10) | The only epic where the design skills earn their keep |
| **E6** Demo and evaluation | `artifact-design`, `artifact-diagramming`, `/security-review`, `throughline-doc-sync` | `boundary-auditor` and `doc-chain-checker` for the final pass | E6-S6's write-up is graded; the artifact skills are the best grade-per-hour item in this document |

---

## 10. Anti-patterns and failure modes

### 10.1 Too many skills makes skill selection worse

Skills are chosen by matching your request against `description` lines. Thirteen animation and mobile skills in a project with no animation and no mobile do not sit quietly - they compete for selection with the skills you need, and occasionally win. A vague description on an irrelevant skill is worse than no skill.

**Target: about 8-12 active skills for this project.** Section 2's original plan landed at 9 (4 kept third-party + 4 `throughline-*` + `ui-ux-pro-max` at user level) and was tightened further to **8** on request - the five originally-"Demote" skills were removed as well, leaving only skills with a genuine, stated reason to fire in this repo.

### 10.2 If you do not want to remove them, name the ones that apply

A short project `CLAUDE.md` (generate the skeleton with `/init`) stating which skills apply here, plus the four hard rules - no new dependencies outside Project Setup section 4; the ERD is one living document; model output is untrusted; a module never writes a table it does not own - is a cheaper mitigation than pruning, and it helps every agent regardless of which skills load.

### 10.3 Do not let a skill add a dependency

The single most likely way this tooling harms the project: a design skill suggests Framer Motion, a viz skill suggests Recharts, an agent installs it, and Project Setup section 4 is quietly false. Then `pnpm-lock.yaml` and the documentation disagree, and you find out at deploy time on day 7.

**Rule: any `pnpm add` is a decision that gets written into Project Setup section 4 first, or it does not happen.**

### 10.4 Do not run an accessibility or design pass before the data is right

ERD section 14: build it headless first. A beautifully spaced impact panel showing the wrong transitive closure is worse than an ugly one showing the right closure, because the ugly one gets fixed. Design passes go at the end of E5, after the API Contracts shapes are actually rendering.

### 10.5 Do not spawn agents to feel productive

Each agent starts cold and re-derives context you already have. Two or three targeted read-only audits per slice is right; a fan-out of eight agents over a 340KB document corpus is expensive and returns an averaged opinion.

---

## 11. The 2.5-hour setup checklist

Done once, on 2026-09-23. Table kept as a record of what was actually applied, in what order.

| # | Action | Status |
|---|---|---|
| 1 | Write `.claude/skills/throughline-lineage-invariants/SKILL.md` (section 6.1) | **done** |
| 2 | Write `.claude/skills/throughline-module-boundaries/SKILL.md` (section 6.2) | **done** |
| 3 | Write `.claude/skills/throughline-doc-sync/SKILL.md` (section 6.3) | **done** |
| 4 | Write `.claude/skills/throughline-screen-kit/SKILL.md` (section 6.4) | **done** |
| 5 | Mirror all four into `.agents/skills/` (byte-identical, verified with `diff -r`) | **done** |
| 6 | Write `.claude/agents/boundary-auditor.md` and `.claude/agents/test-citation-checker.md` | **done** |
| 7 | Write `.claude/agents/invariant-reviewer.md` and `.claude/agents/doc-chain-checker.md` | **done** |
| 8 | Prune section 2's four "Remove" skills | **done** |
| 9 | Split `.gitignore` so the project's own skills and agents are tracked (section 8.1) | **done** |
| 10 | Commit all of it - so every agent on every machine reads the same rules | **done** |

Not on this list, and deliberately: installing anything, authorizing any connector, adding any dependency. All of those remain decisions for the epic that needs them, not this setup pass.

**Where the eight files landed**, for reference:

```text
.claude/skills/throughline-lineage-invariants/SKILL.md
.claude/skills/throughline-module-boundaries/SKILL.md
.claude/skills/throughline-doc-sync/SKILL.md
.claude/skills/throughline-screen-kit/SKILL.md
.agents/skills/throughline-lineage-invariants/SKILL.md   (mirror)
.agents/skills/throughline-module-boundaries/SKILL.md    (mirror)
.agents/skills/throughline-doc-sync/SKILL.md             (mirror)
.agents/skills/throughline-screen-kit/SKILL.md           (mirror)
.claude/agents/boundary-auditor.md
.claude/agents/invariant-reviewer.md
.claude/agents/test-citation-checker.md
.claude/agents/doc-chain-checker.md
```

All twelve confirmed trackable under the amended `.gitignore` (section 8.1) via `git check-ignore`, and each of the four skills confirmed to fire on its trigger phrase in-session before being committed.

---

## 12. Summary

- **What is installed is mostly wrong for this project.** It is an animation and mobile pack; Throughline is a dense, desktop, read-heavy review tool. Four skills should go, five should be demoted, four earn their keep.
- **The highest-value skills do not exist yet and cannot be installed.** They encode this repo's frozen decisions: the lineage invariants, the module layer graph, the six-document sync rule, and the screen kit that carries NFR-005's rendering rule alongside the visual vocabulary. Two and a half hours to write, and they pay back across E2 through E6.
- **Agents are for read-only audits, not for the lineage core.** Cold start is the whole cost model. Four small ones - boundaries, invariants, test citations, doc chain - run at slice gates.
- **Accessibility is a real, documented gap** with a demo-day cost, and the honest fix is a bounded four-item pass, not a WCAG programme this budget cannot hold.
- **Modern and trendy is not the goal here.** The plan is 84% over budget and NFR-008 is simplicity. Three transitions, a dense and calm interface, one very good dependency graph, and a keyboard-operable approval dialog will read as far more professional than motion for its own sake.

---

**Related documents:**
[BRD v2.2](./Throughline_BRD.md) ·
[Technical Requirements & Lineage Invariants v1.3](./Throughline_Technical_Requirements_Lineage_Invariants.md) ·
[ERD/Data Model v1.4](./Throughline_ERD.md) ·
[Module Boundaries v1.0](./Throughline_Module_Boundaries.md) ·
[API Contracts v1.0](./Throughline_API_Contracts.md) ·
[Project Setup v1.1](./Throughline_Project_Setup.md) ·
[Jira Plan v1.0](./Throughline_Jira_Plan.md)
