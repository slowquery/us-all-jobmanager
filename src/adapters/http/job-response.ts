import { Job } from '../../domain/job';

/**
 * HTTP 응답으로 노출하는 Job 리소스 형태(04-api-layer-design.md 엔드포인트별 성공 예시). `retryCount`는
 * 재시도 상한 판정을 위한 내부 필드라 API 계약(04 응답 예시)에 포함하지 않는다.
 */
export interface JobResponse {
  id: string;
  title: string;
  description: string;
  status: Job['status'];
  createdAt: string;
  updatedAt: string;
}

/**
 * domain `Job`을 HTTP 응답 형태로 직렬화한다.
 * @param job 직렬화할 Job 엔티티
 * @returns `retryCount`를 제외한 응답 리소스
 */
export function toJobResponse(job: Job): JobResponse {
  const { id, title, description, status, createdAt, updatedAt } = job;
  return { id, title, description, status, createdAt, updatedAt };
}
