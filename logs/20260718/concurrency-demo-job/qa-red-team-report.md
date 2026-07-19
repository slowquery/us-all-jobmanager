# QA/레드팀 리포트 — 뉴스 다이제스트 job (concurrency-demo-job)

- 일자: 2026-07-18 (초기 키워드 구현 QA — 이후 주제별 그룹 요약 전환은 247 테스트로 별도 재검증됨)
- 워크트리: `~/Project/UsAllJobManager.worktrees/20260718-concurrency-demo-job` (브랜치 `feat/news-digest-job`)
- 범위: `NewsDigestJobProcessor`의 no-throw 계약, timeout 유계성, dedupe/idempotency, `DispatchingJobProcessor`
  네트워크 격리, 유스케이스 per-job 안전망, config 비밀 게이팅에 대한 적대적(adversarial) 검증. fake/더블만 사용 —
  실제 네트워크 호출 없음.
- 제약 준수: 기존 테스트 파일은 **수정하지 않음**. `src/**` 아래 신규 `*.adversarial.spec.ts`만 추가. 제품 소스(비-테스트
  `src`)·`package.json`·`.gjc`·메인 체크아웃은 건드리지 않음.

## 판정: 통과(PASSED)

기존 스위트 전부 green 유지, 모든 적대적 케이스가 계약대로 동작. 제품 결함 없음 — 시도한 모든 파괴에 구현이 버팀.

## 실행 명령과 결과

| 명령 | 결과 |
|---|---|
| `corepack yarn test` | **PASS** — 스위트 40/40, 테스트 207/207 (기존 188 + 신규 적대적 19) |
| `corepack yarn test:e2e` | **PASS** — 스위트 1/1, 테스트 18/18 (무변경, 회귀 없음) |
| `corepack yarn test:cov` | **PASS** — 커버리지 게이트 유지: 전역 statements 98.47% / branches 95.31% / functions 93.89% / lines 98.74% (임계 97/86/92/98 모두 충족), `src/domain` 100/100/100/100 |

## 추가한 적대적 스펙 파일

| 파일 | 목적 |
|---|---|
| `news-digest-job.processor.adversarial.spec.ts` | no-throw 계약(동기 throw / rejected promise / abort-reject / logger undefined / 빈 입력), timeout 유계, dedupe/idempotency |
| `job-processor.strategy.adversarial.spec.ts` | DispatchingJobProcessor 네트워크 격리(불일치/near-miss 제목은 네트워크 fake를 타지 않음) |
| `process-pending-jobs.use-case.adversarial.spec.ts` | 유스케이스 per-job try/catch 안전망(throw하는 처리기가 형제 job을 막지 않음, 다중 동시 throw) |
| `news-digest.config.adversarial.spec.ts` | config 게이팅(`enabled`는 플래그 + 두 비밀 모두 필요, 각 비밀 결핍 조합) |

## 적대적 케이스별 결과표

| # | 대상 | 적대적 케이스 | 기대 | 실제 | 결과 |
|---|---|---|---|---|---|
| 1a | no-throw | 뉴스 소스가 동기 throw | `process()`가 `{outcome:'failed'}` resolve, reject 없음 | 그대로 | PASS |
| 1b | no-throw | 요약기가 rejected Promise 반환 | `{outcome:'failed'}` resolve | 그대로 | PASS |
| 1c | no-throw | 알림기가 abort로 reject(timeout race, `timeoutMs=20`) | `{outcome:'failed'}` resolve | 그대로 | PASS |
| 1d | no-throw | `logger`가 `undefined`인데 협력자 throw | `logger?.log`에서 안 터지고 `{outcome:'failed'}` | 그대로 | PASS |
| 1e | no-throw | 빈 입력 배열(`[]`) | `{outcome:'failed'}` + `NEWS_DIGEST_FAILED` 에러 로그 1건 | 그대로, 에러 로그 정확히 1건 | PASS |
| 2 | timeout 유계 | 협력자가 `signal.aborted`까지 무한 대기(`timeoutMs=30`) | `timeoutMs` 소수 배 이내 `failed` 유계 종료 | 경과시간 `< timeoutMs*10`, `failed` | PASS |
| 3a | dedupe | 동일 `job.id` 2회 처리 | 2번째는 알림기 미호출 `completed` | `notifyCallCount===1`, 둘 다 `completed` | PASS |
| 3b | dedupe | 서로 다른 `job.id` 2개 | 각각 독립, job당 알림 1회 | `notifyCallCount===2`, 둘 다 `completed` | PASS |
| 4a | dispatcher 격리 | 제목이 sentinel과 다름 | 뉴스("네트워크") 처리기 미호출, fallback 1회 | `matched===0`, `fallback===1` | PASS |
| 4b | dispatcher 격리 | 제목이 sentinel과 정확히 일치 | 뉴스 처리기 1회, fallback 미호출 | `matched===1`, `fallback===0` | PASS |
| 4c | dispatcher 격리 | near-miss 제목(대소문자/공백/부분/빈) | 전부 fallback만, 뉴스 처리기 미호출 | 5변형 모두 `matched===0`, `fallback===5` | PASS |
| 5a | 유스케이스 안전망 | 배치 3건 중 1건 처리기가 동기 throw | 해당 job만 `failed`, 형제는 `completed`, `JOB_PROCESSOR_THREW` 1건, processing 고착 0 | `succeeded:2`, `failed:1`, 로그 1건, 고착 0 | PASS |
| 5b | 유스케이스 안전망 | 3건 중 2건 실패(rejected+sync throw), 1건 성공 | 2 `failed`, 1 `succeeded`, `JOB_PROCESSOR_THREW` 2건 | 그대로 | PASS |
| 6a | config 게이팅 | 플래그 true, Gemini key 있음, Slack webhook 없음 | `enabled=false` | `false` | PASS |
| 6b | config 게이팅 | 플래그 true, Slack webhook 있음, Gemini key 없음 | `enabled=false` | `false` | PASS |
| 6c | config 게이팅 | 플래그 true, 두 비밀 공백만 | `enabled=false`(trim 후) | `false` | PASS |
| 6d | config 게이팅 | 플래그 없음, 두 비밀 있음 | `enabled=false`(명시적 opt-in 필요) | `false` | PASS |
| 6e | config 게이팅(대조) | 플래그 `'TRUE'`(대소문자), 두 비밀 있음 | `enabled=true` | `true` | PASS |
| 6f | config 게이팅(대조) | 플래그 `'true '`(후행 공백), 두 비밀 있음 | `enabled=true` | `true` | PASS |
| 7 | 기존 회귀 | C-1~C-5 동시성 + 전체 e2e | 전부 green, 무변경 | 기존 188 유닛·동시성 + 18 e2e 모두 통과 | PASS |

## 발견 사항

실제 결함 없음. 시도한 모든 적대적 입력 — 파이프라인 각 단계 협력자의 동기 throw·rejected promise, abort 타이머와
경합하는 무한 대기 협력자, 오류 경로의 `undefined` 로거, dispatcher 정확 일치 라우팅을 노리는 near-miss/경계 제목,
한 배치 tick 내 다중 동시 throw — 에 대해 no-throw 계약·timeout 유계·dedupe 원장·라우팅·유스케이스 안전망·config
게이팅이 모두 계약대로 버텼다.

## 산출물

리포트 경로: `logs/20260718/concurrency-demo-job/qa-red-team-report.md` (이 파일).
