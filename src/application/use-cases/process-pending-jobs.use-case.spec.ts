import { ProcessPendingJobsUseCase, SCHEDULER_BATCH_SIZE } from './process-pending-jobs.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { InMemoryLogger } from '../testing/in-memory-logger';
import { DefaultJobProcessor } from '../ports/job-processor.strategy';
import { makeJob } from '../testing/job.fixture';
import { Job } from '../../domain/job';

describe('ProcessPendingJobsUseCase', () => {
  it('pending job이 없으면 빈 배치로 집계하고 batch 로그를 남긴다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repository, new DefaultJobProcessor(), logger);

    const result = await useCase.execute();

    expect(result).toEqual({
      batchSize: 0,
      succeeded: 0,
      failed: 0,
    });
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]).toMatchObject({
      type: 'batch',
      batchSize: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it('pending job을 processing으로 선점 후 완료 처리하고 집계·로그를 남긴다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'a',
      status: 'pending',
    }));
    repository.seed(makeJob({
      id: 'b',
      status: 'pending',
    }));
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repository, new DefaultJobProcessor(), logger);

    const result = await useCase.execute();

    expect(result).toEqual({
      batchSize: 2,
      succeeded: 2,
      failed: 0,
    });
    expect(await repository.findById('a')).toMatchObject({ status: 'completed' });
    expect(await repository.findById('b')).toMatchObject({ status: 'completed' });
    expect(logger.events).toHaveLength(3);
    const transitionEvents = logger.events.filter((event) => event.type === 'transition');
    expect(transitionEvents).toHaveLength(2);
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'a',
        from: 'processing',
        to: 'completed',
        actor: 'scheduler',
      }),
    );
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'b',
        from: 'processing',
        to: 'completed',
        actor: 'scheduler',
      }),
    );
    expect(logger.events[logger.events.length - 1]).toMatchObject({
      type: 'batch',
      batchSize: 2,
      succeeded: 2,
      failed: 0,
    });
  });

  it('처리 실패로 판정된 job은 failed로 커밋되고 succeeded/failed 집계가 분리된다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'a',
      status: 'pending',
    }));
    repository.seed(makeJob({
      id: 'b',
      status: 'pending',
    }));
    const logger = new InMemoryLogger();
    const processor = new DefaultJobProcessor((job: Job) => (job.id === 'b' ? 'failed' : 'completed'));
    const useCase = new ProcessPendingJobsUseCase(repository, processor, logger);

    const result = await useCase.execute();

    expect(result).toEqual({
      batchSize: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(await repository.findById('a')).toMatchObject({ status: 'completed' });
    expect(await repository.findById('b')).toMatchObject({ status: 'failed' });
    const transitionEvents = logger.events.filter((event) => event.type === 'transition');
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'a',
        from: 'processing',
        to: 'completed',
        actor: 'scheduler',
      }),
    );
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'b',
        from: 'processing',
        to: 'failed',
        actor: 'scheduler',
      }),
    );
  });

  it('전건 실패로 판정되면 succeeded 커밋(withBatch)을 건너뛰고 completed 배열은 비어 있다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'a',
      status: 'pending',
    }));
    repository.seed(makeJob({
      id: 'b',
      status: 'pending',
    }));
    const logger = new InMemoryLogger();
    const processor = new DefaultJobProcessor(() => 'failed');
    const useCase = new ProcessPendingJobsUseCase(repository, processor, logger);

    const result = await useCase.execute();

    expect(result).toEqual({
      batchSize: 2,
      succeeded: 0,
      failed: 2,
    });
    expect(await repository.findById('a')).toMatchObject({ status: 'failed' });
    expect(await repository.findById('b')).toMatchObject({ status: 'failed' });
    const transitionEvents = logger.events.filter((event) => event.type === 'transition');
    expect(transitionEvents).toHaveLength(2);
    expect(transitionEvents.every((event) => (event as { to: string }).to === 'failed')).toBe(true);
  });

  it('listByStatus 조회는 SCHEDULER_BATCH_SIZE(10건)를 상한으로 사용한다', async () => {
    const repository = new InMemoryJobRepository();
    for (let i = 0; i < 15; i += 1) {
      repository.seed(makeJob({
        id: `job-${i}`,
        status: 'pending',
      }));
    }
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repository, new DefaultJobProcessor(), logger);

    const result = await useCase.execute();

    expect(SCHEDULER_BATCH_SIZE).toBe(10);
    expect(result.batchSize).toBe(10);
    expect((await repository.list()).filter((job) => job.status === 'pending')).toHaveLength(5);
  });
});

describe('ProcessPendingJobsUseCase - JobProcessor no-throw 계약 위반 방어(try/catch 안전망)', () => {
  it('처리기가 특정 job에서 throw하면 그 job만 failed로 커밋되고 나머지 job은 정상적으로 completed 처리되며 JOB_PROCESSOR_THREW 에러 로그가 남는다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'ok-1',
      status: 'pending',
    }));
    repository.seed(makeJob({
      id: 'throws',
      status: 'pending',
    }));
    repository.seed(makeJob({
      id: 'ok-2',
      status: 'pending',
    }));
    const logger = new InMemoryLogger();
    const processor = {
      async process(job: Job) {
        if (job.id === 'throws') {
          throw new Error('boom');
        }
        return { outcome: 'completed' as const };
      },
    };
    const useCase = new ProcessPendingJobsUseCase(repository, processor, logger);

    const result = await useCase.execute();

    expect(result).toEqual({
      batchSize: 3,
      succeeded: 2,
      failed: 1,
    });
    expect(await repository.findById('ok-1')).toMatchObject({ status: 'completed' });
    expect(await repository.findById('ok-2')).toMatchObject({ status: 'completed' });
    expect(await repository.findById('throws')).toMatchObject({ status: 'failed' });

    const errorEvents = logger.events.filter((event) => event.type === 'error');
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      type: 'error',
      level: 'error',
      source: 'scheduler',
      errorCode: 'JOB_PROCESSOR_THREW',
    });

    const transitionEvents = logger.events.filter((event) => event.type === 'transition');
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'throws',
        from: 'processing',
        to: 'failed',
        actor: 'scheduler',
      }),
    );
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'ok-1',
        from: 'processing',
        to: 'completed',
        actor: 'scheduler',
      }),
    );
    expect(transitionEvents).toContainEqual(
      expect.objectContaining({
        type: 'transition',
        jobId: 'ok-2',
        from: 'processing',
        to: 'completed',
        actor: 'scheduler',
      }),
    );
  });
});
