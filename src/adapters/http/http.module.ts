import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { JobRepository } from '../../application/ports/job-repository.port';
import { LoggerPort } from '../../application/ports/logger.port';
import { CreateJobUseCase } from '../../application/use-cases/create-job.use-case';
import { GetJobsUseCase } from '../../application/use-cases/get-jobs.use-case';
import { GetJobUseCase } from '../../application/use-cases/get-job.use-case';
import { PatchJobUseCase } from '../../application/use-cases/patch-job.use-case';
import { SearchJobsUseCase } from '../../application/use-cases/search-jobs.use-case';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module';
import { JOB_REPOSITORY, LOGGER_PORT } from '../tokens';
import { HttpExceptionFilter } from './http-exception.filter';
import { JobsController } from './jobs.controller';
import { LoggingInterceptor } from './logging.interceptor';

/**
 * API(HTTP 엔드포인트) 전용 모듈. REST 컨트롤러({@link JobsController})와 그것이 호출하는 HTTP
 * 유스케이스(생성/목록/검색/단건/수정), 그리고 전역 요청 파이프라인(`APP_PIPE` 검증 / `APP_FILTER`
 * 에러 envelope / `APP_INTERCEPTOR` 로깅·트레이싱)을 한 곳에 응집한다. 포트 구현체는
 * {@link InfrastructureModule}가 제공하므로 이 모듈은 포트 토큰만 주입받는다(헥사고날 경계 유지).
 *
 * 전역 pipe/filter/interceptor는 이 모듈에서 `APP_*` 토큰으로 등록해도 앱 전역에 적용된다
 * (NestFactory가 모든 모듈의 `APP_*` provider를 수집). 인스턴스 API(`app.useGlobalPipes` 등)
 * 대신 토큰 등록을 쓰는 이유는 `Test.createTestingModule` 오버라이드 합성·부트스트랩 순서 비의존이다
 * (09-final-design.md 확정 #4·#6).
 */
@Module({
  imports: [InfrastructureModule],
  controllers: [JobsController],
  providers: [
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
      inject: [
        JOB_REPOSITORY,
        LOGGER_PORT,
      ],
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class HttpModule {}
