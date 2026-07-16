# Change-set review + folded fixes

- Date (KST): 20260716 · Session-name: project-governance
- Architect lane (subagent 7-GovChangeSetReview): architecture=CLEAR, product=CLEAR, code=WATCH → overall COMMENT, **no blockers**.

## Folded fixes (post-review)
- **P2 pre-commit `src/**` guard** — replaced `git diff --cached --name-only | grep -q` (pipefail+SIGPIPE false-negative; `core.quotePath` non-ASCII miss) with a captured-variable form using `git -c core.quotePath=false diff --cached --name-only`. Fail-closed and non-ASCII-safe.
- **P2 commit-msg false positives** — allow-list generated subjects (`^(Merge |Revert |fixup! |squash! |amend! )`) so `git merge`/autosquash never force `--no-verify`. Conventional-Commits set unchanged (feat|fix|chore|docs|style|refactor|test) per Rule 7.
- **P3 commit-msg node-missing** — distinct diagnostic; skips SemVer sync with a message when `node` is unavailable (avoids false rejection of correct trailers) while keeping the CC shape check.
- **P3 AGENTS.md footer** — added explicit exception noting Rule 8 is normative in AGENTS.md itself (no separate `.gjc/rules` file by design).

## Re-verification after fixes: 14/14 PASS
Still rejects: non-Conventional subject, SemVer mismatch, commit on master, `src/**` from main checkout.
Now allows: `Merge`/`Revert`/`fixup!` generated subjects. `bash -n` syntax OK on all four hooks. Rule-8 footer exception present.

## Residuals accepted (documented)
- Reviewer `bashAllowedPrefixes` are word-prefix matched; `git log/diff --output=<file>` remains a trivial write vector (noted in each agent file). Mitigation deferred to implementation hardening.
- commit-msg `perf|build|ci|revert` types and `!` breaking-change marker omitted (Rule 7 fixed set); revisit when a major bump first occurs.
