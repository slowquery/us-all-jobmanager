import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { trace } from '@opentelemetry/api';
import { ProcessPendingJobsUseCase } from '../../application/use-cases/process-pending-jobs.use-case';
import { LoggerPort } from '../../application/ports/logger.port';

/** tick 루트 스팬을 여는 OTel 트레이서 이름(06-observability-design.md adapter 계측 한정). */
const SCHEDULER_TRACER_NAME = 'us-all-job-manager-scheduler';

/** `@Interval` tick 주기(ms). 09-final-design.md 확정 #7: 60초. */
export const SCHEDULER_TICK_MS = 60_000;

/**
 * 스케줄러 tick 발화 어댑터(03-scheduler-processing-design.md, 09-final-design.md 확정 #3·#7).
 *
 * `@Interval(SCHEDULER_TICK_MS)`가 붙은 {@link tick}이 고정 주기로 호출된다. 이 클래스는 "tick이
 * 실행되어도 되는가"(overrun 스킵 판단)만 책임지고, 실제 처리 로직은 전부
 * {@link ProcessPendingJobsUseCase}에 위임한다(03의 adapter/application 분리 — 08의 수동 tick
 * 트리거 테스트 전략의 전제 조건).
 *
 * ### overrun 스킵 (`isTickRunning`)
 * 이전 tick이 아직 실행 중일 때 새 tick이 겹쳐 발화하면(`@Interval`은 이전 실행 완료 여부와 무관하게
 * 고정 주기로 콜백을 발화한다) `isTickRunning` boolean 플래그로 새 tick을 즉시 스킵(drop)한다. 이는
 * 02의 guard-in-lock이 이미 보장하는 데이터 무결성 위에 얹는 성능 최적화이며(겹치는 tick이 같은
 * job을 동시에 노려 큐 대기만 낭비하는 것을 방지), 안전성 방어선이 아니다(03 Pros 참조).
 *
 * `skipGuardEnabled` 생성자 옵션으로 이 가드 자체를 끌 수 있다(기본값 true = 가드 켜짐, 03 정본).
 * 이는 08 C-4(tick 중복 재현) 테스트 전용 주입점이며, 실 프로덕션 경로의 무결성 계약(02
 * guard-in-lock)과는 무관하다(가드를 꺼도 개별 job 전이는 여전히 02의 atomic read→guard→write를
 * 통과하므로 데이터가 깨지지는 않는다 — 다만 중복 선점 시도로 인한 큐 대기 낭비가 재현된다).
 *
 * ### 트레이싱 (tick 루트 스팬)
 * 스킵되지 않고 실제로 처리를 진행하는 tick마다 `scheduler.tick` 루트 스팬을 연다
 * (06-observability-design.md 트레이싱 설계, 09-final-design.md 확정 #12). job별 자식 스팬은 이
 * 클래스가 직접 열지 않는다 — `ProcessPendingJobsUseCase`에 주입되는 `JobProcessor`를 감싸는
 * `TracingJobProcessor`(adapter 계층 데코레이터, DI 배선은 `app.module.ts`)가 담당하며, OTel
 * context API가 `startActiveSpan`의 활성 컨텍스트를 통해 부모-자식 관계를 암묵적으로 연결한다
 * (도메인/유스케이스 무침투 — application/domain에 `@opentelemetry/*` import 금지).
 */
@Injectable()
export class JobSchedulerAdapter {
  /** 이전 tick이 아직 실행 중인지 여부(overrun 스킵 판단용, 인프로세스 상태). */
  private isTickRunning = false;

  /**
   * @param processPendingJobs tick 1회의 실제 처리를 위임할 유스케이스
   * @param logger tick 시작/종료/스킵 이벤트 로깅 포트
   * @param skipGuardEnabled overrun 스킵 가드 활성화 여부(기본 true, 08 C-4 테스트 전용 비활성화 주입점)
   */
  constructor(
    private readonly processPendingJobs: ProcessPendingJobsUseCase,
    private readonly logger: LoggerPort,
    private readonly skipGuardEnabled: boolean = true,
  ) {}

  /**
   * 스케줄러 tick 콜백. `@nestjs/schedule`이 `SCHEDULER_TICK_MS` 주기로 호출하지만, 08의 결정론적
   * 테스트 전략(fake timer 기각)에 따라 수동으로도 직접 호출 가능하다(테스트는 이 메서드를
   * `@Interval` 데코레이터를 거치지 않고 바로 호출한다).
   *
   * `skipGuardEnabled`가 true(기본값)이고 이전 tick이 아직 실행 중이면 즉시 스킵 로그를 남기고
   * 반환한다. 그 외의 경우 tick 시작 로그 → {@link ProcessPendingJobsUseCase.execute} 위임 →
   * tick 종료 로그(소요 시간 포함) 순으로 진행한다.
   */
  @Interval(SCHEDULER_TICK_MS)
  async tick(): Promise<void> {
    const tickId = randomUUID();

    if (this.skipGuardEnabled && this.isTickRunning) {
      this.logger.log({
        type: 'tick',
        level: 'info',
        source: 'scheduler',
        message: 'tick skipped: previous tick still running',
        tickId,
        phase: 'skipped',
      });
      return;
    }

    this.isTickRunning = true;
    const startedAt = Date.now();
    this.logger.log({
      type: 'tick',
      level: 'info',
      source: 'scheduler',
      message: 'tick started',
      tickId,
      phase: 'start',
    });

    await trace.getTracer(SCHEDULER_TRACER_NAME).startActiveSpan(
      'scheduler.tick',
      { attributes: { 'tick.id': tickId } },
      async (span) => {
        try {
          await this.processPendingJobs.execute();
          this.logger.log({
            type: 'tick',
            level: 'info',
            source: 'scheduler',
            message: 'tick ended',
            tickId,
            phase: 'end',
            durationMs: Date.now() - startedAt,
          });
        } finally {
          span.end();
          this.isTickRunning = false;
        }
      },
    );
  }
}
