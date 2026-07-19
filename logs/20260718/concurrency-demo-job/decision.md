# 동시성 요구를 실증할 JOB 예제 선정 — 뉴스→Gemini→Slack 충분성 판정과 A+C 이원 전략

- Date (KST): 20260718
- Session-name: concurrency-demo-job
- Author/agent: gjc (ralplan 합의: Planner + Architect + Critic, 2회차 CLEAR/APPROVE·OKAY)
- Status: accepted

> 근거 산출물(ralplan): `.gjc/_session-019f764f-ab3c-7000-a6a9-60e81aedf3be/plans/ralplan/019f764f-ab3c-7000-a6a9-60e81aedf3be/`
> (stage-01-planner, stage-02-revision, stage-02-post-interview, stage-02-final / architect·critic stage_n 1·2)

## Context

REQUIREMENTS.md 동시성 절을 "실제 JOB을 생성해서" 구현하려는데, 후보로 "오늘의 뉴스를 불러와 Gemini 무료 API로 키워드를 정리해 Slack webhook으로 전달하는 job"이 그 목적에 충분한지, 아니면 더 나은 예제가 있는지를 결정한다.

핵심 재정의: REQUIREMENTS의 동시성 요구(45–47행)는 "API 요청과 스케줄러가 **동시에 같은 단일 JSON 파일에 접근**해도 데이터가 손실·깨지지 않아야 한다"는 **공유 데이터 무결성**이며, **job이 무슨 일을 하는지와 직교**한다. 그리고 이 요구는 이미 해결·증명되어 있다:

- **해결 메커니즘**: `JsonDbJobRepository`의 인프로세스 단일 Promise 체인 직렬화 큐 + guard-in-lock(임계구역 내부에서 최신 상태 재조회 후 guard 평가). 포트 계약은 `withTransition`(단건 원자), `withBatch`(배치 원자, 파일 write 1회).
- **증명**: `test/concurrency/` C-1(무보호 lost update 재현)·C-2(torn snapshot)·C-3(stress)·C-4(tick overrun 중복선점)·C-5(write-behind 유실 실증=기각안)·regression(보호 경로 무손실).
- **파이프라인**: `ProcessPendingJobsUseCase.execute`는 ① `listByStatus('pending',10)` → ② `withBatch(ids,'processing')` 원자 선점(락 내부) → ③ `jobProcessor.process(job)` **락 바깥** 실행(실제 작업/외부 I/O 자리) → ④ `withBatch(→'completed'|'failed')` 원자 커밋. "선점 → 락 밖 처리 → 커밋" 패턴이 이미 내장되어, 느린 외부 I/O를 락을 쥔 채 하지 않도록 설계돼 있다.
- `JobProcessor`는 얇은 Strategy 확장점이며 현재 `DefaultJobProcessor`는 no-op(처리=전이). TSDoc에 "향후 실제 처리 로직 교체 지점"이라 명시.

즉 "동시성 구현" 관점에서 새 job이 채워야 할 빈칸은 없다. 남은 것은 **실증(데모)과 문서화의 품질** 문제다.

## Chosen design / pattern / technology

**A+C 이원 전략(권고), `JobProcessor` 포트는 무변경 유지.** 단, 본 세션의 확정 산출물은 이 결정 문서이며 **코드 변경은 없다**(구현은 별도 실행 승인 대상).

- **A. 결정론적 slow/sleeping `JobProcessor` 테스트 더블**: 테스트가 지연을 명시 제어(주입 delay 또는 resolve-gate promise, jitter 기본 0·사용 시 시드 고정). tick overrun(C-4)·"락 안에서 I/O 안 한다" 규율을 CI에서 **결정론적으로** 재현. 외부 의존 0.
- **C. 실제 외부 I/O job(뉴스→Gemini→Slack이 한 인스턴스)**: `JobProcessor` 포트 뒤 **인프라 어댑터**로 배치. env 기능 플래그(기본 off) + per-call timeout + 결정적 dedupe key(도메인 무변경 기본값) + **no-throw 오류 계약**. **CI는 mock**, 실호출은 로컬 수동 스모크 한정.

바인딩: `src/adapters/scheduler/scheduler.module.ts`의 `JOB_PROCESSOR` useFactory에서 플래그 스위칭하고, delegate 무관 `new TracingJobProcessor(delegate)` 래핑을 유지(스팬 계측 소실 방지). infrastructure→adapters 역방향 import 금지.

## Pros

- 저장소 포트 계약·도메인 전이표·재시도 정책을 **전혀 바꾸지 않고** 기존 Strategy 확장점 위에 얹힌다(blast radius 최소).
- 동시성 "증명"은 A로 CI에서 결정론적으로 재현되어 실제 증거가 된다(외부 네트워크에 의존하지 않음).
- C-mock은 헥사고날 확장점과 no-throw/at-least-once/timeout 설계를 현실적으로 데모하되 CI 결정론과 PUBLIC 레포 안전성을 해치지 않는다.
- Architect 리뷰에서 드러난 실제 함정(아래 Side effects)을 설계 단계에서 선제 차단.

## Cons

- 뉴스 실호출은 로컬 수동 스모크로만 가능(CI 아님) — "실제 동작 데모"의 자동화 범위가 제한된다.
- C를 실제로 구현하려면 신규 인프라 어댑터·테스트·플래그 배선이 필요(문서-only를 넘어서는 후속 작업).
- 커밋 전 프로세스 크래시로 인한 `processing` 영구 고아는 **알려진 한계로 남는다**(복구는 도메인 전이표 변경=별도 승인 필요).

## Performance tradeoffs

- 없음(문서 단계). 구현 시에도 처리는 이미 락 바깥에서 수행되므로 외부 I/O 지연이 직렬화 큐를 막지 않는다. 다만 tick(60초)을 초과하는 느린 처리 시 `isTickRunning` 스킵가드가 다음 tick을 drop(성능 최적화이자 중복 선점 낭비 방지)하며, 이는 데이터 무결성 방어선이 아니라 그 위의 최적화다.

## Side effects

- **[Architect HIGH-1] `JobProcessor` 예외 계약 미정의 위험**: 현재 `process-pending-jobs.use-case.ts:77`의 `await jobProcessor.process(job)`는 try/catch가 없고 `TracingJobProcessor`도 rethrow한다. 실제 외부 I/O 어댑터가 throw하면 **배치 잔여 job 전체가 `processing`에 고착**된다. → 구현 시 **JobProcessor no-throw 계약(모든 오류→`outcome:'failed'`) 명문화 + 유스케이스 per-job try/catch 안전망** 필수(포트/전이 계약 변경 아님).
- **idempotency 검증 시나리오 재정의**: "전송 후 커밋 전 크래시 → 재선점·재처리"는 현행 전이표(`processing→pending` 없음)·`listByStatus('pending')` 선점에서 **구현 불가**. → `failed→pending` PATCH 재시도(retryCount<3, 기존 정책) 경로로 재정의하여 dedupe 차단(또는 at-least-once 수용을 명시적 assertion·문서로) 검증.
- **[PUBLIC 레포] 유출면**: 저장소가 공개(README/HISTORY 공개 커밋). API 키·웹훅 URL은 env-only·기본 off·placeholder. 추가로 `jobs.json`은 .gitignore 대상이 아닌 **추적·커밋 파일**이므로 뉴스 어댑터 실구동 시 런타임 데이터(뉴스 내용·dedupe key)가 커밋될 수 있다 → 실행용 DB 경로 env 분리 또는 데모 후 원복 + 커밋 전 diff 검수.
- **job 유형 판별 부재**: `JOB_PROCESSOR`는 스케줄러 전역 단일 바인딩이고 Job에 type/payload 필드가 없다. 플래그 on 시 API로 만든 **모든 pending job이 뉴스 파이프라인**을 탄다 → 기본값은 "데모 한정 전역 교체 + 한계 문서화"(도메인 무변경).

## Alternatives considered

- **(사용자 후보) 뉴스→Gemini→Slack 단독 = 동시성 구현으로 충분?** → **아니오/불필요.** 공유 JSON 무결성은 job 내용과 무관하게 저장소 계층에서 보장되며 C-1~C-5로 이미 과충분히 증명됨. 뉴스 job은 그 증명에 아무것도 더하지 않는다. 다만 "락-밖 처리 규율·at-least-once/idempotency·timeout"을 **현실적으로 실증하는 데모**로는 가치가 있어, 단독이 아니라 A와 짝지어 C-mock으로 채택.
- **B. 공유 집계(카운터/잔액 이관) lost-update 데모** → 기각. 공유 surface가 이미 단일 JSON 파일이라 C-1/C-3과 증명이 중복, 신규 가치 제한적.
- **C 단독 실호출(비-mock)을 CI에 편입** → 기각. CI 비결정성 + PUBLIC 레포 API 키 노출 위험으로 Driver ①(결정론)·②(안전성) 위배.
- **D. 외부 부수효과 fan-out(dual-write) job** → 기각. dual-write 교육엔 최적이나 해결책(outbox 등)이 단일 JSON 파일 스코프를 초과, 과제 범위 대비 과설계.

## Follow-ups

- (열린 항목) **문서-only vs 구현까지**: 사용자 선택 = **문서-only 확정**. 구현(A+C)은 명시적 실행 승인 시 착수.
- 구현 승인 시 순서(각 bounded slice): (a) no-throw 계약 TSDoc + 유스케이스 try/catch + 예외 고착 회귀 테스트 → (b) slow 더블 + C-4 연장 → (c) 뉴스 어댑터 + mock/idempotency/timeout + SchedulerModule 플래그. 전용 워크트리(Rule1), 완료 시 PR + 3인 리뷰(Rule6).
- **도메인 변경 3종(각각 별도 승인·에스컬레이션)**: ① `processing` 고아 복구(기동 복구 스윕 또는 전이표에 `processing→pending` 추가) ② Job `type` 필드(job 판별) ③ dedupe key 도메인 필드 — ②③은 도메인+영속+DTO+e2e 파급이라 묶음 승인 권장.
- 저장소 문서 드리프트: `tracing-job.processor.ts`·`job-scheduler.adapter.ts` TSDoc이 DI 배선을 `app.module.ts`로 표기하나 실제는 `scheduler.module.ts` → 해당 배선을 건드리는 구현 시 함께 정정.
- Gemini "무료" 티어 약관·지속성은 구현 승인 시점 재확인.
