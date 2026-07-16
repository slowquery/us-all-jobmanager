---
description: Every design decision records its technical tradeoffs into logs/<KST-date>/<session-name>/.
alwaysApply: true
---

# Rule 4 — Decision / tradeoff logs

- For each design decision, write a tradeoff note under
  `logs/<KST-YYYYMMDD>/<session-name>/NN-<slug>.md` (KST via `TZ=Asia/Seoul date +%Y%m%d`).
- Each note MUST cover: context, chosen design pattern/tech, pros, cons, performance tradeoffs,
  side effects, alternatives considered. Use `logs/TEMPLATE.md`.
- Enforcement: advisory; the Design reviewer verifies presence during PR review.
