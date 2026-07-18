import { Job, JobStatus } from '../../domain/job';

/**
 * 테스트용 Job 픽스처 생성 헬퍼. 지정하지 않은 필드는 합리적인 기본값으로 채운다.
 * @param overrides 기본값을 덮어쓸 필드
 * @returns Job 인스턴스
 */
export function makeJob(overrides: Partial<Job> & { id: string }): Job {
  const now = '2026-07-17T09:00:00.000Z';
  const status: JobStatus = overrides.status ?? 'pending';
  return {
    title: 'Task',
    description: 'Do something',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
    status,
  };
}
