import { IsIn, IsOptional, IsString } from 'class-validator';
import { JobStatus } from '../../../domain/job';

/** `GET /jobs/search`가 받는 4개 상태값 열거(도메인 `JobStatus`와 동일 집합). */
const JOB_STATUS_VALUES: JobStatus[] = ['pending', 'processing', 'completed', 'failed'];

/**
 * `GET /jobs/search` 쿼리 파라미터 DTO. `title`(부분 일치)과 `status`(완전 일치) 모두 선택이나,
 * 최소 1개는 있어야 한다(컨트롤러에서 별도 검증, `GET /jobs`와 책임 분리, 04-api-layer-design.md
 * 검색 쿼리 파라미터 설계).
 */
export class SearchQueryDto {
  /** 제목 부분 일치 검색어(대소문자 무시). */
  @IsOptional()
  @IsString()
  title?: string;

  /** 상태 완전 일치 필터. */
  @IsOptional()
  @IsIn(JOB_STATUS_VALUES)
  status?: JobStatus;
}
