import { CreateJobUseCase } from './create-job.use-case';
import { AllowListJobTypes } from '../ports/supported-job-types.port';
import { AllowAllJobTypes } from '../testing/allow-all-job-types';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';

describe('CreateJobUseCase', () => {
  it('구현된 작업 유형이면 job을 생성하고 status는 pending, retryCount는 0으로 고정된다', async () => {
    const repository = new InMemoryJobRepository();
    const useCase = new CreateJobUseCase(repository, new AllowAllJobTypes());

    const result = await useCase.execute({
      title: 'Task 1',
      description: 'Do something',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('생성이 성공해야 한다');
    }
    expect(result.job.title).toBe('Task 1');
    expect(result.job.description).toBe('Do something');
    expect(result.job.status).toBe('pending');
    expect(result.job.retryCount).toBe(0);
    expect(await repository.findById(result.job.id)).toEqual(result.job);
  });

  it('구현되지 않은 작업 유형은 생성하지 않고 UNSUPPORTED_JOB_TYPE으로 거부한다', async () => {
    const repository = new InMemoryJobRepository();
    const useCase = new CreateJobUseCase(repository, new AllowListJobTypes(['news-digest']));

    const result = await useCase.execute({
      title: '임의 작업',
      description: '구현되지 않은 유형',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('생성이 거부되어야 한다');
    }
    expect(result.reason).toBe('UNSUPPORTED_JOB_TYPE');
    expect(result.title).toBe('임의 작업');
    expect(result.supported).toEqual(['news-digest']);
    // 거부된 job은 저장소에 남지 않는다.
    expect(await repository.list()).toHaveLength(0);
  });

  it('구현된 sentinel 제목(news-digest)은 생성을 허용한다', async () => {
    const repository = new InMemoryJobRepository();
    const useCase = new CreateJobUseCase(repository, new AllowListJobTypes(['news-digest']));

    const result = await useCase.execute({
      title: 'news-digest',
      description: '',
    });

    expect(result.ok).toBe(true);
  });
});
