/**
 * 포트 인터페이스(`JobRepository`/`LoggerPort`)는 런타임 값이 아니므로 NestJS DI 토큰으로 직접 쓸 수
 * 없다 — 이 상수들을 `@Inject`/`useClass`/`useFactory` 바인딩의 토큰으로 사용한다. `adapters` 계층
 * 전역(HTTP·스케줄러)이 공유하는 접점이라 `adapters` 루트에 둔다(Rule 3, 헥사고날 경계 유지 목적).
 */
export const JOB_REPOSITORY = Symbol('JOB_REPOSITORY');

/** {@link JOB_REPOSITORY}와 동일한 목적의 `LoggerPort` DI 토큰. */
export const LOGGER_PORT = Symbol('LOGGER_PORT');

/** {@link JOB_REPOSITORY}와 동일한 목적의 `JobProcessor` DI 토큰(스케줄러 배선, S6). */
export const JOB_PROCESSOR = Symbol('JOB_PROCESSOR');

/** {@link JOB_REPOSITORY}와 동일한 목적의 `SupportedJobTypes` DI 토큰(구현된 작업 유형 레지스트리). */
export const SUPPORTED_JOB_TYPES = Symbol('SUPPORTED_JOB_TYPES');
