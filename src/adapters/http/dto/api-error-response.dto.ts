import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 에러 응답 envelope의 `details` 원소(Swagger 스키마, {@link ApiErrorDetail}와 동일 형태). */
export class ApiErrorDetailDto {
  @ApiPropertyOptional({
    description: '문제 필드명',
    example: 'title',
  })
  field?: string;

  @ApiProperty({
    description: '실패 사유',
    example: 'title must be longer than or equal to 1 characters',
  })
  reason!: string;
}

/**
 * 전역 {@link HttpExceptionFilter}가 모든 에러를 직렬화하는 공통 envelope(Swagger 스키마).
 * `code`는 머신 판별용 SCREAMING_SNAKE_CASE 상수다({@link ApiErrorBody}와 동일 형태).
 */
export class ApiErrorResponseDto {
  @ApiProperty({
    description: '에러 코드(머신 판별용)',
    enum: [
      'VALIDATION_FAILED',
      'NOT_FOUND',
      'INVALID_TRANSITION',
      'RETRY_LIMIT_EXCEEDED',
      'HTTP_ERROR',
      'INTERNAL',
    ],
    example: 'VALIDATION_FAILED',
  })
  code!: string;

  @ApiProperty({
    description: '사람이 읽는 에러 메시지(한글)',
    example: '요청이 유효하지 않습니다.',
  })
  message!: string;

  @ApiPropertyOptional({
    description: '필드별 상세',
    type: [ApiErrorDetailDto],
  })
  details?: ApiErrorDetailDto[];
}
