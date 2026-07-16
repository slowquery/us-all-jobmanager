---
description: Design-important features must go through ralplan (planner/architect/critic consensus) before implementation.
alwaysApply: true
---

# Rule 2 — Ralplan before design-important work

- If a change involves non-trivial architecture, sequencing, new modules/boundaries, or
  multiple viable designs, run `/skill:ralplan` and reach consensus (Critic OKAY + Architect
  CLEAR/APPROVE) before writing implementation code.
- Trivial, single-location fixes (typos, obvious one-liners) execute directly.
- Enforcement: advisory trigger; the commit boundary + PR review are the hard backstop.
