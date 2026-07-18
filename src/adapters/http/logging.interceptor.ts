import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { context as otelContext, trace } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { LoggerPort } from '../../application/ports/logger.port';
import { LOGGER_PORT } from '../tokens';
import { ApiErrorBody, ApiException } from './api.exception';

/** HTTP 인바운드 스팬을 여는 OTel 트레이서 이름(06-observability-design.md adapter 계측 한정). */
const HTTP_TRACER_NAME = 'us-all-job-manager-http';

/**
 * 전역 HTTP 로깅 인터셉터(`APP_INTERCEPTOR`로 등록, 05-logging-design.md 확정 #5). 모든 요청
 * 1건당 완료(성공/실패) 시점에 정확히 1회 `LoggerPort`로 `http_request` 이벤트를 남긴다 —
 * `method`/`path`/`statusCode`/`latencyMs`만 기록하고 요청 body는 어떤 경로로도 로깅하지 않는다
 * (09 확정 #11 보안 조항 ②).
 *
 * 06-observability-design.md 확정대로 이 인터셉터가 요청 진입 시 HTTP 인바운드 루트 스팬을 열고
 * `otelContext.with`로 활성 컨텍스트를 주입한다 — 이후 이 요청 처리 흐름(유스케이스 → infrastructure
 * `FileLoggerAdapter`)에서 `trace.getActiveSpan()`으로 동일 traceId를 읽어 로그 라인에 상관시킬 수
 * 있다(application/domain은 계측 API를 직접 호출하지 않는다, adapter 계층 한정 원칙).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  /** @param logger HTTP 요청 로그를 기록할 구조화 로깅 포트 */
  constructor(@Inject(LOGGER_PORT) private readonly logger: LoggerPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method;
    const path = request.originalUrl ?? request.url;
    const startedAt = Date.now();

    const span = trace.getTracer(HTTP_TRACER_NAME).startSpan(`${method} ${path}`);
    const activeContext = trace.setSpan(otelContext.active(), span);

    // otelContext.with(ctx, () => next.handle().pipe(...))만으로는 활성 컨텍스트가 유지되지
    // 않는다 — next.handle()이 반환하는 Observable은 여기서 즉시 subscribe되지 않고(Nest가
    // 인터셉터 체인을 모두 구성한 뒤 별도 시점에 subscribe한다), 그 시점엔 이미 이 동기 콜백을
    // 벗어나 있어 async_hooks 계보가 스팬 컨텍스트를 계승하지 못한다. 실제 subscribe() 호출
    // 자체를 otelContext.with() 내부에서 수행해야 이후 컨트롤러→유스케이스→infrastructure로
    // 이어지는 비동기 체인이 이 스팬을 상속한다.
    return new Observable((subscriber) => otelContext.with(activeContext, () => next.handle().pipe(
      tap(() => {
        this.logCompletion(method, path, response.statusCode, startedAt);
        span.end();
      }),
      catchError((error: unknown) => {
        const { statusCode, errorCode } = this.resolveErrorInfo(error);
        this.logCompletion(method, path, statusCode, startedAt, errorCode);
        span.end();
        throw error;
      }),
    ).subscribe(subscriber)));
  }

  /** 요청 완료 1건을 `http_request` 이벤트로 기록한다. `errorCode`가 있으면 `level: 'error'`. */
  private logCompletion(method: string, path: string, statusCode: number, startedAt: number, errorCode?: string): void {
    const latencyMs = Date.now() - startedAt;
    this.logger.log({
      type: 'http_request',
      level: errorCode === undefined ? 'info' : 'error',
      source: 'http',
      message: errorCode === undefined ? 'request completed' : 'request failed',
      method,
      path,
      statusCode,
      latencyMs,
      ...(errorCode === undefined ? {} : { errorCode }),
    });
  }

  /**
   * `HttpExceptionFilter`가 최종적으로 매길 상태 코드/에러 코드를 인터셉터 시점에 선반영한다.
   * 필터는 인터셉터 바깥(응답 스트림 이후)에서 실행되므로 `response.statusCode`가 아직 반영되지
   * 않은 상태 — 예외 타입으로부터 직접 추론한다(필터의 매핑 규칙과 반드시 동일하게 유지).
   */
  private resolveErrorInfo(error: unknown): { statusCode: number; errorCode: string } {
    if (error instanceof ApiException) {
      const body = error.getResponse() as ApiErrorBody;
      return {
        statusCode: error.getStatus(),
        errorCode: body.code,
      };
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === HttpStatus.BAD_REQUEST) {
        return {
          statusCode: status,
          errorCode: 'VALIDATION_FAILED',
        };
      }
      if (status === HttpStatus.NOT_FOUND) {
        return {
          statusCode: status,
          errorCode: 'NOT_FOUND',
        };
      }
      return {
        statusCode: status,
        errorCode: status >= 500 ? 'INTERNAL' : 'HTTP_ERROR',
      };
    }
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      errorCode: 'INTERNAL',
    };
  }
}
