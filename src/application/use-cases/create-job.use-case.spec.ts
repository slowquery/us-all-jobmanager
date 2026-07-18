import { CreateJobUseCase } from './create-job.use-case';
import { InMemoryJobRepository } from '../testing/in-memory-job-repository';

describe('CreateJobUseCase', () => {
  it('title/description으로 job을 생성하고 status는 pending, retryCount는 0으로 고정된다', async () => {
    const repository = new InMemoryJobRepository();
    const useCase = new CreateJobUseCase(repository);

    const job = await useCase.execute({ title: 'Task 1', description: 'Do something' });

    expect(job.title).toBe('Task 1');
    expect(job.description).toBe('Do something');
    expect(job.status).toBe('pending');
    expect(job.retryCount).toBe(0);
    expect(await repository.findById(job.id)).toEqual(job);
  });
});
