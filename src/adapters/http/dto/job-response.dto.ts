import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '../../../domain/job';

/**
 * HTTP 응답으로 노출하는 Job 리소스(Swagger 스키마). `retryCount`는 재시도 상한 판정용 내부
 * 필드라 API 계약에 포함하지 않는다(04-api-layer-design.md). 클래스로 선언해 `@nestjs/swagger`가
 * 런타임 스키마·example을 생성할 수 있게 한다({@link toJobResponse}가 이 형태를 반환).
 */
export class JobResponseDto {
  @ApiProperty({
    description: '작업 식별자(UUID)',
    example: '3f8a1c2e-9b4d-4e21-8a77-1d2c3b4e5f60',
  })
  id!: string;

  @ApiProperty({
    description: '작업 제목',
    example: '배포 파이프라인 실행',
  })
  title!: string;

  @ApiProperty({
    description: '작업 설명',
    example: '스테이징 배포 후 스모크 테스트 수행',
  })
  description!: string;

  @ApiProperty({
    description: '작업 상태',
    enum: [
      'pending',
      'processing',
      'completed',
      'failed',
    ],
    example: 'pending',
  })
  status!: JobStatus;

  @ApiProperty({
    description: '생성 시각(ISO8601)',
    example: '2026-07-18T09:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '최종 수정 시각(ISO8601)',
    example: '2026-07-18T09:00:00.000Z',
  })
  updatedAt!: string;
}

/** 목록/검색 응답 공통 envelope(`GET /jobs`·`GET /jobs/search`). */
export class JobListResponseDto {
  @ApiProperty({
    description: '작업 리소스 배열',
    type: [JobResponseDto],
  })
  items!: JobResponseDto[];

  @ApiProperty({
    description: '`items` 길이',
    example: 1,
  })
  count!: number;
}
