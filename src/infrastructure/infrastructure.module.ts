import { Module } from '@nestjs/common';
import { JOB_REPOSITORY, LOGGER_PORT, SUPPORTED_JOB_TYPES } from '../adapters/tokens';
import { JobRepository } from '../application/ports/job-repository.port';
import { LoggerPort } from '../application/ports/logger.port';
import { AllowListJobTypes, SupportedJobTypes } from '../application/ports/supported-job-types.port';
import { readNewsDigestConfig } from './config/news-digest.config';
import { FileLoggerAdapter } from './logging/file-logger.adapter';
import { JsonDbJobRepository } from './persistence/json-db-job.repository';

/**
 * 인프라 구현체를 포트 토큰({@link LOGGER_PORT}/{@link JOB_REPOSITORY}/{@link SUPPORTED_JOB_TYPES})에
 * 바인딩하고 **export**하는 공유 모듈. HTTP({@link HttpModule})와 스케줄러({@link SchedulerModule})가
 * 동일한 포트 인스턴스를 주입받도록 이 모듈을 import한다 — 포트 provider 중복 정의를 피하고
 * 헥사고날 경계(구현체는 인프라, 유스케이스는 포트만 의존)를 단일 지점에서 유지한다(Rule 3).
 *
 * 세 토큰을 export하므로 `Test.createTestingModule({ imports: [AppModule] })` 그래프에서도
 * `.overrideProvider(LOGGER_PORT|JOB_REPOSITORY|SUPPORTED_JOB_TYPES)`가 그대로 동작한다(e2e 테스트 배선 호환).
 *
 * `SUPPORTED_JOB_TYPES`(구현된 작업 유형 레지스트리)는 스케줄러가 실제 라우팅하는 유형으로 구성한다 —
 * 현재 구현된 처리기는 뉴스 다이제스트뿐이므로 그 sentinel 제목(`NEWS_DIGEST_JOB_TITLE`, 기본 `news-digest`)
 * 하나만 허용한다. 이 목록에 없는 작업은 `POST /jobs`가 400 `UNSUPPORTED_JOB_TYPE`로 거부한다.
 *
 * `JOB_PROCESSOR`(TracingJobProcessor)는 스케줄러 전용이라 이 인프라 모듈이 아니라 유일 소비자인
 * {@link SchedulerModule}가 바인딩한다 — infrastructure가 adapters/scheduler에 역방향 의존하지
 * 않도록 경계를 유지한다.
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
      provide: SUPPORTED_JOB_TYPES,
      useFactory: (): SupportedJobTypes => new AllowListJobTypes([readNewsDigestConfig().jobTitle]),
    },
  ],
  exports: [
    LOGGER_PORT,
    JOB_REPOSITORY,
    SUPPORTED_JOB_TYPES,
  ],
})
export class InfrastructureModule {}
