import { IsOptional, IsString, Length } from 'class-validator';

/**
 * `POST /jobs` 요청 바디 DTO. `title`은 필수 문자열(1~200자), `description`은 선택 문자열
 * (0~2000자)이다. `status`는 요청에서 받지 않는다 — 생성 시 항상 서버가 `pending`으로 고정한다
 * (04-api-layer-design.md POST /jobs, whitelist:true로 필드 외 값은 자동 거부된다).
 */
export class CreateJobDto {
  /** 작업 제목(필수, 1~200자). */
  @IsString()
  @Length(1, 200)
  title!: string;

  /** 작업 설명(선택, 0~2000자). 미지정 시 빈 문자열로 취급한다. */
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;
}
