import { trace } from '@opentelemetry/api';
import { JobProcessOutcome, JobProcessor } from '../../application/ports/job-processor.strategy';
import { Job } from '../../domain/job';

/** job별 자식 스팬을 여는 OTel 트레이서 이름(06-observability-design.md adapter 계측 한정). */
const SCHEDULER_TRACER_NAME = 'us-all-job-manager-scheduler';

/**
 * `JobProcessor` 포트를 감싸 job 1건 처리마다 `scheduler.process-job` 자식 스팬을 여는
 * adapter 계층 데코레이터(06-observability-design.md 트레이싱 설계 — "스케줄러 tick 루트
 * 스팬 → job별 자식 스팬", 09-final-design.md 확정 #12).
 *
 * `ProcessPendingJobsUseCase`(application)는 `JobProcessor` 인터페이스만 의존하며 이 데코레이터의
 * 존재를 알지 못한다 — 스팬 생성은 DI 배선(`app.module.ts`)에서 `DefaultJobProcessor` 인스턴스를
 * 이 클래스로 감싸 등록하는 방식으로 바깥에서 주입된다(계측은 adapter 계층 한정 원칙, 도메인/
 * 유스케이스 무침투 — application/domain에 `@opentelemetry/*` import 금지).
 *
 * 열린 자식 스팬은 `JobSchedulerAdapter.tick()`이 여는 `scheduler.tick` 루트 스팬의 활성
 * 컨텍스트를 OTel context API로 자동 상속한다(부모-자식 연결은 `startActiveSpan` 호출 시점의
 * 활성 컨텍스트로 암묵적으로 이루어지며, 이 클래스가 직접 부모 스팬을 참조하지 않는다).
 */
export class TracingJobProcessor implements JobProcessor {
  /** @param delegate 실제 처리를 위임할 `JobProcessor` 구현체(예: `DefaultJobProcessor`) */
  constructor(private readonly delegate: JobProcessor) {}

  /**
   * job 1건을 `scheduler.process-job` 자식 스팬으로 감싸 위임 처리한다. 처리 결과(`outcome`)를
   * 스팬 속성으로 기록하고, 위임 처리가 예외를 던지더라도 스팬은 항상 종료된다.
   * @param job 처리 대상 job
   * @returns 위임한 `JobProcessor`의 처리 결과를 그대로 반환
   */
  async process(job: Job): Promise<JobProcessOutcome> {
    return trace.getTracer(SCHEDULER_TRACER_NAME).startActiveSpan(
      'scheduler.process-job',
      { attributes: { 'job.id': job.id } },
      async (span) => {
        try {
          const outcome = await this.delegate.process(job);
          span.setAttribute('job.outcome', outcome.outcome);
          return outcome;
        } finally {
          span.end();
        }
      },
    );
  }
}
