# 스케줄러 어댑터(`src/adapters/scheduler`)

Job 처리기(백그라운드 스케줄러)의 흐름도. 정본 설계 문서: `logs/20260717/implementation-design/09-final-design.md`(최우선) + `03-scheduler-processing-design.md`.

## 목차

1. [역할·트리거](#1-역할트리거)
2. [함수 흐름](#2-함수-흐름)
3. [구조도](#3-구조도)
4. [상태 전이 연계](#4-상태-전이-연계)
5. [실패·재시도](#5-실패재시도)

## 1. 역할·트리거

- `JobSchedulerAdapter`는 `@nestjs/schedule`의 `@Interval(SCHEDULER_TICK_MS)`(60초, 09 확정 #7)가 붙은
  `tick()` 메서드로 주기 트리거된다.
- 이 어댑터의 책임은 **"tick이 실행되어도 되는가"**(overrun 스킵 판단)와 **tick 시작/종료/스킵 로그
  발행**뿐이다. 실제 pending job 조회·전이·처리는 전부 `ProcessPendingJobsUseCase`(application 계층,
  S5 소유 파일 `src/application/use-cases/process-pending-jobs.use-case.ts`)에 위임한다(03의
  adapter/application 분리 — 08의 "수동 tick 트리거" 결정론적 테스트 전략의 전제 조건).
- `@nestjs/schedule`이 자동으로 호출하는 것과 별개로, `tick()`은 인자 없는 공개 메서드이므로 테스트나
  운영 도구가 수동으로도 직접 호출할 수 있다(fake timer 없이 결정론적 검증, 08 확정).
- 모듈(`app.module.ts`) 등록은 이 세션(S5)의 책임이 아니다 — S6가 `JobSchedulerAdapter`를
  `AppModule`의 provider로 등록한다.

## 2. 함수 흐름

```
tick() 호출
  │
  ├─ tickId 발급(randomUUID)
  │
  ├─ skipGuardEnabled && isTickRunning === true?
  │     └─ Yes → LoggerPort.log({ type: 'tick', phase: 'skipped', tickId }) 후 즉시 반환
  │
  ├─ isTickRunning = true
  ├─ LoggerPort.log({ type: 'tick', phase: 'start', tickId })
  │
  ├─ try:
  │     └─ ProcessPendingJobsUseCase.execute() await
  │           (pending 조회 → processing 선점 → JobProcessor 처리 → completed/failed 커밋
  │            → 커밋 job별 transition 이벤트 emit → batch 집계 로그, 03/05 참조)
  │     └─ LoggerPort.log({ type: 'tick', phase: 'end', tickId, durationMs })
  │
  └─ finally:
        └─ isTickRunning = false
```

- `isTickRunning`은 인프로세스 boolean 플래그이며 `tick()` 진입부터 처리 완료(성공/실패 무관)까지
  true를 유지한다(`finally`에서 해제 보장).
- `skipGuardEnabled` 생성자 옵션(기본값 `true`)으로 이 가드 자체를 끌 수 있다 — 08 C-4(tick 중복
  재현) 테스트 전용 주입점이며, 기본값(가드 켜짐)이 03이 정한 정본 동작이다.

## 3. 구조도

```
adapters                          application(+ports)                infrastructure
──────────────────────────────    ────────────────────────────────    ─────────────────────────
JobSchedulerAdapter           ─▶  ProcessPendingJobsUseCase       ─▶  JsonDbJobRepository
  @Interval(SCHEDULER_TICK_MS)      1. listByStatus('pending', 10)      (직렬화 큐 + 임계구역:
  isTickRunning 스킵 가드            2. withBatch(.., 'processing')       atomic read→guard→write)
  tick 시작/종료/스킵 로그            3. JobProcessor.process(job)×N
                                    4. withBatch(.., 'completed'|'failed')  LoggerPort 구현체
                                    5. 커밋 job별 transition 이벤트 emit     (FileLoggerAdapter,
                                       (actor='scheduler')                  infrastructure 소유)
                                    6. batch 집계 로그
```

- `@nestjs/schedule` 의존은 이 adapter 계층에 한정된다(Rule 3, domain/application 무침투).
- `JobSchedulerAdapter` → `ProcessPendingJobsUseCase` → `JobRepository`/`LoggerPort`(포트) 순으로만
  의존하며, adapter는 포트 구현체(`JsonDbJobRepository`, `FileLoggerAdapter`)를 직접 알지 못한다(DI
  경유, 등록은 S6).

## 4. 상태 전이 연계

- 01의 전이 테이블 중 스케줄러가 담당하는 두 전이: `pending → processing`(선점), `processing →
  completed | failed`(처리 결과 커밋). 두 전이 모두 `JobRepository.withBatch`를 경유해 02의 atomic
  read→guard→write(guard-in-lock)를 통과한다 — adapter는 이 계약의 구현 세부를 알지 못한다.
- 05-logging-design.md "상태 전이 이벤트" 절에 따라, 커밋에 성공한 job마다 `transition` 로그 이벤트
  (`jobId`, `from: 'processing'`, `to: 'completed' | 'failed'`, `actor: 'scheduler'`)가 발행된다. 이
  emit은 `ProcessPendingJobsUseCase`(actor를 아는 계층, S3 이관 책임)가 담당하며 `JobSchedulerAdapter`는
  관여하지 않는다.
- `tick` 이벤트(`start`/`end`/`skipped`)와 `transition`/`batch` 이벤트는 서로 다른 `LogEvent` 유형이며
  (`logger.port.ts` `TickLogEvent`/`TransitionLogEvent`/`BatchLogEvent`), 동일 `logs.txt`에 NDJSON
  한 줄씩 기록된다(05 단일 write stream).

## 5. 실패·재시도

- **개별 job 처리 실패**: `JobProcessor.process(job)`이 `'failed'`를 판정하면 해당 job은
  `processing → failed`로 커밋되고 tick 자체는 계속 진행한다(한 job의 실패가 배치 전체를 막지
  않음). 실패 job의 재시도는 스케줄러가 아니라 API(`PATCH /jobs/:id`, `failed → pending`,
  `retryCount < 3`)를 통해 사용자가 트리거한다(01/09 확정 #9) — 스케줄러는 자동 재시도를 수행하지
  않는다.
- **배치 중 일부만 커밋되고 프로세스가 종료되는 경우**: `withBatch`는 트랜잭션이 아니므로(02·03이
  명시적으로 UoW를 기각) 배치 원자성은 보장하지 않는다. 미처리로 남은 job은 여전히 `pending` 또는
  `processing` 상태로 남고, 다음 tick의 `listByStatus('pending', ..)` 조회가 자연 복구한다(03의
  "다음 tick이 다시 pending을 조회하면 스킵된 job도 함께 잡힌다" 근거).
- **tick 겹침(overrun)**: 이전 tick이 60초 내에 끝나지 않아 다음 tick이 발화하면, `isTickRunning`
  가드(기본 켜짐)가 새 tick을 스킵(drop)한다. 이는 데이터 무결성 방어선이 아니라 02의
  guard-in-lock 위에 얹는 성능 최적화다 — 가드가 없어도(테스트 전용 `skipGuardEnabled=false`) 개별
  job 전이는 여전히 02의 atomic read→guard→write를 통과하므로 무효 전이는 발생하지 않고, 다만 중복
  선점 시도로 인한 직렬화 큐 대기 낭비가 관측된다(08 C-4).
- **로깅 실패 격리**: `LoggerPort.log()` 호출이 실패해도(예: 파일 I/O 오류) 이 adapter의 tick
  처리 흐름에는 영향을 주지 않는다 — 이는 `LoggerPort` 구현체(`FileLoggerAdapter`, infrastructure
  소유)가 보장하는 계약이며, 이 adapter는 그 계약을 신뢰하고 별도 방어 코드를 두지 않는다.
