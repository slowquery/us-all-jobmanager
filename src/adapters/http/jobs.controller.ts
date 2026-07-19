import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { TransitionFailureReason } from '../../application/ports/job-repository.port';
import { CreateJobUseCase } from '../../application/use-cases/create-job.use-case';
import { DeleteJobUseCase } from '../../application/use-cases/delete-job.use-case';
import { GetJobsUseCase } from '../../application/use-cases/get-jobs.use-case';
import { GetJobUseCase } from '../../application/use-cases/get-job.use-case';
import { PatchJobUseCase } from '../../application/use-cases/patch-job.use-case';
import { SearchJobsUseCase } from '../../application/use-cases/search-jobs.use-case';
import { ApiException } from './api.exception';
import { ApiErrorResponseDto } from './dto/api-error-response.dto';
import { CreateJobDto } from './dto/create-job.dto';
import { JobListResponseDto, JobResponseDto } from './dto/job-response.dto';
import { PatchJobDto } from './dto/patch-job.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { toJobResponse } from './job-response';

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
 * 삭제 실패 사유를 HTTP 상태/에러 코드로 매핑한다(404 NOT_FOUND / 409 JOB_IN_PROGRESS).
 * @param id 대상 job id(에러 메시지 구성용)
 * @param reason `DeleteResult` 실패 사유(NOT_FOUND/FORBIDDEN_PROCESSING)
 * @returns 컨트롤러가 던질 {@link ApiException}
 */
function toDeleteFailureException(id: string, reason: 'NOT_FOUND' | 'FORBIDDEN_PROCESSING'): ApiException {
  if (reason === 'NOT_FOUND') {
    return new ApiException(HttpStatus.NOT_FOUND, 'NOT_FOUND', `id=${id} 인 작업을 찾을 수 없습니다.`);
  }
  return new ApiException(
    HttpStatus.CONFLICT,
    'JOB_IN_PROGRESS',
    '처리 중인 작업은 삭제할 수 없습니다.',
    [{
      field: 'status',
      reason: 'processing 상태의 작업은 삭제가 금지됩니다.',
    }],
  );
}

/**
 * 작업(Job) REST API 컨트롤러. REQUIREMENTS.md의 6개 엔드포인트(`POST/GET/GET search/GET :id/PATCH/DELETE :id`)를
 * 04-api-layer-design.md·09-final-design.md 확정 스펙대로 노출한다. 이 계층은 DTO 형식 검증(전역
 * `ValidationPipe`)까지만 책임지고, 전이·삭제 가부 판정은 유스케이스(그 안의 포트 구현체 임계구역)에
 * 위임한다(Rule 3, 헥사고날 경계).
 */
@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly createJobUseCase: CreateJobUseCase,
    private readonly getJobsUseCase: GetJobsUseCase,
    private readonly searchJobsUseCase: SearchJobsUseCase,
    private readonly getJobUseCase: GetJobUseCase,
    private readonly patchJobUseCase: PatchJobUseCase,
    private readonly deleteJobUseCase: DeleteJobUseCase,
  ) {}

  /** `POST /jobs` — 새 작업 생성(201). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '작업 생성',
    description: '새 작업을 생성한다. 생성 시 상태는 항상 pending으로 고정된다.',
  })
  @ApiBody({
    type: CreateJobDto,
    examples: {
      기본: {
        summary: '제목+설명',
        value: {
          title: '배포 파이프라인 실행',
          description: '스테이징 배포 후 스모크 테스트 수행',
        },
      },
      제목만: {
        summary: '설명 생략',
        value: { title: '로그 로테이션' },
      },
    },
  })
  @ApiCreatedResponse({
    description: '생성된 작업',
    type: JobResponseDto,
    example: {
      id: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
      title: '배포 파이프라인 실행',
      description: '스테이징 배포 후 스모크 테스트 수행',
      status: 'pending',
      createdAt: '2026-07-18T09:00:00.000Z',
      updatedAt: '2026-07-18T09:00:00.000Z',
    },
  })
  @ApiBadRequestResponse({
    description: '검증 실패(VALIDATION_FAILED) 또는 미구현 작업 유형(UNSUPPORTED_JOB_TYPE)',
    type: ApiErrorResponseDto,
    example: {
      code: 'VALIDATION_FAILED',
      message: '요청이 유효하지 않습니다.',
      details: [{
        field: 'title',
        reason: 'title must be longer than or equal to 1 characters',
      }],
    },
  })
  async create(@Body() dto: CreateJobDto): Promise<JobResponseDto> {
    const result = await this.createJobUseCase.execute({
      title: dto.title,
      description: dto.description ?? '',
    });
    if (!result.ok) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'UNSUPPORTED_JOB_TYPE',
        `구현되지 않은 작업 유형입니다: "${result.title}".`,
        [{
          field: 'title',
          reason: result.supported.length > 0
            ? `현재 구현된 작업 유형: ${result.supported.join(', ')}`
            : '현재 구현된 작업 유형이 없습니다.',
        }],
      );
    }
    return toJobResponse(result.job);
  }

  /** `GET /jobs` — 전체 작업 목록 조회(200, 페이지네이션 없음). */
  @Get()
  @ApiOperation({
    summary: '작업 목록 조회',
    description: '전체 작업 목록을 반환한다(페이지네이션 없음).',
  })
  @ApiOkResponse({
    description: '작업 목록',
    type: JobListResponseDto,
    example: {
      items: [{
        id: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
        title: '배포 파이프라인 실행',
        description: '스테이징 배포 후 스모크 테스트 수행',
        status: 'pending',
        createdAt: '2026-07-18T09:00:00.000Z',
        updatedAt: '2026-07-18T09:00:00.000Z',
      }],
      count: 1,
    },
  })
  async list(): Promise<JobListResponseDto> {
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
  @ApiOperation({
    summary: '작업 검색',
    description: 'title 부분 일치·status 완전 일치로 검색한다. 둘 다 없으면 400.',
  })
  @ApiOkResponse({
    description: '검색 결과',
    type: JobListResponseDto,
    example: {
      items: [{
        id: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
        title: '배포 파이프라인 실행',
        description: '스테이징 배포 후 스모크 테스트 수행',
        status: 'pending',
        createdAt: '2026-07-18T09:00:00.000Z',
        updatedAt: '2026-07-18T09:00:00.000Z',
      }],
      count: 1,
    },
  })
  @ApiBadRequestResponse({
    description: 'title/status 둘 다 없음',
    type: ApiErrorResponseDto,
    example: {
      code: 'VALIDATION_FAILED',
      message: '요청이 유효하지 않습니다.',
      details: [{
        field: 'atLeastOneField',
        reason: 'title 또는 status 중 최소 1개는 필요합니다.',
      }],
    },
  })
  async search(@Query() query: SearchQueryDto): Promise<JobListResponseDto> {
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
  @ApiOperation({
    summary: '작업 단건 조회',
    description: 'id로 작업 1건을 조회한다. 미존재 시 404.',
  })
  @ApiParam({
    name: 'id',
    description: '작업 식별자(UUID)',
    example: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
  })
  @ApiOkResponse({
    description: '작업',
    type: JobResponseDto,
    example: {
      id: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
      title: '배포 파이프라인 실행',
      description: '스테이징 배포 후 스모크 테스트 수행',
      status: 'pending',
      createdAt: '2026-07-18T09:00:00.000Z',
      updatedAt: '2026-07-18T09:00:00.000Z',
    },
  })
  @ApiNotFoundResponse({
    description: '미존재',
    type: ApiErrorResponseDto,
    example: {
      code: 'NOT_FOUND',
      message: 'id=3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60 인 작업을 찾을 수 없습니다.',
    },
  })
  async getById(@Param('id') id: string): Promise<JobResponseDto> {
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
  @ApiOperation({
    summary: '작업 수정',
    description: 'title/description/status(재시도 전이) 중 최소 1개 필드를 수정한다.',
  })
  @ApiParam({
    name: 'id',
    description: '작업 식별자(UUID)',
    example: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
  })
  @ApiBody({
    type: PatchJobDto,
    examples: {
      제목수정: {
        summary: '제목만 변경',
        value: { title: '배포 파이프라인 실행(수정)' },
      },
      재시도: {
        summary: 'failed → pending 재시도',
        value: { status: 'pending' },
      },
    },
  })
  @ApiOkResponse({
    description: '수정된 작업',
    type: JobResponseDto,
    example: {
      id: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
      title: '배포 파이프라인 실행(수정)',
      description: '스테이징 배포 후 스모크 테스트 수행',
      status: 'pending',
      createdAt: '2026-07-18T09:00:00.000Z',
      updatedAt: '2026-07-18T09:05:00.000Z',
    },
  })
  @ApiNotFoundResponse({
    description: '미존재',
    type: ApiErrorResponseDto,
    example: {
      code: 'NOT_FOUND',
      message: 'id=... 인 작업을 찾을 수 없습니다.',
    },
  })
  @ApiConflictResponse({
    description: '허용되지 않는 전이 또는 재시도 상한 초과',
    type: ApiErrorResponseDto,
    example: {
      code: 'INVALID_TRANSITION',
      message: '현재 상태에서 허용되지 않는 전이입니다.',
      details: [{
        field: 'status',
        reason: '허용된 전이: failed → pending',
      }],
    },
  })
  async patch(@Param('id') id: string, @Body() dto: PatchJobDto): Promise<JobResponseDto> {
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

  /**
   * `DELETE /jobs/:id` — 작업 삭제(204). `processing` 상태의 작업은 삭제가 금지되어 409
   * `JOB_IN_PROGRESS`로 거부한다. 미존재 시 404 NOT_FOUND.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '작업 삭제',
    description: 'id로 작업 1건을 삭제한다. processing 상태는 409로 거부되며, 미존재 시 404.',
  })
  @ApiParam({
    name: 'id',
    description: '작업 식별자(UUID)',
    example: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
  })
  @ApiNoContentResponse({ description: '삭제 완료(응답 바디 없음)' })
  @ApiNotFoundResponse({
    description: '미존재',
    type: ApiErrorResponseDto,
    example: {
      code: 'NOT_FOUND',
      message: 'id=... 인 작업을 찾을 수 없습니다.',
    },
  })
  @ApiConflictResponse({
    description: '처리 중인 작업 삭제 시도',
    type: ApiErrorResponseDto,
    example: {
      code: 'JOB_IN_PROGRESS',
      message: '처리 중인 작업은 삭제할 수 없습니다.',
      details: [{
        field: 'status',
        reason: 'processing 상태의 작업은 삭제가 금지됩니다.',
      }],
    },
  })
  async remove(@Param('id') id: string): Promise<void> {
    const result = await this.deleteJobUseCase.execute(id);
    if (!result.ok) {
      throw toDeleteFailureException(id, result.reason);
    }
  }
}
