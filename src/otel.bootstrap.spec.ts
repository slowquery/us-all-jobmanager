import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { initializeOtel, resetOtelForTesting } from './otel.bootstrap';

describe('initializeOtel', () => {
  afterEach(() => {
    resetOtelForTesting();
    jest.restoreAllMocks();
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
});
