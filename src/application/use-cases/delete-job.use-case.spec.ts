import { DeleteJobUseCase } from './delete-job.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { InMemoryLogger } from '../testing/in-memory-logger';
import { makeJob } from '../testing/job.fixture';
import { JobStatus } from '../../domain/job';

describe('DeleteJobUseCase', () => {
  const DELETABLE_STATUSES: JobStatus[] = [
    'pending',
    'completed',
    'failed',
  ];

  for (const status of DELETABLE_STATUSES) {
    it(`${status} job은 삭제되고 audit 마커 메시지("job deleted id=<id>")를 가진 delete 이벤트를 남긴다`, async () => {
      const repository = new InMemoryJobRepository();
      const logger = new InMemoryLogger();
      repository.seed(makeJob({
        id: 'a',
        status,
      }));
      const useCase = new DeleteJobUseCase(repository, logger);

      const result = await useCase.execute('a');

      expect(result).toEqual({ ok: true });
      expect(await repository.findById('a')).toBeNull();
      expect(logger.events).toEqual([expect.objectContaining({
        type: 'delete',
        jobId: 'a',
        message: 'job deleted id=a',
      })]);
    });
  }

  it('processing job은 FORBIDDEN_PROCESSING을 반환하고 삭제하지 않으며 이벤트를 남기지 않는다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    repository.seed(makeJob({
      id: 'a',
      status: 'processing',
    }));
    const useCase = new DeleteJobUseCase(repository, logger);

    const result = await useCase.execute('a');

    expect(result).toEqual({
      ok: false,
      reason: 'FORBIDDEN_PROCESSING',
    });
    expect(await repository.findById('a')).not.toBeNull();
    expect(logger.events).toHaveLength(0);
  });

  it('존재하지 않는 id는 NOT_FOUND를 반환하고 이벤트를 남기지 않는다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    const useCase = new DeleteJobUseCase(repository, logger);

    const result = await useCase.execute('missing');

    expect(result).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
    expect(logger.events).toHaveLength(0);
  });
});
