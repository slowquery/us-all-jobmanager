# 테스트 전략 설계

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

REQUIREMENTS.md는 "API와 스케줄러를 검증할 수 있는 테스트 코드 작성"만 요구하고 구체적인 러너·구조는
위임한다. 본 문서는 02([02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md))가
소유한 atomic read→guard→write 계약과 03([03-scheduler-processing-design.md](./03-scheduler-processing-design.md))이
정의한 tick↔처리 유스케이스 분리 구조를 **검증 가능한 테스트로 번역**하는 것이 목적이며, 두 문서의
계약 문언 자체를 재서술하지 않는다. 04([04-api-layer-design.md](./04-api-layer-design.md))가 정의한
5개 엔드포인트는 e2e 표면으로 참조한다. 대상은 (1) 계층별 테스트 범위, (2) `@nestjs/schedule`을
결정론적으로 검증하는 방법, (3) 02의 race 시나리오를 재현하는 동시성 회귀 테스트, (4) node-json-db를
사용하는 테스트의 파일 격리 전략이다.

## Chosen design / pattern / technology

### 계층별 전략

| 계층 | 대상 | 도구 | 비고 |
| --- | --- | --- | --- |
| **domain guard 순수 유닛** | 01의 `canTransition(from, to)` 전이 테이블·guard 함수, job 값 객체 검증 로직 | Jest만(프레임워크 무의존) — `@nestjs/testing`, HTTP, node-json-db 어느 것도 import하지 않는 순수 함수 테스트 | 입력→출력만 assert. 01의 전이 테이블 각 행(허용/불허)을 파라미터화(`it.each`)해 전수 커버 |
| **usecase 유닛** | `PatchJobUseCase`, `ProcessPendingJobsUseCase` 등 application 계층 유스케이스 | Jest + `@nestjs/testing`의 `Test.createTestingModule` 없이도 가능(순수 클래스면 `new Usecase(fakeRepo)`), `JobRepository` 포트는 인메모리 목/스텁으로 대체(실제 node-json-db 미사용) | 02가 정의한 `withTransition(id, targetStatus, patch)` 호출 여부·인자·guard 결과에 따른 분기(성공/거부)를 검증. 실제 파일 I/O·직렬화 큐 타이밍은 검증 대상이 아님(그 책임은 다음 계층·02 자체의 계약 문서가 짐) |
| **adapter(controller) e2e** | 04의 5개 엔드포인트(`POST /jobs`, `GET /jobs`, `GET /jobs/search`, `GET /jobs/:id`, `PATCH /jobs/:id`) | `supertest` + NestJS `Test.createTestingModule().compile()` → 실제 `INestApplication` 부트스트랩, 실제 `JsonDbJobRepository` 어댑터를 격리된 임시 DB 파일에 연결 | HTTP 상태 코드·응답 스키마·에러 envelope(04 정의)까지 실제 스택을 통과해 검증. node-json-db 격리 전략은 아래 절 참조 |

세 계층의 경계는 헥사고날 레이어와 1:1로 대응한다: domain guard 유닛 = domain, usecase 유닛 =
application(+ports, 목 어댑터로 대체), e2e = adapters(+ infrastructure 실물 연결). 이 대응 덕분에
포트 목만 교체하면 usecase 유닛이 e2e 없이도 대부분의 분기를 커버하고, e2e는 "계층 간 실제 배선이
맞는지"만 최소 케이스로 확인하면 된다(과잉 e2e 방지).

### @nestjs/schedule 결정론적 테스트

- **옵션 1 — fake timer(예: Jest `jest.useFakeTimers()` + `jest.advanceTimersByTime(SCHEDULER_TICK_MS)`)**:
  `@Interval` 데코레이터가 등록한 실제 타이머를 가짜 시계로 전진시켜 콜백을 발화시킨다. NestJS
  스케줄러 모듈(`@nestjs/schedule`)이 내부적으로 `setInterval`을 감싸는 방식에 fake timer가
  올바르게 반응하는지는 버전에 의존적이며, `SchedulerRegistry` 내부 구현(cron 라이브러리 wrapping)과
  Jest의 fake timer 구현이 어긋나면 tick이 발화하지 않거나 여러 번 발화하는 비결정적 실패가
  발생할 수 있다. 테스트가 프레임워크의 내부 타이밍 배선에 결합된다.
- **옵션 2 — 수동 tick 트리거(스케줄 데코레이터와 처리 유스케이스 분리, tick 함수 직접 호출)**: 03이
  이미 `JobSchedulerAdapter`(tick 발화·`isTickRunning` 가드)와 `ProcessPendingJobsUseCase`(배치
  처리)를 분리해두었으므로, 테스트는 `@Interval`을 전혀 거치지 않고 `ProcessPendingJobsUseCase`를
  직접 `await usecase.execute()` 호출한다. 실시간·가짜 시계 어느 쪽도 필요 없다.

**추천: 옵션 2(수동 tick 트리거)를 확정한다.** 근거:

- 03이 "tick 함수와 처리 로직의 분리는 08의 결정론적 테스트를 위한 수동 tick 트리거 전략의 전제
  조건"이라고 이미 명시했으므로, 계층 분리 설계와 정합하는 유일한 선택이다.
- fake timer는 `@nestjs/schedule`이 내부적으로 사용하는 스케줄링 라이브러리의 구현 세부에 테스트를
  결합시켜, 라이브러리 버전 변경 시 테스트가 프레임워크 배선 문제로 깨질 위험이 있다(검증하고자
  하는 것은 "처리 로직이 옳은가"이지 "`@nestjs/schedule`이 정확히 60초마다 발화하는가"가 아니다 —
  후자는 프레임워크 자체의 책임이며 재검증할 필요가 없다).
- `isTickRunning` 가드·overrun 스킵 로직(adapter 계층)은 tick 데코레이터에 강결합되어 있어 순수
  유닛으로 검증하기 어렵지만, 이 로직 자체는 "안전성"이 아닌 "성능 최적화"(02의 guard-in-lock이
  이미 무결성을 보장하는 위에 얹힌 최적화, 03 Pros 참조)이므로 08의 필수 검증 대상에서 제외하고
  아래 "커버리지 범위와 비목표"에 명시한다.
- adapter의 tick 함수(`@Interval` 콜백) 자체는 "즉시 유스케이스로 위임"하는 얇은 코드이므로, 이
  위임 한 줄만 e2e 또는 통합 테스트 1건으로 스모크 검증하고, 실제 처리 로직 분기는 전부
  `ProcessPendingJobsUseCase` 유닛 테스트가 담당한다.

### 동시성 회귀 테스트(02의 race 시나리오 재현)

02·03의 계약(atomic read→guard→write, guard-in-lock)을 재서술하지 않고, 02의 race 시나리오 표
([02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) 참조)를 그대로
`Promise.all`로 재현하는 회귀 테스트 2건을 확정한다. 두 테스트 모두 e2e 계층(실제
`JsonDbJobRepository` + 격리된 임시 DB 파일, 아래 절 참조)에서 수행해 실제 직렬화 큐 구현까지
통과시킨다.

1. **동시 PATCH 회귀(재시도 중복 클릭, 02 race 시나리오 #1과 정합)**: `failed` 상태의 job 하나를
   시딩한 뒤, 동일 `PATCH /jobs/:id`(`{ status: 'pending' }` — 04 DTO가 `status`를 `'pending'` 단일
   열거로 제한하므로 이 값만 사용 가능) 호출 2건을 `Promise.all([patch1, patch2])`로 동시 발사한다
   (재시도 버튼 중복 클릭 시나리오 재현).
   - **assert 조건(무손실)**: 두 응답 중 정확히 1건만 성공(2xx, `failed→pending` 커밋)하고 나머지
     1건은 409 `INVALID_TRANSITION`으로 거부되어야 한다 — 거부된 요청은 큐 순번이 돌아왔을 때
     재조회한 상태가 이미 `pending`이라 `canTransition('pending', 'pending')`이 거짓으로 평가된
     결과다. 두 응답 모두 성공하면 02의 guard-in-lock이 깨진 것.
   - **assert 조건(무효 전이 방지)**: 처리 완료 후 저장소를 재조회해 최종 상태가 `pending`으로
     정확히 1회만 전이된 결과와 일치하는지 확인하고, 응답 카운트(성공 1 + 거부 1)와 최종 상태가
     모순되지 않는지(예: 두 응답 다 실패했는데 상태가 바뀌어 있는 경우) 함께 검증한다.
2. **PATCH ↔ 스케줄러 배치 회귀**: `processing` 상태의 job 하나를 시딩한 뒤, `PATCH /jobs/:id`(예:
   `status: 'pending'`으로 되돌리는 요청 — 01 표상 애초 불허)와
   `ProcessPendingJobsUseCase.execute()`(해당 job을 `processing→completed`로 전이시키는 배치 처리)를
   `Promise.all([patchCall, schedulerTickCall])`로 동시 실행한다.
   - **assert 조건(무손실)**: 스케줄러의 `processing→completed` 전이가 손실 없이 반영되어야 한다 —
     최종 상태가 `completed`여야 하며, PATCH가 이를 되돌려 `pending`으로 덮어쓰는 결과가 나오면 실패.
   - **assert 조건(무효 전이 방지)**: PATCH 응답이 전이 거부(비2xx, 04 에러 응답 스키마)여야 하며,
     저장소 재조회 결과가 스케줄러 커밋 이후 상태(`completed`)와 일치해야 한다. 두 assert 중
     하나라도 어긋나면 guard-in-lock 또는 재조회 순서 보장이 깨진 것으로 간주한다.

두 테스트 모두 "무손실"과 "무효 전이 방지"를 별개의 assert 블록으로 분리해, 실패 시 어느 계약이
깨졌는지(전이 결과 손실 vs guard 우회) 즉시 구분할 수 있게 한다. 02의 세 번째 race 시나리오(생성↔
목록 조회)는 상태 전이가 아니므로 "무효 전이" assert 대상이 아니며, 필요 시 별도의 일관성 스냅숏
검증(선택)으로 다룰 수 있으나 본 문서의 필수 acceptance 대상(≥2개)에는 포함하지 않는다.

### node-json-db 테스트 격리

- **테스트별 임시 파일 경로 주입**: `JsonDbJobRepository`(또는 그 상위 `JsonDB` 설정)는 DB 파일
  경로를 생성자/모듈 옵션으로 주입받도록 구성한다(하드코딩된 `jobs.json` 경로 금지). 각 테스트
  스위트(또는 `describe` 블록)는 `os.tmpdir()` 하위에 고유 파일명(예: `job-test-${randomUUID()}.json`)을
  생성해 병렬 테스트 실행 간 파일 경합을 원천 차단한다.
- **초기 상태 시딩**: `beforeEach`(또는 `beforeAll`, 테스트 격리 수준에 맞춰 선택)에서 임시 파일에
  테스트가 필요로 하는 최소 시드 데이터(예: 특정 상태의 job 1~2건)를 직접 써넣은 뒤 `JsonDB` 인스턴스를
  생성한다. 02가 정의한 "파일 미존재 시 빈 구조 초기화" 경로도 파일을 아예 생성하지 않은 케이스로
  별도 유닛 검증한다.
- **teardown 삭제 전략**: `afterEach`에서 해당 테스트가 생성한 임시 파일을 `fs.rm`(또는
  `fs.unlink`)으로 삭제한다. 프로세스가 비정상 종료해 삭제가 누락되는 경우를 대비해, 임시 파일은
  OS 임시 디렉터리(`os.tmpdir()`) 하위에 두어 CI/로컬 환경 재시작 시 자연 정리되도록 하고, 저장소에
  커밋되는 `jobs.json`(02가 정의한 샘플 시딩 파일)과는 완전히 분리된 경로를 사용해 테스트가 실제
  제출용 시드 데이터를 훼손하지 않도록 한다.
- **동시성 회귀 테스트와의 관계**: 위 두 회귀 테스트는 각각 독립된 임시 파일을 사용해야 하며, 같은
  파일을 공유하는 여러 테스트 케이스를 병렬(`--runInBand` 미사용 시 Jest 워커 병렬 실행) 환경에서
  실행해도 서로 간섭하지 않아야 한다.

### 테스트 러너/도구 선택 — Ponytail 사다리 판정

- **(a) NestJS 표준 Jest 스택**: `@nestjs/cli`가 스캐폴딩하는 기본 구성(Jest + `ts-jest` + `supertest`,
  `package.json`의 `test`/`test:e2e` 스크립트). NestJS 공식 문서·CLI가 기본 제공하며 별도 설치 없이
  즉시 사용 가능.
- **(b) 대안(Vitest 등)**: 빠른 실행 속도, ESM 우선 설계 등의 장점이 있으나 NestJS CLI 스캐폴딩·
  공식 튜토리얼·`@nestjs/testing`과의 통합 사례가 Jest 대비 적어 설정 비용(트랜스파일러 연동,
  데코레이터 메타데이터 처리)이 추가로 든다.

**판정: (a) NestJS 표준 Jest 스택을 채택하며, 사다리 3단(플랫폼 네이티브)에서 멈춘다.** REQUIREMENTS가
NestJS를 기술 스택으로 고정했고, Jest는 NestJS 스캐폴딩의 기본값이자 `@nestjs/testing`
(`Test.createTestingModule`)이 공식적으로 전제하는 러너다. 3일 마감에 새 러너를 도입해 설정 비용을
치를 이유가 없다 — (b)는 신규 의존성 도입(사다리 4단 이상)이면서 이번 스코프에서 (a) 대비 실질적
이득(예: 대규모 테스트 스위트의 실행 속도 병목)이 없으므로 기각한다.

### 커버리지 범위와 비목표

- **범위(In)**: 01의 전이 테이블 전 케이스(허용/불허), 02의 race 시나리오 2건(회귀), 03의 배치
  처리 유스케이스 정상/실패 분기, 04의 5개 엔드포인트 각각 성공·검증 실패·조회 실패(404) 경로.
- **비목표(Out)**: `isTickRunning` 가드·overrun 스킵의 실시간 타이밍 검증(위 결정론적 테스트 절
  근거 참조 — 안전성이 아닌 성능 최적화이며 fake timer 없이는 정밀 타이밍 검증이 어려움), 06이
  설계한 트레이싱 스팬·로그 파이프라인의 자동화 검증(관측성은 설계 문서 산출물이며 코드 계측
  자체가 이번 세션 non-goal), 부하/성능 테스트(02의 처리량 상한은 설계 단계 추정치이며 실측 벤치마크는
  본 문서의 스코프 밖), node-json-db 라이브러리 자체의 동작(이미 02가 공식 문서 근거로 검증 완료,
  재검증 불필요).

### 헥사고날 배치

- **domain**: guard 순수 유닛 테스트의 대상(01의 `canTransition`)이 위치. 테스트 자체도 `@nestjs/*`
  import 없이 이 계층과 동일한 무의존 원칙을 지킨다.
- **application(+ports)**: usecase 유닛 테스트의 대상(`PatchJobUseCase`, `ProcessPendingJobsUseCase`).
  목/스텁 `JobRepository` 구현이 이 계층의 포트 인터페이스를 대체한다.
- **adapters**: e2e 테스트가 실제로 구동하는 controller·`JobSchedulerAdapter`(수동 호출 시 tick
  경로 자체는 스모크 대상).
- **infrastructure**: e2e 테스트가 임시 파일로 격리해 실제 연결하는 `JsonDbJobRepository`. 동시성
  회귀 테스트는 반드시 이 계층 실물을 통과해야 02의 직렬화 큐 구현 자체를 검증할 수 있다(usecase
  유닛 테스트의 목 리포지토리는 큐 구현을 대체하지 않으므로 race 회귀를 잡아낼 수 없음).

## Pros

- 계층별 전략이 헥사고날 경계와 1:1 대응해, 어느 계층에서 실패했는지 테스트 실패 위치만으로 즉시
  판단 가능하다.
- 수동 tick 트리거는 03의 기존 설계(adapter/유스케이스 분리)를 그대로 재사용해 추가 구현 비용이
  거의 없다.
- 동시성 회귀 테스트가 02·03의 계약을 재서술 없이 참조로 소비해, 계약 변경 시 08을 별도로 갱신할
  필요 없이(02·03만 갱신) 테스트 시나리오의 의미가 유지된다.

## Cons

- e2e 계층의 동시성 회귀 테스트는 실제 파일 I/O를 수반해 domain/usecase 유닛보다 느리고, CI 실행
  시간에 기여하는 비중이 크다.
- `isTickRunning`/overrun 스킵을 비목표로 남기면서, 해당 로직에 버그가 있어도 무결성은 02가 보장하지만
  "스킵이 실제로 발생하는가"라는 성능 특성 자체는 테스트로 보증되지 않는 사각지대가 남는다.

## Performance tradeoffs

- 동시성 회귀 테스트가 실제 직렬화 큐를 통과시키므로, 두 PATCH/스케줄러 호출이 병렬로 시작해도
  내부적으로 순차 처리된다 — 테스트 자체의 실행 시간은 "임계구역 2회 실행 시간" 수준으로 짧지만,
  이 짧음 자체가 "직렬화가 실제로 일어나고 있다"는 방증이 아니므로 assert는 반드시 상태 결과에
  대해 이루어져야 하며 타이밍에 의존해서는 안 된다(테스트가 취약해지는 것을 방지).
- usecase 유닛 테스트는 인메모리 목을 사용해 파일 I/O가 없으므로 domain 유닛과 비슷한 속도로
  실행되며, 빠른 피드백 루프(TDD 워크플로)에 적합하다.

## Side effects

- e2e 테스트가 임시 파일을 다수 생성/삭제하므로, teardown 누락 시 `os.tmpdir()`에 잔여 파일이
  쌓일 수 있다 — CI 환경은 매 실행마다 임시 디렉터리가 초기화되므로 실질적 위험은 낮으나, 로컬
  반복 실행 시 누적 가능성을 인지해야 한다(teardown 절 참조).
- 동시성 회귀 테스트가 02의 실제 직렬화 큐 구현에 의존하므로, 02의 큐 구현이 변경되면(예: (a)에서
  다른 옵션으로 재평가) 08의 회귀 테스트가 즉시 실패해 회귀를 조기 탐지하는 안전망 역할도 겸한다.

## Alternatives considered

- **fake timer(옵션 1)**: `@nestjs/schedule` 내부 타이머 배선에 결합되어 버전 변경에 취약하고,
  03의 tick/유스케이스 분리 설계를 활용하지 못하는 우회 경로라 기각.
- **Vitest 등 대안 러너**: NestJS 표준 스캐폴딩·`@nestjs/testing` 통합 사례 부족으로 3일 마감 대비
  설정 비용이 (a) 대비 크고, 신규 의존성 도입 이득이 이번 스코프에서 없어 기각.
- **동시성 회귀를 usecase 유닛(목 리포지토리)에서 수행**: 목 리포지토리는 순서를 프로그래머가
  임의로 제어하므로 02의 실제 직렬화 큐 버그(예: 락 해제 누락)를 검출하지 못한다 — race 회귀는
  반드시 e2e(실물 `JsonDbJobRepository`)에서 수행해야 실효성이 있어 기각.
- **모든 계층을 e2e로 통일(계층 분리 없이 전부 HTTP 왕복으로 검증)**: 01의 전이 테이블처럼 순수
  함수로 전수 커버 가능한 대상까지 HTTP 스택을 왕복시키면 실행 시간이 비대해지고 실패 원인 특정이
  어려워져(YAGNI 위반) 기각.

## Follow-ups

- 실측 성능 데이터가 확보되면(03 Follow-ups) 배치 병렬화 검토와 함께, 동시성 회귀 테스트의 job
  개수를 늘려(예: 10건 동시 PATCH) 부하 시나리오를 추가할지 재검토한다.
- `isTickRunning`/overrun 스킵의 타이밍 검증이 필요해지면(예: 실제 운영 중 스킵 빈도 이슈 발생 시)
  fake timer 기반 보조 테스트를 별도로 추가하는 것을 재검토 후보로 남긴다(현재는 비목표).
- 07([07-ponytail-adoption.md](./07-ponytail-adoption.md))의 신규 의존성 도입 게이트 절차에 따라,
  향후 테스트 전용 유틸(예: 테스트 데이터 팩토리 라이브러리) 도입 시 사다리 판정을 남긴다.
