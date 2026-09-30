# Throughline - Jira Implementation Plan

**Document version:** 1.10
**Status:** Derived from ERD/Data Model v1.16, Technical Requirements & Lineage Invariants v1.12, Module Boundaries v1.22, API Contracts v1.19, and Project Setup & Configuration Plan v1.10. v1.9 (UC-S11): adds story UC-S11 (show the Jira site on Integrations and create a Jira project from the app; TR FR-092, ERD 7.8, T54), +4h, 82 -> 83 issues; existing ids not renumbered. v1.8 (UC-S10): adds story UC-S10 (remove a repository link from Throughline without deleting it on GitHub; TR FR-091, ERD 7.7, T53), +3h, 81 -> 82 issues; note on UC-S7 for the "Integrations" navigation wording (FR-004/FR-087); existing ids not renumbered. v1.7 (UC-S9, product feedback after trying UC-E1): adds story UC-S9 (guided connect-then-create flow, GitHub owner defaults to the connected account, selectable repository visibility); +4h, 80 -> 81 issues; existing ids not renumbered. v1.6 (round 14): adds Epic UC-E1 (per-user provider connections, BR-012), 8 stories UC-S1..UC-S8, at the project owner request; existing ids are not renumbered. Parent of the day-by-day implementation plan and of coding. v1.5: added E5-S13 to align the existing Backlog review UI with the Stitch hierarchy and quality-gate layout, without changing FR-063/FR-064 behavior.
**Purpose:** The ticket breakdown for building **Throughline itself** over the 8-day capstone window - not the in-product Jira *integration* (that is FR-070..074, delivered by Epic 4 below). This plan is what gets created in a real Jira project to run the build.
**CSV export:** `Throughline_Jira_Import.csv` is not kept in the repo - it was a mechanical, always-derivable restatement of the table below with no decisions of its own. Regenerate it from this plan (same 71 issues plus the 12 of UC-E1 from v1.6-v1.9 = 83, Jira's CSV import format) immediately before the actual bulk-import, rather than carrying a second copy that can drift from this table.

> **For AI agents:** every story below cites the exact ERD test id(s), TR requirement id(s), Module Boundaries function(s), and/or API Contracts route(s) it delivers. Do not close a story without its cited tests passing. Do not invent a story that has nothing to cite - if a task doesn't trace to one of the four parent documents, it does not belong in P0. Epic 1's stories are the ticket-level view of `Throughline_Project_Setup.md`'s section 10 setup sequence - that document, not this one, is the authoritative step order and tool list (OpenAI, Tailwind/shadcn, Vitest/Testcontainers, Vercel/GitHub Actions); this plan cites it rather than restating it, so the two cannot drift.

### Revision 1.9 changes

- **Added story UC-S11** to Epic UC-E1 (section 8A): show the connected Jira site on Integrations, and create a Jira project from the guided Jira screen. Cites the new **FR-092**, FR-087, FR-088 and the new ERD test **T54**; depends on UC-S9; 4h. No schema change; adds the `manage:jira-project` OAuth scope (existing Jira connections reconnect once; Atlassian app console setting in Project Setup).
- Issue count 82 -> 83 (UC-E1 now has 11 stories/tasks); hours 209.5 -> 213.5 (+4h); gap +133.5h (167%) over the 80h budget. Section 1.6 prose figures remain pre-UC-E1 (add 45h now).

### Revision 1.8 changes

- **Added story UC-S10** to Epic UC-E1 (section 8A): remove a project's GitHub repository link from Throughline (never deleting it on GitHub). Cites the new **FR-091**, FR-031 and the new ERD test **T53**; depends on UC-S9; 3h. No schema change.
- **UC-S7 note only** (its title is fixed to match its Jira ticket): the screen it builds is now user-facing "Integrations" - a top-level header-navigation entry with an attention hint plus an account-menu shortcut (TR FR-004 amended, FR-087 retitled); the route stays `/connections`.
- Issue count 81 -> 82 (UC-E1 now has 10 stories/tasks); hours 206.5 -> 209.5 (+3h); gap +129.5h (162%) over the 80h budget. Section 1.6 prose figures remain pre-UC-E1 (add 41h now).

### Revision 1.7 changes

- **Added story UC-S9** to Epic UC-E1 (section 8A): guided connect-then-create flow on the GitHub, Jira and Stitch screens, the GitHub owner defaulting to the connected account, and selectable GitHub repository visibility. **Reason:** product feedback after trying the feature. Cites FR-088, FR-089, FR-090, plus FR-030/FR-031 for the visibility choice (see the row). Depends on UC-S7.
- Issue count 80 -> 81 (UC-E1 now has 9 stories/tasks); hours 202.5 -> 206.5 (+4h); gap +126.5h (158%) over the 80h budget. The section 1.6 prose figures are still the pre-UC-E1 figures (see its v1.6 note; add 38h now).

### Revision 1.6 changes

- **Added Epic UC-E1** (section 8A) with stories **UC-S1..UC-S8**: per-user GitHub, Jira and Stitch connections instead of one shared server credential each. **Reason it exists:** project owner request - users must act with their own provider accounts; this reverses the shared-credential model. It is a P0-reopening scope addition, so it is recorded in the BRD (BR-012, v2.5), the Technical Requirements (FR-086..FR-090, v1.7), the ERD (table #17, round 14, v1.11), Module Boundaries (module 18, v1.17) and API Contracts (section 10A, v1.15) **before** these stories, as the doc-sync chain requires. Every story cites at least one of those.
- Issue count 71 -> 80 (1 epic + 8 stories/tasks); hours 168.5 -> 202.5 (+34h). See section 1.6 for what this does to the capacity gap: it makes it worse, and it is not hidden.
- `UC-` ids use their own prefix because they are not part of any of E1-E6 or of the ERD's four build slices; nothing existing was renumbered.

### Revision 1.5 changes

- **Added E5-S13** as a presentation refinement of the existing Backlog review and quality gate (TR FR-063/FR-064, E5-S5): group Stories beneath their Epics and place quality/traceability context in a right rail, matching the Stitch Backlog Review reference. Existing approval, impact, API, and state behavior are unchanged. Actions without real backing remain absent or disabled rather than simulated.
- Epic 5's Stories/Tasks count increases 12 -> 13; total issue count 70 -> 71. The 4h estimate raises E5 to 38h and the total to 168.5h (+88.5h, 111% over the 80h budget).

### Revision 1.4 changes

The implemented UI was visibly missing screens shown in the Stitch design reference (the persistent nav shell, the per-project dashboard). Investigation found these had never been backed by a business/technical requirement anywhere in the doc chain - not a skipped ticket, an absent one. Fixed by adding the requirement first (BRD v2.3 BR-011, TR v1.5 FR-003/FR-004), then the stories:

- **Added E5-S11** (persistent navigation shell: shared header + tab/link set across every project screen) - TR FR-004.
- **Added E5-S12** (project dashboard overview: per-artifact-type status/count tiles + recent lineage activity feed) - TR FR-003. Depends on `E5-S11` (renders inside the shell) and `E5-S1` (needs the project detail read path).
- Epic 5's Stories/Tasks count updated 10 -> 12; total issue count 68 -> 70 (section 2).
- Section 1.6 budget table updated: E5 27h -> 34h, total 157.5h -> 164.5h (+84.5h/106% over the 80h budget, up from +77.5h/97%). Same disclaimer as the rest of that section applies - this is a scheduling decision for whoever owns the 8-day deadline, not a reason this document declines to add a requirement that's actually there.

### Revision 1.2 changes

Docs-folder cleanup pass, no ticket content changed: removed `Throughline_Jira_Import.csv` from the repo (was a generated duplicate of the table below, kept in sync by hand - a drift risk this plan otherwise avoids by design; see the header's replacement note).

### Revision 1.1 changes

A traceability pass found two P0 routes with no owning story and several stale/unsatisfiable citations. Fixed here, nothing re-scoped:

- **Added E1-S8** (`artifact-lifecycle.createProject` + the four `/api/projects` routes, API Contracts section 3) - FR-001/FR-002 and the project-creation routes had no story anywhere in v1.0. Also closes INV-007/T33 (brief immutability on the `PATCH` route). **E5-S1** (the UI that calls these routes) now depends on `E1-S8` instead of `E1-S6` - it was pointed at the auth story because no story owned the routes it actually needs.
- **Added E3-S11** (impact routes, API Contracts section 6) - `GET /api/projects/:projectId/impact` and `POST /api/impact/acknowledgements` were only reachable from a UI story (E5-S6) with no API-layer task beneath it.
- **E1-S5** retitled and re-cited. It claimed to satisfy `T2-T20, T22-T39` at slice 1, but ERD section 14's own slice table assigns most of that range to slices 2-4 (application-level behavior that doesn't exist yet at slice 1) - the story's Definition of Done was unsatisfiable as written. Now matches Project Setup step 9 exactly: port all of T1-T43 as stubs, T14/T27/T28/T34 pass in this slice, the rest turn green as their owning slice's gate task (E2-S9, E3-T1, E4-T3) lands. Estimate raised 2h -> 5h to reflect porting the full suite, not just running four tests.
- **E2-S9 / E3-T1**: T8 and T40 need `approveVersion`/`materialize`, which don't exist until E3-S1/E3-S3. Moved their approval-dependent assertions from E2-S9 to E3-T1 rather than leaving E2-S9 citing a test it cannot pass standalone.
- **E3-S6/S7/S8/S9** (`requirements`/`architecture`/`ui-requirements`/`backlog`): added `E2-S2` (`ai-client`) to `Depends on` - each of these calls `ai-client` directly per Module Boundaries section 3, but only depended on `E2-S6` in v1.0.
- **E4-S1** `Depends on` corrected from `E1-S3` (the `impact()` SQL migration) to `E2-S1, E2-S8` (the `db` and `impact` TypeScript modules it actually imports, per Module Boundaries' module map).
- **E5-S4** now cites FR-041 (UI Requirements approval), previously uncited anywhere in the plan.
- Fixed the "66 issues" vs. "62 issues" mismatch (was inconsistent between section 1's header and section 2's summary in v1.0; both now read 68, post-addition), the dangling "extended per section 5 below" cross-reference in section 1.5, and the stale "Project Setup v1.1" citation (now v1.2 - see that document's section 13: steps 1-4/E1-T3/E1-T4/E1-T5 are already scaffolded on `chore/project-setup`).

---

## 1. Structure and conventions

### 1.1 Issue types

- **Epic** - one per ERD build slice plus UI and hardening/evaluation (7 total, section 2; the seventh, UC-E1, is labelled `uc` instead of `slice-N`).
- **Story** - a unit of work that changes product behavior; always cites at least one ERD test id or TR FR/INV id.
- **Task** - a unit of work with no product behavior of its own (setup, spikes, deployment, write-ups). Spikes are Tasks, not Stories, because TR section 42 frames them as proving a boundary, not shipping a feature.

No Sub-tasks. A Story that needs sub-tasks is too big and should be split into two Stories instead (keeps the board simple, NFR-008).

IDs keep sequential `-S`/`-T` numbering per epic in the order they were planned, not partitioned by type - several Tasks (e.g. `E1-S5`, `E2-S9`, `E3-S10`, `E3-S11`, `E4-S5`, `E4-S6`, all of `E6-S*`) carry an `-S` id because a Task was added after the `-T` sequence for that epic had already been assigned elsewhere. The **Issue Type** column (and the CSV's `Issue Type` field) is authoritative over the id prefix, not the other way around.

### 1.2 Labels

Every issue carries:
- `slice-N` (1-4) or `ui` or `eval` or `uc` (Epic UC-E1, section 8A), matching section 2's epics
- `module-<name>` for every Module Boundaries module it touches (e.g. `module-identity`, `module-github`); E5's UI stories carry `module-api` since they touch the `api` layer module (map row 17) rather than a lower-layer module directly
- `p0` or `p1` (TR sections 36-37; nothing in this plan is P1 except where explicitly marked - see section 6)
- `test-<id>` for every ERD acceptance test the story is responsible for (e.g. `test-T21`)

Multiple labels sit in one CSV cell, space-separated (e.g. `slice-1 module-db p0`) rather than one column per label - Jira Cloud's classic CSV importer splits a Labels-mapped cell on whitespace, which is safe because a Jira label cannot itself contain a space.

### 1.3 Priority mapping (for the CSV import)

Jira's default Priority field has no P0/P1 concept. The CSV maps `p0 -> Highest`, `p1 -> Low`. Adjust after import if your Jira instance uses a different scheme - the `p0`/`p1` label is the source of truth, not the Priority field.

### 1.4 Definition of Ready

A story is ready to start when: its cited parent-document sections exist (they all do, as of this plan), its `Depends on` stories are Done, and - for any story calling an LLM or a provider - the relevant Task in Epic 1/4 (spike or credential setup) is Done.

### 1.5 Definition of Done

A story is Done when: the code exists, every cited ERD test id passes against a real Postgres instance (Appendix C's suite as ported in E1-S5, with each epic's own gate task - E2-S9, E3-T1, E4-T3 - turning the rest of the suite green as its slice lands), every cited API Contracts route returns the documented shape for both its success and error cases (including the "404, never 403" cross-project convention, API Contracts section 1.4), and no other module was made to write a table it does not own (Module Boundaries section 5).

### 1.6 Estimates and capacity reality check

Hours are rough sizing for a single developer already deeply familiar with this exact design (the estimates assume no ramp-up time re-deriving the ERD's rules). Summed honestly, they do **not** fit "8 full-time development days" under any normal reading of that phrase, and this plan states that plainly rather than quietly shrinking individual estimates to make the total look better.

| Grouping | Hours | vs. 8 x 10h = 80h budget |
|---|---|---|
| E1 Foundation (incl. scaffold, hygiene tooling, CI, project creation - Project Setup section 9) | 23.5 | |
| E2 Lineage Core | 28 | |
| E3 Approval & Generation | 31 | |
| E4 External Integrations | 27 | |
| **Backend/lineage subtotal (E1-E4)** | **109.5** | **already +29.5h over budget with no UI and no evaluation** |
| E5 UI | 38 | |
| E6 Demo & Evaluation | 21 | |
| UC-E1 Per-user provider connections (v1.6, round 14; +UC-S9 in v1.7, +UC-S10 in v1.8, +UC-S11 in v1.9 - added after the figures quoted in the prose below) | 45 | |
| **Total** | **213.5** | **+133.5h (167%) over an 8 x 10h budget** (168.5h / +88.5h / 111% before UC-E1) |

*v1.6 note: every hour figure quoted in the prose from here to the end of this section (168.5h, 147.5h, 142.5h, and the gaps computed from them) is the pre-UC-E1 figure and was not recomputed; add 45h to each (34h at v1.6, +4h for UC-S9 at v1.7, +3h for UC-S10 at v1.8, +4h for UC-S11 at v1.9). UC-E1 is not part of the E1-E5 "build" subtotal those options refer to, and none of the three options above shrinks it - UC-S4..UC-S6 cannot be cut one provider at a time either: a new operation for a provider with no per-user path would have no credential at all, because new operations never fall back to the legacy shared one (FR-086) - that is the point of BR-012. This is stated rather than smoothed over.*

This is the single most important finding of this planning pass: the P0 scope as specified across the BRD, Technical Requirements, ERD, Module Boundaries and Project Setup plan plus the E5-S13 Stitch presentation refinement sizes to roughly **168.5 focused hours**, not the ~68-80 hours an 8-day build literally holds. This was true the moment BRD section 8's P0 list and TR section 36 were written; a ticket-level estimate is just what makes it visible. (v1.0 of this plan put the figure at ~150h; v1.1 revised it up after E1-S5 was re-scoped to actually porting the Appendix C suite rather than just running four tests of it, and after two previously-uncited P0 routes - project creation and the impact endpoints - were given owning stories. Neither change added scope; both were already implied by the frozen parent documents.)

*As of this revision, E1-T3/E1-T4/E1-T5 (3h, steps 1-3 of Project Setup section 10) are already scaffolded on `chore/project-setup` per Project Setup v1.2 section 13 - the table above still carries their full estimate because it sizes the P0 scope, not remaining work; the true remaining total is ~3h lower than shown. This does not change the shape of the gap.*

**Three honest ways to close the gap, not mutually exclusive:**

1. **Read "8 full-time development days" as covering the build only (E1-E5, 147.5h), with evaluation (E6, 21h) as a distinct wrap-up phase.** This is not a scope cut: BRD section 8 ("MVP Scope") and section 10 ("Success Criteria and Evaluation") are already written as two separate concerns, and TR section 40 treats the evaluation write-up as reference material distinct from the technical build. Closes 21h with no loss of P0 substance. **Recommended default.**
2. **Build one generic, type-parameterized artifact-review screen instead of four bespoke ones** (merge E5-S2/S3/S4/S5, 11h combined, into a single ~6h story). Every artifact type is still reviewable and approvable; only per-type visual bespoke-ness is reduced. Saves ~5h. **Recommended default.**
3. **If Epic 4 runs long, ship Stitch demo-day-ready in `manual_fallback` mode only** (skip E4-S4's `api` wiring and E4-S5's Spike B under time pressure) and add the live API path back after the demo if time remains. This is not a new cut - FR-054's manual fallback is already the sanctioned P0 degrade path, not an invented one. Saves up to 5h if triggered.

Applying option 1 drops evaluation's 21h out of the 8-day build window, leaving **147.5h** (E1-E5) to build in. Applying option 2 on top brings it to **142.5h** against an 80h budget - still 62.5h (78%) over, which is why option 3 exists as a named release valve, and why the schedule in section 9 still shows E4/E5 overlapping rather than assuming slack. **This gap is a scheduling decision, not an engineering one - it belongs to whoever owns the 8-day deadline, not to this document.** If the real constraint is a literal 8 x 8.5h week, the honest options are: extend the timeline, work materially longer days (not recommended as a plan, only notable as arithmetic), or make a fourth, larger cut this document does not make unilaterally - most plausibly reducing BRD section 10.1's three sample briefs to two, which requires the BRD owner's sign-off because BRD 10.1 states three explicitly.

---

## 2. Epics

| Epic | Title | ERD build slice | Target day(s) | Stories/Tasks |
|---|---|---|---|---|
| E1 | Foundation, Schema and Auth | Slice 1 | 1 | 13 |
| E2 | Lineage Core | Slice 2 | 2 | 10 |
| E3 | Approval, Architecture and Generation | Slice 3 | 3-4 | 12 |
| E4 | External Integrations | Slice 4 | 5-6 | 9 |
| E5 | UI and Visualization | (cross-cutting) | 4-7 | 13 |
| E6 | Demo, Evaluation and Hardening | (none - wrap-up) | 8, then a separate evaluation phase (section 1.6) | 8 |
| UC-E1 | Per-user provider connections (round 14) | (none - after slice 4; needs E1-E4 code) | after E4 | 11 |

83 issues (7 epics + 76 stories/tasks); 71 originally across 8 days (~8-9 issues/day), plus UC-E1's 12 (epic + 11 stories), which are outside that 8-day plan (section 8A).

---

## 3. Epic 1 - Foundation, Schema and Auth

**Goal:** a deployed, empty Throughline instance whose database matches Appendix A exactly, whose Data API is provably closed, and which can create/read a bare Project row (no artifacts, no lineage) so Epic 2 has somewhere to attach test data. Nothing else in this epic touches product behavior. Step order below follows `Throughline_Project_Setup.md` section 10 exactly - see that document for the full rationale behind each tool choice.

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| E1-T1 | Task | Provision Supabase project (Postgres 15+, Auth, Storage) | ERD 2.1, 5.1 | - | 0.5h |
| E1-T3 | Task | Scaffold Next.js app; `tsconfig` strictness; `eslint-plugin-boundaries` config; verify it fails on a deliberate bad import | Project Setup sections 2, 3, 5.1, 5.3; step 1-3 | - | 1h |
| E1-T4 | Task | Code-hygiene tooling: husky, lint-staged, Prettier, `.npmrc`, `.vscode`, `.gitattributes` | Project Setup sections 5.5-5.8; step 2b | E1-T3 | 1.5h |
| E1-T5 | Task | Env schema (Zod, throws at boot) + `.env.example` | Project Setup section 7; step 4 | E1-T4 | 0.5h |
| E1-S1 | Story | Drizzle schema for all 16 tables (Appendix A.1; the 17th, `provider_connection`, arrives with UC-S3) | ERD Appendix A.1; Module Boundaries `db` | E1-T1, E1-T5 | 3h |
| E1-S2 | Story | Custom migration: triggers (Appendix A.2) | ERD Appendix A.2 | E1-S1 | 1.5h |
| E1-S3 | Story | Custom migration: `impact()` function (section 6.3) | ERD 6.3 | E1-S2 | 1h |
| E1-S4 | Story | Custom migration: Supabase hardening (Appendix A.3) | ERD Appendix A.3; T34 | E1-S3 | 1h |
| E1-S5 | Task | Port ERD Appendix C (T1-T52) into `tests/integration` as executable stubs; **T14, T27, T28, T34 pass in this slice** - the rest turn green as their owning slice lands (E2-S9, E3-T1, E4-T3 each re-run this same suite, not a copy of it) | ERD Appendix C; Project Setup section 10 step 9; T14, T27, T28, T34 | E1-S4 | 5h |
| E1-S6 | Story | `auth` module + `POST /api/session/bootstrap`: open sign-up with mandatory email verification, `app_user` upsert | TR NFR-005; Module Boundaries `auth`; API Contracts section 2 | E1-S4 | 3h |
| E1-S8 | Story | `artifact-lifecycle.createProject` (minimal - project + its 4 blank artifact rows, no generation) + `POST/GET /api/projects`, `GET/PATCH /api/projects/:projectId` | TR FR-001, FR-002, INV-007; Module Boundaries `artifact-lifecycle`; API Contracts section 3; T33 (brief immutability, via `PATCH`'s `project_seed_frozen` guard) | E1-S4, E1-S6 | 1.5h |
| E1-S7 | Story | CI workflow (GitHub Actions): typecheck, lint, format:check, unit + integration tests on every PR | Project Setup section 9; step 11 | E1-S5 | 2h |
| E1-T2 | Task | First hosted deployment (Vercel + Supabase, Supavisor transaction pooler); confirm the access gate blocks an unauthenticated visitor | TR section 43; ERD 2.1 rule 3; step 12 | E1-S6, E1-S7 | 2h |

**Definition of Done for the epic:** `git log` shows the migrations applied to the hosted project; E1-S5's suite output shows 0 FAIL/0 ERROR on T14/T27/T28/T34 (including the T34 anon-role checks run against the *real* Supabase roles, not the local simulation) and the rest of the ported suite present but expected-fail/skip pending later slices; CI is green on a normal PR and red on a deliberately broken test (Project Setup step 11); a browser can reach the deployed app, sign in, and create an empty project via E1-S8's routes.

---

## 4. Epic 2 - Lineage Core

**Goal:** the matching/hashing/impact engine, proven against a real LLM, before any screen exists to show it. This is the highest-risk epic in the plan (ERD section 14).

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| E2-T1 | Task | Spike A: structured LLM output round trip + no-change regeneration stability | TR 42 (Spike A) | E1-T2 | 3h |
| E2-S1 | Story | `db` module: `withProjectLock`, `withTx` | ERD 3.2; Module Boundaries `db` | E1-S4 | 1h |
| E2-S2 | Story | `ai-client` module: structured generation + `ai_generation_run` logging | TR section 33, NFR-004; Module Boundaries `ai-client` | E2-T1 | 2h |
| E2-S3 | Story | `identity.matchAndPersistItems`: previousDisplayKey claiming, projection + hash, reuse/new-revision/new-item | ERD 5.3, 5.4; INV-010, INV-011, INV-012, INV-016; Module Boundaries `identity` | E2-S1 | 6h |
| E2-S4 | Story | `identity`: content-only fallback matching | ERD 5.3 rule 1b; INV-014; T31, T32 | E2-S3 | 2h |
| E2-S5 | Story | `dependency-binding`: `bindUpstreamRefs`, `checkFreshness` | ERD 3.3 steps 2-4; INV-006 | E2-S3 | 2h |
| E2-S6 | Story | `artifact-lifecycle.createDraftFromGeneration`: full persist transaction incl. stale path | ERD 3.3; TR FR-080; T7, T20, T43 | E2-S3, E2-S5 | 4h |
| E2-S7 | Story | `artifact-lifecycle.createManualRevisionDraft` + `identity.copyMembership` | ERD 3.6; TR FR-081; T40 (pre-approval half only - the draft shares every ItemVersion and has no context refs; the post-approval half closes out in E3-T1) | E2-S6 | 2h |
| E2-S8 | Story | `impact` module: `getWarnings`, `getExternalDrift`, `acknowledge` wrapping `impact()` | ERD 6.1-6.4; INV-020..026; T1, T1b, T1c, T2, T3, T4, T15, T17, T25 | E1-S3 | 3h |
| E2-S9 | Task | **T21 first**, then run T1-T5, T15, T31, T32, T43 against real generation (T8 and T40 need `approveVersion`/`materialize`, which don't exist yet - their approval-dependent assertions close out in E3-T1 instead) | ERD 14 (slice 2 gate); T21 | E2-S2, E2-S6, E2-S7, E2-S8 | 3h |

**Definition of Done for the epic:** T21 passes against a real LLM call (not a mock) before any other test in this epic is considered meaningful, per the ERD's own ordering. No screen exists yet - everything is verified through integration tests and a scratch script. T8 and T40 are exercised here only up to the point that doesn't require approval (draft creation, matching); their full pass is E3-T1's responsibility, not this epic's.

---

## 5. Epic 3 - Approval, Architecture and Generation

**Goal:** every artifact type can be generated, revised, edited, and approved (with the gate and override), end to end, headless.

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| E3-S1 | Story | `artifact-lifecycle.approveVersion` + gate | ERD 3.4, 6.5; TR FR-083; T6, T10, T22, T23 | E2-S6, E2-S8 | 3h |
| E3-S2 | Story | `artifact-lifecycle.approveWithOverride` | ERD 3.5; TR FR-084; T6 (override half) | E3-S1 | 2h |
| E3-S3 | Story | `architecture-materialization`: `createOptions`, `materialize`, stack guard | ERD 5.5; TR FR-020..022; T8, T9, T30 | E3-S1 | 4h |
| E3-S4 | Story | `artifact-lifecycle.requestRevision` / `.rejectVersion` | ERD 3.1; T5 | E3-S1 | 1h |
| E3-S5 | Story | `identity.rebindDraftItem` + `artifact-lifecycle.proposeItemEdit`/`commitItemEdit` | ERD 5.3 manual edit; TR FR-082; T24 | E2-S3 | 3h |
| E3-S6 | Story | `requirements` module: prompt, schema, quality gate | TR FR-010..012 | E2-S2, E2-S6 | 3h |
| E3-S7 | Story | `architecture` module: prompt, schema (exactly 2 options), option selection | TR FR-020, FR-021, FR-023(P1-off) | E2-S2, E2-S6, E3-S3 | 3h |
| E3-S8 | Story | `ui-requirements` module: prompt, schema | TR FR-040 | E2-S2, E2-S6 | 2h |
| E3-S9 | Story | `backlog` module: prompt, schema, quality gate, Epic/Story parent resolution | TR FR-060..063 | E2-S2, E2-S6 | 4h |
| E3-S10 | Task | API routes: artifact generate/revise/approve/edit/quality-gate (API Contracts section 4-5) | API Contracts sections 4-5 | E3-S1..E3-S9 | 3h |
| E3-S11 | Task | API routes: impact + acknowledgements (`impact.getWarnings`, `impact.acknowledge`) | API Contracts section 6 | E2-S8 | 1h |
| E3-T1 | Task | Slice-3 gate: run T6, T7, T8, T9, T10, T22, T23, T24, T30, T40 end to end through the API routes (T8/T40 close out the approval-dependent assertions E2-S9 could not complete) | ERD 14 (slice 3 gate) | E3-S10 | 2h |

**Definition of Done for the epic:** all four artifact types can be generated, approved, and revised via `curl`/Postman against the deployed API, with the gate and override both exercised at least once against real data.

---

## 6. Epic 4 - External Integrations

**Goal:** GitHub, Jira, and Stitch all write through one shared protocol, are retry-safe, and never silently duplicate.

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| E4-S1 | Story | `external-operations.runOperation`: insert-first/lock/decide protocol | ERD 7.2; TR section 30; T11, T18 | E2-S1, E2-S8 | 4h |
| E4-T1 | Task | Spike C - GitHub: create, simulate lost response, reconcile via marker | TR 42 (Spike C) | E4-S1 | 2h |
| E4-T2 | Task | Spike C - Jira: create, simulate ambiguous response, search-marker reconcile; **decides the final marker mechanism** | TR 42 (Spike C), 30.2 | E4-S1 | 2h |
| E4-S2 | Story | `github` module: preview, init (marker + README/ADR/lineage.json), drift check | ERD 7.3; TR FR-030..036; T11, T17, T18, T13 | E4-T1 | 4h |
| E4-S3 | Story | `jira` module: preview, export (Epics before Stories, parent by LogicalItem), FR-074 skip/create-new | ERD 7.4; TR FR-070..074; T12, T26, T41 | E4-T2 | 5h |
| E4-S4 | Story | `stitch` module: preview, generate, manual fallback, Supabase Storage + signed URLs | ERD 7.5, 4.16; TR FR-050..054 | E4-S1 | 3h |
| E4-S5 | Task | Spike B - Stitch: approved prompt -> generation -> persisted output or fallback | TR 42 (Spike B) | E4-S4 | 2h |
| E4-S6 | Task | API routes: GitHub/Jira/Stitch preview/init/export/generate + operation polling/retry | API Contracts sections 7-10 | E4-S2, E4-S3, E4-S4 | 3h |
| E4-T3 | Task | Slice-4 gate: run T11-T13, T18, T26, T41, T42 end to end through the API routes | ERD 14 (slice 4 gate) | E4-S6 | 2h |

**P1 deferred (not in this plan, TR section 37):** Stitch variants/iterative editing, multiple GitHub templates, multiple Jira configurations, FR-023 team-skill warning. If E6 runs short, do not pull these in.

**Definition of Done for the epic:** a real GitHub repo and real Jira issues exist from a test project, created through the API, and a simulated lost-response retry on each produces no duplicate.

---

## 7. Epic 5 - UI and Visualization

**Goal:** every API route from Epics 2-4 has a screen. This epic can start once E3-S10's routes exist and run in parallel with E4 for screens that don't depend on external integrations.

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| E5-S1 | Story | Project creation + brief entry | API Contracts section 3 | E1-S8 | 2h |
| E5-S2 | Story | Requirements review/approve screen + quality gate display | API Contracts section 4; TR FR-012, FR-013 | E3-S10 | 3h |
| E5-S3 | Story | Architecture review screen: two options side by side, selection, approve | API Contracts section 4; TR FR-020..022 | E3-S10 | 3h |
| E5-S4 | Story | UI Requirements review/approve screen | API Contracts section 4; TR FR-041 | E3-S10 | 2h |
| E5-S5 | Story | Backlog review/approve screen + quality gate display | API Contracts section 4; TR FR-063, FR-064 | E3-S10 | 3h |
| E5-S6 | Story | Warning panel + direct acknowledgement UI | API Contracts section 6; TR INV-023, INV-024 | E3-S11 | 3h |
| E5-S7 | Story | Dependency/version visualization (simple view, same data as warning panel) | TR section 27; ERD 6.1 | E5-S6 | 3h |
| E5-S8 | Story | Manual item edit UI: preview diff, require confirmation on rebind | API Contracts section 5; TR FR-082 | E3-S5 | 2h |
| E5-S9 | Story | GitHub/Jira/Stitch preview screens with impact shown + confirmation gate | API Contracts sections 8-10; TR FR-085 | E4-S6 | 4h |
| E5-S10 | Story | Sandboxed Stitch HTML/screenshot preview (separate-origin iframe, no `allow-same-origin`) | TR FR-053; ERD 4.16 | E4-S6 | 2h |
| E5-S11 | Story | Persistent navigation shell: shared header + tab/link set across every project screen (Overview, Requirements, Architecture, UI Requirements, Backlog, Warnings, Dependencies, Outputs) | TR FR-004 | E5-S1 | 3h |
| E5-S12 | Story | Project dashboard overview: per-artifact-type status/count tiles + recent lineage activity feed | TR FR-003 | E5-S11, E5-S1 | 4h |
| E5-S13 | Story | Backlog review Stitch layout: group Stories under Epics; move quality gate and linked-story coverage into a right rail; preserve review actions and state | TR FR-063, FR-064; API Contracts section 4 | E5-S5, E5-S11 | 4h |

**Definition of Done for the epic:** a user can complete the entire workflow - brief through Jira export - by clicking through the UI alone, with no direct API calls.

---

## 8. Epic 6 - Demo, Evaluation and Hardening

**Goal:** the P0 acceptance criteria pass, the BRD's evaluation is run, and the capstone write-up exists.

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| E6-S1 | Task | Full demo scenario run-through on the hosted instance | TR section 39 | E5-S9 | 2h |
| E6-S2 | Task | P0 acceptance criteria checklist (all 29 items) | TR section 44 | E6-S1 | 2h |
| E6-S3 | Task | Security pass: re-run T34 against production Supabase; confirm no credentials/secrets leak (NFR-005) | TR NFR-005; ERD T34 | E6-S1 | 1h |
| E6-S4 | Task | Controlled change test via manual revision (exactly one item changed) | BRD 10.3; TR FR-081 | E6-S2 | 1h |
| E6-S5 | Task | Run 3 sample briefs, manual baseline vs. Throughline | BRD 10.1, 10.2 | E6-S4 | 6h |
| E6-S6 | Task | Evaluation write-up (measures, controlled-change results, limitations per BRD 10.4) | BRD 10 | E6-S5 | 3h |
| E6-S7 | Task | Bug-fix / hardening buffer | - | E6-S2 | 4h |
| E6-S8 | Task | Final capstone documentation pass (README, architecture summary, known limitations) | ERD section 11; TR sections 37-38 | E6-S6 | 2h |

**Definition of Done for the epic:** the evaluation write-up exists with honestly reported findings (BRD 10.4 explicitly requires negative findings to be reported), and every P0 acceptance criterion in TR section 44 is checked off or explicitly logged as a known gap.

---

## 8A. Epic UC-E1 - Per-user provider connections (round 14)

**Goal:** every signed-in user connects their own GitHub, Jira and Stitch accounts and every external write is made with them; the shared server credentials survive only as an optional legacy path for operations that already exist. Tokens stay server-side and are stored only as ciphertext (NFR-005).

**Reason this epic exists (recorded, not assumed):** project owner request - users must act with their own provider accounts; this reverses the shared-credential model. Parent documents: BRD BR-012; TR section 16B (FR-086..FR-090) and NFR-005; ERD round 14 (section 4.17, 7.6, Appendix A.5, T45-T52); Module Boundaries 4.9; API Contracts 10A.

**Conventions for this epic.** Labels: `uc` (in place of `slice-N`), `module-connections` plus every other module touched, `p0`, `test-T45`.. as cited. UC-S1..UC-S8 (all eleven from v1.9) assume E1-E4 are built (the modules they modify exist). `Depends on` lists only the UC dependencies. Estimates are as rough as section 1.6 says.

| ID | Type | Title | Cites | Depends on | Est. |
|---|---|---|---|---|---|
| UC-S1 | Task | Docs round | BRD BR-012; TR FR-086..FR-090, NFR-005; ERD round 14 (4.17, 7.6, A.5, C.2); Module Boundaries 4.9; API Contracts 10A; Project Setup section 7 | - | 3h |
| UC-S2 | Story | connections module (encryption, CRUD, refresh-with-row-lock) | Module Boundaries 4.9, 5, 6; ERD 4.17, 7.6; TR FR-086, FR-090, NFR-005; T45, T46, T52 | UC-S1 | 5h |
| UC-S3 | Story | Migration provider_connection + project targets + external_operation.connection_id | ERD A.5, 4.2, 4.14, 4.17; TR FR-088; T34 (extended), T45-T48, SQL halves of T49, T50 | UC-S1 | 3h |
| UC-S4 | Story | GitHub OAuth connect/disconnect + per-user credential in external/github | TR FR-086, FR-088; ERD 7.3, 7.6; Module Boundaries 4.5-4.7; API Contracts 10A (GitHub routes, `PATCH .../targets`), section 8 errors; T45, T51 | UC-S2, UC-S3 | 5h |
| UC-S5 | Story | Jira 3LO connect + site/project picker + per-user credential in external/jira | TR FR-086, FR-088; ERD 7.4, 7.6; API Contracts 10A (Jira routes), section 9 errors; T26, T41, T52 | UC-S2, UC-S3, UC-S4 | 6h |
| UC-S6 | Story | Stitch API-key connect + per-user credential in external/stitch | TR FR-086; ERD 7.5, 7.6; API Contracts 10A (`POST /api/connections/stitch`), section 10 errors; T45 | UC-S2, UC-S3, UC-S4 | 3h |
| UC-S7 | Story | Connections page + inline connect-to-continue prompts | TR FR-087, FR-089, FR-004 (exception); API Contracts 10A (`GET /api/connections`, `DELETE /api/connections/:provider`, `PreviewConnectionDTO`) | UC-S4, UC-S5, UC-S6 | 5h |
| UC-S8 | Story | Legacy system-credential path + reconnect-required state + security pass (T34 re-run) | TR FR-090, NFR-005; ERD 7.2, 7.6; API Contracts `RECONNECT_REQUIRED`, `needsReconnect`; T34, T49, T50, T51; extends E6-S3 | UC-S4, UC-S5, UC-S6 | 4h |
| UC-S9 | Story | Guided connect-then-create flow; GitHub owner defaults to the connected account | TR FR-088, FR-089, FR-090 (and FR-030/FR-031 for the visibility choice); ERD 4.2, 7.3, 7.6, round 15; Module Boundaries 4.6, 4.7; API Contracts 10A (`PreviewConnectionDTO.accountName`, `PATCH .../targets` null = default), section 8 (`visibility`, `TARGET_REQUIRED` defensive) | UC-S7 | 4h |
| UC-S10 | Story | Remove a repository link from Throughline (without deleting it on GitHub) | TR FR-091, FR-031 (one-repository rule); ERD 7.7, T53 (application test); Module Boundaries 4.5 (`external-operations.unlinkGithubRepository`), 4.7; API Contracts section 8 (`DELETE /api/projects/:projectId/github`), section 11 (`UNLINK_BLOCKED`) | UC-S9 | 3h |
| UC-S11 | Story | Show the Jira site on Integrations and create a Jira project from the app | TR FR-092, FR-087, FR-088; ERD 7.8, 7.6, 4.17, T54 (application test); Module Boundaries 4.6 (`jira.createProject`, `jira.validateProjectKey`), 4.7; API Contracts 10A (`POST /api/connections/jira/projects`, OAuth start scope), section 11 (`PROJECT_KEY_TAKEN`, `JIRA_ADMIN_REQUIRED`, `RECONNECT_REQUIRED` reason `missing_scope`); Project Setup section 7 (Atlassian scope) | UC-S9 | 4h |

**Scope notes** (the ticket titles above are fixed - they match the tickets already created in Jira - so scope detail lives here):
- **UC-S2** also owns the lint change for the new boundary: a `layer3b-connections` element type in `eslint.config.mjs` (`src/connections`, importable by layers 4-6 only, never by 1-3), added to the `layer6-api` (and `layer4`/`layer5`) allow-lists (Module Boundaries 4.7; Project Setup lint-element list), plus `CONNECTION_ENCRYPTION_KEY`, `OAUTH_STATE_SECRET` and the OAuth client variables in `src/lib/env.ts` and `.env.example`.
- **UC-S3** creates migrations `0009` and `0010`, runs ERD C.2 against a scratch PostgreSQL 15 and records the real output there.
- **UC-S4** carries the shared plumbing the other two providers reuse, so it must land first: `external-operations.runOperation` recording `connection_id` at insert (and leaving the row untouched on `ReconnectRequiredError`), the `ctx` pass-through convention for provider modules (Module Boundaries 4.6), `getRefsForLogicalItem`'s Jira target filter and `hasOperationsFor`, `artifact-lifecycle.updateProjectTargets`, and the `PATCH /api/projects/:projectId/targets` route (GitHub owner validation first; Jira validation is added by UC-S5), together with the GitHub owner picker route.
- **UC-S7 (v1.8 note; title unchanged):** the screen is presented to users as **Integrations** - one top-level link in the persistent header navigation with a status hint when an integration needs attention, plus an account-menu shortcut (TR FR-004 amended, FR-087 retitled); the route stays `/connections`. If UC-S7 has already shipped as "Connections", the rename and the navbar entry are follow-up work under UC-S9's UI pass.
- **UC-S11** (v1.9) owns: the connected Jira site (name + URL from `provider_meta`) on the Integrations screen and the chosen project (key + name) in Step 2 of the Jira screen; the "Create a new Jira project" option in Step 2 (name prefilled from the Throughline project name, derived editable key validated against Jira before submit, Scrum or Kanban template) selecting the new project as the Jira target via `PATCH .../targets`; `jira.validateProjectKey`/`jira.createProject` and `POST /api/connections/jira/projects`; the `manage:jira-project` scope in the authorize URL (plus a `missing_scope` reconnect prompt for older connections) and the Atlassian app-console setting (Project Setup); and the T54 application test. The key-validation path and its plain-text answer are verified live (ERD 7.8, round 17 R17-4); the two template keys and the 403/201 shapes still need verifying. No migration, no operation/ref row.
- **UC-S10** (v1.8) owns: `external-operations.unlinkGithubRepository` + `UnlinkBlockedError`, the `DELETE /api/projects/:projectId/github` route, the GitHub-screen "Remove repository link" action with its confirmation (must state that the repository still exists on GitHub, and link to `https://github.com/<owner>/<name>/settings`, Danger Zone, for manual deletion), and the T53 application test. No migration.
- **UC-S9** (v1.7) owns: the guided step list at the top of the GitHub, Jira and Stitch screens (Step 1 Connect - OAuth button, or the inline Stitch key field calling `POST /api/connections/stitch`; Step 2 target/review; Step 3 create/export; later steps visibly locked, `aria-current` on the active step, preview dimmed but readable); the `github` module resolving the owner as `ctx.githubOwner ?? credential.meta.login` and the `PATCH .../targets` null = default behaviour; `PreviewConnectionDTO.accountName` and GitHub `targetReady` = connection active; and the public/private repository visibility (recorded in `target_descriptor`, hashed only when private). No schema change.
- **UC-S5** adds the Jira half of the targets route (`jira.checkProjectAccessible`) and the site/project picker routes; **UC-S6** adds the Stitch key validation route. Both reuse UC-S4's plumbing.

Dependencies as scheduled: UC-S2 and UC-S3 need UC-S1 (they can run in parallel); UC-S4 needs UC-S2 and UC-S3; UC-S5 and UC-S6 each need UC-S4's plumbing commit (they may then run in parallel with each other); UC-S7 and UC-S8 need UC-S4 through UC-S6.

**Definition of Done for the epic:** with two different user accounts, each connects their own GitHub, Jira and Stitch and creates outputs in their own accounts; a user with no connection is stopped with `CONNECTION_REQUIRED` and no operation row; a revoked or expired connection shows reconnect-required and leaves the operation, its refs and every warning unchanged (T49); a pre-existing operation still reconciles with the legacy credential (T50); T45-T52 pass (the SQL halves against a real PostgreSQL 15 - ERD C.2 is written but **not yet executed** as of v1.6); T34 passes against the real Supabase project with `provider_connection` present.

**What this plan does not do:** it applies nothing to the live database (migrations `0009`/`0010` are applied by UC-S3, directly and in one transaction, like `0008` - not with `pnpm db:migrate`), and it does not add a GitHub App flow (documented later hardening, ERD 7.3).

---

## 9. Dependency graph (epic level)

```text
E1 (Foundation)
  -> E2 (Lineage core)
       -> E3 (Approval/Architecture/Generation)
            -> E4 (External integrations)  ---\
            -> E5 (UI)  ------------------------+--> E6 (Demo/Evaluation)
```

E4 and E5 can run partially in parallel once E3-S10 lands (E5's non-external screens don't block on E4). E6 needs both finished. UC-E1 (section 8A, round 14) is built on E1-E4 and is outside this graph: UC-S7 also touches E5's GitHub/Jira/Stitch screens, and UC-S8 extends E6-S3's security pass.

---

## 10. Traceability

Every story in this plan cites at least one ERD test id or TR requirement id, so the chain from BRD section 3.1 completes:

```text
Business Objective (BO) -> Business Requirement (BR) -> FR/INV -> ERD table/section -> Module -> API route -> Jira story (this document) -> verification test
```

No new BO/BR/FR/INV is introduced here (BR-012 and FR-086..FR-090 were added upstream, in the BRD and Technical Requirements, before UC-E1). If a piece of implementation work has no citation, it does not belong in P0 - flag it rather than adding an uncited story (TR Appendix B guidance).
