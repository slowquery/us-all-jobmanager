import { HttpException, HttpStatus } from '@nestjs/common';

/** 에러 응답 envelope의 `details` 배열 원소 형태(04-api-layer-design.md 에러 응답 구조). */
export interface ApiErrorDetail {
  field?: string;
  reason: string;
}

/** 에러 응답 envelope 본문. `code`는 머신 판별용 SCREAMING_SNAKE_CASE 상수. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[];
}

/**
 * 컨트롤러가 도메인/유스케이스 실패(NOT_FOUND/INVALID_TRANSITION/RETRY_LIMIT_EXCEEDED 등)를
 * HTTP 응답으로 변환할 때 던지는 예외. `getResponse()`가 그대로 에러 envelope 본문이 되도록
 * 설계해, `HttpExceptionFilter`가 별도 매핑 없이 직렬화할 수 있게 한다
 * (09-final-design.md 확정 #4·#6, 상태 코드는 400/404/409/500).
 */
export class ApiException extends HttpException {
  constructor(status: number, code: string, message: string, details?: ApiErrorDetail[]) {
    const body: ApiErrorBody = {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    };
    super(body, status);
  }
}

/**
 * 예외 → `{ status, code }` 매핑의 **단일 정본**. `HttpExceptionFilter`(응답 직렬화)와
 * `LoggingInterceptor`(로그 errorCode 선반영)가 동일 규칙을 각자 복제하던 것을 제거하기 위해
 * 추출한 순수 함수다. 두 곳이 이 함수만 호출하므로 매핑이 구조적으로 항상 일치한다.
 *
 * 규칙(09-final-design.md 확정 #4·#6):
 * - `ApiException`: 이미 구성된 envelope의 `code`와 상태를 그대로 사용한다.
 * - 그 외 `HttpException`: 400 → `VALIDATION_FAILED`, 404 → `NOT_FOUND`,
 *   그 외 5xx → `INTERNAL`, 나머지 4xx → `HTTP_ERROR`.
 * - 그 외 예기치 못한 예외: 500 `INTERNAL`.
 */
export function resolveErrorEnvelope(exception: unknown): { status: number; code: string } {
  if (exception instanceof ApiException) {
    const body = exception.getResponse() as ApiErrorBody;
    return {
      status: exception.getStatus(),
      code: body.code,
    };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status === HttpStatus.BAD_REQUEST) {
      return {
        status,
        code: 'VALIDATION_FAILED',
      };
    }
    if (status === HttpStatus.NOT_FOUND) {
      return {
        status,
        code: 'NOT_FOUND',
      };
    }
    return {
      status,
      code: status >= 500 ? 'INTERNAL' : 'HTTP_ERROR',
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL',
  };
}
