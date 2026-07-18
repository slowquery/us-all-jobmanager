/**
 * 작업(Job)의 상태 값 집합.
 *
 * `pending`(대기) → `processing`(스케줄러 처리 중) → `completed`(완료) | `failed`(실패)의
 * 선형 흐름에 `failed → pending` 재시도 전이(PATCH 경유, retryCount 상한 3회)가 추가된다.
 * 09-final-design.md 확정 #9 참조.
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * 작업(Job) 도메인 엔티티.
 *
 * 프레임워크(NestJS 등) 의존성이 없는 순수 데이터 형태이며, 영속화 계층(node-json-db)과
 * API 계층(DTO)은 이 형태를 각자의 스키마로 매핑해 사용한다.
 */
export interface Job {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  /** 0으로 생성, `failed → pending` 재시도 성공 시 +1, 최대 3까지 허용(09 확정 #9). */
  retryCount: number;
  /** ISO8601 생성 시각. */
  createdAt: string;
  /** ISO8601 최종 수정 시각. */
  updatedAt: string;
}
