import { Job } from '../../domain/job';
import { CreateJobData, JobRepository } from '../ports/job-repository.port';
import { SupportedJobTypes } from '../ports/supported-job-types.port';

/**
 * `CreateJobUseCase.execute`의 결과. 구현된 작업 유형이면 생성된 job을, 구현되지 않은 유형이면
 * 거부 사유를 담은 판별 유니온으로 반환한다(컨트롤러가 HTTP 상태/에러 코드로 매핑).
 */
export type CreateJobResult =
  | { ok: true; job: Job }
  | { ok: false; reason: 'UNSUPPORTED_JOB_TYPE'; title: string; supported: readonly string[] };

/**
 * `POST /jobs` 유스케이스. 작업 생성 규칙(status는 항상 `pending` 고정 등)은 포트 구현체가
 * 담당하고, 이 클래스는 **구현된 작업 유형인지 검증**한 뒤 포트에 위임한다(04-api-layer-design.md).
 *
 * 구현되지 않은 작업(실제 처리기가 없어 무동작으로 성공 처리되던 job)은 생성 단계에서 거부해,
 * "아무 일도 하지 않고 성공"하는 job이 만들어지지 않게 한다. 구현 유형 판별은 {@link SupportedJobTypes}
 * 포트에 위임하므로 이 계층은 구체 목록을 알지 못한다(Rule 3).
 */
export class CreateJobUseCase {
  /**
   * @param jobRepository 작업 영속화 포트
   * @param supportedJobTypes 구현된 작업 유형 레지스트리(입력 검증 seam)
   */
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly supportedJobTypes: SupportedJobTypes,
  ) {}

  /**
   * 새 job을 생성한다. 구현되지 않은 작업 유형이면 생성하지 않고 거부 결과를 반환한다.
   * @param input 생성 입력(title/description)
   * @returns 성공 시 생성된 Job, 미구현 유형이면 거부 사유
   */
  async execute(input: CreateJobData): Promise<CreateJobResult> {
    if (!this.supportedJobTypes.isSupported(input.title)) {
      return {
        ok: false,
        reason: 'UNSUPPORTED_JOB_TYPE',
        title: input.title,
        supported: this.supportedJobTypes.titles,
      };
    }
    const job = await this.jobRepository.create(input);
    return {
      ok: true,
      job,
    };
  }
}
