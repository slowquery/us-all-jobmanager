import { Module } from '@nestjs/common';
import { JOB_PROCESSOR, JOB_REPOSITORY, LOGGER_PORT } from '../adapters/tokens';
import { JobProcessor, DefaultJobProcessor } from '../application/ports/job-processor.strategy';
import { JobRepository } from '../application/ports/job-repository.port';
import { LoggerPort } from '../application/ports/logger.port';
import { TracingJobProcessor } from '../adapters/scheduler/tracing-job.processor';
import { FileLoggerAdapter } from './logging/file-logger.adapter';
import { JsonDbJobRepository } from './persistence/json-db-job.repository';

/**
 * 인프라/어댑터 구현체를 포트 토큰({@link LOGGER_PORT}/{@link JOB_REPOSITORY}/{@link JOB_PROCESSOR})에
 * 바인딩하고 **export**하는 공유 모듈. HTTP({@link HttpModule})와 스케줄러({@link SchedulerModule})가
 * 동일한 포트 인스턴스를 주입받도록 이 모듈을 import한다 — 포트 provider 중복 정의를 피하고
 * 헥사고날 경계(구현체는 인프라/어댑터, 유스케이스는 포트만 의존)를 단일 지점에서 유지한다(Rule 3).
 *
 * 세 토큰을 export하므로 `Test.createTestingModule({ imports: [AppModule] })` 그래프에서도
 * `.overrideProvider(LOGGER_PORT|JOB_REPOSITORY)`가 그대로 동작한다(e2e 테스트 배선 호환).
 *
 * `JobProcessor`는 `DefaultJobProcessor`를 `TracingJobProcessor`(adapter 계층 스팬 데코레이터,
 * 06-observability-design.md)로 감싼 인스턴스를 바인딩해 job별 자식 스팬 계측이 application 코드
 * 변경 없이 DI 배선만으로 주입되게 한다(도메인/유스케이스 무침투).
 */
@Module({
  providers: [
    {
      provide: LOGGER_PORT,
      useFactory: (): LoggerPort => new FileLoggerAdapter('logs.txt'),
    },
    {
      provide: JOB_REPOSITORY,
      useFactory: (logger: LoggerPort): JobRepository => new JsonDbJobRepository('jobs.json', logger),
      inject: [LOGGER_PORT],
    },
    {
      provide: JOB_PROCESSOR,
      useFactory: (): JobProcessor => new TracingJobProcessor(new DefaultJobProcessor()),
    },
  ],
  exports: [
    LOGGER_PORT,
    JOB_REPOSITORY,
    JOB_PROCESSOR,
  ],
})
export class InfrastructureModule {}
