import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { HttpModule } from './adapters/http/http.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { JOB_PROCESSOR, JOB_REPOSITORY, LOGGER_PORT } from './adapters/tokens';
import { JobsController } from './adapters/http/jobs.controller';
import { CreateJobUseCase } from './application/use-cases/create-job.use-case';
import { PatchJobUseCase } from './application/use-cases/patch-job.use-case';
import { JobSchedulerAdapter } from './adapters/scheduler/job-scheduler.adapter';
import { InMemoryJobRepository } from './application/testing/in-memory-job-repository';
import { InMemoryLogger } from './application/testing/in-memory-logger';

describe('모듈 분리 배선', () => {
  it('AppModule이 컨트롤러·유스케이스·스케줄러를 모두 해결한다', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOGGER_PORT)
      .useValue(new InMemoryLogger())
      .overrideProvider(JOB_REPOSITORY)
      .useValue(new InMemoryJobRepository())
      .compile();

    expect(moduleRef.get(JobsController)).toBeInstanceOf(JobsController);
    expect(moduleRef.get(CreateJobUseCase)).toBeInstanceOf(CreateJobUseCase);
    expect(moduleRef.get(PatchJobUseCase)).toBeInstanceOf(PatchJobUseCase);
    expect(moduleRef.get(JobSchedulerAdapter)).toBeInstanceOf(JobSchedulerAdapter);
  });

  it('InfrastructureModule이 공유 포트 토큰을 export한다(오버라이드 가능)', async () => {
    const repository = new InMemoryJobRepository();
    const moduleRef = await Test.createTestingModule({ imports: [InfrastructureModule] })
      .overrideProvider(LOGGER_PORT)
      .useValue(new InMemoryLogger())
      .overrideProvider(JOB_REPOSITORY)
      .useValue(repository)
      .compile();

    // export된 토큰이라 루트에서 조회되고, 오버라이드가 그대로 반영된다.
    expect(moduleRef.get(JOB_REPOSITORY)).toBe(repository);
    expect(moduleRef.get(LOGGER_PORT)).toBeInstanceOf(InMemoryLogger);
    // JOB_PROCESSOR는 스케줄러 전용이라 InfrastructureModule에서는 제공하지 않는다.
    expect(() => moduleRef.get(JOB_PROCESSOR)).toThrow();
  });

  it('HttpModule 단독으로도 InfrastructureModule을 통해 컨트롤러를 해결한다', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HttpModule] })
      .overrideProvider(LOGGER_PORT)
      .useValue(new InMemoryLogger())
      .overrideProvider(JOB_REPOSITORY)
      .useValue(new InMemoryJobRepository())
      .compile();

    expect(moduleRef.get(JobsController)).toBeInstanceOf(JobsController);
  });
});
