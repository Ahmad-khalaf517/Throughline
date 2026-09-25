---
name: throughline-feature
description: Run the Throughline Jira feature workflow in Codex. Use when asked to implement a planned Jira story or when the user invokes $throughline-feature.
---

# Throughline feature workflow for Codex

Use this skill instead of the Claude Code `/feature` command. The project role instructions live in `.codex/agents/` and the Codex-specific versions are authoritative for Codex runs.

## Worktree and prerequisites

1. Run this workflow in a Codex task opened with the project in a Codex-managed Git worktree. The user can select a worktree when creating the task. Do not call Claude Code's `EnterWorktree` command. If this task is already attached to the main checkout, stop before changing Jira status and ask the user to reopen it in a worktree.
2. Check whether `node_modules` exists. If not, install dependencies before framework-facing implementation so the Next.js guides are available.
3. Resolve the supplied plan ID or Jira key against `docs/Throughline_Jira_Plan.md` and Jira. Follow the plan's Definition of Ready and dependencies. If a real Jira issue cannot be identified, stop rather than guessing.

## Phases

1. **Plan.** Read the Jira Plan row and every section it cites. Load `throughline-doc-sync`, then state module ownership, files, cited T##/FR/INV/API route coverage, dependencies, and scope exclusions. The frozen source documents take precedence over code; report contradictions and stop.
2. **Start.** Transition the resolved Jira issue to In Progress with the connected Atlassian tool. Do not begin source edits until the transition succeeds.
3. **Implement.** Delegate the complete plan to `feature-implementer`. It must load `throughline-module-boundaries`; also load `throughline-lineage-invariants` or `throughline-screen-kit` when their triggers apply. It may run typecheck and lint, but not tests.
4. **Verify.** After implementation completes, delegate to both `feature-verifier` and `test-citation-checker`. Read their actual outputs. If a check fails, send the failure back to `feature-implementer` for correction; do not patch source from the coordinator.
5. **Review.** Run `boundary-auditor` for new `src/` files or import changes and `invariant-reviewer` for lineage, lifecycle, or artifact-type changes. Post a concise implementation summary on the Jira issue, then transition it to the configured review status. Never transition it to Done.
6. **Report.** List changed files, checks and results, cited identifiers, deferred work, and any incomplete phase.

## Delegation and gate limits

Use Codex project custom agents by their configured names. Keep the full pipeline in the same Codex worktree task so the Jira state, agent working directory, and edits share one checkout. Do not emulate an agent by changing its name or bypassing the repository gate.

The legacy `.claude/hooks/gate.mjs` is Claude-specific. This skill does not claim that it receives Codex hook events. Until a Codex-compatible gate hook is configured and validated, do not claim its event-based edit/test restrictions were enforced; retain the stage checks above and report that limitation.
