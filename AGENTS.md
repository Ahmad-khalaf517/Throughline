<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Codex feature workflow

For Codex, requests to implement one or more features or Jira stories automatically use `.agents/skills/throughline-feature/SKILL.md`; the user does not need to name the skill or request a worktree. Create a dedicated Codex-managed worktree from local `main` for each new story, without asking for routine confirmation. Keep each story's planning, Jira transitions, implementation, verification, and review tied to its own worktree. For multiple stories, follow the skill's dependency and parallel scheduling rules. Delegate coding and verification to the configured Codex project agents. These instructions apply to Codex; Claude Code continues to use `CLAUDE.md` and `.claude/commands/feature.md`.

## Jira prerequisite convention

For Throughline, the user confirms that Jira In Review means the story is already merged. Treat In Review or Done as satisfying a prerequisite status when the required code is present in local main. Do not block dependent work solely because a merged prerequisite remains In Review. This convention overrides the stricter Done-only wording in the feature skill and Jira Plan.
