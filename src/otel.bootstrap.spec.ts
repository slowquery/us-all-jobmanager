import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { initializeOtel, resetOtelForTesting } from './otel.bootstrap';

describe('initializeOtel', () => {
  afterEach(() => {
    resetOtelForTesting();
    jest.restoreAllMocks();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    // registerShutdownHook이 붙인 once 리스너가 signal 미발화 테스트에 잔존하면 이후
    // 테스트의 신호 발화 검증에 오염을 남기므로 매 테스트 후 제거한다.
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('최초 호출 시 NodeSDK.start()를 1회 호출하고 SDK 인스턴스를 반환한다', () => {
    const startSpy = jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);

    const sdk = initializeOtel({ traceExporter: new InMemorySpanExporter() });

    expect(sdk).toBeInstanceOf(NodeSDK);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('이미 초기화된 상태에서 다시 호출하면 no-op이며 동일 인스턴스를 반환한다(멱등성)', () => {
    const startSpy = jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);

    const first = initializeOtel({ traceExporter: new InMemorySpanExporter() });
    const second = initializeOtel({ traceExporter: new InMemorySpanExporter() });

    expect(second).toBe(first);
    // 두 번째 호출은 새 SDK를 구성하거나 start()를 다시 호출하지 않는다.
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('SDK 초기화 중 예외가 발생해도 던지지 않고 undefined를 반환한다(앱 부트스트랩 무해화)', () => {
    jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => {
      throw new Error('boom');
    });

    const sdk = initializeOtel({ traceExporter: new InMemorySpanExporter() });

    expect(sdk).toBeUndefined();
  });

  it('traceExporter 미지정 + 환경변수 미설정 시 기본 OTLP 엔드포인트로 exporter를 구성해 초기화한다', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const startSpy = jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);

    const sdk = initializeOtel();

    expect(sdk).toBeInstanceOf(NodeSDK);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('traceExporter 미지정 + OTEL_EXPORTER_OTLP_ENDPOINT 설정 시 해당 엔드포인트로 exporter를 구성해 초기화한다', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector.internal:4318';
    const startSpy = jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);

    const sdk = initializeOtel();

    expect(sdk).toBeInstanceOf(NodeSDK);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('SIGTERM 수신 시 등록된 SDK의 shutdown()을 호출한다', () => {
    jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);
    const shutdownSpy = jest.spyOn(NodeSDK.prototype, 'shutdown').mockResolvedValue(undefined);

    initializeOtel({ traceExporter: new InMemorySpanExporter() });
    process.emit('SIGTERM');

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('SIGINT 수신 시 등록된 SDK의 shutdown()을 호출한다', () => {
    jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);
    const shutdownSpy = jest.spyOn(NodeSDK.prototype, 'shutdown').mockResolvedValue(undefined);

    initializeOtel({ traceExporter: new InMemorySpanExporter() });
    process.emit('SIGINT');

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });
});
