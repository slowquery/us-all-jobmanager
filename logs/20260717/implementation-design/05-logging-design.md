# 요청/처리 로깅 설계 (logs.txt)

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 "모든 요청을 `logs.txt`에 로깅"(API)과 "처리 결과를 `logs.txt`에 로깅"(스케줄러)을
각각 명시적으로 요구한다. 03([03-scheduler-processing-design.md](./03-scheduler-processing-design.md))은
tick 시작/종료/스킵 로그 항목 정의를 본 문서로 위임했고, 04([04-api-layer-design.md](./04-api-layer-design.md))는
5개 엔드포인트의 성공/실패 응답과 에러 envelope(`code/message/details`)을 확정했다. 본 문서는 이 두
문서가 남긴 "로깅 지점"을 실제로 어디서·어떤 패턴으로·어떤 포맷으로 `logs.txt`에 기록할지 확정한다.
06([06-observability-design.md](./06-observability-design.md))이 Loki 수집을 전제로 로그 포맷을
재사용하므로, 본 문서에서 확정하는 포맷이 관측성 설계의 입력이 된다(Sequencing: 05→06).

## Chosen design / pattern / technology

### 로깅 대상 정의

- **HTTP 요청/응답**: 모든 요청 1건당 1개 로그 라인(method, path, status, latency, traceId).
  04가 정의한 에러 envelope의 `code`도 실패 응답에 포함한다.
- **스케줄러 tick·배치 결과**: tick 시작/종료/스킵(overrun) 1건, 배치 완료 시 처리 건수·성공·실패
  집계 1건(03이 정의한 최대 10건/tick, 선점+완료 2단 전이 대상).
- **에러**: 요청 처리 중 발생한 4xx/5xx와 스케줄러 개별 job 처리 실패를 모두 별도 식별 가능하게
  기록한다(에러 전용 별도 파일을 신설하지 않고, 동일 `logs.txt`에 `level=error`로 구분 — 03·04가
  요구하는 로깅 지점을 단일 스트림에서 커버하는 것이 R2 리스크 완화의 핵심).
- **상태 전이 이벤트**: `jobId`, `from`→`to`, `actor`(`api`|`scheduler`) 1건(06 로그 카탈로그 #4와
  정합). emit 지점은 `JobRepository.withTransition`의 성공 경로 — 02의 atomic read→guard→write
  임계구역에서 guard가 참으로 평가되어 커밋이 완료된 직후, 임계구역을 벗어나기 전에 1회 기록한다
  (거부된 전이는 이 이벤트를 남기지 않고 위 "에러" 항목의 `INVALID_TRANSITION`으로만 기록됨).
- **락 대기·보유 시간**: `jobId`, `waitMs`(임계구역 진입 대기 시간), `holdMs`(임계구역 점유 시간)
  1건(06 로그 카탈로그 #6과 정합). emit 지점은 `JsonDbJobRepository`의 직렬화 큐 임계구역
  진입 시각(대기 종료)과 이탈 시각(처리 완료)을 각각 측정해 두 값을 계산한 뒤, 임계구역을 벗어난
  직후 1회 기록한다.

### 후보 패턴 비교

- **(a) NestJS Interceptor(HTTP) + 명시적 logger 호출(스케줄러)**: `LoggingInterceptor`가
  `NestInterceptor.intercept()`에서 요청 진입 시각을 기록하고 `pipe(tap/catchError)`로 응답
  완료(성공/실패) 시점에 1회 로깅한다. 스케줄러는 03의 adapter(`JobSchedulerAdapter`)와
  application(`ProcessPendingJobsUseCase`)이 tick 시작/종료/스킵·배치 집계 시점에 공통
  `AppLogger`(아래 (d) 참조)를 직접 호출한다.
- **(b) Middleware**: Express 스타일 미들웨어(`NestMiddleware`)가 요청 진입 시 등록되어 응답
  `res.on('finish')` 이벤트에서 로깅한다.
- **(c) 커스텀 Decorator**: `@LogRequest()` 같은 메서드 데코레이터를 각 컨트롤러 핸들러에 붙여
  메타데이터 기반으로 로깅 로직을 주입한다.
- **(d) 전역 Logger 서비스 추상화(port)**: `application`/`infrastructure` 경계에 `LoggerPort`를
  두고 NestJS `Logger`(또는 파일 append 구현체)를 어댑터로 주입한다. HTTP 로깅 패턴 (a)/(b)/(c)와
  독립적으로, 어떤 방식이든 최종 기록 지점을 통일하기 위한 보조 축이다.

### Ponytail 사다리 판정

**HTTP 로깅은 (a) Interceptor를 채택하며 사다리 3단(플랫폼 네이티브)에서 멈춘다. 스케줄러 로깅은
03의 adapter/application 계층에서 명시적 `logger.log(...)` 호출로 처리하며 이 역시 3단이다. 파일
쓰기 지점은 (d) 얇은 `LoggerPort`(사다리 5~6단, 한 줄 래퍼)로 통일한다.**

- (b) Middleware는 요청이 컨트롤러에 도달하기 전에 실행되어 응답 상태 코드·본문을 알기 위해
  `res.on('finish')` 콜백에 의존해야 하는데, 이는 NestJS가 `NestInterceptor`로 이미 1급 제공하는
  "핸들러 전/후 개입" 지점을 우회 재구현하는 것이다. Interceptor는 `Observable` 파이프라인으로
  성공/에러 두 경로를 모두 자연스럽게 잡아내지만(`tap`/`catchError`), Middleware는 예외
  필터(04의 전역 `ExceptionFilter`)가 응답을 재작성하는 시점과의 순서 보장이 불명확해 상태 코드를
  놓칠 위험이 있다 → 플랫폼이 더 적합한 도구를 이미 제공하므로 기각.
- (c) 커스텀 Decorator는 5개 엔드포인트 "전체"에 예외 없이 적용해야 하는 요구(REQUIREMENTS: "모든
  요청")를 컨트롤러마다 데코레이터 부착 여부에 의존하게 만든다 — 하나라도 누락하면 로깅 공백이
  생기는 실패 모드를 코드가 스스로 허용한다. Interceptor는 `APP_INTERCEPTOR`로 전역 등록하면
  누락 가능성 자체가 없다. 메타프로그래밍(데코레이터 팩토리 + 리플렉션)으로 얻는 이득이 없이
  복잡도만 추가 → 과잉(Ponytail 6단 최소 커스텀보다 나쁜, 근거 없는 4단 상당의 우회) → 기각.
- (d)는 HTTP/스케줄러 두 진입 지점이 물리 파일(`logs.txt`) append라는 동일한 부수효과를 공유하므로,
  중복 파일 핸들 관리·포맷 직렬화 로직을 한 곳(`LoggerPort` 구현체)에 모으는 것이 자연스럽다. 이는
  새로운 추상화 계층을 위한 계층이 아니라, 두 호출자(Interceptor, 스케줄러 adapter)가 같은
  I/O 자원을 안전하게 공유하기 위한 최소 접점이다 — 사다리를 거스르지 않는다(순수 로깅 유틸리티
  함수 하나로 표현 가능하며 DI 포트로 감싸는 이유는 08의 테스트 목적 대체 가능성 때문).

### 로그 라인 포맷 결정

**구조화 JSON 1줄(JSON Lines, NDJSON)로 확정한다.** 텍스트(비정형 문자열) 포맷 대신 JSON을 선택하는
근거는 06의 Loki 수집 방식(옵션 (a) 단일 스트림 파일 sink + Promtail/Alloy tail, 06에서 확정)이
필드 기반 파싱·라벨 추출을 전제하기 때문이다. Promtail/Alloy의 JSON 파이프라인 스테이지는 텍스트
정규식 파싱보다 필드 추출이 안정적이고, `logs.txt`를 그대로 Loki 라벨/필드로 승격할 수 있어 이중
포맷 변환 계층이 필요 없다(R2: logs.txt와 Loki 요구 충돌을 단일 소스로 해소). 다만 REQUIREMENTS는
"logs.txt"라는 파일명만 요구하고 포맷은 자유이므로, 사람이 읽을 때는 `jq`로 즉시 pretty-print
가능한 NDJSON이 실용적 타협점이다.

공통 필드: `timestamp`(ISO 8601), `level`(`info`|`error`), `traceId`(06이 정의하는 트레이스
컨텍스트와 연동, 요청/1 tick당 1개 생성), `source`(`http`|`scheduler`), `message`. 이후 이벤트별
전용 필드가 추가된다.

### logs.txt 포맷 예시 (5건)

1) 요청 1건 (성공):
```json
{"timestamp":"2026-07-17T09:00:00.123Z","level":"info","traceId":"a1b2c3d4-...","source":"http","message":"request completed","method":"POST","path":"/jobs","statusCode":201,"latencyMs":12}
```

2) 스케줄러 배치 1건 (tick 종료 집계):
```json
{"timestamp":"2026-07-17T09:01:00.045Z","level":"info","traceId":"e5f6a7b8-...","source":"scheduler","message":"tick completed","tickId":"e5f6a7b8-...","batchSize":10,"succeeded":8,"failed":1,"skipped":0,"durationMs":340}
```

3) 에러 1건 (PATCH 무효 전이):
```json
{"timestamp":"2026-07-17T09:02:11.900Z","level":"error","traceId":"c9d0e1f2-...","source":"http","message":"request failed","method":"PATCH","path":"/jobs/b3f1...","statusCode":409,"errorCode":"INVALID_TRANSITION","latencyMs":5}
```

4) 상태 전이 이벤트 1건 (재시도 성공, `failed→pending`):
```json
{"timestamp":"2026-07-17T09:02:12.010Z","level":"info","traceId":"c9d0e1f2-...","source":"http","message":"transition committed","jobId":"b3f1...","from":"failed","to":"pending","actor":"api"}
```

5) 락 대기/보유 시간 1건 (임계구역 진입/이탈 측정):
```json
{"timestamp":"2026-07-17T09:02:12.008Z","level":"info","traceId":"c9d0e1f2-...","source":"http","message":"lock section measured","jobId":"b3f1...","waitMs":2,"holdMs":6}
```

### 파일 append의 동시 쓰기 안전성

HTTP 요청(다중 동시 접속)과 스케줄러(단일 tick, 03이 정의한 순차 job 처리)가 동일한 `logs.txt`에
동시에 append할 수 있다. 이는 02가 다루는 job 데이터 동시성과 별개의 문제(02의 `JobRepository`
트랜잭션 경계와 무관한 로깅 I/O)이므로, 02의 직렬화 큐를 재사용하지 않는다. 대신 Node.js
`fs.appendFile`/`fs.createWriteStream({flags:'a'})`은 단일 프로세스 내에서 각 write 시스템 콜이
POSIX상 원자적으로 커널 버퍼에 append되므로(한 줄 = 한 write 호출인 한, 즉 로그 라인 직렬화 후
개행 포함 단일 문자열로 1회 write), 애플리케이션 레벨의 추가 락 없이 라인 단위 무결성이 보장된다.
`LoggerPort` 구현체는 라인당 정확히 1회의 append 호출만 수행하도록 강제한다(여러 필드를 여러
write로 나누지 않음). 멀티 프로세스(클러스터 모드)로 확장하지 않는 한(과제 스코프 밖, 단일
프로세스 가정은 02·03과 동일) 이 보장으로 충분하며, 이는 새로운 파일 락 라이브러리를 도입할
근거가 없음을 의미한다(Ponytail 1단: 생략 가능).

### 헥사고날 배치

- **adapters**: `LoggingInterceptor`(`@nestjs/common`의 `NestInterceptor`, `APP_INTERCEPTOR`로
  전역 등록)가 HTTP 요청/응답 로깅을 담당한다. 03의 `JobSchedulerAdapter`가 tick 시작/종료/스킵
  로그를 `LoggerPort` 호출로 남긴다. `@nestjs/*` 의존은 이 계층에 한정된다.
- **application**: `ProcessPendingJobsUseCase`가 배치 집계(건수/성공/실패)를 계산해 `LoggerPort`에
  전달한다(로그 포맷 자체는 모르고, 구조화된 이벤트 데이터만 넘긴다 — 포맷 조립은 infrastructure
  책임).
- **domain**: 로깅에 관여하지 않는다(도메인 순수 함수는 로거를 호출하지 않는다 — Rule 3의
  `@nestjs/*` 무침투 원칙을 로거 의존에도 동일 적용).
- **infrastructure**: `LoggerPort`의 구현체(`FileLoggerAdapter`)가 NDJSON 직렬화·`logs.txt`
  append·traceId 컨텍스트 주입을 수행한다. 06의 Promtail/Alloy가 tail하는 대상 파일이 바로 이
  구현체가 쓰는 파일이다.

## Pros

- Interceptor 전역 등록으로 "모든 요청" 로깅 누락 가능성이 구조적으로 제거된다.
- NDJSON 단일 포맷이 `logs.txt`(과제 필수)와 Loki 수집(06)을 동시에 만족해 이중 포맷 유지 비용이
  없다.
- `LoggerPort` 분리로 08이 테스트 시 로거를 인메모리 더블로 교체해 파일 I/O 없이 로깅 호출 여부를
  검증할 수 있다.

## Cons

- NDJSON은 텍스트 로그보다 사람이 터미널에서 바로 읽기엔 밀도가 높다(README에 `tail -f logs.txt |
  jq` 사용법을 명시해 완화, Follow-ups).
- `LoggerPort`라는 추가 인터페이스 계층이 가장 단순한 `console.log` 대비 간접비를 더한다(다만
  단일 파일 I/O 자원을 두 호출자가 공유하는 데 필요한 최소 비용).

## Performance tradeoffs

- 요청당 1회 append(비동기, 응답 반환을 막지 않음 — Interceptor의 `tap` 콜백은 응답 스트림에
  얹히므로 로깅 실패가 요청 실패로 전파되지 않도록 구현 시 catch로 격리해야 한다)로 지연 영향은
  무시할 수준이다.
- 배치 집계 로그는 tick당 1~2줄(집계 1줄 + 선택적 스킵 1줄)로 상한이 있어 03이 정한 tick당 최대
  10건 처리와 무관하게 로그 볼륨이 예측 가능하다.

## Side effects

- `logs.txt`가 무한정 증가한다(로테이션은 과제 스코프 밖 — 3일 마감 데모 규모에서는 문제되지
  않음, README에 명시).
- traceId가 HTTP 요청/스케줄러 tick 양쪽에서 로그 라인에 실리므로, 06이 Tempo 스팬과 상호
  연결(correlation)하는 데 필요한 필드가 이미 05에서 확보된다.

## Alternatives considered

- **(b) Middleware**: 응답 상태 코드 확보 시점이 `ExceptionFilter`(04)의 응답 재작성과 경합할
  위험이 있고, Interceptor가 이미 플랫폼 표준 해법을 제공하므로 기각.
- **(c) 커스텀 Decorator**: 컨트롤러마다 부착이 누락될 수 있어 "모든 요청" 요구를 구조적으로
  보장하지 못하고, 메타프로그래밍 복잡도만 추가하므로 기각.

## Follow-ups

- 로그 로테이션/보존 정책은 이번 스코프 밖(Follow-up으로 README에 명시).
- traceId 생성·전파 규약(HTTP 인바운드 스팬 시작 시점, 스케줄러 tick 루트 스팬 시작 시점)은
  [06-observability-design.md](./06-observability-design.md)에서 트레이싱 설계와 함께 확정한다.
- 08([08-testing-strategy-design.md](./08-testing-strategy-design.md))은 `LoggerPort` 더블을
  이용해 "요청/배치/에러 각각 최소 1회 로깅 호출"을 검증하는 테스트를 설계 시 참조할 수 있다.
