import { HttpException } from '@nestjs/common';

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
    const body: ApiErrorBody = { code, message, ...(details === undefined ? {} : { details }) };
    super(body, status);
  }
}
