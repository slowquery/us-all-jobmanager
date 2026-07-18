import { Job, JobStatus } from './job';

/**
 * 재시도 전이(`failed → pending`) 허용 최대 `retryCount` 상한(미만이어야 허용, 09 확정 #9).
 */
export const MAX_RETRY_COUNT = 3;

/**
 * 상태별 허용 전이 목록(09-final-design.md 확정 #9 전이 표).
 *
 * - `pending → processing`, `processing → completed|failed`는 스케줄러 전용 전이다.
 * - `failed → pending`은 PATCH 전용 전이이며, `retryCount < MAX_RETRY_COUNT`일 때만 허용된다
 *   (이 상한 조건은 이 테이블만으로는 표현되지 않으며 {@link canTransition}이 함께 검사한다).
 * - `completed`는 종단 상태로 어떤 전이도 허용하지 않는다.
 */
export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ['processing'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: ['pending'],
};

/**
 * 전이 실패 사유 구분 값.
 *
 * - `INVALID_TRANSITION`: 전이 표 자체가 허용하지 않는 전이(예: pending → completed).
 * - `RETRY_LIMIT_EXCEEDED`: 전이 표는 허용하나(failed → pending) retryCount 상한을 초과한 경우.
 */
export type TransitionError = 'INVALID_TRANSITION' | 'RETRY_LIMIT_EXCEEDED';

/**
 * 주어진 job이 target 상태로 전이 가능한지 판정하는 순수 도메인 guard.
 *
 * 반드시 02가 소유하는 임계구역(atomic read → guard → write) 내부에서, job의 최신 상태를
 * 재조회한 뒤 호출해야 한다(TOCTOU 방지, 01-state-transition-design.md guard 계약 참조).
 *
 * @param job 현재 상태를 포함한 job 엔티티(최신 재조회 결과여야 함)
 * @param target 전이하려는 목표 상태
 * @returns 허용 전이이자 재시도 상한을 넘지 않으면 true, 아니면 false
 */
export function canTransition(job: Job, target: JobStatus): boolean {
  return transitionError(job, target) === null;
}

/**
 * 전이가 거부될 경우 그 사유를 구분해 반환하는 순수 도메인 함수.
 *
 * 전이 표에 없는 조합이면 `INVALID_TRANSITION`, 표에는 있으나(failed → pending)
 * retryCount 상한을 초과했으면 `RETRY_LIMIT_EXCEEDED`를 반환한다. API 계층은 이 값을
 * 그대로 409 응답 코드에 매핑한다(09-final-design.md).
 *
 * @param job 현재 상태를 포함한 job 엔티티(최신 재조회 결과여야 함)
 * @param target 전이하려는 목표 상태
 * @returns 전이가 허용되면 null, 아니면 거부 사유
 */
export function transitionError(job: Job, target: JobStatus): TransitionError | null {
  const allowed = JOB_TRANSITIONS[job.status];
  if (!allowed.includes(target)) {
    return 'INVALID_TRANSITION';
  }
  if (job.status === 'failed' && target === 'pending' && job.retryCount >= MAX_RETRY_COUNT) {
    return 'RETRY_LIMIT_EXCEEDED';
  }
  return null;
}
