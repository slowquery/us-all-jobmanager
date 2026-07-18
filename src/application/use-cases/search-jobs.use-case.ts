import { Job } from '../../domain/job';
import { JobRepository, JobSearchQuery } from '../ports/job-repository.port';

/**
 * `GET /jobs/search` 유스케이스. 최소 1개 파라미터 필요 등 요청 형식 검증은 adapter(DTO) 책임이며,
 * 이 클래스는 검증을 통과한 조건을 그대로 포트에 위임한다(04-api-layer-design.md).
 */
export class SearchJobsUseCase {
  /** @param jobRepository 작업 영속화 포트 */
  constructor(private readonly jobRepository: JobRepository) {}

  /**
   * 조건에 맞는 job을 검색한다.
   * @param query 검색 조건(title 부분 일치/status 완전 일치, AND 결합)
   * @returns 조건에 맞는 Job 배열
   */
  async execute(query: JobSearchQuery): Promise<Job[]> {
    return this.jobRepository.search(query);
  }
}
