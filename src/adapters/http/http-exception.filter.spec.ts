import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';
import { ApiException } from './api.exception';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(): { host: ArgumentsHost; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  return {
    host,
    status,
    json,
  };
}

describe('HttpExceptionFilter', () => {
  it('ApiException은 내장된 envelope을 그대로 응답한다', () => {
    const filter = new HttpExceptionFilter(new InMemoryLogger());
    const { host, status, json } = makeHost();

    filter.catch(new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', '전이 불가', [{
      field: 'status',
      reason: 'x',
    }]), host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: 'INVALID_TRANSITION',
      message: '전이 불가',
      details: [{
        field: 'status',
        reason: 'x',
      }],
    });
  });

  it('ValidationPipe의 기본 400 BadRequestException을 VALIDATION_FAILED envelope으로 변환한다', () => {
    const filter = new HttpExceptionFilter(new InMemoryLogger());
    const { host, status, json } = makeHost();

    filter.catch(new BadRequestException([
      'title must be a string',
      'title should not be empty',
    ]), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual([
      { reason: 'title must be a string' },
      { reason: 'title should not be empty' },
    ]);
  });

  it('그 외 HttpException(404)은 상태 코드를 보존하며 NOT_FOUND로 매핑한다', () => {
    const filter = new HttpExceptionFilter(new InMemoryLogger());
    const { host, status, json } = makeHost();

    filter.catch(new NotFoundException('Cannot GET /unknown'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0].code).toBe('NOT_FOUND');
  });

  it('그 외 HttpException(403, 5xx 미만)은 상태 코드를 보존하며 HTTP_ERROR로 매핑한다', () => {
    const filter = new HttpExceptionFilter(new InMemoryLogger());
    const { host, status, json } = makeHost();

    filter.catch(new ForbiddenException('접근 권한이 없습니다'), host);

    expect(status).toHaveBeenCalledWith(403);
    expect(json.mock.calls[0][0].code).toBe('HTTP_ERROR');
  });

  it('그 외 HttpException(5xx)은 상태 코드를 보존하며 INTERNAL로 매핑한다', () => {
    const filter = new HttpExceptionFilter(new InMemoryLogger());
    const { host, status, json } = makeHost();

    filter.catch(new HttpException('service unavailable', HttpStatus.SERVICE_UNAVAILABLE), host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json.mock.calls[0][0].code).toBe('INTERNAL');
  });

  it('ValidationPipe 응답 본문이 객체가 아니면(message 필드 없음) exception.message를 details로 사용한다', () => {
    const filter = new HttpExceptionFilter(new InMemoryLogger());
    const { host, status, json } = makeHost();

    filter.catch(new HttpException('plain string body', HttpStatus.BAD_REQUEST), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.details).toEqual([{ reason: 'plain string body' }]);
  });

  it('예기치 못한 예외는 500 INTERNAL로 고정하고 내부 메시지를 응답에 노출하지 않으며 LoggerPort에 상세를 남긴다', () => {
    const logger = new InMemoryLogger();
    const filter = new HttpExceptionFilter(logger);
    const { host, status, json } = makeHost();

    filter.catch(new Error('database file corrupted at /secret/path'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body.code).toBe('INTERNAL');
    expect(body.message).not.toContain('/secret/path');
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]).toMatchObject({
      type: 'error',
      level: 'error',
      errorCode: 'INTERNAL',
    });
    expect((logger.events[0] as { message: string }).message).toContain('/secret/path');
  });
});
