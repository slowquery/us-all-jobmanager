import { ProcessPendingJobsUseCase } from './process-pending-jobs.use-case';
import { JobProcessor } from '../ports/job-processor.strategy';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { InMemoryLogger } from '../testing/in-memory-logger';
import { makeJob } from '../testing/job.fixture';
import { Job } from '../../domain/job';

/**
 * QA/red-team adversarial spec for `ProcessPendingJobsUseCase`의 방어적 try/catch 안전망.
 *
 * 목표: 배치 중 한 job의 `JobProcessor.process`가 no-throw 계약을 위반해 실제로 throw해도,
 * 나머지 job들은 정상적으로 completed로 처리되고, throw한 job만 failed로 커밋되며
 * `JOB_PROCESSOR_THREW` 에러 로그가 정확히 1건 기록되는지를 검증한다. 실제 네트워크 호출은 없다
 * (in-memory 더블만 사용). 기존 스펙 파일은 수정하지 않는다.
 */

describe('QA red-team: ProcessPendingJobsUseCase 안전망(per-job try/catch)', () => {
  it('한 job의 처리기가 throw해도 그 job만 failed, 나머지는 completed이며 JOB_PROCESSOR_THREW 로그가 정확히 1건 기록된다', async () => {
    const repo = new InMemoryJobRepository();
    const good1 = makeJob({
      id: 'good-1',
      status: 'pending',
    });
    const throwingJob = makeJob({
      id: 'throws',
      status: 'pending',
    });
    const good2 = makeJob({
      id: 'good-2',
      status: 'pending',
    });
    repo.seed(good1);
    repo.seed(throwingJob);
    repo.seed(good2);

    const processor: JobProcessor = {
      async process(job: Job) {
        if (job.id === 'throws') {
          throw new Error('processor threw despite no-throw contract');
        }
        return { outcome: 'completed' };
      },
    };
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repo, processor, logger);

    const result = await useCase.execute();

    expect(result.batchSize).toBe(3);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);

    expect((await repo.findById('good-1'))?.status).toBe('completed');
    expect((await repo.findById('good-2'))?.status).toBe('completed');
    expect((await repo.findById('throws'))?.status).toBe('failed');

    const threwErrors = logger.events.filter(
      (e) => e.type === 'error' && e.errorCode === 'JOB_PROCESSOR_THREW',
    );
    expect(threwErrors).toHaveLength(1);

    // 배치 잔여 job이 processing에 고착되지 않음을 재확인.
    const stillProcessing = (await repo.list()).filter((job) => job.status === 'processing');
    expect(stillProcessing).toHaveLength(0);
  });

  it('여러 job이 순차로 throw해도(rejected promise 포함) 배치 전체가 안전하게 failed로 수렴한다', async () => {
    const repo = new InMemoryJobRepository();
    const rejectJob = makeJob({
      id: 'rejects',
      status: 'pending',
    });
    const throwJob = makeJob({
      id: 'throws-2',
      status: 'pending',
    });
    const okJob = makeJob({
      id: 'ok',
      status: 'pending',
    });
    repo.seed(rejectJob);
    repo.seed(throwJob);
    repo.seed(okJob);

    const processor: JobProcessor = {
      async process(job: Job) {
        if (job.id === 'rejects') {
          return Promise.reject(new Error('rejected'));
        }
        if (job.id === 'throws-2') {
          throw new Error('sync throw');
        }
        return { outcome: 'completed' };
      },
    };
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repo, processor, logger);

    const result = await useCase.execute();

    expect(result.batchSize).toBe(3);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(2);
    const threwErrors = logger.events.filter(
      (e) => e.type === 'error' && e.errorCode === 'JOB_PROCESSOR_THREW',
    );
    expect(threwErrors).toHaveLength(2);
  });
});
