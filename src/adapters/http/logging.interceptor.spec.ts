import { CallHandler, ExecutionContext, NotFoundException } from '@nestjs/common';
import { firstValueFrom, of, throwError } from 'rxjs';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';
import { ApiException } from './api.exception';
import { LoggingInterceptor } from './logging.interceptor';

function makeContext(method: string, path: string, statusCode: number): ExecutionContext {
  const response = { statusCode };
  const request = { method, originalUrl: path };
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

function makeHandler(result: unknown, error?: unknown): CallHandler {
  return { handle: () => (error === undefined ? of(result) : throwError(() => error)) };
}

describe('LoggingInterceptor', () => {
  it('성공 응답은 http_request 이벤트를 level:info로 정확히 1회 기록하고 body는 로깅하지 않는다', async () => {
    const logger = new InMemoryLogger();
    const interceptor = new LoggingInterceptor(logger);
    const context = makeContext('POST', '/jobs', 201);

    await firstValueFrom(interceptor.intercept(context, makeHandler({ id: '1', title: 'secret title' })));

    expect(logger.events).toHaveLength(1);
    const [event] = logger.events as unknown as Record<string, unknown>[];
    expect(event).toMatchObject({ type: 'http_request', level: 'info', method: 'POST', path: '/jobs', statusCode: 201 });
    expect(event.errorCode).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain('secret title');
  });

  it('ApiException 발생 시 해당 상태 코드/에러 코드로 level:error 이벤트를 기록하고 예외를 다시 던진다', async () => {
    const logger = new InMemoryLogger();
    const interceptor = new LoggingInterceptor(logger);
    const context = makeContext('PATCH', '/jobs/1', 200);
    const error = new ApiException(409, 'INVALID_TRANSITION', '전이 불가');

    await expect(firstValueFrom(interceptor.intercept(context, makeHandler(undefined, error)))).rejects.toBe(error);

    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]).toMatchObject({ type: 'http_request', level: 'error', statusCode: 409, errorCode: 'INVALID_TRANSITION' });
  });

  it('알 수 없는 예외는 500/INTERNAL로 기록한다', async () => {
    const logger = new InMemoryLogger();
    const interceptor = new LoggingInterceptor(logger);
    const context = makeContext('GET', '/jobs', 200);
    const error = new Error('boom');

    await expect(firstValueFrom(interceptor.intercept(context, makeHandler(undefined, error)))).rejects.toBe(error);

    expect(logger.events[0]).toMatchObject({ statusCode: 500, errorCode: 'INTERNAL' });
  });

  it('NestJS 내장 404(NotFoundException)는 errorCode NOT_FOUND로 기록한다', async () => {
    const logger = new InMemoryLogger();
    const interceptor = new LoggingInterceptor(logger);
    const context = makeContext('GET', '/unknown', 200);
    const error = new NotFoundException();

    await expect(firstValueFrom(interceptor.intercept(context, makeHandler(undefined, error)))).rejects.toBe(error);

    expect(logger.events[0]).toMatchObject({ statusCode: 404, errorCode: 'NOT_FOUND' });
  });
});
