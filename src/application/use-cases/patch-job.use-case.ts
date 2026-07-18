import { JobRepository, TransitionResult } from '../ports/job-repository.port';

/**
 * `PATCH /jobs/:id` 요청 입력. `status`는 DTO 레벨에서 이미 `'pending'` 단일 값으로 좁혀진
 * 상태로 전달된다고 가정한다(형식 검증은 adapter 책임, 04-api-layer-design.md). 이 유스케이스는
 * "그 값이 지금 실제로 허용되는 전이인가"만 domain guard(포트 구현체 경유)로 판정한다.
 */
export interface PatchJobInput {
  id: string;
  title?: string;
  description?: string;
  status?: 'pending';
}

/**
 * `PATCH /jobs/:id` 유스케이스. title/description 갱신과 `failed → pending` 재시도 전이를
 * 모두 `JobRepository.withTransition` 경유로 처리한다(04-api-layer-design.md: "비상태 필드만
 * 있는 PATCH도 동일하게 withTransition을 경유해 무손실을 보장하되 guard 평가 대상은 아니다").
 *
 * - `status === 'pending'`이면 목표 상태를 `'pending'`으로 지정해 재시도 전이를 시도한다.
 * - `status`가 없으면(title/description만 갱신) 목표 상태를 알 수 없으므로 먼저 현재 상태를
 *   조회해 그 값을 target으로 그대로 전달한다 — 포트 구현체는 target이 현재 status와 동일하면
 *   guard 평가를 건너뛰고 patch만 반영한다(job-repository.port.ts `withTransition` 계약 참조).
 */
export class PatchJobUseCase {
  /** @param jobRepository 작업 영속화 포트 */
  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * job을 patch한다.
   * @param input PATCH 입력(형식 검증 통과 후 값)
   * @returns 성공 시 갱신된 Job, 실패 시 사유(NOT_FOUND/INVALID_TRANSITION/RETRY_LIMIT_EXCEEDED)
   */
  async execute(input: PatchJobInput): Promise<TransitionResult> {
    const patch = { title: input.title, description: input.description };

    if (input.status === 'pending') {
      return this.jobRepository.withTransition(input.id, 'pending', patch);
    }

    const current = await this.jobRepository.findById(input.id);
    if (!current) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    return this.jobRepository.withTransition(input.id, current.status, patch);
  }
}
