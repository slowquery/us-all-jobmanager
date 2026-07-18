import { Job } from '../../domain/job';
import { CreateJobData, JobRepository } from '../ports/job-repository.port';

/**
 * `POST /jobs` 유스케이스. job 생성 규칙(status는 항상 `pending`으로 고정 등)은 포트 구현체가
 * 담당하므로, 이 클래스는 입력을 그대로 포트에 위임하는 순수 오케스트레이션만 수행한다
 * (04-api-layer-design.md).
 */
export class CreateJobUseCase {
  /** @param jobRepository 작업 영속화 포트 */
  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * 새 job을 생성한다.
   * @param input 생성 입력(title/description)
   * @returns 생성된 Job
   */
  async execute(input: CreateJobData): Promise<Job> {
    return this.jobRepository.create(input);
  }
}
