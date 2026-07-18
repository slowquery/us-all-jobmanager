import { Job } from './job';

/**
 * 삭제 거부 사유 구분 값. 현재는 `processing`(스케줄러 처리 중) 상태 1건뿐이다 — 처리 중인 job이
 * 삭제되면 스케줄러가 이후 커밋 시점에 대상을 잃어버려 무결성이 깨지므로 금지한다.
 */
export type DeleteError = 'FORBIDDEN_PROCESSING';

/**
 * 주어진 job이 삭제 가능한지 판정하는 순수 도메인 guard. `processing` 상태만 금지하고
 * `pending`/`completed`/`failed`는 모두 허용한다.
 * @param job 판정 대상 job
 * @returns 삭제 가능하면 true
 */
export function canDelete(job: Job): boolean {
  return deleteError(job) === null;
}

/**
 * 삭제가 거부될 경우 그 사유를 구분해 반환하는 순수 도메인 함수.
 * @param job 판정 대상 job
 * @returns 거부 시 `FORBIDDEN_PROCESSING`, 허용 시 null
 */
export function deleteError(job: Job): DeleteError | null {
  return job.status === 'processing' ? 'FORBIDDEN_PROCESSING' : null;
}
