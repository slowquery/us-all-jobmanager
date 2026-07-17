---
description: Every task runs in a dedicated git worktree; never work directly in the main checkout.
alwaysApply: true
---

# Rule 1 — Worktree per task

- Before starting any task, create a worktree:
  `git worktree add ../UsAllJobManager.worktrees/<KST-date>-<session-name> -b <type>/<slug>`
  (KST date via `TZ=Asia/Seoul date +%Y%m%d`; `<session-name>` = kebab task-slug).
- **No exceptions by artifact type.** Creating or editing ANY file — `src/**`, `docs/**`,
  `logs/**`, rules, hooks, markdown-only deliverables included — happens in the task worktree.
  "It's only docs/logs" is not an exemption (violated once on 2026-07-17; do not repeat).
- **Session-start self-check (MUST, before the first Write/Edit):**
  `[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] || echo "MAIN CHECKOUT — create a worktree first"`
  Equal values mean the main checkout; create the worktree and `cd` into it before mutating files.
- **Recovery when violated:** create the worktree immediately, move the produced files into it
  (verify with `diff -r` before deleting from the main checkout), and leave the main checkout clean.
- Enforcement (hard, commit boundary): `.githooks/pre-commit` refuses ANY commit from the main
  checkout (git-dir == git-common-dir) and refuses any commit on `master`.
- Normative source of truth for this rule; AGENTS.md/CLAUDE.md only summarize it.
