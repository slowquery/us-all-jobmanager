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
- **PR 제목은 한글로 작성**한다(Rule 9). 예: `docs: 프로젝트 README 추가`.
- Spawn three review subagents (설계/보안/성능) defined in `.gjc/agents/review-*.md`; each posts
  concrete improvement comments to the PR. Aggregate findings, then propose verification + fixes.

## Rule 7 — Merge, commits, export
- Merge ONLY after explicit user approval; **squash merge only**.
- 머지 전 CI(`verify`: install→lint→build→unit→e2e)가 **통과**해야 한다. 테스트가 존재하면 반드시 통과(하드)해야 하며, 실패하면 **머지 금지** — 원인을 분석해 사용자에게 재확인한다. unit/e2e 테스트가 구현되면 GitHub branch protection의 required status check(`verify`)로 하드 강제한다. 사용자가 머지를 수락했더라도 테스트 실패 시 머지하지 않는다.
- **머지(squash) subject 형식 = `<type>: (X.Y.Z) 한글설명`** (`feat|fix|chore|docs|style|refactor|test`;
  type은 변경 성격을 유지하고, `(X.Y.Z)`는 `package.json` `version`과 바이트 일치). 예: `feat: (0.8.0) 릴리스 자동 태깅 추가`.
  머지 실행은 `gh pr merge --squash --subject "<type>: (X.Y.Z) 한글설명"`로 subject를 명시 지정한다.
- **머지 시 `vX.Y.Z` 태그 자동 부착**: master push(=squash 머지) 때 CI `verify` 통과 후 `tag` job이
  `package.json` `version`을 읽어 `v<version>` 태그가 없으면 생성·push한다(멱등). 같은 `tag` job이 머지
  subject의 릴리스 형식·버전 일치·한글 여부를 사후 검증한다(형식 위반 시 CI 실패로 신고 — 웹 UI 머지는
  사전 차단 불가하므로 사후 게이트). SemVer는 아래 `package.json` `version`과 동기화한다.
- **SemVer bump 하드 강제**: 소스/기능 변경이 포함된 PR은 `package.json` `version`을 base(`master`)보다 반드시 상향해야 한다. CI `verify`의 `SemVer bump 게이트` 스텝이 base 대비 상향 여부를 검사해 미상향 시 실패시킨다(하드). 커밋 메시지의 `version: X.Y.Z` 트레일러는 `package.json`과 바이트 일치해야 하며 `commit-msg` 훅이 검사한다(트레일러가 있을 때). 즉 **CI 게이트(bump 강제) + commit-msg 훅(일치 강제)** 이중 방어.
- On every PR create/edit, run `/export HISTORY/<KST-date>-<session-name>/session.html` from the
  interactive top-level session (fixed path ⇒ overwrite; no proliferating copies).

## Canonical gated-command table (single source; referenced, not duplicated)
| Command | Treatment | Layer |
|---|---|---|
| `git commit` on feature branch (in worktree) | allowed; msg shape(한글 subject) + version 트레일러·subject `(X.Y.Z)` 괄호 버전 일치 검사 | `.githooks/commit-msg` (hard) |
| `git commit` on `master` OR `src/**` from main checkout | refused | `.githooks/pre-commit` (hard) |
| `git merge` (merge commit) on `master` | refused | `.githooks/pre-merge-commit` (hard) |
| `git merge --ff` / `git rebase` onto `master` | bypass commit hooks locally; backstop = pre-push refusing `refs/heads/master`; local divergence recoverable via `git reset --hard origin/master` | `.githooks/pre-push` (hard at push) |
| `git push` feature branch | allowed | — |
| `git push` to `master` | refused | `.githooks/pre-push` (hard) |
| `gh pr view` / `pr diff` / `pr review` / `pr comment` | allowed for reviewer agents | agent frontmatter (hard boundary) |
| `gh api`, `gh pr merge`, `git apply/reset/checkout/clean/push` | refused for reviewer agents | agent frontmatter (hard for reviewers) |
| `gh pr merge --squash` | only after explicit user approval; refused for reviewers | GitHub squash-only (hard shape) + approval (advisory) |
| `gh pr merge --merge` / `--rebase` | refused server-side | GitHub squash-only (hard) |
| PR head `package.json` version ≤ base(`master`) | refused | CI `verify` `SemVer bump 게이트` (hard) |
| PR에서 추가/변경된 `logs/**/*.md`에 한글 없음 | refused | CI `verify` `결정 로그 한글 게이트` (hard) |
| 거버넌스 스크립트/훅·CI의 사용자 노출 출력 문구 | 한글 필수 | 리뷰(advisory) + Rule 9 |
| 머지 subject 형식 `<type>: (X.Y.Z) 한글설명` 위반 | refused(사후) | CI `tag` job `머지 subject 릴리스 형식 검증` (hard, push) |
| subject `(X.Y.Z)` ≠ `package.json` version | refused | `.githooks/commit-msg`(로컬) + CI `tag` job (hard) |
| master push 시 `vX.Y.Z` 태그 자동 부착 | 멱등 생성·push | CI `tag` job (needs verify, `contents: write`) |

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
