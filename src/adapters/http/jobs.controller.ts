import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TransitionFailureReason } from '../../application/ports/job-repository.port';
import { CreateJobUseCase } from '../../application/use-cases/create-job.use-case';
import { GetJobsUseCase } from '../../application/use-cases/get-jobs.use-case';
import { GetJobUseCase } from '../../application/use-cases/get-job.use-case';
import { PatchJobUseCase } from '../../application/use-cases/patch-job.use-case';
import { SearchJobsUseCase } from '../../application/use-cases/search-jobs.use-case';
import { ApiException } from './api.exception';
import { CreateJobDto } from './dto/create-job.dto';
import { PatchJobDto } from './dto/patch-job.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { JobResponse, toJobResponse } from './job-response';

/** 목록/검색 응답 공통 envelope(04-api-layer-design.md `GET /jobs`·`GET /jobs/search` 성공 예시). */
interface JobListResponse {
  items: JobResponse[];
  count: number;
}

/**
 * `TransitionFailureReason`을 04-api-layer-design.md·09-final-design.md가 확정한 HTTP 상태
 * 코드/에러 코드로 매핑한다(404 NOT_FOUND / 409 INVALID_TRANSITION / 409 RETRY_LIMIT_EXCEEDED).
 * @param id 대상 job id(에러 메시지 구성용)
 * @param reason 유스케이스가 반환한 실패 사유
 * @returns 컨트롤러가 던질 {@link ApiException}
 */
function toTransitionFailureException(id: string, reason: TransitionFailureReason): ApiException {
  switch (reason) {
    case 'NOT_FOUND':
      return new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `id=${id} 인 작업을 찾을 수 없습니다.`);
    case 'RETRY_LIMIT_EXCEEDED':
      return new ApiException(
        HttpStatus.CONFLICT,
        'RETRY_LIMIT_EXCEEDED',
        '재시도 상한(3회)을 초과해 더 이상 재시도할 수 없습니다.',
        [{
          field: 'status',
          reason: 'retryCount가 상한에 도달했습니다.',
        }],
      );
    case 'INVALID_TRANSITION':
    default:
      return new ApiException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        '현재 상태에서 허용되지 않는 전이입니다.',
        [{
          field: 'status',
          reason: '허용된 전이: failed → pending',
        }],
      );
  }
}

/**
 * 작업(Job) REST API 컨트롤러. REQUIREMENTS.md의 5개 엔드포인트(`POST/GET/GET search/GET :id/PATCH`)를
 * 04-api-layer-design.md·09-final-design.md 확정 스펙대로 노출한다. 이 계층은 DTO 형식 검증(전역
 * `ValidationPipe`)까지만 책임지고, 전이 가부 판정은 유스케이스(그 안의 포트 구현체 임계구역)에
 * 위임한다(Rule 3, 헥사고날 경계).
 */
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly createJobUseCase: CreateJobUseCase,
    private readonly getJobsUseCase: GetJobsUseCase,
    private readonly searchJobsUseCase: SearchJobsUseCase,
    private readonly getJobUseCase: GetJobUseCase,
    private readonly patchJobUseCase: PatchJobUseCase,
  ) {}

  /** `POST /jobs` — 새 작업 생성(201). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateJobDto): Promise<JobResponse> {
    const job = await this.createJobUseCase.execute({
      title: dto.title,
      description: dto.description ?? '',
    });
    return toJobResponse(job);
  }

  /** `GET /jobs` — 전체 작업 목록 조회(200, 페이지네이션 없음). */
  @Get()
  async list(): Promise<JobListResponse> {
    const jobs = await this.getJobsUseCase.execute();
    return {
      items: jobs.map(toJobResponse),
      count: jobs.length,
    };
  }

  /**
   * `GET /jobs/search` — 제목 부분 일치/상태 완전 일치 검색(200). `title`/`status` 둘 다 없으면
   * `GET /jobs`와 책임이 겹치므로 400 `VALIDATION_FAILED`로 거부한다 — 이 규칙은 {@link SearchQueryDto}의
   * {@link AtLeastOneField} 검증이 ValidationPipe 단계에서 처리한다(컨트롤러 분기 제거, 04-api-layer-design.md 검색 쿼리 파라미터 설계).
   *
   * NestJS 라우팅은 등록 순서로 매칭하므로, `:id`보다 먼저 선언해 `/jobs/search`가 `:id` 파라미터로
   * 오인되지 않게 한다.
   */
  @Get('search')
  async search(@Query() query: SearchQueryDto): Promise<JobListResponse> {
    const jobs = await this.searchJobsUseCase.execute({
      title: query.title,
      status: query.status,
    });
    return {
      items: jobs.map(toJobResponse),
      count: jobs.length,
    };
  }

  /** `GET /jobs/:id` — 단건 조회(200, 미존재 시 404). */
  @Get(':id')
  async getById(@Param('id') id: string): Promise<JobResponse> {
    const result = await this.getJobUseCase.execute(id);
    if (!result.ok) {
      throw toTransitionFailureException(id, result.reason);
    }
    return toJobResponse(result.job);
  }

  /**
   * `PATCH /jobs/:id` — 작업 수정(200). `title`/`description`/`status`(재시도 전이) 중 최소 1개
   * 필드가 필요하다(04-api-layer-design.md PATCH 절). 실패 시 404(NOT_FOUND)/409(INVALID_TRANSITION
   * 또는 RETRY_LIMIT_EXCEEDED)로 매핑한다.
   */
  @Patch(':id')
  async patch(@Param('id') id: string, @Body() dto: PatchJobDto): Promise<JobResponse> {
    const result = await this.patchJobUseCase.execute({
      id,
      title: dto.title,
      description: dto.description,
      status: dto.status,
    });
    if (!result.ok) {
      throw toTransitionFailureException(id, result.reason);
    }
    return toJobResponse(result.job);
  }
}
