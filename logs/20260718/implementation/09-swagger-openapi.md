# Swagger(OpenAPI) 문서화 — 요청/응답 example 전체 추가

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
사용자 요청: `@nestjs/swagger`로 모든 엔드포인트의 요청·응답 example을 전부 추가한다.

기존 응답 타입(`JobResponse`/`JobListResponse`)과 에러 envelope(`ApiErrorBody`)이 interface라 swagger가 런타임 스키마를 만들 수 없었고, 요청 DTO에도 `@ApiProperty`가 없었다.

## Chosen design / pattern / technology
- `@nestjs/swagger@11`(Nest 11 호환) 설치. `swagger-ui-express`는 불필요(11이 `swagger-ui-dist` 번들).
- **응답 클래스 DTO 신설**: `JobResponseDto`/`JobListResponseDto`(`job-response.dto.ts`), `ApiErrorResponseDto`/`ApiErrorDetailDto`(`api-error-response.dto.ts`)에 `@ApiProperty(example)`. 기존 `JobResponse`는 `JobResponseDto`의 타입 별칭으로 두어 `toJobResponse` 반환 구조 동일(런타임 무변경, e2e 응답 shape 회귀 없음).
- **요청 DTO**: Create/Patch/Search에 `@ApiProperty`/`@ApiPropertyOptional`(description·example·min/maxLength·enum). 검증용 합성 프로퍼티 `atLeastOneField`는 `@ApiHideProperty`로 문서에서 숨김.
- **컨트롤러**: `@ApiTags('jobs')` + 엔드포인트별 `@ApiOperation`·`@ApiBody(examples)`·`@ApiParam`·`@ApiCreatedResponse`/`@ApiOkResponse`/`@ApiBadRequestResponse`/`@ApiNotFoundResponse`/`@ApiConflictResponse`(성공·에러 example 포함).
- **main.ts**: `DocumentBuilder`+`SwaggerModule.setup('api-docs')` — `/api-docs`(UI), `/api-docs-json`(OpenAPI JSON).

## Pros
- 5개 엔드포인트의 요청/응답·에러 example이 OpenAPI 문서로 노출(테스트로 실증: paths 3·schemas 6·요청 example·응답 example·409 example).
- 응답을 클래스로 승격해 스키마·example이 코드와 단일 정본으로 동기화.
- 합성 검증 프로퍼티는 문서에서 숨겨 계약 노출 최소화.

## Cons
- 컨트롤러에 example 리터럴이 늘어 파일이 길어짐(가독성 vs 문서 완결성 트레이드오프 — 문서 완결성 우선).
- swagger CLI 플러그인 미사용이라 `@ApiProperty`를 필드마다 명시(자동 추론 대신 명시적 example 제어).

## Performance tradeoffs
- 런타임 무관(문서는 부트스트랩 1회 생성). e2e/유닛 시간 영향 미미.

## Side effects
- CI SemVer 게이트 대상 → 0.3.0 → 0.4.0(minor, 신규 문서화 기능).
- 신규 `swagger.spec.ts`(경로·요청/응답 example·숨김 프로퍼티 6케이스). `@nestjs/swagger` 의존성·yarn.lock 갱신.

## Alternatives considered
- swagger CLI 플러그인(`nestjs/swagger` transformer)으로 `@ApiProperty` 자동 생성: 빌드 설정(ts transformer) 추가 필요 + example은 어차피 수동 지정이라 명시적 데코레이터로 통일 → 기각.
- 응답 interface 유지 + `@ApiResponse`에 raw schema 수기 작성: 코드-스키마 이중화 → 클래스 승격이 단일 정본이라 채택.

## Follow-ups
- 인증 도입 시 `@ApiBearerAuth`/`addBearerAuth` 추가.
- 필요 시 swagger CLI 플러그인으로 description 자동 추론 도입 검토(선택).
