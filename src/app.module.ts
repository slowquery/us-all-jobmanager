import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpExceptionFilter } from './adapters/http/http-exception.filter';
import { JobsController } from './adapters/http/jobs.controller';
import { LoggingInterceptor } from './adapters/http/logging.interceptor';
import { JOB_REPOSITORY, LOGGER_PORT } from './adapters/tokens';
import { JobRepository } from './application/ports/job-repository.port';
import { LoggerPort } from './application/ports/logger.port';
import { CreateJobUseCase } from './application/use-cases/create-job.use-case';
import { GetJobsUseCase } from './application/use-cases/get-jobs.use-case';
import { GetJobUseCase } from './application/use-cases/get-job.use-case';
import { PatchJobUseCase } from './application/use-cases/patch-job.use-case';
import { SearchJobsUseCase } from './application/use-cases/search-jobs.use-case';
import { FileLoggerAdapter } from './infrastructure/logging/file-logger.adapter';
import { JsonDbJobRepository } from './infrastructure/persistence/json-db-job.repository';

/**
 * 애플리케이션 루트 모듈. 헥사고날 배치의 DI 배선을 담당한다(Rule 3) — 포트(`JobRepository`/
 * `LoggerPort`)는 인터페이스라 런타임 토큰이 없으므로 심볼 토큰({@link JOB_REPOSITORY}/
 * {@link LOGGER_PORT})으로 바인딩하고, 유스케이스는 포트만 주입받는 순수 클래스이므로 `useFactory`로
 * 직접 생성한다(`@Injectable` 없이도 DI 컨테이너가 인스턴스를 관리할 수 있게 하는 최소 배선).
 *
 * 전역 파이프/필터/인터셉터는 `APP_PIPE`/`APP_FILTER`/`APP_INTERCEPTOR` 토큰으로 등록한다
 * (`app.useGlobalPipes(...)` 등 인스턴스 API 대신 — 토큰 등록은 `Test.createTestingModule`의
 * provider 오버라이드와 자연스럽게 합성되고, `main.ts` 부트스트랩 순서에 의존하지 않는다,
 * 09-final-design.md 확정 #4·#6).
 *
 * 스케줄러 모듈 등록(`src/adapters/scheduler/**`)은 이 모듈의 책임이 아니다 — S5가 어댑터 코드를
 * 작성하고 S6가 이 모듈에 배선한다(공통 제약: app.module.ts는 S4 소유이나 스케줄러 wiring은 범위 밖).
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [JobsController],
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
      provide: CreateJobUseCase,
      useFactory: (repository: JobRepository): CreateJobUseCase => new CreateJobUseCase(repository),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: GetJobsUseCase,
      useFactory: (repository: JobRepository): GetJobsUseCase => new GetJobsUseCase(repository),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: SearchJobsUseCase,
      useFactory: (repository: JobRepository): SearchJobsUseCase => new SearchJobsUseCase(repository),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: GetJobUseCase,
      useFactory: (repository: JobRepository): GetJobUseCase => new GetJobUseCase(repository),
      inject: [JOB_REPOSITORY],
    },
    {
      provide: PatchJobUseCase,
      useFactory: (repository: JobRepository, logger: LoggerPort): PatchJobUseCase => new PatchJobUseCase(repository, logger),
      inject: [JOB_REPOSITORY, LOGGER_PORT],
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
