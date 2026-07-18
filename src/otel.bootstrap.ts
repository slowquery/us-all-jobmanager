import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { diag, DiagLogLevel } from '@opentelemetry/api';

/** OTel Resource의 `service.name`으로 사용할 값(06-observability-design.md traceId 규약 입력). */
const SERVICE_NAME = 'us-all-jobmanager';

/** exporter 미지정 시 사용할 OTLP HTTP 엔드포인트 기본값(로컬 Tempo/Collector 기본 포트). */
const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

/** {@link initializeOtel}에 전달 가능한 선택 옵션. */
export interface OtelBootstrapOptions {
  /**
   * 사용할 `SpanExporter`. 미지정 시 `OTEL_EXPORTER_OTLP_ENDPOINT` 환경변수(기본값
   * {@link DEFAULT_OTLP_ENDPOINT})를 가리키는 `OTLPTraceExporter`를 사용한다. 테스트 환경(e2e
   * `otel.setup.ts`)은 OTLP 재시도 노이즈·shutdown 지연을 격리하기 위해 exporter 미등록 또는
   * `InMemorySpanExporter`를 직접 주입한다(09-final-design.md 확정 #12).
   */
  traceExporter?: SpanExporter;
}

/** 현재 프로세스에서 초기화된 SDK 인스턴스(멱등 가드 겸 shutdown 훅 대상). `undefined`면 미초기화. */
let activeSdk: NodeSDK | undefined;

/**
 * OTel SDK(`@opentelemetry/sdk-node`)를 멱등하게 초기화한다(06-observability-design.md
 * traceId 규약 ②: "로컬 무Tempo 환경에서도 상시 초기화가 정본"). 이미 초기화된 상태에서
 * 다시 호출하면 아무 것도 하지 않고 기존 SDK 인스턴스를 그대로 반환한다 — `main.ts`가
 * import 순서 보장을 위해 최상단에서 호출하고, 테스트 환경(`test/setup/otel.setup.ts`)이
 * 동일 함수를 exporter만 바꿔 재사용해도 이중 등록(`NodeSDK.start()` 중복 호출) 에러가
 * 나지 않도록 하는 것이 목적이다.
 *
 * exporter로의 span 전송 실패(OTLP 미도달 등)는 SDK 내부 `BatchSpanProcessor`가 흡수하며 이
 * 함수 호출자에게 예외를 던지지 않는다 — 애플리케이션 동작에 영향을 주지 않는다(export
 * 실패는 무해). 다만 SDK 자체의 동기 초기화 오류(설정 오류 등)까지 앱을 죽이지 않도록
 * try/catch로 조용히 격리한다.
 *
 * @param options {@link OtelBootstrapOptions}
 * @returns 초기화된(또는 기존) `NodeSDK` 인스턴스. 초기화 자체가 실패하면 `undefined`.
 */
export function initializeOtel(options: OtelBootstrapOptions = {}): NodeSDK | undefined {
  if (activeSdk) {
    return activeSdk;
  }

  try {
    // OTLP exporter가 백그라운드로 던지는 진단 로그(미도달 경고 등)가 프로세스를 흔들지
    // 않도록 diag 레벨을 ERROR로 낮춘다 — 앱 동작에는 무해하되 콘솔 노이즈만 줄인다.
    diag.setLogger({
      error: () => undefined,
      warn: () => undefined,
      info: () => undefined,
      debug: () => undefined,
      verbose: () => undefined,
    }, DiagLogLevel.ERROR);

    const traceExporter = options.traceExporter ?? new OTLPTraceExporter({ url: `${resolveOtlpEndpoint()}/v1/traces` });

    const sdk = new NodeSDK({
      serviceName: SERVICE_NAME,
      traceExporter,
    });

    sdk.start();
    activeSdk = sdk;
    registerShutdownHook(sdk);
    return sdk;
  } catch {
    // 의도적으로 비움: SDK 초기화 실패가 애플리케이션 부트스트랩을 막지 않는다(export
    // 실패 무해 원칙을 초기화 단계까지 확장).
    return undefined;
  }
}

/** `OTEL_EXPORTER_OTLP_ENDPOINT` 환경변수 또는 기본값을 반환한다. */
function resolveOtlpEndpoint(): string {
  return process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_ENDPOINT;
}

/** 프로세스 종료 시그널에서 SDK를 정리하는 shutdown 훅을 1회만 등록한다. */
function registerShutdownHook(sdk: NodeSDK): void {
  const shutdown = (): void => {
    sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

/**
 * 테스트 전용: 프로세스 전역에 남은 SDK 초기화 상태를 초기화한다. 프로덕션 경로(`main.ts`)에서는
 * 호출하지 않는다 — 유닛 테스트가 `initializeOtel`의 멱등성 자체를 검증할 때만 사용한다.
 */
export function resetOtelForTesting(): void {
  activeSdk = undefined;
}
