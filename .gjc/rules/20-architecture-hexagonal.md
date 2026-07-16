---
description: Application code follows Hexagonal / Clean Architecture (ports & adapters, domain isolation, dependency rule).
globs: ["src/**/*.ts"]
---

# Rule 3 — Hexagonal / Clean Architecture

- Layering: `domain/` (entities, value objects, domain services — no framework imports) →
  `application/` (use-cases + `application/ports/` interfaces) → `adapters/` (inbound: Nest
  controllers/schedulers; outbound: repositories/clients implementing ports) →
  `infrastructure/` (wiring, config, Nest modules).
- Dependency rule: dependencies point inward only. Domain never imports application/adapters;
  application never imports adapters/infrastructure. Cross boundaries via ports (interfaces).
- NestJS: keep `@nestjs/*` in adapters/infrastructure; domain and use-cases stay framework-free.
- Enforcement: advisory (Design reviewer checks it); follow-up hardening via
  `eslint-plugin-boundaries` / `dependency-cruiser`.
