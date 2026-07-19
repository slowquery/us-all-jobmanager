# QA/Red-Team Report — news-digest job (concurrency-demo-job)

- Date: 2026-07-18
- Worktree: `~/Project/UsAllJobManager.worktrees/20260718-concurrency-demo-job` (branch `feat/news-digest-job`)
- Scope: adversarial verification of NewsDigestJobProcessor no-throw contract, timeout bounding,
  dedupe/idempotency, DispatchingJobProcessor network isolation, use-case per-job safety net,
  and config secret gating. Fakes/doubles only — no real network calls.
- Constraint compliance: existing test files were **not modified**; only new
  `*.adversarial.spec.ts` files were added under `src/**`. No product source (non-test `src`),
  `package.json`, `.gjc`, or main checkout were touched.

## Verdict: PASSED

All existing suites remain green and every adversarial case behaved per contract. No product
defects were found; the implementation withstood every attempted break.

## Commands run (verbatim) and results

| Command | Result |
|---|---|
| `corepack yarn test` | **PASS** — Test Suites: 40 passed, 40 total; Tests: 207 passed, 207 total (188 pre-existing + 19 new adversarial) |
| `corepack yarn test:e2e` | **PASS** — Test Suites: 1 passed, 1 total; Tests: 18 passed, 18 total (unchanged, regression-clean) |
| `corepack yarn test:cov` | **PASS** — coverage gate held: global statements 98.47%, branches 95.31%, functions 93.89%, lines 98.74% (all ≥ configured thresholds 97/86/92/98); `src/domain` at 100/100/100/100 |

## New adversarial spec files added

| File | Purpose |
|---|---|
| `src/infrastructure/news-digest/news-digest-job.processor.adversarial.spec.ts` | No-throw contract (sync throw / rejected promise / abort-reject / undefined logger / empty headlines), timeout bounding, dedupe/idempotency |
| `src/application/ports/job-processor.strategy.adversarial.spec.ts` | DispatchingJobProcessor network isolation (mismatched/near-miss titles never hit the "network" fake) |
| `src/application/use-cases/process-pending-jobs.use-case.adversarial.spec.ts` | Use-case per-job try/catch safety net (throwing processor doesn't block sibling jobs; multiple simultaneous throws) |
| `src/infrastructure/config/news-digest.config.adversarial.spec.ts` | Config gating (`enabled` requires flag AND both secrets; each missing-secret combination) |

## Per-adversarial-case result table

| # | Target | Adversarial case | Expected | Actual | Result |
|---|---|---|---|---|---|
| 1a | No-throw contract | `NewsSource.fetchTodayHeadlines` throws synchronously | `process()` resolves `{outcome:'failed'}`, never rejects | Resolved `{outcome:'failed'}` | PASS |
| 1b | No-throw contract | `KeywordSummarizer.summarizeKeywords` returns a rejected Promise | `process()` resolves `{outcome:'failed'}`, never rejects | Resolved `{outcome:'failed'}` | PASS |
| 1c | No-throw contract | `SlackNotifier.notify` rejects because of abort (timeout race, `timeoutMs=20`) | `process()` resolves `{outcome:'failed'}`, never rejects | Resolved `{outcome:'failed'}` | PASS |
| 1d | No-throw contract | Collaborator throws while `logger` is `undefined` | `process()` still resolves `{outcome:'failed'}` without throwing on `logger?.log` | Resolved `{outcome:'failed'}` | PASS |
| 1e | No-throw contract | Empty headlines array (`[]`) | Mapped to `{outcome:'failed'}` with one `NEWS_DIGEST_FAILED` error log | Resolved `{outcome:'failed'}`, exactly 1 error log with `errorCode:'NEWS_DIGEST_FAILED'` | PASS |
| 2 | Timeout bounding | Collaborator (`NewsSource`) hangs until `signal.aborted` fires, `timeoutMs=30` | Bounded termination — `failed` returned well within a small multiple of `timeoutMs` | Resolved `{outcome:'failed'}`; elapsed time `< timeoutMs*10` | PASS |
| 3a | Dedupe/idempotency | Same `job.id` processed twice | 2nd call returns `completed` without calling `notifier` again | `notifyCallCount === 1` across both calls, both `completed` | PASS |
| 3b | Dedupe/idempotency | Two distinct `job.id`s processed | Each is independent, `notifier` called once per job | `notifyCallCount === 2`, both `completed` | PASS |
| 4a | Dispatcher isolation | Job title differs from sentinel (`'unrelated-title'`) | Matched (news/"network") processor never invoked; fallback invoked once | `matchedCalls()===0`, `fallbackCalls()===1` | PASS |
| 4b | Dispatcher isolation | Job title exactly matches sentinel (`'news-digest'`) | Matched processor invoked once; fallback never invoked | `matchedCalls()===1`, `fallbackCalls()===0` | PASS |
| 4c | Dispatcher isolation | Near-miss titles (case/whitespace/partial-match/empty string) | All route to fallback only, matched never called | `matchedCalls()===0` across all 5 near-miss variants; `fallbackCalls()===5` | PASS |
| 5a | Use-case safety net | One of 3 seeded jobs' processor throws synchronously mid-batch | Only the throwing job ends `failed`; siblings end `completed`; exactly 1 `JOB_PROCESSOR_THREW` log; no jobs left stuck in `processing` | `succeeded:2`, `failed:1`, repo statuses matched exactly, 1 `JOB_PROCESSOR_THREW` log, 0 jobs stuck in `processing` | PASS |
| 5b | Use-case safety net | 2 of 3 jobs fail (one rejected Promise, one sync throw), 1 succeeds | Batch resolves cleanly; 2 `failed`, 1 `succeeded`; 2 `JOB_PROCESSOR_THREW` logs | `succeeded:1`, `failed:2`, exactly 2 `JOB_PROCESSOR_THREW` logs | PASS |
| 6a | Config gating | Flag `true`, Gemini key present, Slack webhook empty | `enabled=false` | `enabled===false` | PASS |
| 6b | Config gating | Flag `true`, Slack webhook present, Gemini key empty | `enabled=false` | `enabled===false` | PASS |
| 6c | Config gating | Flag `true`, both secrets whitespace-only strings | `enabled=false` (post-trim) | `enabled===false` | PASS |
| 6d | Config gating | Flag absent/undefined, both secrets present | `enabled=false` (explicit opt-in required) | `enabled===false` | PASS |
| 6e | Config gating (regression contrast) | Flag `'TRUE'` (case variant), both secrets present | `enabled=true` | `enabled===true` | PASS |
| 6f | Config gating (regression contrast) | Flag `'true '` (trailing space), both secrets present | `enabled=true` | `enabled===true` | PASS |
| 7 | Existing regression | C-1..C-5 concurrency specs + full e2e suite | All green, unmodified | 188 pre-existing unit/concurrency tests + 18 e2e tests all still pass | PASS |

## Findings

No real defects found. The implementation's no-throw contract, timeout bound, dedupe ledger,
dispatcher routing, use-case safety net, and config gating all held under every adversarial
input attempted, including:

- synchronous throws and rejected promises from every pipeline collaborator stage,
- an intentionally never-resolving collaborator racing the abort timer,
- an absent (`undefined`) optional logger during an error path,
- near-miss/edge-case job titles probing the dispatcher's exact-match routing,
- multiple simultaneous processor throws within one batch tick.

## Artifact

Report path: `logs/20260718/concurrency-demo-job/qa-red-team-report.md` (this file).
