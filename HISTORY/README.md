# HISTORY — session exports

On every PR create/edit, the interactive top-level session is exported here (Rule 7):

```
/export HISTORY/<KST-date>-<session-name>/session.html
```

- `<KST-date>` via `TZ=Asia/Seoul date +%Y%m%d` (e.g. `20260716`).
- `<session-name>` = kebab task-slug only (e.g. `project-governance`).
- Fixed path per session ⇒ re-export **overwrites** the same file; do not create proliferating copies.

## ⚠️ Public-exposure notice (accepted)
This repository is **public**. Session export HTML contains source, file paths, and internal
discussion, and these exports are **committed** — so their full content is publicly visible.
This exposure was explicitly reviewed and accepted by the repo owner. Do not export sessions that
contain secrets/credentials; run a secret scan before committing an export.

## Runnable export (no slash command needed)

```bash
scripts/export-session.sh <session-name>     # e.g. project-governance
# or: yarn export:session <session-name>
```

The script derives the KST date from the session start time, so re-running it overwrites the same
`HISTORY/<date>-<session-name>/session.html` (stable path). Overrides: `GJC_SESSION_FILE`,
`GJC_SESSION_DATE`. The interactive `/export` slash command remains available as an alternative.

**필수:** 모든 PR에는 작업 당시까지의 export HTML이 커밋되어 있어야 한다. PR 갱신 시 재실행 후 재커밋.
