# NestJS 모듈 분리 — API/스케줄러/인프라 3계층 + AppModule 조합화

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
사용자 제안: API 엔드포인트로 호출되는 것은 별도 모듈로 분리해 main module에서 import하는 방식이 유지보수에 유리하다. 검토 후 진행.

기존 `AppModule` 단일 파일이 세 관심사(인프라 포트 바인딩 / HTTP 컨트롤러·유스케이스·전역 파이프라인 / 스케줄러)를 한 `providers` 배열에 섞어 128줄로 비대했다.

## Chosen design / pattern / technology
포트 provider를 HTTP·스케줄러가 공유하므로, API 모듈만 떼면 포트 중복 정의/순환이 생긴다. 정석 3계층으로 분리했다:
1. **InfrastructureModule** (`src/infrastructure/infrastructure.module.ts`): `LOGGER_PORT`/`JOB_REPOSITORY`/`JOB_PROCESSOR` 바인딩 + **export**(공유 코어).
2. **HttpModule** (`src/adapters/http/http.module.ts`, = 제안한 API 모듈): `imports: [InfrastructureModule]`, `JobsController` + HTTP 유스케이스 5종 + 전역 `APP_PIPE`/`APP_FILTER`/`APP_INTERCEPTOR`.
3. **SchedulerModule** (`src/adapters/scheduler/scheduler.module.ts`): `imports: [InfrastructureModule, ScheduleModule.forRoot()]` + `ProcessPendingJobsUseCase`/`JobSchedulerAdapter`.
4. **AppModule**: `imports: [InfrastructureModule, HttpModule, SchedulerModule]`만(조합 전용, 128→20줄).

전역 `APP_*` provider는 HttpModule에서 등록해도 NestFactory가 전 모듈에서 수집하므로 앱 전역 적용이 유지된다.

## Pros
- API 관심사가 HttpModule 한 곳에 응집 → 엔드포인트 추가/변경 시 수정 지점 국소화(유지보수성, 제안 목적 달성).
- 인프라/HTTP/스케줄러 경계가 모듈로 명시화, AppModule은 조합만 담당.
- InfrastructureModule이 토큰을 export하므로 e2e의 `.overrideProvider(LOGGER_PORT|JOB_REPOSITORY)`가 그대로 동작(회귀 없음, e2e 17 green으로 실증).

## Cons
- 파일 수 증가(모듈 3개 신설). 소규모 앱에선 단일 모듈이 더 단순하다는 반론은 있으나, 이미 세 관심사가 뚜렷해 분리 이득이 크다.
- InfrastructureModule이 AppModule·HttpModule·SchedulerModule 세 곳에서 import되지만 Nest가 모듈 인스턴스를 dedup(싱글턴)하므로 포트 인스턴스는 1개만 생성된다.

## Performance tradeoffs
- 없음. 배선 구조만 변경, 런타임 동작·인스턴스 수 동일(포트 싱글턴 공유). build/test 시간 영향 미미.

## Side effects
- CI SemVer 게이트 대상 → 0.2.2 → 0.3.0(minor, 구조 개선).
- 스케줄러 README의 "AppModule provider 등록" 서술을 SchedulerModule로 정정(Rule 10 colocation).
- 신규 spec `app.module.spec.ts`(배선·export·HttpModule 단독 해결 3케이스).

## Alternatives considered
- API 모듈만 분리하고 인프라·스케줄러는 AppModule 유지: 포트 provider를 API 모듈이 재정의해야 해 중복/경계 훼손 → 기각.
- `@Global()` InfrastructureModule: import 명시가 사라져 의존성이 암묵화됨 → 명시적 import가 추적성에 유리해 기각.
- 유스케이스별 모듈 세분화: 과분할(현 규모 대비 이득 없음) → 기각.

## Follow-ups
- 없음. 향후 엔드포인트 그룹이 늘면 HttpModule을 도메인별 서브모듈로 더 나눌 수 있다.
