import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { initializeOtel } from '../../src/otel.bootstrap';

/**
 * e2e 테스트 전용 OTel 부트스트랩(span-only, OTLP exporter 미연결).
 *
 * 06-observability-design.md가 확정한 "traceId는 OTel active span의 트레이스 ID를 정본으로
 * 한다"는 규약은 실제 active span이 존재해야만 관찰 가능하다. `src/otel.bootstrap.ts`의
 * 멱등 초기화 함수 {@link initializeOtel}을 재사용하되, `traceExporter`만
 * `InMemorySpanExporter`(네트워크 I/O 없음, `SpanExporter` 인터페이스 구현체)로 교체해
 * OTLP 재시도 노이즈·shutdown 지연을 e2e 테스트에서 격리한다 — `NodeSDK`가 내부적으로 등록하는
 * `AsyncHooksContextManager`+`NodeTracerProvider`는 프로덕션(`main.ts`)과 동일하므로,
 * `LoggingInterceptor`가 여는 스팬이 이후 비동기 처리 흐름(유스케이스 → `FileLoggerAdapter`)까지
 * 전파되는지 e2e에서 그대로 검증할 수 있다(운영 환경의 `sdk-node` 상시 초기화와 동등한 최소 조건).
 *
 * `initializeOtel`은 멱등(이미 초기화된 상태면 no-op)이므로, jest가 이 setup 파일을 여러 테스트
 * 프로세스/워커에서 재실행해도 이중 등록 에러가 발생하지 않는다. `main.ts`의 정식 OTel SDK
 * 부트스트랩(운영 OTLP exporter 설정)은 이 파일의 책임이 아니다 — 이 파일은 jest e2e 프로세스
 * 전역에서 스팬 컨텍스트 전파만 재현하는 테스트 인프라다.
 */
initializeOtel({ traceExporter: new InMemorySpanExporter() });
