---
description: Implement a Jira story end to end - Opus plans, Sonnet codes, Haiku tests, ticket moves to In Progress then to review
argument-hint: <TICKET-KEY> <what to build>
---

Implement the Jira story **$1**. What the user asked for: $ARGUMENTS

Run the phases below in order. The gate in `.claude/hooks/gate.mjs` enforces the order mechanically - if you skip ahead, your Edit or Bash call is denied and you will be told why. Do not try to work around a denial; it means a phase was skipped.

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
