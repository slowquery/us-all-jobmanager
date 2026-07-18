# 설계 리뷰 LOW 3건 해소 — 모듈 경계·검증기·Swagger 스키마 정리

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
PR #4 전체 재리뷰(Rule 6)에서 설계 관점은 CLEAR/APPROVE였고 LOW 3건만 남았다. 사용자 지시로 이 LOW 3건을 이 PR에서 해소한다.

## Chosen design / pattern / technology
1. **JOB_PROCESSOR 소유 모듈 이동**: `InfrastructureModule`이 `TracingJobProcessor`(adapters/scheduler)를 import·바인딩해 infrastructure→adapters 역방향 의존이 있었다. 유일 소비자인 `SchedulerModule`로 provider를 이동하고 InfrastructureModule에서 제거(import·export·docstring 정리). 이제 infrastructure는 자기 계층(logging/persistence)만 참조한다.
2. **api-error-response.dto `code` 표기 표준화**: `@ApiProperty({ example, examples:[...] })`의 property 레벨 `examples` 배열은 OpenAPI 3.0 schema 비표준이었다. `enum: [...]`(표준) + 단수 `example`로 교체하고 실제 코드 `HTTP_ERROR`를 목록에 추가(resolveErrorEnvelope와 일치).
3. **AtLeastOneField를 클래스 데코레이터로 재작성(합성 프로퍼티 제거)**: 기존엔 검증을 얹기 위해 합성 프로퍼티 `atLeastOneField?: unknown`을 두었는데, 이 프로퍼티가 화이트리스트에 포함되어 클라이언트가 동명 키를 보내도 `forbidNonWhitelisted`가 거부하지 못했다(06 Cons/Follow-up에 수용 기록). `ClassDecorator`로 재작성해 클래스에 직접 부착 → **스키마에 프로퍼티가 추가되지 않아** 여분 키가 정상 거부되고, `@IsOptional` 스킵 문제도 원천 소멸. PatchJobDto/SearchQueryDto의 합성 프로퍼티·`@ApiHideProperty` 제거.

## Pros
- 헥사고날 경계 강화: infrastructure가 adapters에 의존하지 않음. 소유(정의)-소비 지점 일치.
- OpenAPI 문서가 표준 스키마(enum)로 정확.
- 보안 개선 실증: `atLeastOneField` 여분 키 전송이 이제 400 VALIDATION_FAILED로 거부됨(e2e 신규 테스트로 검증, 06 Follow-up 완결).

## Cons
- `AtLeastOneField`가 `PropertyDecorator`→`ClassDecorator`로 시그니처 변경(내부 전용이라 영향 국소, spec 갱신 완료).

## Performance tradeoffs
- 없음. 배선/데코레이터 위치 변경만.

## Side effects
- CI SemVer 게이트 대상 → 0.4.0 → 0.4.1(patch).
- e2e 17→18(atLeastOneField whitelist 거부 케이스 추가). app.module.spec: InfrastructureModule은 JOB_PROCESSOR를 제공하지 않음을 assert. swagger.spec: PatchJobDto가 실제 3필드만 노출을 assert.

## Alternatives considered
- `@Exclude()`(class-transformer)로 합성 프로퍼티 숨김: 화이트리스트는 검증 메타데이터 기반이라 여분 키가 여전히 통과(프로브로 확인) → 기각.
- 합성 프로퍼티 유지 + 결정로그 수용 유지: 사용자가 해소 지시 → 클래스 데코레이터로 근본 해결.
- JOB_PROCESSOR를 그대로 두기: 역방향 의존은 버그는 아니나 경계 명확성 위해 이동.

## Follow-ups
- 없음(설계 LOW 3건 종결). 성능/보안 관점 WATCH 항목은 별도.
