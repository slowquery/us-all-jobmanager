---
description: PR + 3-reviewer flow, user-approved squash merge, Conventional Commits + SemVer, and session export.
alwaysApply: true
---

# Rules 5-7 — Approval, review, and release flow

## Rule 5 — Write approval
- In the interactive session, announce and get user confirmation before mutating files.
- Hard floor: `.githooks/` gate commits/pushes; approval granularity is per-commit / per-PR.
- Note: `.gjc/**` is runtime-owned (author `.gjc/*` governance files via shell, not agent write tools).

## Rule 6 — Completion: PR + three specialist reviewers
- Push the feature branch, `gh pr create`, then STOP for user confirmation.
- Spawn three review subagents (설계/보안/성능) defined in `.gjc/agents/review-*.md`; each posts
  concrete improvement comments to the PR. Aggregate findings, then propose verification + fixes.

## Rule 7 — Merge, commits, export
- Merge ONLY after explicit user approval; **squash merge only**.
- Squash/commit subject = Conventional Commits: `feat|fix|chore|docs|style|refactor|test`; bump
  SemVer synced to `package.json` `version`.
- On every PR create/edit, run `/export HISTORY/<KST-date>-<session-name>/session.html` from the
  interactive top-level session (fixed path ⇒ overwrite; no proliferating copies).

## Canonical gated-command table (single source; referenced, not duplicated)
| Command | Treatment | Layer |
|---|---|---|
| `git commit` on feature branch (in worktree) | allowed; msg shape + SemVer validated | `.githooks/commit-msg` (hard) |
| `git commit` on `master` OR `src/**` from main checkout | refused | `.githooks/pre-commit` (hard) |
| `git merge` (merge commit) on `master` | refused | `.githooks/pre-merge-commit` (hard) |
| `git merge --ff` / `git rebase` onto `master` | bypass commit hooks locally; backstop = pre-push refusing `refs/heads/master`; local divergence recoverable via `git reset --hard origin/master` | `.githooks/pre-push` (hard at push) |
| `git push` feature branch | allowed | — |
| `git push` to `master` | refused | `.githooks/pre-push` (hard) |
| `gh pr view` / `pr diff` / `pr review` / `pr comment` | allowed for reviewer agents | agent frontmatter (hard boundary) |
| `gh api`, `gh pr merge`, `git apply/reset/checkout/clean/push` | refused for reviewer agents | agent frontmatter (hard for reviewers) |
| `gh pr merge --squash` | only after explicit user approval; refused for reviewers | GitHub squash-only (hard shape) + approval (advisory) |
| `gh pr merge --merge` / `--rebase` | refused server-side | GitHub squash-only (hard) |

Honest note: local prompts cannot stop a human clicking merge in the web UI; only the GitHub
squash-only setting + branch protection on `master` constrain the UI.

## Runnable session export (Rule 7)
Session export is runnable directly (by the agent or a user) via a repo script, in addition to
the interactive `/export` slash command:

```bash
scripts/export-session.sh <session-name>     # e.g. project-governance
# or: yarn export:session <session-name>
```

It resolves the current session (`$GJC_SESSION_ID`, override `GJC_SESSION_FILE`), renders HTML via
`gjc --export`, and writes `HISTORY/<KST-session-date>/<session-name>/session.html`. The KST date is
derived from the SESSION START time (not "now"), so re-exports overwrite in place (fixed path).

- 커밋 메시지 내용은 한글로 작성한다 (타입 프리픽스만 영문). `commit-msg` 훅이 강제.

**필수**: 모든 PR은 생성·수정 시점 기준으로 export된 `HISTORY/<KST-session-date>/<session-name>/session.html`을
**커밋된 상태로 포함**해야 한다(작업 당시까지의 스냅샷). PR을 갱신할 때마다 `scripts/export-session.sh <session-name>`를
다시 실행해 덮어쓴 뒤 커밋한다.
