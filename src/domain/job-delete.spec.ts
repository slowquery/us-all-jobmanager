import { Job, JobStatus } from './job';
import { canDelete, deleteError } from './job-delete';

/**
 * 테스트용 최소 Job 픽스처 생성 헬퍼. status 이외 필드는 삭제 판정과 무관하므로 고정값을 쓴다.
 */
function makeJob(status: JobStatus): Job {
  return {
    id: 'job-1',
    title: 't',
    description: 'd',
    status,
    retryCount: 0,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

describe('job-delete: 4개 상태 전수', () => {
  it('pending은 삭제 가능하다', () => {
    const job = makeJob('pending');
    expect(deleteError(job)).toBeNull();
    expect(canDelete(job)).toBe(true);
  });

  it('processing은 삭제가 금지된다(FORBIDDEN_PROCESSING)', () => {
    const job = makeJob('processing');
    expect(deleteError(job)).toBe('FORBIDDEN_PROCESSING');
    expect(canDelete(job)).toBe(false);
  });

  it('completed는 삭제 가능하다', () => {
    const job = makeJob('completed');
    expect(deleteError(job)).toBeNull();
    expect(canDelete(job)).toBe(true);
  });

  it('failed는 삭제 가능하다', () => {
    const job = makeJob('failed');
    expect(deleteError(job)).toBeNull();
    expect(canDelete(job)).toBe(true);
  });
});
