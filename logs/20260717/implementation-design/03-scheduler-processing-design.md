# 스케줄러 작업 처리 설계

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 "생성된 작업은 백그라운드에서 일정 주기로 상태를 점검하여 처리한다"고만 요구하고,
"처리 주기와 한 번에 처리할 단위는 자유롭게 가정하여 결정한다(예: 1분 간격)"며 수치 확정을 위임한다.
스케줄러는 01([01-state-transition-design.md](./01-state-transition-design.md))이 정의한
`pending → processing → completed | failed` 전이의 실제 실행 주체이며, 02
([02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md))가 소유한
atomic read→guard→write 규약을 매 tick·매 job마다 경유해야 하는 최대 호출자다. 본 문서는 tick 주기·
배치 크기를 수치로 확정하고, 처리 파이프라인 패턴을 선택하며, tick 겹침(overrun)과 중복 처리 방지
전략을 결정한다.

## Chosen design / pattern / technology

### 요구 해석 — tick 주기·배치 크기 가정

REQUIREMENTS.md가 "예: 1분 간격"을 명시적으로 예시로 들었으므로, 이를 그대로 채택한다.

- **tick 주기: 60초(1분)**. 근거: 요구사항 원문의 예시를 그대로 따르며, 채용 과제 채점자가 데모 시
  1~2분 내에 상태 전이가 눈에 보이길 기대할 합리적 상한이다. 너무 짧으면(예: 5초) node-json-db 전체
  파일 rewrite(02 조사 근거) 빈도가 과도해지고, 너무 길면(예: 10분) 데모 관찰이 어렵다.
- **배치 크기: 1 tick당 최대 10건**. 근거: REQUIREMENTS의 샘플 데이터 규모(조회 동작 확인용 소량)를
  고려하면 job 총량이 수십 건 수준일 것으로 가정 가능하며, 10건이면 대부분의 데모 시나리오에서 1
  tick 내에 `pending` 잔량을 모두 소진한다. 상한을 두는 이유는 02의 직렬화 큐가 job마다 임계구역을
  순차 실행하므로, 무제한 배치는 단일 tick이 다음 tick 주기(60초)를 초과해 overrun을 유발할 위험을
  키우기 때문이다(아래 overrun 절 참조). 두 수치 모두 코드 상수로 노출해 조정 가능하게 한다(예:
  `SCHEDULER_TICK_MS`, `SCHEDULER_BATCH_SIZE`).
- 두 값 모두 REQUIREMENTS가 "자유롭게 가정"을 명시한 항목이므로, 이 해석을 README의 "구현에 대한
  코멘트"에도 동일하게 기록해야 한다(05·08과의 접점, Follow-ups 참조).

### 후보 패턴 비교

- **(a) `@Cron`/`@Interval` + 유스케이스 직접 호출 + tick 중복 방지 플래그**: `@nestjs/schedule`의
  `@Interval(SCHEDULER_TICK_MS)` 데코레이터가 붙은 adapter 메서드가 `ProcessPendingJobsUseCase`를
  직접 호출한다. 이전 tick이 아직 실행 중이면 새 tick 실행을 스킵하는 boolean 플래그(`isTickRunning`)
  하나로 중복 실행을 막는다.
- **(b) Strategy(상태별 처리기)**: `pending` 처리기, 재시도 대상 처리기 등 상태별로 별도 클래스를
  두고 배치 실행기가 상태에 맞는 Strategy를 선택해 위임한다.
- **(c) Template Method(공통 배치 골격)**: 추상 클래스가 "조회 → 반복 → 개별 처리 → 결과 집계"의
  공통 골격을 정의하고, 하위 클래스가 개별 처리 단계만 오버라이드한다.
- **(d) 인메모리 큐/워커**: tick이 대상 job을 인메모리 큐에 적재하고, 별도 워커(또는 워커 풀)가
  큐를 소비해 비동기로 처리한다.

### Ponytail 사다리 판정

**(a)를 채택하며, 사다리 3단(플랫폼 네이티브: `@nestjs/schedule`)에서 멈춘다. 필요 시에만 얇은
Strategy(사다리 6단, 최소 커스텀)로 국소 확장한다.**

- 이번 스코프의 "처리"는 `pending` job을 성공/실패로 분기시키는 단일 동작뿐이고(상태별로 근본적으로
  다른 처리 로직이 없다), (b) Strategy는 상태별 분기가 실제로 존재할 때 가치가 생긴다. 현재는
  `if (성공 조건) completed else failed` 수준의 분기이므로 클래스 계층을 미리 만드는 것은 예측성
  확장(YAGNI)이다 → **원칙적으로 기각하되, 처리 로직이 실제로 상태별로 분화되는 시점(Follow-ups)에는
  얇은 Strategy 인터페이스 하나로 6단 확장을 허용**한다. 이는 (a) 자체를 대체하는 것이 아니라 개별
  job 처리 단계 내부의 국소 확장이다.
- (c) Template Method는 배치 골격이 여러 하위 클래스에서 재사용될 때 가치가 있다. 본 과제는 배치
  골격이 하나뿐이므로(스케줄러 배치가 1종류) 추상 클래스 계층을 세울 대상이 없다 → 기각. 배치
  골격은 유스케이스 내부의 평범한 함수(조회 → for-loop → 집계)로 충분히 표현되며, 이는 사다리
  2단(표준 언어 기능)에서 이미 종결된다.
- (d) 인메모리 큐/워커는 tick과 처리 실행을 비동기로 분리해 tick 함수 자체는 즉시 반환하고 워커가
  백그라운드에서 소비하는 구조다. 이는 REQUIREMENTS가 요구하지 않는 확장(동시 여러 워커에 의한
  병렬 처리)이며, 02의 직렬화 큐(단일 writer)와 결합하면 "인메모리 큐 → 직렬화 큐"의 이중 대기열
  구조가 되어 복잡도만 늘고 처리량 이득이 없다(어차피 02의 임계구역이 병목이므로). 오히려 워커 풀의
  생명주기 관리, 큐 적재 시점과 데이터 신선도(stale) 문제 등 새로운 리스크를 도입한다 → 기각.
- (a)는 `@nestjs/schedule`이 REQUIREMENTS가 지정한 기술 스택이므로 플랫폼 네이티브 사용(3단)이며,
  신규 의존성 없이 "tick → 유스케이스 호출"이라는 단일 진입점으로 목적을 완전히 달성한다.

### 배치 크기/tick 겹침(overrun) 처리

- **overrun 정의**: 현재 tick의 배치 처리(최대 10건, 각 건은 02의 임계구역을 순차 통과)가
  다음 tick 예정 시각(60초 후)까지 끝나지 않는 상황.
- **결정: `@Interval` 대신 재귀 `setTimeout` 기반 self-scheduling 또는 `isTickRunning` 가드가
  붙은 `@Interval`로, overrun 시 다음 tick을 스킵(drop)한다.** `@nestjs/schedule`의 `@Interval`은
  이전 실행 완료 여부와 무관하게 고정 주기로 콜백을 발화하므로, adapter 메서드 최상단에서
  `isTickRunning` 플래그를 확인해 이미 실행 중이면 즉시 반환(스킵)하고 스킵 사실을 05(로깅)에
  전달한다. 처리 완료 시 플래그를 해제한다.
- **스킵을 선택한 근거(겹침 실행 대신)**: 겹치는 두 tick이 동시에 실행되면 두 tick이 각자
  `pending` 목록을 조회해 같은 job 집합을 동시에 집으려 시도할 수 있다. 01의 `processing` 상태와
  02의 atomic read→guard→write가 결합하면 두 번째 tick의 개별 job 전이는 guard에서 거부되어
  최종적으로 데이터 무결성은 깨지지 않지만(방어선은 이미 02가 제공), 무의미하게 큐에 중복 작업을
  적재해 02의 직렬화 큐 대기 시간만 늘리고 처리량을 낭비한다. tick 자체를 상위 레벨에서 스킵하면
  이 낭비를 근본적으로 차단한다 — 이는 방어선을 새로 세우는 것이 아니라, 이미 02가 보장하는
  안전성 위에 성능 최적화를 얹는 것이다.
- **큐잉(다음 tick을 버리지 않고 지연 실행)을 채택하지 않은 이유**: overrun이 누적되면 대기 tick이
  계속 쌓여 처리 지연이 무한정 증가할 수 있고(단일 프로세스, 단일 배치 크기 10건 규모의 과제
  스코프에서는 발생 가능성이 낮지만), 큐잉 로직 자체가 새로운 상태(대기 중인 tick 개수)를 관리해야
  하는 복잡도를 추가한다. "다음 60초 tick이 다시 pending을 조회하면 스킵된 tick에서 처리하지 못한
  job도 함께 잡힌다"는 자연 복구 특성이 있으므로, 스킵이 더 단순하고 충분하다.
- 배치 크기 10건 상한은 이 overrun 리스크를 낮추는 역할도 겸한다(무제한 배치보다 단일 tick 실행
  시간의 상한을 예측 가능하게 만든다).

### 동시성 계약 준수

배치 내 각 job의 상태 전이(`pending → processing`, `processing → completed | failed`)는
예외 없이 02의 **atomic read→guard→write** 규약을 경유한다. 구체적으로:

- `ProcessPendingJobsUseCase`는 02가 정의하는 `JobRepository` 포트의 배치 조회 메서드(예:
  `listByStatus('pending', limit)`)로 최대 10건의 후보를 가져온 뒤, **각 job마다 개별적으로**
  `JobRepository.withTransition(id, 'processing', ...)`을 호출한다. 배치를 하나의 트랜잭션으로
  묶지 않고 job 단위로 락 큐(직렬화 큐)를 통과시킨다 — 02가 트랜잭션/UoW를 명시적으로 기각했으므로
  (02의 Alternatives (b) 참조), 03도 동일한 경계를 따른다.
- 각 job의 실제 처리(성공/실패 판정)가 끝난 뒤 `processing → completed`/`processing → failed`
  전이 역시 개별 `withTransition` 호출로 02의 임계구역을 다시 통과한다. 즉 한 job은 tick 1회 동안
  최소 두 번(선점 전이 + 완료 전이) 락 큐를 지난다.
- 배치의 각 job 처리는 02의 큐가 이미 직렬화를 보장하므로, 유스케이스 레벨에서 job들을
  `Promise.all`로 동시에 시작해도(진입 순서는 비결정적이나) 무손실·무효 전이 방지는 02의 규약이
  담보한다. 다만 배치 내 순서 예측 가능성을 위해 본 구현은 `for...of` 순차 호출을 기본으로 하고,
  성능이 실제 병목이 될 경우에만(Follow-ups) 병렬화를 재검토한다.
- 상세 규약 문언(guard-in-lock, race 시나리오)은 02가 소유한다. 03은 "모든 전이 진입점이 규약을
  경유한다"는 사실만 참조로 명시하며 규약 자체를 재정의하지 않는다.

### 헥사고날 배치

- **adapters**: `@Interval(SCHEDULER_TICK_MS)`가 붙은 `JobSchedulerAdapter`(또는 유사 명명)가
  tick 발화·`isTickRunning` 가드·overrun 스킵 판단을 담당한다. `@nestjs/schedule` 의존은 이 계층에
  한정된다.
- **application(+ports)**: `ProcessPendingJobsUseCase`가 배치 조회 개수(10건)·개별 job 처리
  오케스트레이션을 담당하며, 01의 `canTransition` 호출 시점과 02의 `JobRepository.withTransition`
  호출만 알면 된다. adapter는 이 유스케이스를 직접 호출하는 것 외에 처리 로직을 알지 못한다(tick
  함수와 처리 로직의 분리는 08의 "결정론적 테스트를 위한 수동 tick 트리거" 전략의 전제 조건이기도
  하다).
- **domain**: 개별 job "처리"의 성공/실패 판정 로직(예: 조건 평가)이 순수 도메인 함수로 존재한다면
  이 계층에 위치한다. 01의 `JobStatus`/`canTransition`을 재사용한다.
- **infrastructure**: `JobRepository` 구현체(02 참조)가 배치 조회 쿼리와 직렬화 큐를 실제로
  실행한다. 03은 이 구현에 관여하지 않는다.
- `@nestjs/schedule`(`@Interval`)이 domain/application에 스며들지 않도록, tick 함수는 adapter에
  두고 즉시 유스케이스로 위임하는 얇은 어댑터 패턴을 유지한다(Rule 3 준수).

## Pros

- tick 주기·배치 크기가 코드 상수로 명시되어 있어 데모·테스트에서 조정이 쉽다.
- tick 함수와 처리 유스케이스가 분리되어 있어(adapter → application), 08이 tick 데코레이터 없이
  유스케이스를 직접 호출하는 결정론적 테스트를 작성할 수 있다.
- overrun 스킵 전략이 02의 직렬화 큐 위에 얹히는 성능 최적화이므로, 최악의 경우(스킵 로직에
  버그가 있어도) 데이터 무결성은 02의 guard-in-lock이 별도로 보장한다(방어선 이중화가 아닌 계층
  분리).

## Cons

- 배치를 job 단위로 순차 락 큐에 태우므로(트랜잭션 미사용), 배치 중간에 일부 job만 전이되고
  나머지가 처리되지 못한 채 프로세스가 종료되면 다음 tick이 자연 복구하되 "배치의 원자성"은
  보장하지 않는다. 이는 02가 이미 트랜잭션을 기각한 것과 일관된 트레이드오프다.
- `isTickRunning` 단일 플래그는 인프로세스 상태이므로, 향후 다중 인스턴스로 확장하면 각 인스턴스가
  독립적으로 tick을 발화해 같은 job을 동시에 노리는 문제가 재발한다(02의 Follow-ups와 동일한
  단일 프로세스 가정의 연장선).

## Performance tradeoffs

- tick당 최대 10건 × 2회 임계구역 통과(선점+완료)로 상한이 걸리므로, 단일 tick의 최악 실행 시간은
  "임계구역 1회 처리 시간 × 최대 20"으로 예측 가능하다. 이는 60초 주기 대비 충분히 여유 있는
  상한으로 설계했다(02의 O(n) 저장 비용 조사 참조 — 과제 규모의 job 수에서는 문제되지 않음).
- 순차(`for...of`) 처리는 병렬(`Promise.all`) 대비 배치 총 소요 시간이 늘지만, 02의 직렬화 큐가
  어차피 병렬 시작을 순차 실행으로 되돌리므로 실질 처리량 차이는 미미하고 코드 예측 가능성이 더
  큰 이득이다.
- overrun 스킵은 처리 지연(스킵된 job이 다음 tick까지 대기)이라는 대가를 받아들이는 대신 큐 대기
  폭주를 막는 트레이드오프다.

## Side effects

- tick 스킵이 발생하면 해당 사실이 05(로깅)로 전달되어야 운영 가시성이 확보된다 — 05가 "스케줄러
  tick 시작/종료/스킵" 로그 항목을 정의하는 근거가 된다(Follow-ups).
- `SCHEDULER_TICK_MS`/`SCHEDULER_BATCH_SIZE`를 코드 상수(또는 환경변수)로 노출하면, 테스트 환경에서
  더 짧은 주기로 오버라이드해 tick 동작을 빠르게 검증할 수 있는 부수적 이점이 있다(08 참조).

## Alternatives considered

- **(b) Strategy(상태별 처리기)**: 상태별로 근본적으로 다른 처리 로직이 없는 현재 스코프에서는
  클래스 계층을 미리 세우는 예측성 확장이라 기각. 처리 로직이 실제로 상태별로 분화되면 얇은
  Strategy 인터페이스로 국소 도입하는 것을 Follow-ups로 남긴다.
- **(c) Template Method(공통 배치 골격)**: 배치 골격이 1종류뿐이라 하위 클래스로 나눌 대상이 없고,
  평범한 함수(조회→반복→집계)로 사다리 2단에서 이미 요구를 충족하므로 기각.
- **(d) 인메모리 큐/워커**: 02의 직렬화 큐와 결합 시 이중 대기열이 되어 복잡도만 늘고 처리량 이득이
  없으며, REQUIREMENTS가 요구하지 않는 병렬 워커 확장이므로 기각.

## Follow-ups

- 처리 로직이 상태별로 실제 분화되는 시점에 (b) 얇은 Strategy 도입을 재검토한다.
- tick 스킵/시작/종료 로그 항목 정의는
  [05-logging-design.md](./05-logging-design.md)에서 확정한다(본 문서는 스킵이 "발생한다"는
  사실과 그 근거만 정의).
- 배치 내 job 처리를 `Promise.all` 병렬로 전환할지는 실측 성능 데이터가 확보된 이후 재검토한다.
- 08([08-testing-strategy-design.md](./08-testing-strategy-design.md))은 본 문서가 정의한
  tick↔처리 유스케이스 분리 구조를 전제로 fake timer 없는 수동 tick 트리거 테스트를 설계해야 하고,
  02의 race 시나리오(PATCH↔스케줄러 배치)를 재현할 때 본 문서의 배치 크기·순차 처리 가정을
  참조해야 한다.
