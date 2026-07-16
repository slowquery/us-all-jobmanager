---
description: Every task runs in a dedicated git worktree; never work directly in the main checkout.
alwaysApply: true
---

# Rule 1 — Worktree per task

- Before starting any task, create a worktree:
  `git worktree add ../UsAllJobManager.worktrees/<KST-date>-<session-name> -b <type>/<slug>`
  (KST date via `TZ=Asia/Seoul date +%Y%m%d`; `<session-name>` = kebab task-slug).
- Never edit/commit `src/**` from the main checkout. Enforcement: `.githooks/pre-commit`
  refuses `src/**` commits from the main checkout and refuses any commit on `master`.
- Normative source of truth for this rule; AGENTS.md/CLAUDE.md only summarize it.
