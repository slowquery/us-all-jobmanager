import { Job } from '../../domain/job';
import { JobRepository } from '../ports/job-repository.port';

/**
 * `GetJobUseCase.execute` 결과 판별 유니온. 실패 사유는 미존재(`NOT_FOUND`) 1종뿐이며
 * adapter는 이를 404 `JOB_NOT_FOUND`로 매핑한다(04-api-layer-design.md).
 */
export type GetJobResult = { ok: true; job: Job } | { ok: false; reason: 'NOT_FOUND' };

/**
 * `GET /jobs/:id` 유스케이스. 단건 조회 후 존재 여부를 판별한다.
 */
export class GetJobUseCase {
  /** @param jobRepository 작업 영속화 포트 */
  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * id로 job 단건을 조회한다.
   * @param id 조회할 job의 id
   * @returns 존재하면 `{ ok: true, job }`, 없으면 `{ ok: false, reason: 'NOT_FOUND' }`
   */
  async execute(id: string): Promise<GetJobResult> {
    const job = await this.jobRepository.findById(id);
    if (!job) {
      return { ok: false, reason: 'NOT_FOUND' };
    }
    return { ok: true, job };
  }
}
