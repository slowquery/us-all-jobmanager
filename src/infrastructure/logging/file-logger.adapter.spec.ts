import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { FileLoggerAdapter } from './file-logger.adapter';

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/;

/**
 * write stream은 비동기로 flush되므로, 파일에 내용이 실제로 기록될 때까지 짧게 폴링한다
 * (`fs.createWriteStream`은 내부 버퍼링 이후 커널에 flush하는 시점이 동기 호출 직후가 아니다).
 */
async function waitForContent(path: string, timeoutMs = 2000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      if (content.trim().length > 0) {
        return content;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for content at ${path}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('FileLoggerAdapter', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'file-logger-adapter-'));
    logPath = join(dir, 'logs.txt');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('이벤트 1건을 NDJSON 한 줄로 기록하고 공통 필드를 포함한다', async () => {
    const logger = new FileLoggerAdapter(logPath);

    logger.log({
      type: 'http_request',
      level: 'info',
      source: 'http',
      message: 'request completed',
      method: 'POST',
      path: '/jobs',
      statusCode: 201,
      latencyMs: 12,
    });
    const content = await waitForContent(logPath);

    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.level).toBe('info');
    expect(parsed.source).toBe('http');
    expect(parsed.message).toBe('request completed');
    expect(parsed.method).toBe('POST');
    expect(parsed.statusCode).toBe(201);
    expect(parsed.type).toBeUndefined();
    expect(() => new Date(parsed.timestamp).toISOString()).not.toThrow();
    expect(parsed.timestamp).toBe(new Date(parsed.timestamp).toISOString());
  });

  it('여러 이벤트를 기록하면 라인 수만큼 write되고 각 라인이 독립적으로 파싱된다', async () => {
    const logger = new FileLoggerAdapter(logPath);

    logger.log({ type: 'error', level: 'error', source: 'http', message: 'boom', errorCode: 'INTERNAL' });
    logger.log({ type: 'tick', level: 'info', source: 'scheduler', message: 'tick start', tickId: 't1', phase: 'start' });
    const content = await waitForContent(logPath);

    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(() => lines.map((line) => JSON.parse(line))).not.toThrow();
  });

  it('active span이 없으면 32-hex fallback traceId를 발급하고 spanId는 생략한다', async () => {
    const logger = new FileLoggerAdapter(logPath);

    logger.log({ type: 'error', level: 'error', source: 'http', message: 'no span here', errorCode: 'X' });
    const content = await waitForContent(logPath);

    const parsed = JSON.parse(content.trim());
    expect(parsed.traceId).toMatch(TRACE_ID_PATTERN);
    expect(parsed.spanId).toBeUndefined();
  });

  it('active span이 있으면 32-hex traceId와 16-hex spanId를 함께 기록한다', async () => {
    // NoopContextManager(기본값)는 with()가 컨텍스트를 실제로 전파하지 않아 getActiveSpan()이
    // 항상 undefined다. 실제 스팬 전파를 검증하려면 AsyncHooksContextManager + 실 TracerProvider를
    // 등록해야 한다(운영 환경의 sdk-node 상시 초기화와 동등한 조건).
    const contextManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(contextManager);
    const provider = new BasicTracerProvider();
    trace.setGlobalTracerProvider(provider);

    try {
      const logger = new FileLoggerAdapter(logPath);
      const tracer = trace.getTracer('test');

      await tracer.startActiveSpan('test-span', async (span) => {
        logger.log({ type: 'error', level: 'error', source: 'http', message: 'within span', errorCode: 'X' });
        span.end();
      });
      const content = await waitForContent(logPath);

      const parsed = JSON.parse(content.trim());
      expect(parsed.traceId).toMatch(TRACE_ID_PATTERN);
      expect(parsed.spanId).toMatch(SPAN_ID_PATTERN);
    } finally {
      trace.disable();
      context.disable();
      contextManager.disable();
    }
  });

  it('스트림 write가 실패해도 log()는 예외를 던지지 않는다(로깅 실패 격리)', () => {
    const logger = new FileLoggerAdapter(logPath);
    const stream = (logger as unknown as { stream: { write: () => void } }).stream;
    jest.spyOn(stream, 'write').mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => logger.log({
      type: 'error',
      level: 'error',
      source: 'http',
      message: 'should not throw',
      errorCode: 'X',
    })).not.toThrow();
  });
});
