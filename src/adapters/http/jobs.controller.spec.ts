import { HttpStatus } from '@nestjs/common';
import { CreateJobUseCase } from '../../application/use-cases/create-job.use-case';
import { DeleteJobUseCase } from '../../application/use-cases/delete-job.use-case';
import { GetJobsUseCase } from '../../application/use-cases/get-jobs.use-case';
import { GetJobUseCase } from '../../application/use-cases/get-job.use-case';
import { PatchJobUseCase } from '../../application/use-cases/patch-job.use-case';
import { SearchJobsUseCase } from '../../application/use-cases/search-jobs.use-case';
import { InMemoryJobRepository } from '../../application/testing/in-memory-job-repository';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';
import { makeJob } from '../../application/testing/job.fixture';
import { ApiException } from './api.exception';
import { JobsController } from './jobs.controller';

function makeController(): { controller: JobsController; repository: InMemoryJobRepository } {
  const repository = new InMemoryJobRepository();
  const logger = new InMemoryLogger();
  const controller = new JobsController(
    new CreateJobUseCase(repository),
    new GetJobsUseCase(repository),
    new SearchJobsUseCase(repository),
    new GetJobUseCase(repository),
    new PatchJobUseCase(repository, logger),
    new DeleteJobUseCase(repository, logger),
  );
  return {
    controller,
    repository,
  };
}

describe('JobsController', () => {
  it('POST: 생성된 job을 응답하며 retryCount는 노출하지 않는다', async () => {
    const { controller } = makeController();

    const response = await controller.create({
      title: 'Task',
      description: 'do',
    });

    expect(response).toMatchObject({
      title: 'Task',
      description: 'do',
      status: 'pending',
    });
    expect((response as unknown as Record<string, unknown>).retryCount).toBeUndefined();
  });

  it('GET list: 전체 목록과 count를 반환한다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({ id: 'a' }));
    repository.seed(makeJob({ id: 'b' }));

    const response = await controller.list();

    expect(response.count).toBe(2);
    expect(response.items).toHaveLength(2);
  });

  it('search: title만 있으면 부분 일치 검색을 수행한다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      title: 'Deploy service',
    }));
    repository.seed(makeJob({
      id: 'b',
      title: 'Cleanup',
    }));

    const response = await controller.search({ title: 'deploy' });

    expect(response.items.map((job) => job.id)).toEqual(['a']);
  });

  it('getById: 존재하지 않으면 404 NOT_FOUND ApiException을 던진다', async () => {
    const { controller } = makeController();

    await expect(controller.getById('missing')).rejects.toBeInstanceOf(ApiException);
    await expect(controller.getById('missing')).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it('getById: 존재하면 200으로 job을 응답한다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      title: 'found',
    }));

    const response = await controller.getById('a');

    expect(response.id).toBe('a');
    expect(response.title).toBe('found');
  });

  it('patch: INVALID_TRANSITION은 409로 매핑된다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      status: 'completed',
    }));

    await expect(controller.patch('a', { status: 'pending' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INVALID_TRANSITION' }),
      status: HttpStatus.CONFLICT,
    });
  });

  it('patch: RETRY_LIMIT_EXCEEDED는 409로 매핑된다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      status: 'failed',
      retryCount: 3,
    }));

    await expect(controller.patch('a', { status: 'pending' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'RETRY_LIMIT_EXCEEDED' }),
      status: HttpStatus.CONFLICT,
    });
  });

  it('patch: 재시도 성공 시 갱신된 job을 응답한다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      status: 'failed',
      retryCount: 0,
    }));

    const response = await controller.patch('a', { status: 'pending' });

    expect(response.status).toBe('pending');
  });

  it('remove: 존재하는 job을 삭제하고 undefined(204 no-body)를 반환한다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      status: 'pending',
    }));

    const response = await controller.remove('a');

    expect(response).toBeUndefined();
    expect(await repository.findById('a')).toBeNull();
  });

  it('remove: 존재하지 않으면 404 NOT_FOUND ApiException을 던진다', async () => {
    const { controller } = makeController();

    await expect(controller.remove('missing')).rejects.toBeInstanceOf(ApiException);
    await expect(controller.remove('missing')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_FOUND' }),
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('remove: processing job은 409 JOB_IN_PROGRESS로 거부되고 삭제되지 않는다', async () => {
    const { controller, repository } = makeController();
    repository.seed(makeJob({
      id: 'a',
      status: 'processing',
    }));

    await expect(controller.remove('a')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'JOB_IN_PROGRESS' }),
      status: HttpStatus.CONFLICT,
    });
    expect(await repository.findById('a')).not.toBeNull();
  });
});
