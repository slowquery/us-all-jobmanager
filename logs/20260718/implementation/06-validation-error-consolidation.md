# API 검증·에러 처리 공통화 — class-validator 응집 + 에러 매핑 단일화

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
사용자 제안: API 엔드포인트의 에러 처리를 class-validator/class-transformer로 검증하고, 에러 문구·공통 처리는 exception filter + pipe로 공통화하는 게 낫다.

조사 결과 목표 아키텍처는 **이미 PR #4에 구현**되어 있었다 — 전역 `ValidationPipe`(`whitelist`/`forbidNonWhitelisted`), 전역 `HttpExceptionFilter`(`@Catch()`), `ApiException`/`ApiErrorBody` envelope, DTO 3종의 class-validator 데코레이터. 따라서 제안의 "정신"을 실제로 완성하는 남은 간극만 반영했다(이전 설계 P3·보안 LOW 리뷰와 일치).

## Chosen design / pattern / technology
1. **에러 매핑 단일 정본**: 예외 → `{ status, code }` 매핑을 순수 함수 `resolveErrorEnvelope`(api.exception.ts)로 추출. `HttpExceptionFilter`와 `LoggingInterceptor`가 각자 복제하던 매핑을 이 함수 호출로 대체 → 구조적으로 항상 일치(수동 동기화 주석 제거).
2. **검증 로직 DTO 응집**: 커스텀 클래스-검증 데코레이터 `AtLeastOneField(fields)`를 도입. PATCH·검색의 "최소 1개 필드" 규칙을 컨트롤러 `if` 분기에서 DTO로 이동 → ValidationPipe 단일 파이프라인으로 일원화, 컨트롤러 분기 2개 제거.
3. **search title 길이 상한**: `SearchQueryDto.title`에 `@Length(1, 200)` 추가(create/patch와 일관, 무제한 검색어 DoS 벡터 차단).
4. **`transform: true`** + `transformOptions.enableImplicitConversion: false`: DTO를 실제 클래스 인스턴스로 변환(class-transformer 활용). 암시적 형변환은 끔(쿼리/바디가 모두 문자열이라 불필요·예측가능성 우선).

## Pros
- 매핑 이중화 제거로 필터/인터셉터 errorCode 드리프트 원천 차단.
- 검증이 DTO 선언에 응집 → 컨트롤러는 유스케이스 호출에 집중, 규칙 가시성↑.
- search 무제한 검색어 차단(보안).

## Cons
- `AtLeastOneField`는 `@IsOptional`이 붙은 실제 필드에 부착하면 값 부재 시 검증이 통째로 건너뛰어진다(class-validator 동작). 이를 우회하려 **합성 프로퍼티**(`atLeastOneField?: unknown`)에 부착하고 validator options에 `always: true`를 준다 — 다소 우회적. 합성 프로퍼티가 whitelist에 포함되어 클라이언트가 동명 키를 보내도 거부되지 않지만, `unknown`이라 무해.

## Performance tradeoffs
- 없음. 검증은 요청당 1회 동일 비용. 컨트롤러 분기 제거로 미세하게 단순화.

## Side effects
- 컨트롤러 단위 테스트 2건(직접 호출로 guard 검증) 제거 — 해당 규칙은 DTO 검증 + e2e로 커버. 신규 spec: `AtLeastOneField`(3), `resolveErrorEnvelope`(6), DTO empty/cap 케이스.
- CI SemVer 게이트 대상 → 0.1.1 → 0.2.0(minor, 검증/에러 처리 구조 개선).

## Alternatives considered
- 컨트롤러 `if` 유지: 제안(검증은 class-validator로 공통화)과 배치되어 기각.
- `@ValidateIf`/전역 커스텀 파이프로 "최소 1개" 구현: 데코레이터 응집보다 분산되어 기각.
- `enableImplicitConversion: true`: 쿼리 숫자/불리언 자동 변환 이점이 현 DTO(문자열/열거)엔 없고 예기치 못한 강제변환 위험이 있어 기각.

## Follow-ups
- 합성 프로퍼티 whitelist 노출을 `@Exclude`/`@Expose`로 더 조일지 검토(선택, 무해).
- 05 로깅/04 API 문서에 `resolveErrorEnvelope` 단일 정본 반영(선택).
