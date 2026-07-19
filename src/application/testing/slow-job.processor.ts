import { Job } from '../../domain/job';
import { JobProcessOutcome, JobProcessor } from '../ports/job-processor.strategy';

/**
 * 테스트 전용 결정론적 "느린" `JobProcessor` 더블.
 *
 * 처리 지연을 **테스트가 명시적으로 제어**한다 — `gate` promise를 주면 테스트가 resolve하는 시점까지
 * 처리가 멈추고(결정론적 overrun 재현에 이상적), 없으면 고정 `delayMs`만큼만 지연한다. 무작위 jitter는
 * 결정론성과 상충하므로 두지 않는다(항상 0). C-4 tick overrun을 fake timer 없이 실측 연장하는 용도.
 *
 * `application/testing/`은 커버리지 집계에서 제외된다(package.json jest 설정).
 */
export class SlowJobProcessor implements JobProcessor {
  private readonly processedIds: string[] = [];

  /**
   * @param options.delayMs 고정 지연(ms). `gate` 미지정 시에만 적용. 기본 0.
   * @param options.gate 지정 시 이 promise가 resolve될 때까지 처리를 보류한다(테스트 제어 지연).
   * @param options.outcome 반환할 처리 결과. 기본 `completed`.
   * @param options.onProcess 각 처리 시작 시 호출되는 관측 훅(옵션).
   */
  constructor(
    private readonly options: {
      delayMs?: number;
      gate?: Promise<void>;
      outcome?: 'completed' | 'failed';
      onProcess?: (job: Job) => void;
    } = {},
  ) {}

  /** 지금까지 처리 요청을 받은 job id 목록(호출 순서대로, 중복 포함). */
  get processed(): readonly string[] {
    return this.processedIds;
  }

  /**
   * job 1건을 (테스트가 제어하는) 지연 후 처리한다.
   * @param job 처리 대상 job
   * @returns 생성자에 지정된 결과(기본 completed)
   */
  async process(job: Job): Promise<JobProcessOutcome> {
    this.processedIds.push(job.id);
    this.options.onProcess?.(job);
    if (this.options.gate) {
      await this.options.gate;
    } else if ((this.options.delayMs ?? 0) > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, this.options.delayMs);
      });
    }
    return { outcome: this.options.outcome ?? 'completed' };
  }
}
