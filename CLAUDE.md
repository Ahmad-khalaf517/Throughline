@AGENTS.md

## Worktrees

`/feature` always runs inside a git worktree, entered via `EnterWorktree` as Phase 0 of `.claude/commands/feature.md` - never directly on `main`. This is a standing instruction: do this without asking, and without being told "worktree" each time. See that file for why the whole pipeline (not just the coding subagent) has to run from inside the worktree - it's a hard requirement of `.claude/hooks/gate.mjs`'s cwd-partitioned gate, not a style preference.
