import { Job } from '../../domain/job';

/** 개별 job 처리 결과. `completed`/`failed`만 존재하며 domain 전이 표와 1:1 대응한다. */
export interface JobProcessOutcome {
  outcome: 'completed' | 'failed';
}

/**
 * `processing`으로 선점된 job 1건의 실제 처리를 담당하는 얇은 Strategy 인터페이스
 * (09-final-design.md 확정 #3, 03-scheduler-processing-design.md Follow-ups: 처리 로직이
 * 상태별로 분화되는 시점의 확장 지점). `ProcessPendingJobsUseCase`는 구체 구현을 모르고 이
 * 인터페이스만 의존한다.
 */
export interface JobProcessor {
  /**
   * job 1건을 처리해 성공/실패를 판정한다.
   * @param job 처리 대상 job(이미 `processing`으로 전이 커밋된 최신 상태)
   * @returns 처리 결과(`completed` 또는 `failed`)
   */
  process(job: Job): Promise<JobProcessOutcome>;
}

/**
 * 현재 스코프의 기본 `JobProcessor` 구현체. 09-final-design.md 확정대로 "처리 = 전이"이며
 * 외부 실작업(API 호출 등)이 없으므로 결정론적으로 단순 성공 처리한다.
 *
 * 실패 경로를 테스트하거나 향후 실제 처리 로직으로 교체할 수 있도록, 판정 함수를 생성자로
 * 주입 가능하게 설계했다(기본값은 항상 `completed`).
 */
export class DefaultJobProcessor implements JobProcessor {
  /**
   * @param decide job별 처리 결과를 판정하는 함수(선택). 미지정 시 항상 `completed`를 반환한다.
   */
  constructor(private readonly decide: (job: Job) => 'completed' | 'failed' = () => 'completed') {}

  /**
   * job을 처리한다. 현재 스코프에서는 순수 결정론적 판정 함수 호출뿐이며 부수효과가 없다.
   * @param job 처리 대상 job
   * @returns 생성자에 주입된 판정 함수의 결과
   */
  async process(job: Job): Promise<JobProcessOutcome> {
    return { outcome: this.decide(job) };
  }
}
