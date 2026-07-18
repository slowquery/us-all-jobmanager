import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Response } from 'express';
import { LoggerPort } from '../../application/ports/logger.port';
import { LOGGER_PORT } from '../tokens';
import { ApiErrorBody, ApiException } from './api.exception';

/** {@link ApiErrorBody}에 응답으로 내려줄 HTTP 상태 코드를 더한 내부 결합 타입. */
type ResolvedError = ApiErrorBody & { status: number };

/**
 * 전역 예외 필터. `HttpException` 계열(`ApiException` 포함)과 예기치 못한 예외를 모두 동일한
 * 에러 envelope(`{ code, message, details? }`)으로 직렬화한다(04·09-final-design.md 확정 #4).
 *
 * - `ApiException`: 컨트롤러/유스케이스가 이미 구성한 envelope을 그대로 사용한다.
 * - 그 외 `HttpException`(대표적으로 `ValidationPipe`의 검증 실패): 400은 `VALIDATION_FAILED`로
 *   고정 매핑한다(09 확정 #6, 422 대신 400).
 * - 그 외 예기치 못한 예외: 500 `INTERNAL`로 고정하고, 응답 body에는 내부 정보(스택/메시지)를
 *   전혀 노출하지 않는다 — 상세는 `LoggerPort`의 `error` 이벤트로만 기록한다
 *   (09 확정 #11 보안 조항 ①).
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter<unknown> {
  /** @param logger 500 상세를 기록할 구조화 로깅 포트 */
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const resolved = this.resolve(exception);
    const body: ApiErrorBody = {
      code: resolved.code,
      message: resolved.message,
      ...(resolved.details === undefined ? {} : { details: resolved.details }),
    };
    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof ApiException) {
      const body = exception.getResponse() as ApiErrorBody;
      return {
        status: exception.getStatus(),
        ...body,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.BAD_REQUEST) {
        return this.resolveValidationFailure(exception);
      }
      if (status === HttpStatus.NOT_FOUND) {
        return {
          status,
          code: 'NOT_FOUND',
          message: exception.message,
        };
      }
      return {
        status,
        code: status >= 500 ? 'INTERNAL' : 'HTTP_ERROR',
        message: exception.message,
      };
    }

    return this.resolveInternalError(exception);
  }

  /** `ValidationPipe`가 던지는 기본 400 응답(`message: string[]`)을 검증 실패 envelope으로 변환한다. */
  private resolveValidationFailure(exception: HttpException): ResolvedError {
    const raw = exception.getResponse();
    const rawMessages = typeof raw === 'object' && raw !== null && 'message' in raw ? (raw as { message: unknown }).message : exception.message;
    const messages = Array.isArray(rawMessages) ? rawMessages.map(String) : [String(rawMessages)];
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_FAILED',
      message: '요청이 유효하지 않습니다.',
      details: messages.map((reason) => ({ reason })),
    };
  }

  /** 예기치 못한 예외를 500 `INTERNAL`로 고정하고, 실제 상세는 로그에만 남긴다(내부정보 비노출). */
  private resolveInternalError(exception: unknown): ResolvedError {
    const message = exception instanceof Error ? exception.message : String(exception);
    try {
      this.logger.log({
        type: 'error',
        level: 'error',
        source: 'http',
        message,
        errorCode: 'INTERNAL',
      });
    } catch {
      // 로깅 실패가 에러 응답 생성 자체를 막지 않는다(로깅 실패 격리 조항).
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      message: '서버 오류가 발생했습니다.',
    };
  }
}
