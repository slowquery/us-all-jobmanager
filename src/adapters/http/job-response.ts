import { Job } from '../../domain/job';
import { JobResponseDto } from './dto/job-response.dto';

/**
 * HTTP 응답으로 노출하는 Job 리소스 형태의 별칭. 실제 스키마/example 정의는 Swagger용 클래스
 * {@link JobResponseDto}가 보유하며(04-api-layer-design.md 엔드포인트별 성공 예시), `retryCount`는
 * 재시도 상한 판정 내부 필드라 응답 계약에 포함하지 않는다. `toJobResponse`는 이 형태를 반환한다.
 */
export type JobResponse = JobResponseDto;

/**
 * domain `Job`을 HTTP 응답 형태로 직렬화한다.
 * @param job 직렬화할 Job 엔티티
 * @returns `retryCount`를 제외한 응답 리소스
 */
export function toJobResponse(job: Job): JobResponse {
  const {
    id,
    title,
    description,
    status,
    createdAt,
    updatedAt,
  } = job;
  return {
    id,
    title,
    description,
    status,
    createdAt,
    updatedAt,
  };
}
