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
   *
   * **오류 계약(no-throw)**: 구현체는 절대 예외를 던지지 않는다. 외부 I/O 실패·timeout·비정상
   * 응답을 포함한 모든 오류는 `{ outcome: 'failed' }`로 매핑해 반환한다. `ProcessPendingJobsUseCase`가
   * 락 밖에서 여러 job을 순차 처리할 때 한 job의 예외가 배치 잔여 job을 `processing`에 고착시키는
   * blast radius를 원천 차단하기 위한 계약이다(유스케이스가 방어적 try/catch 안전망을 추가로 두더라도
   * 구현체는 이 계약을 스스로 지켜야 한다).
   * @param job 처리 대상 job(이미 `processing`으로 전이 커밋된 최신 상태)
   * @returns 처리 결과(`completed` 또는 `failed`). 절대 reject되지 않는다.
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

/**
 * job의 특성에 따라 서로 다른 {@link JobProcessor}로 위임을 분기하는 Strategy+Composite 처리기.
 *
 * `JOB_PROCESSOR`는 스케줄러 전역 단일 바인딩이므로, 뉴스 어댑터를 그대로 바인딩하면 API로 생성된
 * 모든 pending job이 뉴스 파이프라인을 타게 된다. 이 분배기는 `matches` 술어가 참인 job만
 * `matched`(뉴스 처리기)로 보내고 나머지는 `fallback`(기본 처리기)으로 보내, 도메인 스키마 변경
 * 없이 "뉴스 job만 뉴스 처리"를 실현한다(등록/호출 설계 — 순수 application 계층, Rule 3 준수).
 *
 * no-throw 오류 계약은 위임 대상 처리기들이 지키며, 이 분배기는 판정만 하고 예외를 새로 만들지 않는다.
 */
export class DispatchingJobProcessor implements JobProcessor {
  /**
   * @param matches job이 `matched` 처리기로 갈지 판정하는 술어
   * @param matched 술어가 참일 때 위임할 처리기(예: 뉴스 다이제스트)
   * @param fallback 술어가 거짓일 때 위임할 처리기(예: 기본 처리기)
   */
  constructor(
    private readonly matches: (job: Job) => boolean,
    private readonly matched: JobProcessor,
    private readonly fallback: JobProcessor,
  ) {}

  /**
   * job을 술어 판정에 따라 적절한 처리기로 위임한다.
   * @param job 처리 대상 job
   * @returns 위임한 처리기의 결과
   */
  async process(job: Job): Promise<JobProcessOutcome> {
    return (this.matches(job) ? this.matched : this.fallback).process(job);
  }
}
