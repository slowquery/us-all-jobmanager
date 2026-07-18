import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';

/**
 * e2e 테스트 전용 최소 OTel 부트스트랩(span-only, exporter 미연결).
 *
 * 06-observability-design.md가 확정한 "traceId는 OTel active span의 트레이스 ID를 정본으로
 * 한다"는 규약은 실제 active span이 존재해야만 관찰 가능하다. `@opentelemetry/api`의 기본
 * `NoopContextManager`는 `context.with()`가 컨텍스트를 실제로 전파하지 않으므로(항상
 * `getActiveSpan() === undefined`), `LoggingInterceptor`가 여는 스팬이 이후 비동기 처리
 * 흐름(유스케이스 → `FileLoggerAdapter`)까지 전파되는지 e2e에서 검증하려면 실제
 * `ContextManager`+`TracerProvider`를 전역 등록해야 한다(운영 환경의 `sdk-node` 상시 초기화와
 * 동등한 최소 조건 — `infrastructure/logging/file-logger.adapter.spec.ts`가 이미 채택한 패턴과
 * 동일하다).
 *
 * `main.ts`의 정식 OTel SDK 부트스트랩(exporter 설정 포함)은 이 파일의 책임이 아니다 — 이 파일은
 * jest e2e 프로세스 전역에서 스팬 컨텍스트 전파만 재현하는 테스트 인프라이며, 존재하지 않으면
 * 임시로 생성해 두되 정본화는 후속 세션(S6, OTel SDK 프로덕션 부트스트랩 통합)이 담당한다.
 */
const contextManager = new AsyncHooksContextManager();
contextManager.enable();
context.setGlobalContextManager(contextManager);

const provider = new BasicTracerProvider();
trace.setGlobalTracerProvider(provider);
