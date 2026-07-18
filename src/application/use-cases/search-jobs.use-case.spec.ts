import { SearchJobsUseCase } from './search-jobs.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';
import { makeJob } from '../testing/job.fixture';

describe('SearchJobsUseCase', () => {
  it('title 부분 일치(대소문자 무시)로 검색한다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'a',
      title: 'Deploy Service',
    }));
    repository.seed(makeJob({
      id: 'b',
      title: 'Cleanup Logs',
    }));
    const useCase = new SearchJobsUseCase(repository);

    const jobs = await useCase.execute({ title: 'deploy' });

    expect(jobs.map((job) => job.id)).toEqual(['a']);
  });

  it('title과 status를 함께 지정하면 AND 조건으로 좁힌다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'a',
      title: 'Deploy Service',
      status: 'pending',
    }));
    repository.seed(makeJob({
      id: 'b',
      title: 'Deploy Service',
      status: 'completed',
    }));
    const useCase = new SearchJobsUseCase(repository);

    const jobs = await useCase.execute({
      title: 'deploy',
      status: 'completed',
    });

    expect(jobs.map((job) => job.id)).toEqual(['b']);
  });

  it('조건에 맞는 job이 없으면 빈 배열을 반환한다', async () => {
    const repository = new InMemoryJobRepository();
    repository.seed(makeJob({
      id: 'a',
      title: 'Deploy Service',
    }));
    const useCase = new SearchJobsUseCase(repository);

    expect(await useCase.execute({ title: 'nonexistent' })).toEqual([]);
  });
});
