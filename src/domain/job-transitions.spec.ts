import { Job, JobStatus } from './job';
import { canTransition, MAX_RETRY_COUNT, transitionError } from './job-transitions';

/**
 * 테스트용 최소 Job 픽스처 생성 헬퍼. status/retryCount 이외 필드는 전이 판정과
 * 무관하므로 고정값을 사용한다.
 */
function makeJob(status: JobStatus, retryCount = 0): Job {
  return {
    id: 'job-1',
    title: 't',
    description: 'd',
    status,
    retryCount,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

const STATUSES: JobStatus[] = ['pending', 'processing', 'completed', 'failed'];

/** 09-final-design.md 전이 표(4x4 전 조합)의 기대 결과. failed→pending은 retryCount=0 기준. */
const EXPECTED: Record<JobStatus, Record<JobStatus, 'ALLOW' | 'INVALID_TRANSITION'>> = {
  pending: {
    pending: 'INVALID_TRANSITION',
    processing: 'ALLOW',
    completed: 'INVALID_TRANSITION',
    failed: 'INVALID_TRANSITION',
  },
  processing: {
    pending: 'INVALID_TRANSITION',
    processing: 'INVALID_TRANSITION',
    completed: 'ALLOW',
    failed: 'ALLOW',
  },
  completed: {
    pending: 'INVALID_TRANSITION',
    processing: 'INVALID_TRANSITION',
    completed: 'INVALID_TRANSITION',
    failed: 'INVALID_TRANSITION',
  },
  failed: {
    pending: 'ALLOW',
    processing: 'INVALID_TRANSITION',
    completed: 'INVALID_TRANSITION',
    failed: 'INVALID_TRANSITION',
  },
};

describe('job-transitions: 09-final-design.md 전이 표 4x4 전수', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const expected = EXPECTED[from][to];

      it(`${from} -> ${to} : ${expected}`, () => {
        const job = makeJob(from, 0);
        const error = transitionError(job, to);
        const allowed = canTransition(job, to);

        if (expected === 'ALLOW') {
          expect(error).toBeNull();
          expect(allowed).toBe(true);
        } else {
          expect(error).toBe('INVALID_TRANSITION');
          expect(allowed).toBe(false);
        }
      });
    }
  }
});

describe('job-transitions: failed -> pending retryCount 경계(0/2/3)', () => {
  it('retryCount=0(하한)이면 재시도를 허용한다', () => {
    const job = makeJob('failed', 0);
    expect(transitionError(job, 'pending')).toBeNull();
    expect(canTransition(job, 'pending')).toBe(true);
  });

  it('retryCount=2(상한 직전)이면 재시도를 허용한다', () => {
    const job = makeJob('failed', MAX_RETRY_COUNT - 1);
    expect(transitionError(job, 'pending')).toBeNull();
    expect(canTransition(job, 'pending')).toBe(true);
  });

  it('retryCount=3(상한 도달)이면 RETRY_LIMIT_EXCEEDED로 거부한다', () => {
    const job = makeJob('failed', MAX_RETRY_COUNT);
    expect(transitionError(job, 'pending')).toBe('RETRY_LIMIT_EXCEEDED');
    expect(canTransition(job, 'pending')).toBe(false);
  });

  it('retryCount가 상한을 초과(4)해도 RETRY_LIMIT_EXCEEDED로 거부한다', () => {
    const job = makeJob('failed', MAX_RETRY_COUNT + 1);
    expect(transitionError(job, 'pending')).toBe('RETRY_LIMIT_EXCEEDED');
    expect(canTransition(job, 'pending')).toBe(false);
  });

  it('failed -> processing 등 표에 없는 전이는 retryCount와 무관하게 INVALID_TRANSITION이다', () => {
    const job = makeJob('failed', 0);
    expect(transitionError(job, 'processing')).toBe('INVALID_TRANSITION');
  });
});
