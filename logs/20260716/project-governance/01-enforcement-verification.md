# Enforcement Verification — Project Governance

- Date (KST): 20260716
- Session-name: project-governance
- Surface: local git-hook + filesystem (CLI). Method: enforce-by-violation (red-team).
- Result: **17 / 17 PASS**

## Checks (attempt a violation, expect refusal)

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | AGENTS.md exists | present | PASS |
| 2 | CLAUDE.md imports `@AGENTS.md` | present | PASS |
| 3 | `.gjc/AGENTS.md` absent (no shadow of root) | absent | PASS |
| 4 | AGENTS.md states 9 rules (`^## Rule [1-9]`) | 9 | PASS |
| 5 | AGENTS.md precedence footer | present | PASS |
| 6 | `.gjc/rules/*.md` count | 6 | PASS |
| 7 | `.gjc/agents/review-*.md` count | 3 | PASS |
| 8 | `git commit` on `master` | refused by pre-commit | PASS |
| 9 | commit-msg rejects non-Conventional subject | refused | PASS |
| 10 | commit-msg accepts valid Conventional subject | allowed | PASS |
| 11 | commit-msg rejects SemVer != package.json (0.0.1) | refused | PASS |
| 12 | commit-msg accepts SemVer == package.json | allowed | PASS |
| 13 | pre-push refuses `refs/heads/master` | refused | PASS |
| 14 | pre-push allows feature branch | allowed | PASS |
| 15 | pre-commit refuses `src/**` from main checkout | refused | PASS |
| 16 | pre-merge-commit refuses merge commit on `master` | refused | PASS |
| 17 | `core.hooksPath` = `.githooks` | set | PASS |

Note on check 16: first harness attempt reported a false negative because `git checkout master`
cannot switch to an unborn branch (no commits yet); re-verified deterministically via
`git symbolic-ref HEAD refs/heads/master` → hook refused (exit 1). Hook logic is identical to the
verified pre-commit master guard.

## Not verifiable locally (deferred to GitHub goal / human-gated)
- GitHub squash-only setting and branch protection on `master` (need the published remote).
- First governed PR + 3-reviewer flow + `/export` to HISTORY/ (need the remote + user go-ahead).
- Per-write UI blocking (S1 plugin spike) — deferred (extension discovery quarantined in v0.11.1).
