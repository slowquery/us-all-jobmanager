# UsAllJobManager — Agent Operating Rules

Single source of truth for how agents work in this repo. Each rule is summarized here in ≤3
lines and links to its normative file under `.gjc/rules/`.

## Rule 1 — Worktree per task
Every task runs in a dedicated git worktree (`git worktree add ../UsAllJobManager.worktrees/<KST-date>-<session-name> -b <type>/<slug>`). Never edit/commit `src/**` from the main checkout.
Normative: [.gjc/rules/00-worktree.md](.gjc/rules/00-worktree.md) · Enforced by `.githooks/pre-commit`.

## Rule 2 — Ralplan before design-important work
Non-trivial architecture/sequencing/new-boundary changes go through `/skill:ralplan` consensus before implementation. Trivial fixes execute directly.
Normative: [.gjc/rules/10-ralplan-gate.md](.gjc/rules/10-ralplan-gate.md).

## Rule 3 — Hexagonal / Clean Architecture
`domain → application(+ports) → adapters → infrastructure`; dependencies point inward only; keep `@nestjs/*` out of domain/use-cases.
Normative: [.gjc/rules/20-architecture-hexagonal.md](.gjc/rules/20-architecture-hexagonal.md).

## Rule 4 — Decision / tradeoff logs
Every design decision is logged to `logs/<KST-date>/<session-name>/NN-<slug>.md` (context, pattern/tech, pros, cons, performance tradeoffs, side effects).
Normative: [.gjc/rules/30-decision-log.md](.gjc/rules/30-decision-log.md) · Template: [logs/TEMPLATE.md](logs/TEMPLATE.md).

## Rule 5 — Write approval
Announce and get user confirmation before mutating files; the hard floor is the commit/push gate (per-commit / per-PR approval).
Normative: [.gjc/rules/40-release-flow.md](.gjc/rules/40-release-flow.md).

## Rule 6 — Completion: PR + three specialist reviewers
On completion: PR from the worktree → user confirmation → 설계/보안/성능 review agents post PR comments → propose verification + fixes.
Normative: [.gjc/rules/40-release-flow.md](.gjc/rules/40-release-flow.md) · Agents: `.gjc/agents/review-{design,security,performance}.md`.

## Rule 7 — Merge, commits, export
Merge only after explicit user approval; **squash merge only**; Conventional Commits + SemVer synced to `package.json`; 커밋 메시지 내용은 한글로 작성(타입 프리픽스만 영문); export the session to `HISTORY/<KST-date>-<session-name>/` on every PR create/edit — run `scripts/export-session.sh <session-name>` (or the `/export` slash command).
Normative: [.gjc/rules/40-release-flow.md](.gjc/rules/40-release-flow.md) · Enforced by `.githooks/{commit-msg,pre-merge-commit,pre-push}` + GitHub squash-only/branch protection on `master`.

## Rule 8 — AGENTS.md + CLAUDE.md
These two files are the always-on prose layer and stay in sync (`CLAUDE.md` imports `@AGENTS.md`). Do not create `.gjc/AGENTS.md` (it would shadow this root file for GJC).

## Rule 9 — Korean-language proposals
Write all user-facing proposals / suggestions / recommendations in Korean (한국어). Code, commit messages, and file content follow existing conventions.
Normative: [.gjc/rules/50-communication-korean.md](.gjc/rules/50-communication-korean.md).

---
Precedence: `.gjc/rules/*.md` are normative and win on any conflict; this file and `CLAUDE.md`
are the summary layer. Exception: Rule 8 (this two-file prose layer) is normative in this file
itself — it has no separate `.gjc/rules` file by design. Default & protected branch is `master`.
