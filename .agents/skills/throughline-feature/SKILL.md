---
name: throughline-feature
description: Run the Throughline Jira feature workflow in Codex. Use automatically when asked to implement one or more features or Jira stories, or when the user invokes $throughline-feature.
---

# Throughline feature workflow for Codex

Use this skill instead of the Claude Code `/feature` command. The project role instructions live in `.codex/agents/` and the Codex-specific versions are authoritative for Codex runs.

Match Claude's phase order and role separation using Codex tools and configured models. A feature request authorizes routine worktree creation and the delegations below without another confirmation. If the request does not identify a story, resolve it against the Jira Plan and Jira; ask for clarification only if the mapping is ambiguous.

## Worktree and prerequisites

1. For each new feature implementation, create a Codex-managed Git worktree from the local `main` branch before changing Jira status or editing source. Use `mcp__codex_app__create_worktree` with `ref: "main"` to create and attach it to the current task; do not ask the user to reopen the task or approve routine worktree creation. Reuse an existing worktree only when it is already dedicated to this feature and was created from `main`, including when resuming the feature. Do not call Claude Code's `EnterWorktree` command. If `main` cannot be resolved or worktree creation fails, report the concrete blocker before proceeding.
   Use the returned workspace directory explicitly for all subsequent commands, edits, dependency installation, and agent work: attaching a worktree does not change the current working directory. Pass its absolute path to every delegated agent and require it to work there. Worktree creation does not copy uncommitted changes; leave those in the original checkout.
2. Check whether `node_modules` exists in the feature worktree. If not, run `pnpm install` there before implementation so the Next.js guides are available. Leave the worktree in place after the pipeline for user review.
3. Resolve the supplied plan ID or Jira key against `docs/Throughline_Jira_Plan.md` and Jira. Follow the plan's Definition of Ready and dependencies. If a real Jira issue cannot be identified, stop rather than guessing.

## Phases

1. **Plan.** Read the Jira Plan row and every section it cites. Load `throughline-doc-sync`, then state module ownership, files, cited T##/FR/INV/API route coverage, dependencies, and scope exclusions. The frozen source documents take precedence over code; report contradictions and stop.
2. **Start.** Transition the resolved Jira issue to In Progress with the connected Atlassian tool. Do not begin source edits until the transition succeeds.
3. **Implement.** Delegate the complete plan to `feature-implementer`. Only this agent writes implementation code and tests; the coordinator must not edit source. It must load `throughline-module-boundaries`; also load `throughline-lineage-invariants` or `throughline-screen-kit` when their triggers apply. It may run typecheck and lint, but not tests.
4. **Verify.** After implementation completes, delegate to both `feature-verifier` and `test-citation-checker`. The verifier runs `pnpm exec next typegen`, then `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:int`. Read their actual outputs; the coordinator must not run tests. If a check fails, send the failure back to `feature-implementer` for correction, then repeat affected verification; do not patch source from the coordinator. A check that could not run is incomplete, not a pass.
5. **Review.** Run `boundary-auditor` for new `src/` files or import changes and `invariant-reviewer` for lineage, lifecycle, or artifact-type changes. Post a concise implementation summary on the Jira issue, then transition it to the configured review status. Never transition it to Done.
6. **Report.** List changed files, checks and results, cited identifiers, deferred work, and any incomplete phase.

## Multiple features in one request

Resolve every requested story and check its Definition of Ready before starting implementation. Run independent, ready stories concurrently when agent capacity permits, with a separate worktree created from local `main` for each story. Reuse each story's worktree for every later phase and retry; never share implementation directories between stories or create a second worktree just for an implementer.

Maintain a per-story record of plan id, real Jira key, absolute worktree path, base commit, current phase, agent assignments, and verification results. Pass the full plan, assigned worktree path, and file/module ownership to each agent. Tell it that other agents are working concurrently, to stay within its assigned worktree, and not to revert others' work. Schedule the configured agents within available concurrency slots; queue stages when slots are full rather than bypassing role separation. Do not create separate user-visible Codex tasks unless the user explicitly requests them.

Respect dependency order and the Jira Plan's requirement that prerequisite stories be Done. A prerequisite reaching review does not unblock its dependents. Confirm required dependency code is present in local `main` before creating a dependent story's worktree; do not silently base it on another feature branch, merge unreviewed work, or mark a prerequisite Done. Report blocked stories and continue the independent ready stories.

Keep verification isolated as well: do not run commands concurrently against the same mutable test database or shared test resources. Serialize those checks unless isolated resources are configured. Verification and review findings go back to the owning implementer; recheck corrections before posting a successful review handoff. Do not transition a story to review with unresolved failures or incomplete required checks. Report outcomes separately for every requested story, including worktree paths and blockers. Leave worktrees available; do not merge or delete them as part of this workflow.

## Delegation and gate limits

Use Codex project custom agents by their configured names. Keep each story's full pipeline tied to its assigned worktree so its Jira state, agent working directory, and edits share one checkout. Read workflow and role instructions supplied by the calling task even if they have uncommitted updates absent from a fresh `main` worktree; pass those applicable instructions to delegated agents without copying unrelated working changes. Do not emulate an agent by changing its name or bypassing the repository gate.

The legacy `.claude/hooks/gate.mjs` is Claude-specific. This skill does not claim that it receives Codex hook events. Until a Codex-compatible gate hook is configured and validated, do not claim its event-based edit/test restrictions were enforced; retain the stage checks above and report that limitation.
