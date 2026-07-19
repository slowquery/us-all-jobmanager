import { DeleteResult, JobRepository } from '../ports/job-repository.port';
import { LoggerPort } from '../ports/logger.port';

/**
 * `DELETE /jobs/:id` 유스케이스. 삭제 가부 판정(`processing`이면 금지)은
 * `JobRepository.delete`(포트 구현체 임계구역)에 위임하고, 이 유스케이스는 성공 시에만
 * `delete` 이벤트를 emit한다(감사 기록, FileLoggerAdapter가 NDJSON 직렬화 시 `type` 키를
 * 제거하므로 `message` 문자열이 삭제 사실을 남기는 유일한 정본 마커다 — 메시지 형식을
 * 임의로 바꾸지 않는다).
 */
export class DeleteJobUseCase {
  /**
   * @param jobRepository 작업 영속화 포트
   * @param logger 삭제 성공 이벤트를 기록할 구조화 로깅 포트
   */
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * job을 삭제한다.
   * @param id 삭제 대상 job id
   * @returns 성공 시 `{ ok: true }`, 실패 시 사유(NOT_FOUND/FORBIDDEN_PROCESSING)
   */
  async execute(id: string): Promise<DeleteResult> {
    const result = await this.jobRepository.delete(id);
    if (result.ok) {
      this.emitDeleteEvent(id);
    }
    return result;
  }

  /** 삭제 성공 경로에서만 `delete` 이벤트를 기록한다. 메시지 문자열은 감사 마커로 변경 금지. */
  private emitDeleteEvent(id: string): void {
    try {
      this.logger.log({
        type: 'delete',
        level: 'info',
        source: 'http',
        message: `job deleted id=${id}`,
        jobId: id,
      });
    } catch {
      // 로깅 실패는 DELETE 처리 흐름에 전파되지 않는다(로깅 실패 격리 조항).
    }
  }
}
