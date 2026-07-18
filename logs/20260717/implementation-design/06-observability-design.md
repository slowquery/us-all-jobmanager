# 관측성 설계 (Grafana/Loki/Tempo)

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 `logs.txt` 로깅만 명시적으로 요구하지만, 이 저장소의 ADR(Intent Reconciliation
#1)은 스케줄러 가시성 확보를 위해 트레이싱을 **최소 실장으로 확정**했다. 범위는 HTTP 인바운드
스팬 + 스케줄러 tick 스팬(→job별 자식 스팬)이며, 계측은 adapter 계층 한정·도메인 무침투다. 05
([05-logging-design.md](./05-logging-design.md))가 확정한 NDJSON 로그 포맷과 traceId 필드가 본
문서의 입력이다. 본 문서는 필요 로그 종류 카탈로그, 트레이싱 설계, 대시보드 패널, `logs.txt`↔Loki
공존 방안을 확정한다. 코드 계측·docker-compose 구축은 본 세션의 non-goal이며, 본 문서는 구현
세션의 확정 입력이다.

## Chosen design / pattern / technology

### 목표와 범위

로컬 docker-compose(Grafana + Loki + Tempo + Promtail/Alloy)로 스케줄러·API 처리 흐름을 관측
가능하게 만드는 것이 목표다. 실제 docker-compose 파일 작성과 배포는 후속 세션(구현 세션)의
산출물이며, 본 문서는 그 입력이 되는 로그/트레이스/대시보드 설계만 확정한다.

### 필요 로그 종류 카탈로그 (6종)

| # | 로그 종류 | 발생 지점 | 필드/label |
| --- | --- | --- | --- |
| 1 | HTTP 요청 로그 | `LoggingInterceptor`(05) | `traceId`, `method`, `path`, `statusCode`, `latencyMs`, `errorCode?` |
| 2 | 스케줄러 tick 시작/종료/스킵 | `JobSchedulerAdapter`(03) | `traceId`(tick 루트), `tickId`, `event`(`start`\|`end`\|`skip`), `durationMs?`, `skipReason?` |
| 3 | 배치 처리 결과 | `ProcessPendingJobsUseCase`(03) | `traceId`, `tickId`, `batchSize`, `succeeded`, `failed` |
| 4 | 상태 전이 이벤트 | `JobRepository.withTransition`(02) | `traceId`, `jobId`, `from`, `to`, `actor`(`api`\|`scheduler`) |
| 5 | 에러/재시도 | 전역 `ExceptionFilter`(04) + 스케줄러 개별 job 실패 | `traceId`, `errorCode`, `source`(`http`\|`scheduler`), `jobId?`, `retryOf?` |
| 6 | 락 대기·보유 시간 | `JsonDbJobRepository` 직렬화 큐(02) | `traceId`, `jobId`, `waitMs`, `holdMs` |

### 트레이싱 설계 (최소 실장 확정)

**범위는 HTTP 인바운드 스팬 + 스케줄러 tick 루트 스팬 → job별 자식 스팬이며, 계측 지점은 adapter
계층(HTTP: `LoggingInterceptor` 또는 별도 `TracingInterceptor`, 스케줄러: `JobSchedulerAdapter`)에
한정한다. `domain`/`application` 유스케이스는 스팬 생성 API를 직접 호출하지 않는다 — application이
`LoggerPort`에 이벤트 데이터만 전달하듯, 스팬 시작/종료도 adapter가 유스케이스 호출을
`startActiveSpan(...)`으로 감싸는 방식으로 바깥에서 주입한다(도메인 무침투, Rule 3 준수).**

- HTTP 요청: `LoggingInterceptor`가 요청 진입 시 루트 스팬을 열고(`http.method`, `http.route`
  속성), 응답 완료/에러 시 종료한다. 생성된 `traceId`를 05의 로그 라인에 그대로 싣는다.
- 스케줄러: `JobSchedulerAdapter`의 tick 콜백이 tick 루트 스팬을 연다. `ProcessPendingJobsUseCase`가
  개별 job을 처리할 때마다(선점 전이 + 완료 전이, 03 참조) 해당 job의 자식 스팬을 연다
  (`job.id`, `job.transition` 속성). 자식 스팬은 02의 임계구역(락 대기 포함) 구간을 감싸
  락 대기·보유 시간(카탈로그 #6)이 스팬 duration으로도 관측 가능하게 한다.
- **@opentelemetry 도입 범위(Ponytail 판정)**: `@opentelemetry/sdk-node` + `@opentelemetry/exporter-trace-otlp-http`
  최소 2개 패키지만 사용하고, 자동 계측 패키지(`@opentelemetry/auto-instrumentations-node` 등
  HTTP 클라이언트·DB 드라이버까지 훑는 계측 세트)는 도입하지 않는다. 사다리 4단(기존
  프레임워크가 지정하지 않은 신규 의존성)에서 멈추되, 도입 범위를 adapter 2곳(인터셉터,
  스케줄러 어댑터)의 수동 스팬 생성으로 최소화한다 — SDK 초기화(exporter 설정)만 `main.ts`
  부트스트랩에 위치하고 나머지 계층은 API를 호출하지 않는다.
- traceId는 05의 NDJSON 로그 라인과 Tempo 스팬의 트레이스 ID를 동일 값으로 공유해, Grafana에서
  로그 라인 → Tempo 스팬 상호 이동(exemplar/derived field)이 가능하게 한다.

#### traceId 발급·전파 규약 확정

- **① 발급**: traceId는 OTel **active span**의 트레이스 ID를 정본(canonical source)으로 한다 — 별도 UUID 생성 로직을 두지 않는다.
- **② 상시 초기화(정본)**: 로컬 무Tempo 환경(exporter 미연결)에서도 `@opentelemetry/sdk-node`를 `main.ts` 부트스트랩에서 상시 초기화한다. exporter 전송 실패는 스팬 생성·컨텍스트 전파에 무해하며(백그라운드 배치 전송 실패일 뿐), active span은 항상 유효한 **32-hex** 소문자 트레이스 ID를 요청/tick 시작 시점에 발급해 요청 내 상관(correlation)을 보존한다. Tempo 연결 여부와 무관하게 이 경로가 항상 기본값이다.
- **③ 미초기화 한계(fallback)**: SDK 자체가 초기화되지 않은 극단 경로(부트스트랩 실패 등)에서만, 05가 정의하는 것과 동일 형식(32-hex 소문자)의 라인 단위 fallback traceId를 발급한다. 이 fallback은 **요청 내 상관을 보장하지 못한다**(로그 라인마다 독립 생성) — SDK 미초기화라는 예외 경로의 명시적 한계로 남기고, 정상 경로(②)를 대체하지 않는다.
- **④ 전파**: `startActiveSpan(...)`으로 연 스팬의 컨텍스트를 OTel context API가 상속·전파한다. 별도 AsyncLocalStorage 전파 계층을 두지 않는다(Alternatives considered 참조).
- **⑤ 읽기**: traceId를 로그 라인에 싣는 책임은 infrastructure의 `FileLoggerAdapter` 한정이다 — `LoggerPort`를 통해 애플리케이션이 전달한 이벤트 데이터에 발급 시점의 active span traceId를 부여해 기록한다.
- **⑥ 패키지 경계**: `@opentelemetry/api`는 `@opentelemetry/sdk-node`의 **peerDependency**인 별도 인터페이스 패키지다(재노출/번들이 아니며, 글로벌 싱글턴 유지를 위해 SDK와 분리되어 있다 — npm 7+에서는 sdk-node 설치 시 자동 설치됨). #12의 "2패키지"는 **직접 도입을 결정하는 계측 단위**(sdk-node + exporter-trace-otlp-http)를 의미하며, api는 그 전제 인터페이스로 병행 설치될 뿐 별도의 도입 결정 대상이 아니므로 카운트에 포함하지 않는다(07 의존성 게이트 기록 시 api 병행 설치 사실은 명기).

#### 스팬 트리 다이어그램 (텍스트)

```
[HTTP] POST /jobs                                   (LoggingInterceptor 루트 스팬)
  └─ (adapter 계층에서 종료; application/domain 무계측)

[Scheduler] tick#e5f6a7b8 (root span, adapter: JobSchedulerAdapter)
  ├─ job b3f1... : pending → processing            (child span, 02 임계구역 포함)
  ├─ job b3f1... : processing → completed           (child span, 02 임계구역 포함)
  ├─ job 7c2a... : pending → processing              (child span)
  └─ job 7c2a... : processing → failed                (child span)
```

### 대시보드 패널 구성 (5개, 각 소스 명시)

| # | 패널 | 소스 | 쿼리/근거 |
| --- | --- | --- | --- |
| 1 | job 상태 분포 | Loki | `sum by (to) (count_over_time({source=~"http\|scheduler"} \| json \| to != "" [5m]))` — 카탈로그 #4 상태 전이 이벤트(`actor`가 `api`\|`scheduler` 어느 쪽이든 `from`/`to` 필드를 갖는 로그 라인만 `to != ""`로 필터링)를 `to` 필드(전이 후 상태)로 라벨 집계(`count_over_time`은 라인 카운트만 사용하며 `unwrap`과 혼용하지 않는다) |
| 2 | 처리량·지연(p50/p95) | Loki | `quantile_over_time(0.5/0.95, {source="http"} \| json \| unwrap latencyMs [5m])` — 카탈로그 #1의 `latencyMs` |
| 3 | tick 성공률·소요시간 | Loki | `{source="scheduler"} \| json \| event="end"` 필터 후 `succeeded/(succeeded+failed)` 비율과 `durationMs` 시계열 — 카탈로그 #3 |
| 4 | 에러율 | Loki | `sum(rate({level="error"}[5m])) / sum(rate({} [5m]))` — 카탈로그 #5 |
| 5 | 상태 전이 흐름 | Loki | `sum by (from, to) (count_over_time({source... } \| json [1h]))` — 카탈로그 #4를 Sankey/테이블 패널로 시각화 |
| 6 | 락 대기 시간 | Tempo | 스팬 이름 `job.transition` 필터, 스팬 duration 히스토그램(`waitMs` 속성) — 카탈로그 #6, 트레이싱 스팬과 로그 필드 이중 소스 |

(요구 최소 5개를 충족하며 락 대기 시간은 Tempo 소스로 보강해 6번째 패널로 함께 제공한다.)

### logs.txt ↔ Loki 공존 방안

- **(a) 단일 구조화 로그 스트림 → 파일 sink(`logs.txt`) + Promtail/Alloy가 동일 파일 tail**:
  애플리케이션은 `logs.txt` 하나에만 쓰고, Promtail/Alloy가 파일을 tail해 Loki로 전송한다.
- **(b) stdout+파일 이중 출력**: 애플리케이션이 stdout과 `logs.txt`에 각각 별도로 write한다.
- **(c) OTLP 직접 push**: 애플리케이션이 로그 레코드를 OTLP(OpenTelemetry Logs)로 직접
  Loki(또는 OTel Collector)에 push하고, `logs.txt`는 별도 파일 로거로 병행 유지한다.

**Ponytail 평가와 확정: (a)를 채택한다.** `logs.txt`는 05가 이미 NDJSON으로 확정했고, Promtail/Alloy의
`static` 파일 discovery + JSON 파이프라인 스테이지는 별도 코드 없이 설정 파일만으로 라벨(`source`,
`level` 등)을 추출할 수 있다(사다리 4단: 기존 인프라 도구의 표준 설정, 애플리케이션 코드 변경 없음).
(b)는 애플리케이션이 두 출력 경로를 유지해야 해 05가 확정한 "라인당 1회 write" 원자성 보장(05
참조)을 두 배로 반복해야 하고, stdout 캡처(docker 로그 드라이버)와 파일 tail이 같은 이벤트를 중복
집계할 위험이 있다 → 기각. (c)는 애플리케이션 코드에 OTLP 로그 SDK 의존성을 추가로 심어야 하고
(트레이싱 SDK와 별개의 로그 SDK), `logs.txt` 요구를 만족하려면 결국 파일 쓰기도 병행해야 하므로
이중 계측 비용만 늘어난다(사다리 5단 이상, 근거 부족) → 기각.

### Alternatives considered (트레이싱 범위)

- **설계-only(트레이싱을 후속 세션으로 이관)**: 초기 설계안이었으나 사용자 인터뷰에서 기각되었다.
  근거: 스케줄러 가시성이라는 목표에 트레이스(tick→job 계층 구조)가 로그만으로는 표현하기 어려운
  필수 축이며, adapter 계층 한정 최소 계측(HTTP 인터셉터 1곳 + 스케줄러 어댑터 1곳)은 도메인 코드에
  전혀 침투하지 않는 저비용 변경이라 후속 세션으로 미룰 실익이 없다.
- **전 계층 자동 계측(`@opentelemetry/auto-instrumentations-node` 등으로 HTTP 클라이언트·파일
  I/O 등까지 자동 계측)**: 이 저장소는 외부 HTTP 호출이나 별도 DB 드라이버가 없어(node-json-db는
  파일 I/O) 자동 계측 패키지가 실제로 잡아낼 대상이 거의 없고, 의존성 크기와 초기화 복잡도만
  늘어난다. 필요한 스팬은 adapter 2곳의 수동 계측만으로 충분히 표현되므로 과잉 → 기각.

### 헥사고날 배치

- **adapters**: `LoggingInterceptor`/`TracingInterceptor`(HTTP 스팬), `JobSchedulerAdapter`(tick
  루트 스팬). **스팬 생성·계측 API 호출은 이 계층에 한정**된다.
- **infrastructure(좁은 예외)**: `FileLoggerAdapter`는 스팬을 생성하지 않고 `trace.getActiveSpan()`의
  **read-only 컨텍스트 조회만** 수행해 traceId/spanId를 로그 라인에 기입한다 — 위 "⑤ 읽기" 규약과
  정합하며, 계측(스팬 생성) 한정 원칙의 유일한 읽기 전용 예외로 명시한다.
- **application**: `ProcessPendingJobsUseCase`는 job별 처리 결과(성공/실패, 소요 데이터)만
  반환하고, 자식 스팬 생성은 adapter가 유스케이스 호출을 감싸는 방식으로 수행한다(application이
  OpenTelemetry API를 직접 import하지 않음).
- **domain**: 트레이싱에 관여하지 않는다.
- **infrastructure**: `JsonDbJobRepository`의 임계구역 진입/이탈 시각을 락 대기·보유 시간
  필드(카탈로그 #6)로 노출하는 훅만 제공하고, 실제 스팬 생성은 이를 호출하는 adapter(스케줄러
  자식 스팬) 책임으로 유지한다.

## Pros

- 트레이싱 계측이 adapter 2곳에 한정되어, 구현 세션에서 코드 변경 범위가 명확하고 도메인 회귀
  위험이 없다.
- Loki 대시보드 5개+가 05의 로그 카탈로그 필드만으로 구성 가능해, 신규 계측 없이 기존 로그
  스트림을 재사용한다(락 대기 시간만 Tempo 스팬 duration으로 보강).
- (a) 공존 방안은 애플리케이션 코드에 Loki 전송 로직을 전혀 추가하지 않아, 05의 `logs.txt`
  단일 소스 원칙을 그대로 유지한다.

## Cons

- Promtail/Alloy·Tempo·Grafana 프로비저닝(docker-compose, 데이터소스 연결)은 본 세션에서
  검증되지 않으므로, 실제 구현 세션에서 설정 오류(라벨 파싱 실패 등)가 드러날 수 있다.
- adapter 한정 계측은 02의 임계구역 내부 세부 단계(guard 평가 vs 실제 write)까지는 구분하지
  않는다 — 필요 시 자식 스팬을 추가 세분화하는 것은 Follow-ups로 남긴다.

## Performance tradeoffs

- 스팬 생성·종료는 tick당 최대 20회(03의 배치 10건 × 2단 전이)와 요청당 1회로 상한이 있어, 05의
  로그 볼륨과 동일한 규모의 오버헤드다.
- OTLP exporter를 배치 전송(batch span processor)으로 구성하면 스팬 종료가 네트워크 I/O를
  블로킹하지 않는다(구현 세션 결정 사항으로 명시, 본 문서는 방향만 확정).

## Side effects

- traceId가 05의 로그 라인과 Tempo 스팬 양쪽에 실리므로, 운영자는 Grafana에서 로그↔트레이스를
  오갈 수 있지만 두 시스템의 traceId 형식은 위 "traceId 발급·전파 규약 확정" 절이 정한 32-hex
  소문자 OTel active span 정본을 05의 `LoggerPort`가 그대로 수용한다(발급 지점 확정 완료).
- `@opentelemetry/sdk-node` 도입은 07의 신규 의존성 도입 게이트를 경유해야 한다(R7).

## Alternatives considered

- **설계-only(트레이싱 후속 이관)**: 위 "Alternatives considered (트레이싱 범위)" 절에서
  사용자 인터뷰 기각 근거와 함께 이미 기록됨(요약: 스케줄러 가시성에 트레이스가 필수 축, adapter
  한정 최소 계측은 저비용).
- **전 계층 자동 계측**: 계측 대상 부재 + 의존성 비대화로 기각(위 절 참조).
- **(b) stdout+파일 이중 출력** / **(c) OTLP 직접 push**(공존 방안): 위 "logs.txt ↔ Loki 공존
  방안" 절에서 각각 원자성 보장 중복과 이중 계측 비용을 근거로 기각.

## Follow-ups

- docker-compose 기반 Grafana/Loki/Tempo/Promtail(또는 Alloy) 로컬 구축은 본 세션 non-goal —
  코드 구현 세션의 산출물이다.
- 코드 계측(`LoggingInterceptor`/`TracingInterceptor`/`JobSchedulerAdapter`에 실제
  OpenTelemetry API 호출 삽입, `@opentelemetry/sdk-node` 설치)도 non-goal — 구현 세션에서
  수행하며, 07의 신규 의존성 게이트를 경유한다.
- 02의 임계구역 내부 세부 단계(guard 평가/write)를 자식 스팬으로 더 세분화할지는 실측 트레이스
  데이터 확보 이후 재검토한다.
