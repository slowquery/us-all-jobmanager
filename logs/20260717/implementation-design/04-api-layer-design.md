# API 계층 설계 (DTO/검증/에러 응답)

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 5개 엔드포인트(`POST /jobs`, `GET /jobs`, `GET /jobs/search`, `GET /jobs/:id`,
`PATCH /jobs/:id`)의 응답 포맷·검색 쿼리 파라미터·PATCH 허용 필드와 상태 전이 규칙·에러 응답 구조를
"자유 설계"로 열어두되, "HTTP 시맨틱에 맞는 상태 코드"와 "일관된 에러 응답"은 명시적으로 요구한다.
01([01-state-transition-design.md](./01-state-transition-design.md))이 상태 집합과 from→to 허용 표를
확정했고, 02([02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md))가
`atomic read→guard→write` 원자성 계약(guard-in-lock)을 소유 문서로 확정했으므로, 본 문서는 이 두
계약을 API 계층(adapter)에서 어떻게 소비하는지 — 요청/응답 스키마, 검증 위치, 에러 매핑 — 를 결정한다.

## Chosen design / pattern / technology

### 엔드포인트별 요청/응답 스키마 초안

공통 응답 envelope: 성공 시 리소스(또는 리소스 배열)를 그대로 반환, 실패 시 에러 envelope(아래
"에러 응답 구조" 절)을 반환한다. Job 리소스 형태: `{ id, title, description, status, createdAt,
updatedAt }`(REQUIREMENTS 스키마 예시를 타임스탬프로 확장 — 조회/정렬에 필요한 최소 확장).

#### 1) `POST /jobs` — 작업 생성

- 요청 바디: `{ title: string(required, 1~200자), description?: string(0~2000자) }`. `status`는
  요청에서 받지 않는다 — 생성 시 항상 `pending`으로 서버가 고정한다(01의 상태 집합과 정합, 클라이언트가
  임의 초기 상태를 지정하는 경로를 차단).
- 성공 예시(201):
  ```json
  { "id": "b3f1...", "title": "Task 1", "description": "Do something", "status": "pending",
    "createdAt": "2026-07-17T09:00:00.000Z", "updatedAt": "2026-07-17T09:00:00.000Z" }
  ```
- 실패 예시(422, `title` 누락):
  ```json
  { "code": "VALIDATION_FAILED", "message": "요청 본문이 유효하지 않습니다.",
    "details": [{ "field": "title", "reason": "title은 필수이며 1~200자여야 합니다." }] }
  ```

#### 2) `GET /jobs` — 목록 조회

- 쿼리: 없음(전량 반환). 필요 시 후속으로 페이지네이션 추가 가능(Follow-ups).
- 성공 예시(200): `{ "items": [ { "id": "...", "title": "...", "status": "pending", ... } ], "count": 1 }`
- 실패: 입력이 없으므로 검증 실패 경로 없음. 서버 내부 오류만 500(아래 매핑 표).

#### 3) `GET /jobs/search` — 검색

- 쿼리: `title?: string`(부분 일치, 대소문자 무시), `status?: 'pending'|'processing'|'completed'|'failed'`.
  최소 1개 파라미터 필요(둘 다 없으면 422 — `GET /jobs`와 책임을 분리하기 위함).
- 성공 예시(200): `{ "items": [ { "id": "...", "title": "Task 1", "status": "pending", ... } ], "count": 1 }`
- 실패 예시(422, 파라미터 없음 또는 `status` 값 오류):
  ```json
  { "code": "VALIDATION_FAILED", "message": "검색 파라미터가 유효하지 않습니다.",
    "details": [{ "field": "status", "reason": "status는 pending|processing|completed|failed 중 하나여야 합니다." }] }
  ```

#### 4) `GET /jobs/:id` — 단일 조회

- 경로 파라미터: `id`(UUID 문자열).
- 성공 예시(200): `{ "id": "b3f1...", "title": "Task 1", "description": "...", "status": "pending", ... }`
- 실패 예시(404, 미존재):
  ```json
  { "code": "JOB_NOT_FOUND", "message": "id=b3f1... 인 작업을 찾을 수 없습니다.", "details": [] }
  ```
- 실패 예시(400, `id`가 UUID 형식이 아님):
  ```json
  { "code": "VALIDATION_FAILED", "message": "id 형식이 올바르지 않습니다.", "details": [{ "field": "id", "reason": "UUID 형식이어야 합니다." }] }
  ```

#### 5) `PATCH /jobs/:id` — 작업 수정

- 요청 바디(모두 optional, 최소 1개 필드 필요): `{ title?: string(1~200자), description?: string(0~2000자),
  status?: 'pending' }`. `status`는 01의 PATCH 경유 전이 표에 따라 **`'pending'` 값만 허용**(재시도
  전이 `failed → pending` 외의 어떤 값도 DTO 레벨에서 거부 — `processing`/`completed`는 스케줄러 전용
  전이이므로 애초에 열거형에 포함하지 않는다).
- 성공 예시(200, 재시도 전이 성공):
  ```json
  { "id": "b3f1...", "title": "Task 1", "description": "Do something", "status": "pending",
    "createdAt": "2026-07-17T09:00:00.000Z", "updatedAt": "2026-07-17T09:05:00.000Z" }
  ```
- 실패 예시(409, 무효 전이 — 예: 현재 `completed`인 job에 `status: "pending"` 요청):
  ```json
  { "code": "INVALID_TRANSITION", "message": "completed에서 pending으로 전이할 수 없습니다.",
    "details": [{ "field": "status", "reason": "허용된 전이: failed → pending" }] }
  ```
- 실패 예시(404, 미존재 job PATCH 시도): `JOB_NOT_FOUND`(위 4번과 동일 형태).
- 비상태 필드(`title`/`description`)만 있는 PATCH는 01의 전이 표와 무관하게 자유롭게 허용된다(경합 시
  02의 직렬화 큐를 동일하게 경유해 무손실을 보장하되, guard 평가 대상은 아니다).

### 후보 패턴 비교

- **(a) class-validator + `ValidationPipe` + 전역 `ExceptionFilter`(일관 에러 envelope)**: DTO 클래스에
  `@IsString()`/`@Length()`/`@IsIn()` 등 데코레이터로 제약을 선언하고, NestJS 내장 `ValidationPipe`가
  컨트롤러 진입 전에 자동 검증한다. `ValidationPipe`의 기본 실패 상태 코드는 400이며, 본 문서가
  채택하는 422 응답을 얻으려면 `ValidationPipe`를 `new ValidationPipe({ ..., errorHttpStatusCode: 422 })`로
  명시 구성해야 한다(기본값이 아니라 의도적 설정임을 아래 매핑 표에도 명기한다). 전역 `ExceptionFilter`가
  `HttpException` 계열과 도메인
  예외(예: `InvalidTransitionError`)를 동일한 에러 envelope(`code/message/details`)으로 직렬화한다.
- **(b) zod 스키마**: DTO 대신 zod 스키마로 요청 바디/쿼리를 파싱·검증하고, 커스텀 파이프나 미들웨어에서
  `safeParse` 결과를 에러 envelope으로 변환.
- **(c) 수동 검증**: 컨트롤러 메서드 내부에서 `if (!title) throw ...` 형태로 직접 필드별 조건문 작성.

### Ponytail 사다리 판정

**(a)를 채택하며, 사다리 3단(플랫폼 네이티브)에서 멈춘다.** class-validator/class-transformer는
NestJS 스캐폴드에 기본 포함되는 플랫폼 표준 스택이며, `ValidationPipe`/`ExceptionFilter`는 NestJS
프레임워크가 1급으로 제공하는 확장 지점이다.

- (c) 수동 검증은 사다리를 1~2단(생략/표준 lib)으로 낮추려는 시도처럼 보이지만, 실제로는 5개
  엔드포인트마다 검증 로직이 중복 산개하고 에러 envelope 일관성을 컨트롤러마다 수동으로 맞춰야 해
  Ponytail Principle 1의 "검증/에러 처리 안전 경계는 절대 축소하지 않는다"는 예외 조항에 저촉된다.
  검증 로직 자체를 생략하는 게 아니라 "검증을 어디에 선언적으로 모을지"의 문제이므로, 반복 코드로
  안전 경계를 스스로 약화시키는 (c)는 사다리 하단이 아니라 오히려 리스크가 높은 선택 → 기각.
- (b) zod는 NestJS 생태계 밖의 신규 의존성이며, 사다리 4단("기존 의존성")을 만족하는 기존 의존성이
  이미 없는 상태에서 새 라이브러리를 들이는 셈이다. NestJS가 class-validator 통합을 3단(플랫폼
  네이티브)에서 이미 제공하므로, 이를 건너뛰고 4단 이상으로 가는 것은 근거가 부족한 YAGNI 위반 → 기각.
- (a)는 NestJS CLI 스캐폴드가 기본 전제하는 검증 스택이라 신규 패키지 추가 없이(`class-validator`,
  `class-transformer`는 NestJS 프로젝트의 사실상 표준 동봉 의존성) 5개 엔드포인트 전체에 걸쳐 검증
  규칙을 DTO 선언 하나로 통일하고, 에러 envelope도 전역 필터 1개로 통제할 수 있어 최소해다.

### 에러 응답 구조 및 HTTP 상태 코드 매핑 표

에러 envelope 공통 구조: `{ code: string, message: string, details: Array<{ field?: string, reason: string }> }`.
`code`는 머신 판별용 상수(SCREAMING_SNAKE_CASE), `message`는 사람이 읽는 한국어 요약, `details`는
필드별 원인(없으면 빈 배열).

| 상태 코드 | 의미 | 발생 상황 | 근거 |
| --- | --- | --- | --- |
| 200 | OK | `GET`(목록/검색/단일), `PATCH` 성공 | 조회/부분 수정 성공에 대한 표준 시맨틱 |
| 201 | Created | `POST /jobs` 성공 | 신규 리소스 생성 성공의 표준 시맨틱(Location 헤더는 스코프 외로 생략) |
| 400 | Bad Request | 경로 파라미터 형식 오류(`id`가 UUID가 아님) | 요청 자체의 구문적 결함 — 바디/쿼리 필드 검증(422)과 구분해 경로 형식 오류에 한정 사용 |
| 404 | Not Found | `GET /jobs/:id`, `PATCH /jobs/:id` 대상 job 미존재 | 리소스 부재는 404가 HTTP 시맨틱상 정확 |
| 409 | Conflict | `PATCH`에서 01 전이 표상 불허 전이 시도(`INVALID_TRANSITION`) | 요청 자체는 형식상 유효하나 현재 리소스 상태와 충돌하는 연산 — 409가 시맨틱상 정확 |
| 422 | Unprocessable Entity | `POST`/`PATCH` 바디 필드 검증 실패, `GET /jobs/search` 파라미터 검증 실패 | 구문은 유효하나 의미적으로 처리 불가능한 요청 — `ValidationPipe` 기본값은 400이므로, 422를 쓰려면 `errorHttpStatusCode: 422`를 명시 설정해야 한다(아래 결정 참고) |
| 500 | Internal Server Error | 예기치 못한 서버/저장소 오류 | 위 코드로 분류 불가능한 잔여 오류의 폴백 |

**422 채택 근거(설정 명시)**: NestJS `ValidationPipe`가 검증 실패 시 기본으로 던지는 상태 코드는
400(Bad Request)이며, 422를 응답으로 받으려면 `ValidationPipe` 인스턴스화 시
`errorHttpStatusCode: 422` 옵션을 명시적으로 설정해야 한다(설정하지 않으면 모든 검증 실패가 400으로
내려간다). 본 문서는 "리소스 요청은 구문적으로 유효하나 의미적으로 처리 불가능하다"는 422 시맨틱이
바디/쿼리 필드 검증 실패(위 표 참조)에 더 정확히 들어맞는다고 판단해 422 유지를 확정하고, 부트스트랩
(`main.ts` 또는 `AppModule`의 전역 `ValidationPipe` 등록 지점)에서 `errorHttpStatusCode: 422`를
명시 설정하는 것을 구현 세션의 필수 작업으로 남긴다(설정을 누락하면 이 문서의 실패 예시들이 모두
실제로는 400으로 응답되어 계약과 어긋난다).

### 검색 쿼리 파라미터 설계

`GET /jobs/search`는 `title`(부분 일치, `String.includes` 기반 대소문자 무시 비교)과 `status`(01의
`JobStatus` 리터럴 유니온과 동일한 4값 열거)를 쿼리 파라미터로 받는다. 두 파라미터는 모두 optional이나
**최소 1개는 필수**로 강제한다 — 파라미터가 전무한 호출은 의미상 `GET /jobs`와 동일해지므로, 두
엔드포인트의 책임을 명확히 분리하기 위해 검증 단계에서 422로 거부한다. 두 파라미터가 함께 오면 AND
조건(제목 부분 일치 **그리고** 상태 일치)으로 좁힌다.

### PATCH 허용 필드와 01 전이 규칙 연동

PATCH DTO는 `title`/`description`/`status` 3개 필드만 허용하고, 이외 필드(`id`, `createdAt` 등)는
`ValidationPipe`의 `whitelist: true` + `forbidNonWhitelisted: true` 옵션으로 요청 시점에 거부한다.
`status` 필드는 열거형 자체를 `'pending'` 단일 값으로 제한해, 01의 PATCH 경유 전이(`failed → pending`
재시도)만 DTO 레벨에서 표현 가능하게 한다. 다만 DTO 검증은 "값이 문법적으로 `'pending'`인가"만
판정하며, "현재 상태에서 실제로 그 전이가 허용되는가"는 DTO가 아니라 01의 `canTransition(from, to)`
guard가 판정한다(아래 절 참조). 즉 DTO는 상태값의 **형식**을, guard는 상태 전이의 **의미**를 검증하는
역할 분리다.

### PATCH 전이 처리의 02 원자성 계약 경유 명시

PATCH 요청 처리 파이프라인은 두 단계로 명확히 분리된다:

1. **락 밖(adapter 진입 단계)**: `ValidationPipe`가 DTO 형식(필드 존재/타입/열거형 범위)을 검증한다.
   이 단계는 대상 job의 현재 상태를 조회하지 않으며, 순수하게 요청 페이로드의 구문적 유효성만 판정한다.
2. **락 안(application/infrastructure 경계)**: DTO 검증을 통과한 요청만 `PatchJobUseCase`로 전달되고,
   이 유스케이스는 02가 정의하는 `JobRepository` 포트의 `withTransition(id, targetStatus, patch)`를
   호출한다. 02의 **atomic read→guard→write** 계약([02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md))에
   따라, 직렬화 큐의 임계구역 내부에서 대상 job의 최신 상태를 재조회한 뒤 01의 `canTransition` guard를
   guard-in-lock으로 평가하고, 참일 때만 커밋한다. guard가 거짓을 반환하면 유스케이스는
   `InvalidTransitionError`(도메인 예외)를 던지고, 전역 `ExceptionFilter`가 이를 409 `INVALID_TRANSITION`
   에러 envelope으로 변환한다.

이 두 단계 분리로, DTO 검증(형식)이 상태 조회 없이 빠르게 요청을 걸러내면서도, 실제 전이 가부 판정은
반드시 02의 임계구역 내부에서만 이루어져 01이 명시한 read-check-then-act(TOCTOU) 금지 규약을 API
계층에서도 위반하지 않는다. 비상태 필드(`title`/`description`)만 있는 PATCH도 동일하게
`withTransition`(또는 동등한 포트 메서드)을 경유해 02의 직렬화 큐 안에서 처리되어 다른 동시 쓰기와의
무손실을 보장한다.

### 헥사고날 레이어 배치

- **adapter**: PATCH/POST DTO 클래스(class-validator 데코레이터 포함), 컨트롤러(`JobsController`),
  전역 `ExceptionFilter`, `ValidationPipe` 설정. 이 계층은 `@nestjs/*`와 `class-validator`에 의존하되
  도메인 규칙(전이 가부)을 스스로 판정하지 않는다 — DTO는 형식만 검증하고 실제 전이 판정은 유스케이스로
  위임한다.
- **application**: `CreateJobUseCase`, `ListJobsUseCase`, `SearchJobsUseCase`, `GetJobUseCase`,
  `PatchJobUseCase`가 각 엔드포인트 1:1로 대응하며, `JobRepository` 포트만 의존한다. `PatchJobUseCase`는
  01의 `canTransition`을 직접 호출하지 않고(guard 호출은 02의 infrastructure adapter가 임계구역 내부에서
  수행 — 02 헥사고날 배치 참조) 포트의 `withTransition`을 호출해 결과(성공/`InvalidTransitionError`)만
  받는다.
- **domain**: Job 엔티티, 01이 정의한 `JobStatus`/전이 테이블/`canTransition`. DTO나 컨트롤러로부터
  어떤 의존도 받지 않는다.
- **infrastructure**: 02가 정의하는 `JsonDbJobRepository`(원자성 계약 실행 지점). 본 문서는 이 계층에
  새로운 것을 추가하지 않고 02의 배치를 그대로 참조한다.

## Pros

- class-validator DTO 하나로 검증 규칙이 선언적으로 문서화되어, README의 "API 사용법" 섹션 작성 시
  DTO를 그대로 근거로 삼을 수 있다.
- 전역 `ExceptionFilter`가 도메인 예외(`InvalidTransitionError`, `JobNotFoundError`)와 NestJS
  `HttpException`을 모두 동일한 envelope으로 직렬화해, 5개 엔드포인트 전체가 일관된 에러 응답을 갖는다
  (REQUIREMENTS의 "일관된 에러 응답" 요구 직접 충족).
- DTO 검증(락 밖)과 guard 평가(락 안)의 명확한 분리로, 02의 TOCTOU 금지 규약을 API 계층에서 자연스럽게
  준수한다 — 별도의 우회 경로가 코드 구조상 존재하지 않는다.

## Cons

- class-validator 데코레이터 스타일은 런타임 리플렉션(`reflect-metadata`)에 의존해, 순수 함수 기반
  검증보다 디버깅 시 스택 추적이 덜 직관적일 수 있다.
- `status` 열거형을 `'pending'` 단일 값으로 좁힌 설계는 01의 전이 표가 변경되면(예: 새 재시도 규칙
  추가) DTO도 함께 갱신해야 하는 결합을 만든다 — 01과 04 양쪽 모두 링크로 상호 참조해 완화한다.

## Performance tradeoffs

- `ValidationPipe`의 데코레이터 기반 검증은 요청당 리플렉션 오버헤드가 있으나, 페이로드 크기(수 개
  필드)와 요청량(채용 과제 규모)을 고려하면 무시할 수준이다.
- 검증(락 밖)을 임계구역 진입 이전에 완료시킴으로써, 형식이 잘못된 요청이 02의 직렬화 큐를 점유하지
  않도록 배제한다 — 이는 02가 규정한 큐 처리량 상한(성능 병목 지점)에 무효 요청이 부하를 주지 않게
  하는 의도된 최적화다.

## Side effects

- `ValidationPipe`를 전역(`forbidNonWhitelisted: true`)으로 적용하면 DTO에 선언되지 않은 필드를 포함한
  모든 요청이 즉시 422로 거부된다 — 향후 필드 추가 시 DTO를 반드시 함께 갱신해야 하는 결합이 생긴다.
- 에러 envelope의 `code` 상수 목록(`VALIDATION_FAILED`, `JOB_NOT_FOUND`, `INVALID_TRANSITION` 등)이
  API 계약의 일부가 되므로, 향후 변경 시 클라이언트 호환성에 영향을 준다(README API 사용법에 목록화
  필요).

## Alternatives considered

- **(b) zod 스키마**: 타입 추론과 런타임 검증을 하나의 스키마로 통합할 수 있어 매력적이나, NestJS가
  이미 class-validator를 1급 통합(3단 플랫폼 네이티브)으로 제공하는 상황에서 zod 도입은 검증되지 않은
  추가 의존성이자 파이프/필터 배선을 처음부터 다시 만들어야 하는 비용이다. 3일 마감과 맞지 않아 기각.
- **(c) 수동 검증**: 데코레이터 학습 곡선을 피할 수 있으나, 5개 엔드포인트마다 검증 조건문이 중복되고
  에러 envelope 형식을 각 컨트롤러가 수동으로 맞춰야 해 "일관된 에러 응답" 요구를 코드 리뷰 없이는
  보장하기 어렵다. Ponytail Principle 1의 안전 경계 축소 금지에 저촉되어 기각.

## Follow-ups

- `GET /jobs` 페이지네이션(현재는 전량 반환)은 이번 스코프에서 보류했다. job 수가 커지면 `limit`/`offset`
  쿼리 파라미터 추가를 재검토한다.
- 에러 `code` 상수 목록과 상태 코드 매핑 표는 README "API 사용법" 섹션에 그대로 재사용할 예정이다.
- PATCH의 재시도 전이(`failed → pending`)에 횟수 제한이 추가되면([01-state-transition-design.md](./01-state-transition-design.md)
  Follow-ups 참조), 04의 `INVALID_TRANSITION` 응답에 재시도 잔여 횟수 등 추가 `details` 필드가 필요할
  수 있다.
- 08([08-testing-strategy-design.md](./08-testing-strategy-design.md))의 e2e 테스트는 본 문서의 5개
  엔드포인트 성공/실패 예시를 대상 표면으로 참조한다.
