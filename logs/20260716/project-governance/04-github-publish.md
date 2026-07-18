# GitHub publish + first governed PR (G006)

- Date (KST): 20260716 · Session-name: project-governance
- Repo: https://github.com/slowquery/us-all-jobmanager (**PUBLIC**, owner slowquery)

## Published state (verified via gh)
- visibility: PUBLIC · default branch: `master`
- merge policy: **squash only** (mergeCommitAllowed=false, rebaseMergeAllowed=false, squashMergeAllowed=true)
- branch protection on `master`: enforce_admins=true, required_approving_review_count=1, required_linear_history=true, allow_force_pushes=false, allow_deletions=false

## Bootstrap note
- Genesis commit `894c873` (skeleton + governance) committed on `master` with `--no-verify` and pushed with `--no-verify`: a documented ONE-TIME exception (establishing `master` + importing the pre-existing `src/` skeleton, both guarded for ongoing work). All subsequent commits are hook-governed.

## First governed PR (dogfood) — Rule 1/6/7
- PR #1: `docs/add-readme` → `master` (https://github.com/slowquery/us-all-jobmanager/pull/1)
- Authored in a **worktree** (`../UsAllJobManager.worktrees/20260716-project-governance`, Rule 1).
- Commit `48ec925` passed hooks WITHOUT `--no-verify` (Conventional subject, feature branch, non-src) — proves the governed path works.
- 3 specialist reviewers posted PR comments (Rule 6):
  - [설계 관점] caught a real doc error (README mapped `master` protection to Rule 8; it is Rule 7) + per-rule link/traceability + Rule 5 nuance.
  - [보안 관점] public-repo exposure warnings (HISTORY transcripts, `.gjc/config.yml`), secret-scrubbing/.env guidance.
  - [성능 관점] run-command/`prepare` correctness + `ScheduleModule.forRoot()` startup note.
- Fix commit `833e482` addressed all three reviews (still hook-governed).

## Human-gated / residual
- **Merge**: PR #1 stays OPEN awaiting the user's explicit approval + squash-merge (Rule 7 + branch protection requires 1 approving review). Not merged by the agent.
- **`/export`**: session export to `HISTORY/<date>-<session-name>/session.html` is a Claude/GJC slash-command run by the user (agents cannot invoke slash commands). `HISTORY/README.md` documents the path/overwrite semantics.
- **Reviewer agents**: the native restricted `.gjc/agents/review-*.md` agents are not invocable through the sub-agent task surface used here; the 3 review comments were produced by bundled executor agents constrained to read + `gh pr comment`. In an interactive GJC session the custom restricted agents apply.
