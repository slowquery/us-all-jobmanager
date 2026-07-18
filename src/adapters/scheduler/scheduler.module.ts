import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JobProcessor } from '../../application/ports/job-processor.strategy';
import { JobRepository } from '../../application/ports/job-repository.port';
import { LoggerPort } from '../../application/ports/logger.port';
import { ProcessPendingJobsUseCase } from '../../application/use-cases/process-pending-jobs.use-case';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module';
import { JOB_PROCESSOR, JOB_REPOSITORY, LOGGER_PORT } from '../tokens';
import { JobSchedulerAdapter } from './job-scheduler.adapter';

/**
 * 스케줄러 전용 모듈. `@nestjs/schedule`의 `@Interval`(60초 tick)을 활성화하는
 * `ScheduleModule.forRoot()`와, tick마다 pending 작업을 처리하는 {@link JobSchedulerAdapter}·
 * {@link ProcessPendingJobsUseCase}를 배선한다. 포트 구현체는 {@link InfrastructureModule}가
 * 제공한다(HTTP 모듈과 동일 인스턴스 공유, 헥사고날 경계 유지).
 */
@Module({
  imports: [
    InfrastructureModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    {
      provide: ProcessPendingJobsUseCase,
      useFactory: (
        repository: JobRepository,
        jobProcessor: JobProcessor,
        logger: LoggerPort,
      ): ProcessPendingJobsUseCase => new ProcessPendingJobsUseCase(repository, jobProcessor, logger),
      inject: [
        JOB_REPOSITORY,
        JOB_PROCESSOR,
        LOGGER_PORT,
      ],
    },
    {
      provide: JobSchedulerAdapter,
      useFactory: (
        processPendingJobs: ProcessPendingJobsUseCase,
        logger: LoggerPort,
      ): JobSchedulerAdapter => new JobSchedulerAdapter(processPendingJobs, logger),
      inject: [
        ProcessPendingJobsUseCase,
        LOGGER_PORT,
      ],
    },
  ],
})
export class SchedulerModule {}
