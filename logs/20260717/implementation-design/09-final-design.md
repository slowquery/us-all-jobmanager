# 최종 설계 — 사용자 컨펌 확정본 (통합 설계 문서)

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc (사용자 컨펌 세션)
- Status: accepted

## Context

01~08 결정 로그와 3인 리뷰(설계/보안/성능)의 장단점을 사용자가 항목별로 확인·선택하는 컨펌 세션을 거쳐 최종 설계를 확정했다. 본 문서는 그 확정본이며, 개별 결정 로그와 달라진 항목은 아래 "supersede 목록"에 명시한다. **본 문서가 구현 세션의 단일 정본(single source of truth)이다** — 충돌 시 본 문서가 01~08에 우선한다.

### 사용자 컨펌 결정 요약 (14건)

| # | 항목 | 확정 | 출처 |
|---|---|---|---|
| 1 | 상태 전이 | enum + 전이 테이블 + 순수 guard | 01 원안 |
| 2 | 동시성 | 직렬화 큐 + **얇은 배치 트랜잭션 `withBatch`** | 02 원안 + UoW 실질 가치 편입 |
| 3 | 스케줄러 | @Interval + overrun 스킵 + **얇은 Strategy**; 큐/워커는 확장 경로로만 | 03 원안 + Strategy 승격 |
| 4 | API 검증 | class-validator + ValidationPipe + 전역 ExceptionFilter | 04 원안 |
| 5 | 로깅 | 전역 Interceptor + 명시적 logger + NDJSON | 05 원안 |
| 6 | 검증 실패 코드 | **400 Bad Request** (파이프 기본값, 설정 최소화) | 04 supersede |
| 7 | tick/배치 | 60초 / 10건 | 03 원안 |
| 8 | 스케줄러 테스트 | 수동 tick 트리거 | 08 원안 |
| 9 | 재시도 | **`retryCount` 필드 + 최대 3회 상한** | 01 Follow-up 승격 |
| 10 | 로그 쓰기 | **단일 write stream** (fd 재사용) | 05 supersede(성능 리뷰 권고) |
| 11 | 보안 조항 | 500 내부정보 노출 금지 + 요청 body 로깅 금지 | 보안 리뷰 권고 명문화 |
| 12 | 트레이싱 | Tempo 최소 실장(adapter 한정·도메인 무침투) | ralplan 인터뷰 확정 |
| 13 | Ponytail | `.gjc/rules/60-ponytail.md` 후속 편입 + 과도기 결정 로그 관행 | ralplan 인터뷰 확정 |
| 14 | 이중 대기열 | 인메모리 큐/워커 **현 시점 미도입** — "처리가 실작업을 갖는 시점"의 확장 경로로만 명시 | 의미 확인 후 재확정 |

## Chosen design / pattern / technology

### 아키텍처 개요 (헥사고날)

```
adapters                 application(+ports)            domain                infrastructure
─────────────────────    ──────────────────────────     ──────────────────    ─────────────────────────
JobsController(HTTP) ─▶  CreateJob/GetJobs/SearchJobs   Job 엔티티            JsonDbJobRepository
SchedulerAdapter     ─▶  PatchJobUseCase           ─▶   JobStatus enum   ◀─   (직렬화 큐 + 임계구역:
(@Interval, 스킵플래그)   ProcessPendingJobsUseCase      전이 테이블            atomic read→guard→write,
LoggingInterceptor        │ JobRepository 포트 호출      canTransition guard    withTransition/withBatch)
ExceptionFilter           ▼                              (순수 함수)           LoggerPort 구현(write stream)
OTel 스팬(계측 한정)      JobProcessor Strategy                                OTel SDK 부트스트랩(main.ts)
```

의존성은 안쪽으로만. 도메인/유스케이스에 `@nestjs/*` 금지(Rule 3).

### 도메인 모델

```ts
type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
interface Job {
  id: string;          // uuid
  title: string;
  description: string;
  status: JobStatus;
  retryCount: number;  // 확정 #9: 0으로 생성, failed→pending 재시도 시 +1, 최대 3
  createdAt: string;   // ISO8601
  updatedAt: string;
}
```

전이 테이블(01) + 재시도 상한(확정 #9):

| from \ to | pending | processing | completed | failed |
|---|---|---|---|---|
| pending | — | 스케줄러 | — | — |
| processing | — | — | 스케줄러 | 스케줄러 |
| failed | **PATCH (retryCount < 3일 때만)** | — | — | — |
| completed | — | — | — | — |

`canTransition(job, target)`은 순수 함수이며 retryCount 상한 검사를 포함한다. 상한 초과 재시도는 guard가 거부하고 API는 409 `RETRY_LIMIT_EXCEEDED`를 반환한다.

### 동시성 계약 (02 + 확정 #2)

- 모든 상태 전이는 infrastructure의 직렬화 큐(단일 writer) 임계구역에서 **atomic read→guard→write**(guard-in-lock)로 수행. node-json-db 자체 ReadWriteLock은 개별 호출 단위 보호일 뿐 compound RMW(TOCTOU)는 앱 큐가 담당(역할 분리).
- **`withBatch(jobIds, transitionFn)` 신설**: 임계구역 1회 진입 → 스냅숏 read 1회 → N건 각각 guard 평가·적용(거부 건은 스킵, 결과에 표기) → 파일 write 1회로 원자 커밋. 배치 원자성(03의 알려진 약점) 해소 + tick당 파일 rewrite 20회→2회(선점 1회 + 완료 1회).
- 포트: `JobRepository { findById, list, search, create, withTransition(id, target, patch?), withBatch(ids, fn), listByStatus(status, limit) }`.

### 스케줄러 (03 + 확정 #3·#7·#14)

- `@Interval(60_000)`, 배치 최대 10건, `isTickRunning` 플래그로 overrun 스킵(스킵 사실은 로그 카탈로그에 기록).
- 파이프라인: `listByStatus('pending', 10)` → `withBatch`로 pending→processing 선점 → **`JobProcessor` Strategy**(상태/유형별 처리기 인터페이스, 현재 구현체 1개) 실행 → `withBatch`로 completed/failed 커밋.
- **확장 경로(현 시점 미도입)**: job "처리"가 외부 API 호출 등 직렬화되지 않는 실작업을 갖게 되면 인메모리 큐+워커를 Strategy 뒤에 도입한다. 그 시점의 필수 설계: jobId dedup, 파일=정본 원칙(크래시 시 다음 tick 재적재), 큐 대기시간 지표 추가(06). 현재는 처리=전이뿐이라 이중 대기열이 순비용임을 확인하고 미도입 확정.

### API 계층 (04 + 확정 #4·#6)

- class-validator DTO + 전역 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` + 전역 ExceptionFilter의 일관 에러 envelope `{ code, message, details? }`.
- **검증 실패는 400** (파이프 기본값 — 04의 422 채택을 supersede, errorHttpStatusCode 설정 제거).
- 상태 코드: 201(POST), 200(GET/PATCH), 400(검증 실패), 404(NOT_FOUND), 409(INVALID_TRANSITION / RETRY_LIMIT_EXCEEDED), 500(INTERNAL).
- PATCH: `title`/`description`/`status`(단, status는 `'pending'` 단일 열거 = failed→pending 재시도 전용). DTO 검증은 락 밖, 전이 guard는 락 안.
- 검색: `GET /jobs/search?title=<부분일치>&status=<enum>`.

### 로깅 (05 + 확정 #5·#10·#11)

- HTTP: 전역 LoggingInterceptor. 스케줄러: tick 시작/종료/스킵·배치 결과를 명시적 logger 호출. 공통 sink는 `LoggerPort` → **단일 write stream**(`fs.createWriteStream(logs.txt, { flags: 'a' })`, fd 재사용, 라인당 1회 write, 로깅 실패는 catch 격리로 요청에 비전파).
- 포맷: NDJSON 1줄 = 1이벤트, traceId 필드 포함(06 Loki 상관).
- **보안 조항(확정 #11)**: ① 500 응답 body에 스택/내부 경로/드라이버 메시지 노출 금지 — ExceptionFilter가 `{ code: 'INTERNAL', message: '서버 오류' }`로 고정하고 상세는 logs.txt에만 기록. ② 요청 body는 로깅하지 않는다 — method/path/status/duration/traceId만. (title/description 등 사용자 입력이 로그로 흘러가는 것 차단.)

### 관측성 (06 + 확정 #12)

- 트레이싱: Tempo 최소 실장 확정 — HTTP 인바운드 스팬 + 스케줄러 tick 루트 스팬→job별 자식 스팬. 계측은 adapter 2곳 한정, 도메인 무침투. `@opentelemetry/sdk-node` + otlp exporter 2패키지만.
- 로그 수집: logs.txt(NDJSON)를 Promtail/Alloy가 tail(이중 기록 없음). 대시보드 패널 6종(상태 분포, 처리량·지연 p50/p95, tick 성공률·소요, 에러율, 전이 흐름, 락 대기 — 각 Loki/Tempo 소스는 06 참조).
- docker-compose 구축·계측 코드는 구현 세션 산출물.

### 테스트 (08 + 확정 #8)

- domain guard 순수 유닛(retryCount 상한 케이스 포함) / usecase 유닛(포트 목) / adapter e2e(supertest + 임시 파일 격리·teardown).
- 스케줄러: 수동 tick 트리거(데코레이터/유스케이스 분리 활용, fake timer 기각).
- 동시성 회귀: 02 race 시나리오를 Promise.all로 재현 — ① failed 시딩 + PATCH pending ×2(1성공/1거부 409, 최종 pending 1회 전이) ② PATCH↔스케줄러 배치(무손실 + 무효 전이 방지). **withBatch 원자성 테스트 추가**: 배치 중 일부 거부 시에도 write 1회·스냅숏 일관 커밋 assert.

## Pros
- 사용자 컨펌을 거친 결정만 담겨 구현 세션에서 재논쟁 여지가 없다(문서 충돌 시 우선순위도 명시).
- withBatch가 UoW의 실질 가치(원자 배치)와 성능 권고(rewrite 감소)를 동시에 흡수 — 추상화 비용 없이.
- 보안·성능 리뷰 권고가 설계 조항으로 승격되어 구현 누락 시 리뷰에서 잡을 근거가 생겼다.

## Cons
- 400 채택으로 "형식 오류 vs 규칙 위반"의 의미론적 구분(422)을 포기 — 설정 최소화와 맞바꿈.
- retryCount 도입으로 스키마·guard·API 에러 코드가 01~04 문서 대비 확장됨(supersede 목록으로 추적).
- Strategy 인터페이스는 현재 구현체 1개라 당장은 간접층 1개 비용(사용자 확정으로 감수).

## Performance tradeoffs
- withBatch로 tick당 파일 rewrite 20회→2회(선점/완료 각 1회). 단일 write stream으로 로그 open/close 비용 제거.
- 직렬화 큐 처리량 상한(임계구역 1회 시간의 역수)은 유지 — 60초/10건 스코프에서 여유 충분(03 논증).

## Side effects
- 01·02·03·04·05의 개별 결정 일부가 본 문서로 supersede됨(아래 목록). 구현은 본 문서를 따르고, 개별 로그는 이력으로 보존.
- retryCount는 jobs.json 샘플 데이터 스키마에도 반영 필요(02 시딩 전략).

## Alternatives considered
- **완전한 UoW(롤백 추적 계층)**: 컨펌 과정에서 재확인 — node-json-db에 롤백 프리미티브가 없어 실질 대상 부재, withBatch로 대체 확정.
- **인메모리 큐/워커 즉시 도입**: 이중 대기열 의미(②워커 큐 대기 + ①직렬화 큐 대기 합산, 처리량 이득 0, 크래시 시 큐 유실) 확인 후 확장 경로로 강등 확정.
- **422 + errorHttpStatusCode**: 의미론적 구분 이점에도 설정 최소화 우선으로 400 확정.
- **무제한 재시도**: 무한 루프 차단 우선으로 상한 3회 확정.

## Follow-ups
- supersede 목록(구현 시 본 문서 우선): ① 04 §검증 실패 422 → **400**, ② 01 §Follow-up retryCount 보류 → **채택(3회)** + guard·전이표 확장, ③ 02 §포트 → **withBatch 추가**, ④ 03 §Strategy 이연 → **얇은 Strategy 채택** + 큐/워커 확장 경로 명시, ⑤ 05 §appendFile → **단일 write stream**, ⑥ 05·04 → **보안 조항 2건 명문화**.
- `.gjc/rules/60-ponytail.md` 편입 세션(Rule 5 승인 경유) — 07 초안 골격 사용.
- 코드 구현 세션: 본 문서를 정본 입력으로 별도 진행(트레이싱 계측·docker-compose 포함).
