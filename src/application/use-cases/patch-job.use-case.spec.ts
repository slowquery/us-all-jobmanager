import { PatchJobUseCase } from './patch-job.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { InMemoryLogger } from '../testing/in-memory-logger';
import { makeJob } from '../testing/job.fixture';
import { MAX_RETRY_COUNT } from '../../domain/job-transitions';

describe('PatchJobUseCase', () => {
  it('title/description만 있는 patch는 status 변경 없이 필드만 갱신하고 transition 이벤트를 남기지 않는다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    repository.seed(makeJob({ id: 'a', status: 'pending', title: 'Old', description: 'Old desc' }));
    const useCase = new PatchJobUseCase(repository, logger);

    const result = await useCase.execute({ id: 'a', title: 'New' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.title).toBe('New');
      expect(result.job.description).toBe('Old desc');
      expect(result.job.status).toBe('pending');
    }
    expect(logger.events).toHaveLength(0);
  });

  it('status:pending 요청은 failed -> pending 재시도 전이를 수행하고 retryCount를 증가시키며 transition 이벤트(actor=api)를 남긴다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    repository.seed(makeJob({ id: 'a', status: 'failed', retryCount: 0 }));
    const useCase = new PatchJobUseCase(repository, logger);

    const result = await useCase.execute({ id: 'a', status: 'pending' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.status).toBe('pending');
      expect(result.job.retryCount).toBe(1);
    }
    expect(logger.events).toEqual([
      expect.objectContaining({
        type: 'transition',
        jobId: 'a',
        from: 'failed',
        to: 'pending',
        actor: 'api',
      }),
    ]);
  });

  it('completed 상태에 status:pending을 요청하면 INVALID_TRANSITION을 반환하고 transition 이벤트를 남기지 않는다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    repository.seed(makeJob({ id: 'a', status: 'completed' }));
    const useCase = new PatchJobUseCase(repository, logger);

    const result = await useCase.execute({ id: 'a', status: 'pending' });

    expect(result).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
    expect(logger.events).toHaveLength(0);
  });

  it('retryCount가 상한에 도달한 failed job의 재시도는 RETRY_LIMIT_EXCEEDED를 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    repository.seed(makeJob({ id: 'a', status: 'failed', retryCount: MAX_RETRY_COUNT }));
    const useCase = new PatchJobUseCase(repository, logger);

    const result = await useCase.execute({ id: 'a', status: 'pending' });

    expect(result).toEqual({ ok: false, reason: 'RETRY_LIMIT_EXCEEDED' });
    expect(logger.events).toHaveLength(0);
  });

  it('존재하지 않는 id면 NOT_FOUND를 반환한다(status 미지정)', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    const useCase = new PatchJobUseCase(repository, logger);

    const result = await useCase.execute({ id: 'missing', title: 'New' });

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('존재하지 않는 id에 status:pending 재시도를 요청해도 NOT_FOUND를 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    const logger = new InMemoryLogger();
    const useCase = new PatchJobUseCase(repository, logger);

    const result = await useCase.execute({ id: 'missing', status: 'pending' });

    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });
});
