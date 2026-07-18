import { GetJobsUseCase } from './get-jobs.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { makeJob } from '../testing/job.fixture';

describe('GetJobsUseCase', () => {
  it('저장소가 비어있으면 빈 배열을 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    const useCase = new GetJobsUseCase(repository);

    expect(await useCase.execute()).toEqual([]);
  });

  it('저장된 job 전체를 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({ id: 'a' }));
    repository.seed(makeJob({ id: 'b' }));
    const useCase = new GetJobsUseCase(repository);

    const jobs = await useCase.execute();

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.id).sort()).toEqual(['a', 'b']);
  });
});
