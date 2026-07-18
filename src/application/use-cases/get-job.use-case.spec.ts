import { GetJobUseCase } from './get-job.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { makeJob } from '../testing/job.fixture';

describe('GetJobUseCase', () => {
  it('존재하는 id면 ok:true와 job을 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    const job = makeJob({ id: 'a' });
    repository.seed(job);
    const useCase = new GetJobUseCase(repository);

    const result = await useCase.execute('a');

    expect(result).toEqual({
      ok: true,
      job,
    });
  });

  it('존재하지 않는 id면 ok:false, reason:NOT_FOUND를 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    const useCase = new GetJobUseCase(repository);

    const result = await useCase.execute('missing');

    expect(result).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });
});
