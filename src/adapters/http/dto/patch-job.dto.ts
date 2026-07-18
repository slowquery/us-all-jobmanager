import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { JobStatus } from '../../../domain/job';

/**
 * `PATCH /jobs/:id` 요청 바디 DTO. 세 필드 모두 선택이지만 최소 1개는 있어야 한다(컨트롤러에서
 * 별도 검증). `status`는 `'pending'` 단일 값만 허용한다 — 01의 PATCH 경유 전이(`failed → pending`
 * 재시도)만 DTO 레벨에서 표현 가능하게 하고, `processing`/`completed`는 스케줄러 전용 전이라 애초에
 * 열거형에 포함하지 않는다(04-api-layer-design.md PATCH 절). 실제 전이 가부는 domain guard가
 * 애플리케이션/인프라 경계의 임계구역 내부에서 판정한다 — 이 DTO는 값의 형식만 검증한다.
 */
export class PatchJobDto {
  /** 갱신할 제목(선택, 1~200자). */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  /** 갱신할 설명(선택, 0~2000자). */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  /** 재시도 전이 요청 값(선택). `'pending'` 외 다른 값은 DTO 검증 단계에서 거부된다. */
  @IsOptional()
  @IsIn(['pending'])
  status?: Extract<JobStatus, 'pending'>;
}
