# 작업 상태 전이 규칙 설계

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 상태 코드 `pending`을 스키마 예시로만 제시하고, "PATCH 가능 필드와 상태 전이 규칙은
자유 설계"라고 명시한다. 스케줄러가 백그라운드에서 상태를 점검·처리하고, PATCH API도 상태를 바꿀 수 있는
이중 진입점 구조이므로, 전이 규칙을 코드 이전에 문서로 확정해야 03(스케줄러)·04(API)·08(테스트)이 동일한
계약을 참조할 수 있다. 본 문서는 상태 집합, 허용 전이 표, 전이 진입점 구분, 그리고 02가 소유하는 원자성
계약과의 접점(guard 실행 시점)을 확정한다.

## Chosen design / pattern / technology

### 상태 집합 확정

`pending → processing → completed | failed`의 4단계 선형 상태 집합을 채택하고, `failed`에서
`pending`으로 되돌리는 재시도 전이 1개를 추가한다.

- `pending`: 생성 직후, 스케줄러 처리 대기 중.
- `processing`: 스케줄러가 tick에서 집어 처리 중(배치 내 임계구역 안에서만 존재하는 짧은 상태).
- `completed`: 처리 성공.
- `failed`: 처리 실패.
- 재시도 규칙(자유 설계): `failed → pending`을 PATCH로만 허용해 재처리 큐에 재진입시킨다. 재시도 횟수
  제한은 이번 스코프에서는 두지 않는다(요구사항이 재시도 정책을 명시하지 않았고, 카운터 필드 추가는
  샘플 스키마 확장 이상의 과잉 설계로 판단해 보류 — 필요 시 후속 확장).
- 근거: REQUIREMENTS의 스키마 예시가 `status: "pending"` 단일 값만 제공하므로 나머지는 자유 설계이나,
  "일정 주기로 상태를 점검하여 처리"라는 표현이 처리 중 상태를 함의한다. `processing`을 별도로 두어
  스케줄러 tick 중복 처리(같은 job을 두 tick이 동시에 집는 상황)를 상태 자체로 방지할 수 있다.

### 후보 패턴 비교

- **(a) enum + 전이 테이블(`Record<Status, Status[]>`) + 도메인 guard 함수**: 상태값은 TypeScript
  literal union(`'pending' | 'processing' | 'completed' | 'failed'`)으로, 허용 전이는
  `Record<Status, Status[]>` 상수로, 실제 전이 가능 여부 판정은 `canTransition(from, to): boolean`
  순수 함수로 구현.
- **(b) State 패턴(상태별 클래스)**: 상태마다 `PendingState`/`ProcessingState` 등 클래스를 두고 각
  클래스가 허용 전이·행동을 캡슐화.
- **(c) XState류 상태머신 라이브러리**: `xstate` 등을 도입해 상태 정의·가드·액션을 선언적으로 구성.

### Ponytail 사다리 판정

**(a)를 채택하며, 사다리 4단(기존 의존성 재사용 없이 표준 lib만 사용)에서 멈춘다.** 상태가 4~5개뿐이고
전이 로직이 "허용 목록 조회 + boolean 판정" 수준이므로:
- (b) State 패턴은 상태별 클래스 4~5개 + 팩토리/컨텍스트 배선을 요구해, 이 규모의 문제에 과잉
  추상화다(사다리 6단 "최소 커스텀"을 넘어 5단 "한 줄" 수준에서 끝날 일을 클래스 계층으로 확장) → 기각.
- (c) XState 도입은 사다리 4단("기존 의존성")을 만족하는 의존성이 이미 없는 상태에서 신규 패키지를
  추가하는 것이므로, 실질적으로는 사다리를 역행해 3단(플랫폼 네이티브)/2단(표준 lib)을 건너뛰고 신규
  의존성을 도입하는 셈이다. TypeScript enum + plain object만으로 표현 가능한 문제에 상태머신 러너를
  들이는 것은 명백한 YAGNI 위반 → 기각.
- (a)는 표준 TypeScript 문법(2단: 표준 lib/언어 기능)만으로 구현되며, `Record<Status, Status[]>`
  상수 + 순수 함수 하나로 전이 규칙 전체를 표현할 수 있어 사다리에서 가장 낮은 단(생략은 불가 — 검증
  로직 자체가 필요하므로 1단은 성립하지 않음)에 도달한다.

### from → to 허용 표

| from \ to | pending | processing | completed | failed |
| --- | --- | --- | --- | --- |
| pending | - | 허용(스케줄러) | 불허 | 불허 |
| processing | 불허 | - | 허용(스케줄러) | 허용(스케줄러) |
| completed | 불허 | 불허 | - | 불허 |
| failed | 허용(PATCH 재시도) | 불허 | 불허 | - |

### PATCH 경유 / 스케줄러 경유 전이 구분

- **스케줄러 경유**: `pending → processing`, `processing → completed`, `processing → failed`. 사용자가
  직접 지정할 수 없다(PATCH 요청으로 이 세 전이를 시도하면 04의 API 계층에서 거부).
- **PATCH 경유**: `failed → pending`(재시도)만 허용. 그 외 PATCH의 상태 변경 시도는 04의 전이 guard가
  거부하고 일관된 에러 응답(04 참조)을 반환한다. title/description 등 비상태 필드 수정은 이 표와 무관하게
  PATCH에서 자유롭게 허용된다(04에서 상세 정의).

### guard 실행 시점 계약

전이 guard(`canTransition(from, to)`)는 **순수 도메인 함수**로 구현하며, 외부 상태나 부수효과에 의존하지
않는다. 그러나 이 guard를 "언제" 호출하느냐는 정합성에 직결되는 별도 계약이다:

- guard 호출자(스케줄러의 처리 유스케이스, API의 PATCH 유스케이스)는 반드시
  **[02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md)가 소유하는 임계구역
  (critical section) 내부**에서 대상 job의 **최신 상태를 재조회한 뒤** guard를 평가하고, guard가 참을
  반환할 때만 쓰기를 수행해야 한다.
- 순서는 **atomic read → guard → write**로 고정한다: 임계구역 진입 → 최신 레코드 재조회(stale 캐시
  금지) → `canTransition(currentStatus, targetStatus)` 평가 → 참이면 갱신 후 커밋, 거짓이면 임계구역
  내부에서 즉시 거부하고 아무것도 쓰지 않는다.
- 이 규약을 임계구역 밖에서(예: DTO 검증 단계나 조회 시점) 미리 평가해 캐싱하는 방식은 read-check-then-act
  경쟁 조건(TOCTOU)을 유발하므로 명시적으로 금지한다.
- 규약의 세부 구현(락/직렬화 큐, race 시나리오, 예외 처리)은 02가 소유하며, 본 문서는 guard 자체의
  순수성과 "호출 시점이 02 임계구역 내부여야 한다"는 계약만 참조로 명시한다.

### 헥사고날 레이어 배치

- **domain**: 상태 enum(`JobStatus`), 전이 테이블 상수, `canTransition` guard 순수 함수. 프레임워크
  의존성 없음.
- **application(+ports)**: `ProcessJobUseCase`(스케줄러 진입점), `PatchJobUseCase`(API 진입점)가
  `canTransition`을 호출하며, 02가 정의하는 `JobRepository` 포트를 통해 atomic read→guard→write를
  orchestrate한다.
- **adapters**: HTTP 컨트롤러(PATCH 요청 수신), 스케줄러 트리거(`@Cron`/`@Interval` 데코레이터가 붙은
  어댑터)가 각 유스케이스를 호출한다.
- **infrastructure**: node-json-db 기반 `JobRepository` 구현체(02 참조)가 실제 임계구역(락/큐)을
  실장한다.

## Pros

- 전이 규칙이 데이터(상수 테이블)로 표현되어 03/04/08에서 그대로 재사용·테스트 가능하다.
- guard가 순수 함수라 프레임워크 의존 없이 단위 테스트 가능(08의 "domain guard 순수 유닛 테스트" 전략과
  직결).
- 상태 4개 + 재시도 1개라는 작은 문제 공간에 맞는 최소 구현으로, 사다리 위반이 없다.

## Cons

- 전이 테이블이 상태 조합의 조합적 증가에 취약하다(상태가 10개 이상으로 늘면 표 관리 비용 증가). 현재
  스코프(4~5개)에서는 무시할 수 있는 수준이다.
- guard와 락의 결합(호출 시점 계약)을 문서로만 강제하므로, 구현 세션에서 계약을 어기고 임계구역 밖에서
  guard를 미리 평가하는 실수가 코드 리뷰 없이는 감지되지 않을 수 있다. 08의 동시성 회귀 테스트로 완화한다.

## Performance tradeoffs

- 전이 판정은 O(1) 배열 조회 수준으로 비용이 무시할 만하다.
- 성능에 영향을 주는 지점은 guard 자체가 아니라 02의 임계구역(직렬화 큐) 처리량이며, 이는 02 문서의
  책임이다.

## Side effects

- `processing` 상태를 도입함으로써 스케줄러 tick 간 job 재선택을 방지하는 부수 효과가 생긴다(02의
  배치 조회 쿼리가 `status = 'pending'`만 선택하면 됨).
- PATCH가 `failed → pending`만 허용하므로, 클라이언트가 임의로 `completed`를 지정하는 등의 오용을
  guard 단계에서 원천 차단한다.

## Alternatives considered

- **(b) State 패턴(상태별 클래스)**: 상태 전이 로직을 클래스 계층으로 캡슐화하면 상태가 많고 상태별
  행동(사이드이펙트)이 복잡할 때 유리하지만, 본 과제는 상태가 4~5개이고 상태별 "행동"이 없다(단순 값
  전이). 클래스 5개 + 컨텍스트 배선 비용이 이점보다 크다 → 기각.
- **(c) XState류 상태머신 라이브러리**: 선언적 상태머신, 시각화, 병렬/계층 상태 등 강력하지만 본 과제
  범위(선형 4단 + 재시도 1개)에는 대부분 기능이 불필요하다. 신규 의존성 도입 자체가 Ponytail 사다리
  4단("기존 의존성")을 만족하지 못하는 상태에서 5~6단을 건너뛰는 처사이며, 학습 비용도 3일 마감과
  맞지 않는다 → 기각.

## Follow-ups

- 재시도 횟수 제한/backoff 정책은 이번 세션에서 보류했다. 시간이 허락하면 `retryCount` 필드와
  최대 재시도 상한을 후속으로 추가할 수 있다(README "구현 코멘트"에 설계 의도로 기록 예정).
- guard-in-lock 계약의 실제 race 시나리오 검증은
  [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md)의 race 시나리오 표에서
  다룬다.
- PATCH 요청의 상세 요청/응답 스키마와 에러 응답 형식은
  [04-api-layer-design.md](./04-api-layer-design.md)에서 확정한다.
