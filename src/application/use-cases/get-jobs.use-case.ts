import { Job } from '../../domain/job';
import { JobRepository } from '../ports/job-repository.port';

/**
 * `GET /jobs` 유스케이스. 전량 목록 조회를 포트에 그대로 위임한다(페이지네이션은 스코프 밖,
 * 04-api-layer-design.md Follow-ups).
 */
export class GetJobsUseCase {
  /** @param jobRepository 작업 영속화 포트 */
  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * 전체 job 목록을 조회한다.
   * @returns 전체 Job 배열
   */
  async execute(): Promise<Job[]> {
    return this.jobRepository.list();
  }
}
