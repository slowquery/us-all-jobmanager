import { Job } from '../../domain/job';
import { JobRepository } from '../ports/job-repository.port';
import { LoggerPort } from '../ports/logger.port';
import { JobProcessOutcome, JobProcessor } from '../ports/job-processor.strategy';

/** 1 tick당 조회·처리할 최대 job 건수(09-final-design.md 확정 #7: 60초/10건). */
export const SCHEDULER_BATCH_SIZE = 10;

/** `ProcessPendingJobsUseCase.execute` 반환값. tick 1회의 처리 결과 집계다. */
export interface ProcessPendingJobsResult {
  batchSize: number;
  succeeded: number;
  failed: number;
}

/**
 * 스케줄러 tick 1회의 처리 파이프라인 유스케이스(03-scheduler-processing-design.md,
 * 09-final-design.md 확정 #2·#3).
 *
 * 1. `listByStatus('pending', SCHEDULER_BATCH_SIZE)`로 후보를 조회한다.
 * 2. `withBatch(ids, 'processing')`로 pending→processing을 일괄 선점(거부 건은 스킵)한다.
 * 3. 선점에 성공한 job 각각을 {@link JobProcessor}로 처리해 성공/실패를 판정한다.
 * 4. 성공/실패 판정 결과를 각각 `withBatch(..., 'completed')`/`withBatch(..., 'failed')`로
 *    일괄 커밋한다(전이당 파일 write 1회, tick당 최대 2회로 상한 — 09 확정 #2 성능 근거).
 * 5. 커밋된 job별로 {@link LoggerPort} transition 이벤트(actor='scheduler')를 emit한다
 *    (05-logging-design.md "상태 전이 이벤트" 절 — emit 지점은 커밋 완료 직후, S3가 스케줄러
 *    경로의 emit 책임을 이 유스케이스로 이관).
 * 6. 집계 결과를 {@link LoggerPort}로 전달한다(05-logging-design.md 배치 이벤트).
 *
 * adapter(`JobSchedulerAdapter`)는 `isTickRunning` 플래그·tick 시작/종료/스킵 로그만 담당하고,
 * 이 유스케이스는 tick이 실제로 실행되기로 결정된 이후의 처리 로직만 안다(Rule 3: `@nestjs/*`
 * 무침투, 03의 adapter/application 분리).
 */
export class ProcessPendingJobsUseCase {
  /**
   * @param jobRepository 작업 영속화 포트
   * @param jobProcessor 개별 job 처리 Strategy
   * @param logger 배치 결과 로깅 포트
   */
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly jobProcessor: JobProcessor,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * pending job 배치 1회를 처리한다.
   * @returns 배치 크기(선점 성공 건수)·성공/실패 집계
   */
  async execute(): Promise<ProcessPendingJobsResult> {
    const candidates = await this.jobRepository.listByStatus('pending', SCHEDULER_BATCH_SIZE);

    if (candidates.length === 0) {
      const result: ProcessPendingJobsResult = {
        batchSize: 0,
        succeeded: 0,
        failed: 0,
      };
      this.logger.log({
        type: 'batch',
        level: 'info',
        source: 'scheduler',
        message: 'batch skipped: no pending jobs',
        ...result,
      });
      return result;
    }

    const claimed = await this.jobRepository.withBatch(
      candidates.map((job) => job.id),
      'processing',
    );

    const succeededIds: string[] = [];
    const failedIds: string[] = [];
    for (const job of claimed.committed) {
      let outcome: JobProcessOutcome;
      try {
        outcome = await this.jobProcessor.process(job);
      } catch {
        // JobProcessor 오류 계약(no-throw)을 위반한 구현체 방어: 예외를 삼켜 해당 job만 failed로
        // 처리하고, 배치 잔여 job이 processing에 고착되지 않게 한다(선점→락 밖 처리→커밋 blast radius 차단).
        this.logger.log({
          type: 'error',
          level: 'error',
          source: 'scheduler',
          message: `job processor threw for job ${job.id}`,
          errorCode: 'JOB_PROCESSOR_THREW',
        });
        outcome = { outcome: 'failed' };
      }
      if (outcome.outcome === 'completed') {
        succeededIds.push(job.id);
      } else {
        failedIds.push(job.id);
      }
    }

    const completed: Job[] = succeededIds.length > 0 ? (await this.jobRepository.withBatch(succeededIds, 'completed')).committed : [];
    const failed: Job[] = failedIds.length > 0 ? (await this.jobRepository.withBatch(failedIds, 'failed')).committed : [];

    this.emitTransitionEvents(completed, 'completed');
    this.emitTransitionEvents(failed, 'failed');

    const result: ProcessPendingJobsResult = {
      batchSize: claimed.committed.length,
      succeeded: completed.length,
      failed: failed.length,
    };

    this.logger.log({
      type: 'batch',
      level: 'info',
      source: 'scheduler',
      message: 'tick completed',
      ...result,
    });

    return result;
  }

  /**
   * 커밋된 job 목록에 대해 transition 이벤트를 emit한다. `from`은 항상 `'processing'`이다 — 이
   * 유스케이스가 커밋하는 두 전이(선점 완료 후 처리 결과 커밋)는 모두 `processing`에서 출발하기
   * 때문이다(actor='scheduler', S3 이관 책임).
   */
  private emitTransitionEvents(jobs: Job[], to: 'completed' | 'failed'): void {
    for (const job of jobs) {
      this.logger.log({
        type: 'transition',
        level: 'info',
        source: 'scheduler',
        message: 'transition committed',
        jobId: job.id,
        from: 'processing',
        to,
        actor: 'scheduler',
      });
    }
  }
}
