---
description: Implement a Jira story end to end - Opus plans, Sonnet codes, Haiku tests, ticket moves to In Progress then to review
argument-hint: <TICKET-KEY> <what to build>
---

Implement the Jira story **$1**. What the user asked for: $ARGUMENTS

Run the phases below in order. The gate in `.claude/hooks/gate.mjs` enforces the order mechanically - if you skip ahead, your Edit or Bash call is denied and you will be told why. Do not try to work around a denial; it means a phase was skipped.

## Phase 0 - Worktree (you, on Opus)

Before anything else, call `EnterWorktree` (name it after the ticket, e.g. `feature/$1`) so this whole run happens off `main`. This is a standing project instruction - see `CLAUDE.md` - so `EnterWorktree` is authorized without asking the user each time.

This has to be the _whole pipeline_, not just Phase 3, and the reason is mechanical, not stylistic: `.claude/hooks/gate.mjs` partitions its unlock state by the calling process's `cwd` (see the file's own header comment and the `gate-state-shared-across-worktrees` incident it documents). If you `EnterWorktree` now, every later hook event - the Phase 2 Jira transition, the Phase 3/4 subagent Edit and test calls - reports that same worktree `cwd`, so the gate stays internally consistent and unlocks correctly. **Do not** instead leave the session on `main` and spawn `feature-implementer` with `Agent(isolation: "worktree")` in Phase 3 - that creates a _second_, different worktree whose `cwd` never saw the Phase 2 transition, and the gate will deny every edit it tries to make. Plain (non-isolated) `Agent` calls in Phase 3/4 inherit the session's current directory, which is correct once you're already inside the worktree from this step.

If `node_modules` doesn't exist yet in the new worktree, run `pnpm install` before Phase 3 - `feature-implementer` needs `node_modules/next/dist/docs/` for any framework-facing work (see its own instructions), and a fresh worktree checkout won't have it.

Leave the worktree in place when the pipeline ends (don't call `ExitWorktree`) so the user can review the diff, push, and open a PR from it themselves.

## Phase 1 - Plan (you, on Opus)

1. Read the row for **$1** in `docs/Throughline_Jira_Plan.md`. `$1` may be a plan id (`E2-S3`) or a real Jira key (`THR-17`) - resolve whichever you were given to the other before Phase 2 needs it:
   - Given a real Jira key: fetch the ticket through the Atlassian connector and map it to its plan row by matching the summary against the Title column.
   - Given a plan id: search Jira for the issue whose summary matches the row's Title (the CSV import in Jira Plan section 1 carries the Title verbatim as the Jira summary, so this should be an exact or near-exact match). If nothing matches - the project hasn't been imported yet, or the summary was edited after import - **stop and tell the user**, quoting the plan id and title you were looking for, rather than guessing a key or skipping Phase 2 silently.
2. Load the `throughline-doc-sync` skill, then read **every** document section the story **Cites** - ERD, Technical Requirements, Module Boundaries, API Contracts. Those four are frozen.
3. Check the Definition of Ready (Jira Plan section 1.4): do the cited sections exist, are the `Depends on` stories Done, is any needed spike or credential task complete? If not, stop and say so rather than starting.
4. State the plan: which module owns the work, which files change, which `T##`/FR/INV ids it must satisfy, and what you are explicitly not doing.

## Phase 2 - Move the ticket

Transition the **real Jira key** resolved in Phase 1 to **In Progress** through the Atlassian connector.

This is not bookkeeping - the `PostToolUse` hook watches for that transition and it is what unlocks code editing. Until it succeeds, every Edit to `src/` is denied. If Phase 1 could not resolve a real key, this phase cannot run - say so and stop, rather than proceeding uncoded or unlocked.

## Phase 3 - Code (delegate to Sonnet)

Delegate to the `feature-implementer` agent with the full plan from Phase 1. That agent runs on Sonnet and is the only place code may be written.

Do not edit `src/` yourself. You are on Opus; the gate will deny it.

## Phase 4 - Test (delegate to Haiku)

Delegate to **both**, and read their raw output rather than trusting a summary:

- `feature-verifier` - runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int`.
- `test-citation-checker` - confirms every ERD test id the story cites actually exists and runs. This is the Definition of Done (Jira Plan section 1.5).

Both run on Haiku. You may not run the test commands yourself; the gate denies them.

If anything fails, go back to Phase 3 with the failure - do not patch it from the main thread.

## Phase 5 - Review (you, on Opus)

1. If the diff adds a file under `src/` or changes an import, run `boundary-auditor`. If it touches `src/lineage/**`, `src/artifact-lifecycle/**` or `src/artifact-types/**`, run `invariant-reviewer`.
2. Post an implementation-summary comment on **$1**: files touched, key decisions, which `T##`/FR/INV ids are now covered, and anything stubbed or deferred.
3. Transition **$1** to the review status. **Never move it to Done** - the user does that themselves after reviewing.
4. Report honestly: what passed, what failed, what you left out and why. If a phase did not fully succeed, say so plainly instead of rounding it up to done.
