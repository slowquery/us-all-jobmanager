import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { ApiException, resolveErrorEnvelope } from './api.exception';

describe('resolveErrorEnvelope', () => {
  it('ApiException은 envelope의 code와 status를 그대로 사용한다', () => {
    const exception = new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', '전이 불가');
    expect(resolveErrorEnvelope(exception)).toEqual({
      status: HttpStatus.CONFLICT,
      code: 'INVALID_TRANSITION',
    });
  });

  it('400 HttpException은 VALIDATION_FAILED로 매핑된다', () => {
    const exception = new HttpException('bad', HttpStatus.BAD_REQUEST);
    expect(resolveErrorEnvelope(exception)).toEqual({
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
    });
  });

  it('404 HttpException은 NOT_FOUND로 매핑된다', () => {
    expect(resolveErrorEnvelope(new NotFoundException())).toEqual({
      status: HttpStatus.NOT_FOUND,
      code: 'NOT_FOUND',
    });
  });

  it('5xx HttpException은 INTERNAL로 매핑된다', () => {
    const exception = new HttpException('boom', HttpStatus.BAD_GATEWAY);
    expect(resolveErrorEnvelope(exception)).toEqual({
      status: HttpStatus.BAD_GATEWAY,
      code: 'INTERNAL',
    });
  });

  it('그 외 4xx HttpException은 HTTP_ERROR로 매핑된다', () => {
    const exception = new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT);
    expect(resolveErrorEnvelope(exception)).toEqual({
      status: HttpStatus.I_AM_A_TEAPOT,
      code: 'HTTP_ERROR',
    });
  });

  it('HttpException이 아닌 예외는 500 INTERNAL로 매핑된다', () => {
    expect(resolveErrorEnvelope(new Error('unexpected'))).toEqual({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
    });
  });
});
