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
