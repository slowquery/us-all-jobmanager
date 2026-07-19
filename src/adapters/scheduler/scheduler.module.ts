import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { JobProcessor } from '../../application/ports/job-processor.strategy';
import { JobRepository } from '../../application/ports/job-repository.port';
import { LoggerPort } from '../../application/ports/logger.port';
import { ProcessPendingJobsUseCase } from '../../application/use-cases/process-pending-jobs.use-case';
import { readNewsDigestConfig } from '../../infrastructure/config/news-digest.config';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module';
import { JOB_PROCESSOR, JOB_REPOSITORY, LOGGER_PORT } from '../tokens';
import { createSchedulerJobProcessor } from './job-processor.factory';
import { JobSchedulerAdapter } from './job-scheduler.adapter';

/**
 * 스케줄러 전용 모듈. `@nestjs/schedule`의 `@Interval`(60초 tick)을 활성화하는
 * `ScheduleModule.forRoot()`와, tick마다 pending 작업을 처리하는 {@link JobSchedulerAdapter}·
 * {@link ProcessPendingJobsUseCase}를 배선한다. 로거/저장소 포트는 {@link InfrastructureModule}가
 * 제공하고(HTTP 모듈과 동일 인스턴스 공유), 스케줄러 전용 `JOB_PROCESSOR`는 유일 소비자인 이 모듈이
 * 직접 바인딩한다(헥사고날 경계 유지 — infrastructure가 adapters를 역참조하지 않도록).
 *
 * `JOB_PROCESSOR` 구성은 {@link createSchedulerJobProcessor} 팩토리에 위임한다: 뉴스 다이제스트
 * 기능 플래그가 꺼져 있으면 기존과 동일하게 `DefaultJobProcessor`를, 켜져 있으면 제목 sentinel로
 * 뉴스 job만 라우팅하는 `DispatchingJobProcessor`를 구성하며, 어느 경우든 `TracingJobProcessor`로
 * 감싼다. 설정은 `readNewsDigestConfig()`가 환경변수(.env)에서 읽는다(비밀은 env-only).
 */
@Module({
  imports: [
    InfrastructureModule,
    ScheduleModule.forRoot(),
  ],
  providers: [
    {
      provide: JOB_PROCESSOR,
      useFactory: (logger: LoggerPort): JobProcessor => createSchedulerJobProcessor(readNewsDigestConfig(), logger),
      inject: [LOGGER_PORT],
    },
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
