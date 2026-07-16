# Step-0 Confirmations — Project Governance Setup

- Date (KST): 20260716
- Session: 019f69e7-e1f2-7000-8f78-bab4795975ed
- Session-name: project-governance
- Source plan: `.gjc/_session-019f69e7-.../plans/ralplan/.../pending-approval.md` (ralplan consensus, stage_n 5)

## Context

Blocking Step-0 items from the approved plan must be resolved before authoring CLAUDE.md, deciding R5 enforcement strength, and promising branch-protection acceptance.

## 0a — Claude Code `@AGENTS.md` import support

- Decision: **Adopt `@AGENTS.md` import** in root `CLAUDE.md`.
- Rationale: Claude Code memory files support `@path` imports; a one-line `@AGENTS.md` yields a zero-drift mirror of the single source of truth (root `AGENTS.md`).
- Tradeoff: depends on the import feature being honored by the running Claude Code version. If an environment does not expand `@AGENTS.md`, CLAUDE.md degrades to showing a literal reference rather than the rules.
- Fallback (documented, not applied): duplicate the AGENTS.md rule statements into CLAUDE.md with a `do-not-edit — mirror of AGENTS.md` note plus a release-checklist diff step.
- Verification: V8(c) — CLAUDE.md contains `@AGENTS.md` + a do-not-edit note and no forked normative text.

## 0b — GJC-plugin per-write UI gating spike

- Decision: **Defer** the plugin spike; R5 stays at commit/PR-boundary granularity for now.
- Rationale: gajae-code v0.11.1 quarantines extension/plugin discovery by default (`src/main.ts:980-981` disableExtensionDiscovery=true; `src/sdk/session.ts:1686,1767`). A per-write `tool_call` block is only reachable via a constrained plugin bundle through the quarantined runner; standing that up is out of scope for the initial governance seed and is not required for a correct hard-enforcement floor.
- Consequence: R5 hard enforcement = native git hooks at the commit/push boundary + top-level interactive announce-and-confirm (advisory). Per-write UI blocking is a future upgrade if a spike proves `{block:true}` + `ctx.ui.confirm` fire in an interactive session.

## 0c — Repo / branch reality

- Finding: the working directory was **not** a git repository (no `.git`, no remote) at setup time.
- Action taken: `git init -b master` (default + protected branch = `master`, per user decision).
- User decisions carried from ralplan reconciliation: **public** GitHub repo; branch protection on `master`; commit full session transcripts into `HISTORY/` (public exposure explicitly accepted); worktree parent `../UsAllJobManager.worktrees/`; session-name = kebab task-slug only.
- Remaining human-gated step: creating/publishing the public GitHub repo, pushing, enabling squash-only + branch protection, and the first governed PR (goal G006). This is a point-of-no-return (public exposure of committed transcripts) and requires an explicit user go-ahead plus a chosen repo name.
