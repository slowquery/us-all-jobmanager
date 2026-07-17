# node-json-db 영속화와 동시성 제어

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 데이터 저장을 단일 JSON 파일(node-json-db)로 고정하고, "API 요청과 스케줄러가 동시에
같은 데이터에 접근할 수 있는 환경"에서 "데이터가 손실되거나 깨지지 않도록" 요구한다. 저장소는 아직
node-json-db가 설치되지 않은 스켈레톤 상태이므로, 실장 이전에 라이브러리의 실제 동작 특성을 공식 문서
근거로 확인하고 동시성 제어 패턴을 확정해야 한다. 본 문서는 세트 중 최중요 문서이며,
**atomic read→guard→write 계약의 소유 문서**다. 01([01-state-transition-design.md](./01-state-transition-design.md))의
`canTransition(from, to)` guard는 순수 도메인 함수로 확정되었고, "guard는 반드시 02가 소유하는 임계구역
내부에서 최신 상태를 재조회한 뒤 평가되어야 한다"는 참조 계약을 남겼다. 본 문서가 그 임계구역(락/직렬화
큐)의 실제 메커니즘과 원자성 계약 문언, race 시나리오 커버 논증, 초기화/시딩 전략을 확정해 03(스케줄러)·
04(API)·08(테스트)이 그대로 인용할 수 있게 한다.

## Chosen design / pattern / technology

### node-json-db 특성 조사 (공식 문서 근거)

npm 패키지 페이지와 공식 README(https://github.com/Belphemur/node-json-db)를 확인한 결과:

- **자체 ReadWriteLock 존재(메서드 호출 단위)**: 소스 코드(https://github.com/Belphemur/node-json-db)를
  직접 확인한 결과, README만으로 판단했던 이전 조사와 달리 라이브러리는 자체 동시성 락을 갖고 있다.
  `src/JsonDB.ts`의 `getData()`는 `readLockAsync(...)`로, `push()`/`delete()`는 `writeLockAsync(...)`로
  각각 래핑되어 있고, `src/lock/ReadWriteLock.ts`가 readers/writer 상호배제(다중 reader 동시 허용,
  writer는 단독 배타)를 구현하며, `test/06-concurrency.test.ts`가 이 보장을 회귀 테스트로 검증한다.
  즉 "자체 동시성 락이 전혀 없다"는 이전 결론은 소스와 모순되므로 정정한다.
- **락의 보호 범위는 개별 호출 단위 — compound 시퀀스는 비원자적(TOCTOU 노출)**: `readLockAsync`/
  `writeLockAsync`는 각각 단일 `getData()` 호출 또는 단일 `push()`/`delete()` 호출 하나만 감싼다.
  애플리케이션이 필요로 하는 것은 `getData()`(현재 상태 조회) → `canTransition` 평가 → `push()`(갱신)로
  이어지는 compound read-modify-write 시퀀스 전체의 원자성인데, 이 세 단계는 서로 다른 락 획득/해제
  경계에 걸쳐 있다. 즉 첫 `getData()` 호출의 read lock이 해제된 이후, 두 번째 호출의 write lock이
  걸리기 전 사이에 다른 호출이 끼어들어 상태를 바꿀 수 있다 — 라이브러리 락은 파일 손상 방지(동시
  write 간 상호배제, 쓰기 도중 상태를 읽는 것 방지)는 책임지지만, 애플리케이션 레벨의
  read-check-then-act(TOCTOU) 경쟁까지 보호하지는 않는다.
- **`saveOnPush`**: README 인용 — "The second argument is used to tell the DB to save after each push.
  If you set the second argument to false, you'll have to call the `save()` method." 즉 `push` 호출마다
  즉시 파일에 반영할지, 메모리에만 반영하고 수동 `save()`로 지연 반영할지는 설정값이며, 어느 쪽이든
  파일 쓰기는 라이브러리가 유지하는 인메모리 객체 전체를 대상으로 한다.
- **부분 갱신이 아닌 전체 파일 rewrite 비용**: README의 에러 표는 `Can't save the database: XXX`
  (DatabaseError, 저장 실패), `DataBase not loaded. Can't write`(로드 실패 시 저장을 막아 기존 파일을
  보존)를 명시한다. `push`는 DataPath 하위 구조만 갱신하는 것처럼 보이지만, 저장 시점에는 인메모리
  객체 전체가 JSON으로 직렬화되어 파일 전체가 다시 쓰인다(라이브러리가 diff 기반 부분 쓰기를 제공한다는
  언급이 문서 어디에도 없다). job 개수가 늘수록 매 저장 비용이 파일 전체 크기에 비례해 증가한다.
- **비동기 API**: v2.0.0 변경 로그 — "Every method is now asynchronous" — 이므로 `push`/`getData`는
  모두 Promise를 반환하며, 개별 호출 내부는 `ReadWriteLock`으로 보호되지만 여러 호출에 걸친 compound
  시퀀스는 `await` 지점 사이에 다른 호출이 인터리빙될 수 있어 race window가 실질적으로 존재한다(위
  "락의 보호 범위" 항목 참조).

이 조사 결과(자체 ReadWriteLock 존재)에 따라, Escalation/Risk Gate에서 예고된 "자체 동시성 보장이
있으면 대안 재평가" 조건이 실제로 발동한다. 아래 "자체 보장 있음 시나리오 대안 재평가" 절에서 이
재평가를 수행하며, 결론적으로 (a)를 채택한다.

### 자체 보장 있음 시나리오 대안 재평가

node-json-db의 `ReadWriteLock`은 개별 `getData()`/`push()`/`delete()` 호출 각각을 파일 손상으로부터
보호하지만(reader-writer 상호배제), 위에서 확인했듯 compound read-modify-write 시퀀스(재조회→guard→
저장) 전체를 원자화하지는 않는다. 따라서 재평가 결과는 다음과 같다.

- **재평가 결론: (a) 애플리케이션 계층 직렬화 큐 + guard-in-lock 채택은 여전히 유효하다.** 근거는 두
  락의 책임 범위가 다르기 때문이다 — 라이브러리 `ReadWriteLock`은 "파일 I/O 원자성"(한 번의 read
  또는 write 호출이 다른 호출과 겹쳐 파일이 깨지거나 절반만 반영된 상태를 읽는 것을 방지)을 책임지고,
  애플리케이션 직렬화 큐는 "전이 원자성"(재조회→guard 평가→커밋이라는 여러 호출에 걸친 시퀀스 전체가
  다른 작업의 개입 없이 원자적으로 수행됨)을 책임진다. 두 계층은 서로 대체하지 않고 보완한다 —
  라이브러리 락이 없었다면 파일 자체가 깨질 위험까지 추가로 있었겠지만, 라이브러리 락이 있어도
  애플리케이션 큐 없이는 TOCTOU 경쟁(아래 race 시나리오 표 참조)이 그대로 남는다.
- 만약 node-json-db가 compound 시퀀스 전체를 감싸는 트랜잭션 API(예: 콜백 전체를 단일 락으로 감싸는
  `withLock(async () => { ... })` 형태)를 공개로 제공했다면, 애플리케이션 큐 없이 그 API만으로 원자성
  계약을 충족할 수 있었을 것이다. 그러나 확인된 API는 `getData`/`push`/`delete` 개별 메서드 단위 락만
  노출하며, 여러 호출을 하나의 락으로 묶는 공개 API는 존재하지 않는다. 따라서 애플리케이션 계층에서
  별도의 직렬화 경계(큐)를 두는 것 외의 대안이 없다.
- 결론적으로 아래 (a)를 채택하되, 그 근거는 "라이브러리에 동시성 보장이 전혀 없어서"가 아니라
  "라이브러리의 동시성 보장이 compound 시퀀스를 커버하지 않아서"로 정정한다.

### 후보 패턴 비교

- **(a) Repository 포트 + 인프로세스 async mutex/락 큐(단일 writer 직렬화)**: `JobRepository` 포트
  뒤에 인프로세스 큐(예: 단일 `Promise` 체인으로 다음 작업을 이전 작업 완료 후에만 실행)를 두어, 모든
  읽기-쓰기 임계구역을 단일 writer로 직렬화한다. 신규 의존성 없이 `Promise` 체이닝만으로 구현 가능
  (필요 시 `async-mutex` 같은 한 줄짜리 표준 유틸 도입도 사다리 5단 수준에서 허용).
- **(b) Unit of Work + 트랜잭션 추상화**: 여러 레코드에 걸친 변경을 하나의 트랜잭션으로 묶고
  commit/rollback을 지원하는 추상화 계층을 도입.
- **(c) write-behind 캐시 + 주기 flush**: 쓰기를 메모리 캐시에 누적하고 일정 주기마다 배치로 파일에
  flush.
- **(d) 파일 락(proper-lockfile 등)**: OS 레벨 파일 락으로 프로세스 간 동시 쓰기를 막는 방식.

### Ponytail 사다리 판정

**(a)를 채택하며, 사다리 5단(한 줄: `Promise` 체인 기반 큐)에서 멈춘다.** 필요 시에만 6단(최소
커스텀: 큐 클래스 하나)으로 확장한다.

- (a)는 최소해 후보다: 단일 Node.js 프로세스, 단일 파일이라는 좁은 문제 공간에서 "다음 쓰기는 이전
  쓰기가 끝난 뒤 시작"이라는 규칙 하나만 강제하면 무손실 요구를 충족한다. 신규 패키지 없이(사다리
  4단을 만족하지 못해도 2~3단만으로) 구현 가능.
- (b)는 트랜잭션 없는 저장소(node-json-db는 커밋/롤백 개념이 없다)에 과잉이다. rollback 대상이 없는
  단일 파일 구조에 UoW 계층을 씌우는 것은 존재하지 않는 문제에 대한 추상화 → 기각.
- (c)는 크래시(프로세스 재시작) 시 flush 전 변경이 유실될 수 있어 "데이터가 손실되지 않아야 한다"는
  REQUIREMENTS의 안전 경계를 위반할 소지가 있다. Ponytail Principle 1의 "안전 경계는 절대 축소하지
  않는다"에 정면으로 저촉 → 기각.
- (d)는 여러 OS 프로세스가 같은 파일을 다투는 상황(예: 다중 인스턴스 배포)에 필요한 해법이다. 본
  과제는 단일 Node.js 프로세스 내에서 API 요청과 스케줄러가 동일 이벤트 루프를 공유하므로, 프로세스
  간 락은 해결하지 않아도 되는 문제를 해결하는 과잉 설계다 → 기각(멀티 인스턴스 확장 시 재검토 대상,
  Follow-ups 참조).

### 원자성 계약 명문화

상태 전이(및 이 전이에 의존하는 모든 갱신)는 다음 규약을 **반드시** 따른다. 03(스케줄러)·04(PATCH)의
모든 전이 진입점은 이 규약을 경유해야 하며, 규약을 우회하는 직접 `push` 호출은 금지한다.

> **atomic read→guard→write**: 인프로세스 직렬화 큐(단일 writer)의 임계구역(critical section)에
> 진입 → node-json-db에서 대상 job의 최신 상태를 재조회(stale 캐시 금지) → 01의 `canTransition(from,
> to)` guard를 **임계구역 내부에서** 평가(**guard-in-lock**) → 참이면 갱신 후 저장, 거짓이면 임계구역
> 내부에서 즉시 거부하고 아무 것도 쓰지 않은 채 임계구역을 벗어난다.

핵심은 guard 평가가 락 밖에서 미리 이루어지지 않고 **guard-in-lock**(락을 쥔 채로 guard를 평가)이라는
점이다. 락 획득과 guard 평가 사이에 다른 작업이 끼어들 여지를 없애야만 read-check-then-act(TOCTOU)
경쟁을 차단할 수 있다. `JobRepository` 포트는 이 규약을 `withTransition(id, targetStatus, patch)`류의
단일 메서드로 캡슐화해 03/04가 개별적으로 락/재조회 로직을 재구현하지 않도록 한다.

### race 시나리오

| 시나리오 | 무보호 시 결과 | 선택안(a) 하 결과 | 무효 전이 방지 |
| --- | --- | --- | --- |
| **동시 PATCH** — 같은 job에 대해 두 PATCH 요청이 거의 동시에 도착(예: 재시도 요청 2건 중복 클릭) | 두 요청이 모두 `failed` 상태를 읽고 둘 다 `pending`으로 갱신 성공 응답을 받음. 마지막 `push`가 이전 `push`의 부수효과(예: 응답 카운트)를 덮어써도 API 레벨에서는 이상을 감지 못함 | 큐가 두 요청을 순차 처리. 첫 요청이 임계구역에서 `failed→pending`을 커밋. 두 번째 요청은 큐 순번이 돌아왔을 때 재조회한 상태가 이미 `pending`이라 `canTransition('pending','pending')`이 거짓 | guard-in-lock이 두 번째 요청의 재조회를 첫 요청 커밋 **이후** 시점으로 강제하므로, 이미 전이된 상태에 대한 중복 전이가 guard에서 거부됨(무효 전이 0건) |
| **PATCH ↔ 스케줄러 배치** — 사용자가 `processing` 중인 job에 PATCH로 `pending`을 요청하는 동시에 스케줄러 tick이 같은 job을 `processing→completed`로 전이 시도 | PATCH가 먼저 읽은 `processing`을 기준으로 검증을 통과시켜 버리면(01 표상 `processing→pending`은 애초 불허이지만, 무보호 시 read-check-then-act로 오래된 상태 기준 판단이 남아있을 위험), 스케줄러 커밋 직후 PATCH가 이를 덮어써 처리 완료 결과가 소실될 수 있음 | 큐가 두 작업을 순차 직렬화. 스케줄러 커밋(`processing→completed`)이 먼저 임계구역을 통과하면, 뒤이은 PATCH는 재조회 시 `completed`를 보고 01 표에 따라 `completed→pending`을 거짓으로 판정 | 01의 from→to 표 자체가 `processing`을 사용자 직접 지정 대상에서 제외하고, guard-in-lock이 PATCH의 재조회 시점을 스케줄러 커밋 이후로 강제하므로 스케줄러 처리 결과가 PATCH로 되돌려지는 무효 전이가 원천 차단됨 |
| **생성 ↔ 목록 조회(GET /jobs, GET /jobs/search)** — POST로 job이 생성되는 도중 GET 목록 조회가 동시에 들어옴 | node-json-db가 쓰기 중인 파일을 읽는 시점과 겹치면(전체 파일 rewrite 방식이므로) 조회가 일부만 반영된 중간 상태나 파싱 오류를 겪을 위험이 있음 | 생성(쓰기)도 동일 직렬화 큐를 경유하므로, 조회(읽기)를 같은 큐의 읽기 작업으로 등록하면 쓰기 완료 후에만 조회가 실행됨. 조회는 상태를 변경하지 않으므로 guard 평가 자체는 불필요하나 큐 직렬화는 동일하게 적용 | 상태 전이가 아니므로 "무효 전이" 개념은 해당 없음 — 대신 큐 직렬화가 "쓰기 도중 읽기로 인한 비일관 스냅숏 노출"을 방지함을 동등 논증으로 기록(guard-in-lock의 읽기측 대응) |

### 초기화/샘플 시딩

- **파일 미존재 시 동작**: `JsonDB` 인스턴스 생성 시 대상 파일이 없으면 최초 `push`/`save()` 호출
  시점에 새 파일이 생성된다(README의 `DataBase not loaded. Can't write` 에러는 "로드에 실패했을 때"
  발생하는 것이지, 파일이 전혀 없어 최초 생성하는 정상 경로에는 해당하지 않는다). 애플리케이션
  부트스트랩(`onModuleInit` 등, adapter 계층)에서 `{ "jobs": [] }` 루트 구조를 보장하는 초기화 로직을
  1회 실행해, `getData("/jobs")`가 항상 배열을 반환하도록 고정한다.
- **`jobs.json` seed 전략**: 제출 요건("`jobs.json`에 샘플 데이터 포함, 조회 동작 확인용")을 만족하기
  위해, 저장소에 커밋되는 `jobs.json`은 애플리케이션 코드가 생성하는 빈 구조가 아니라 **저장소에
  미리 포함된 샘플 파일**을 사용한다. 부트스트랩 초기화 로직은 파일이 아예 없을 때만 빈 구조를
  만들고, 파일이 이미 존재하면(샘플이 커밋되어 있으면) 그대로 로드해 덮어쓰지 않는다.
- **seed와 런타임 쓰기의 충돌 방지**: 초기화 로직도 동일한 직렬화 큐/`JobRepository` 포트를 경유해
  단 한 번만 "파일 존재 확인 → 없으면 시드 쓰기"를 수행하고, 이 초기화 작업이 완료된 뒤에야 HTTP
  서버가 요청을 수락하고 스케줄러 tick이 시작되도록 애플리케이션 부트스트랩 순서를 고정한다(NestJS
  `onModuleInit`에서 await 완료 후 `listen()`). 이렇게 하면 "초기화 쓰기"와 "런타임 첫 요청의 쓰기"가
  같은 큐 안에서 순서가 보장되어 경쟁이 발생하지 않는다.

### 헥사고날 배치

- **domain**: Job 엔티티/값 객체. 01이 정의한 `JobStatus`, 전이 테이블, `canTransition` guard는
  domain에 위치하며 이번 문서가 그 실행 시점(guard-in-lock)만 규정한다.
- **application(port)**: `JobRepository` 포트(`findById`, `list`, `search`, `create`,
  `withTransition(id, targetStatus, patch)` 등)를 정의한다. `ProcessJobUseCase`(스케줄러)와
  `PatchJobUseCase`(API)가 이 포트만 의존하며, **락 경유 호출은 application 유스케이스가
  orchestrate**한다 — 즉 유스케이스가 "포트의 `withTransition`을 호출한다"는 사실만 알고, 큐/락의
  구현 세부는 알지 못한다.
- **infrastructure**: node-json-db 기반 `JsonDbJobRepository` 어댑터가 `JobRepository` 포트를
  구현하고, 내부적으로 직렬화 큐(단일 writer)와 atomic read→guard→write 임계구역을 실제로 실행한다.
  guard 함수 자체(순수 도메인 로직)는 domain에서 import해 호출하되, "언제 호출하는지"는 이 adapter가
  강제한다. 이 배치는 guard(도메인 순수 함수)와 락(인프라 관심사)의 결합이 헥사고날 경계를 침식하지
  않도록 한다 — guard는 domain에 머무르고, 락은 infrastructure에 머무르며, 둘을 잇는 오케스트레이션은
  application 계층의 책임이다.

## Pros

- Promise 체인 기반 단일 writer 직렬화는 신규 의존성 없이 구현 가능해 3일 마감에 적합하다.
- `JobRepository` 포트 뒤로 락 구현이 숨어 있어, 03/04는 "포트를 호출한다"는 사실만 알면 되고 동시성
  세부에 무지해도 된다(헥사고날 경계 유지).
- 원자성 계약을 단일 문서(본 문서)로 고정해, 03·04·08이 각자 다른 방식으로 재구현할 위험을 없앤다.

## Cons

- 모든 쓰기(및 쓰기와 순서를 맞춰야 하는 읽기)가 단일 큐를 통과하므로, 큐 자체가 애플리케이션 내
  단일 지점 병목이 된다(Performance tradeoffs 참조).
- 단일 프로세스 가정이 전제다. 향후 다중 인스턴스로 스케일아웃하면 인프로세스 락으로는 부족해지고
  (d) 파일 락이나 외부 저장소로의 전환이 필요하다 — 지금은 과제 스코프상 불필요하지만 재검토 지점.

## Performance tradeoffs

- **직렬화 큐의 처리량 상한**: 모든 쓰기(및 안전을 위해 직렬화에 편입한 읽기)가 순차 실행되므로,
  시스템 전체 처리량은 "임계구역 1회 실행 시간의 역수"로 상한이 걸린다. node-json-db는 저장 시
  인메모리 객체 전체를 JSON으로 직렬화해 파일에 쓰므로(위 조사 참조), job 수가 늘수록 개별 임계구역
  실행 시간이 늘어 처리량 상한이 낮아진다(O(n) 저장 비용 × 초당 요청 수 제약).
- 과제 스코프(단일 파일, 채용 과제 규모의 job 수)에서는 이 상한이 체감 지연을 유발할 가능성이 낮다.
  다만 향후 job 수가 커지면 (c) write-behind 같은 배치 flush 전략이 재검토 대상이 될 수 있음을
  Follow-ups에 남긴다.
- 읽기 전용 조회(GET)까지 큐에 편입하면 순수 읽기끼리도 직렬화되어 병렬 조회 성능은 희생된다. 다만
  이는 "생성↔목록 조회" race를 막기 위한 의도된 트레이드오프다.

## Side effects

- 모든 상태 변경 경로(스케줄러·PATCH)가 반드시 `JobRepository` 포트의 `withTransition`을 거치도록
  강제되므로, 향후 코드에서 이 포트를 우회해 직접 node-json-db 인스턴스를 호출하는 실수가 있으면
  원자성 계약이 깨진다. 코드 리뷰/08의 동시성 회귀 테스트로 이 침해를 감지해야 한다(01의 Cons에서도
  동일 리스크가 언급됨).
- 초기화 시퀀스(부트스트랩 완료 후 리스닝 시작)를 고정함으로써 서버 기동이 시딩 완료 시점만큼
  지연된다(단일 파일 존재 확인 + 필요 시 소량 쓰기이므로 체감 지연은 미미).

## Alternatives considered

- **(b) Unit of Work + 트랜잭션 추상화**: 커밋/롤백이 필요한 다중 레코드 트랜잭션을 지원하지만,
  node-json-db 자체에 트랜잭션 개념이 없어 추상화가 실제로 롤백할 대상이 없다. 존재하지 않는 문제에
  대한 선제적 확장 → 기각.
- **(c) write-behind 캐시 + 주기 flush**: flush 주기 사이의 크래시가 곧 데이터 유실이며,
  REQUIREMENTS의 "데이터가 손실되지 않아야 한다"는 명시적 요구와 직접 충돌 → 기각.
- **(d) 파일 락(proper-lockfile)**: 프로세스 간 경쟁을 막는 도구이나 본 과제는 단일 프로세스 내
  동시성만 요구하므로 해결 대상 문제가 없다. 신규 의존성 도입 비용 대비 이득이 없어 기각(멀티
  인스턴스 확장 시 재도입 후보로 Follow-ups에 기록).

## Follow-ups

- 향후 다중 프로세스/인스턴스로 확장 시 인프로세스 큐만으로는 부족하므로, (d) 파일 락 또는 외부
  저장소(예: SQLite WAL, Redis)로의 전환을 재검토해야 한다.
- job 수 증가에 따른 전체 파일 rewrite 비용이 체감되면 (c) write-behind/배치 flush 전략을 재검토
  후보로 남긴다(단, 크래시 유실 리스크 완화책 동반 필요).
- 03([03-scheduler-processing-design.md](./03-scheduler-processing-design.md))은 배치 내 각 job
  전이가 본 문서의 atomic read→guard→write 규약(락 큐)을 경유함을 명시해야 하고, 04는 PATCH 전이
  처리에서 DTO 검증은 락 밖, guard는 락 안(guard-in-lock)이라는 경계를 명시해야 한다.
- 08의 동시성 회귀 테스트는 본 문서의 race 시나리오(동시 PATCH, PATCH↔스케줄러 배치)를
  `Promise.all`로 재현해 무손실·무효 전이 방지를 assert해야 한다.
