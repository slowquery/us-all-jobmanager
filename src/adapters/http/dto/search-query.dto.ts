import {
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '../../../domain/job';
import { AtLeastOneField } from './validators/at-least-one-field.validator';

/** `GET /jobs/search`가 받는 4개 상태값 열거(도메인 `JobStatus`와 동일 집합). */
const JOB_STATUS_VALUES: JobStatus[] = [
  'pending',
  'processing',
  'completed',
  'failed',
];

/**
 * `GET /jobs/search` 쿼리 파라미터 DTO. `title`(부분 일치)과 `status`(완전 일치) 모두 선택이나,
 * 최소 1개는 있어야 한다({@link AtLeastOneField}로 DTO 레벨 검증, `GET /jobs`와 책임 분리,
 * 04-api-layer-design.md 검색 쿼리 파라미터 설계).
 */
@AtLeastOneField([
  'title',
  'status',
], { message: 'title 또는 status 중 최소 1개는 필요합니다.' })
export class SearchQueryDto {
  /** 제목 부분 일치 검색어(대소문자 무시, 1~200자). */
  @ApiPropertyOptional({
    description: '제목 부분 일치 검색어(대소문자 무시, 1~200자)',
    example: '배포',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  /** 상태 완전 일치 필터. */
  @ApiPropertyOptional({
    description: '상태 완전 일치 필터',
    enum: JOB_STATUS_VALUES,
    example: 'pending',
  })
  @IsOptional()
  @IsIn(JOB_STATUS_VALUES)
  status?: JobStatus;
}
