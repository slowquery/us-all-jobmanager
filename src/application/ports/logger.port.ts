import { JobStatus } from '../../domain/job';

/** 로그 심각도. `error`는 4xx/5xx 및 개별 job 처리 실패를 포함한다(05-logging-design.md). */
export type LogLevel = 'info' | 'error';

/** 로그 발생 출처. HTTP 요청 경로와 스케줄러 경로를 구분한다. */
export type LogSource = 'http' | 'scheduler';

/** 모든 {@link LogEvent}가 공유하는 공통 필드. */
interface BaseLogEvent {
  level: LogLevel;
  source: LogSource;
  message: string;
}

/** HTTP 요청/응답 1건에 대한 이벤트(05-logging-design.md 포맷 예시 1·3). */
export interface HttpRequestLogEvent extends BaseLogEvent {
  type: 'http_request';
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  /** 실패 응답(level=error)에서만 채워지는 에러 코드(예: `INVALID_TRANSITION`). */
  errorCode?: string;
}

/** 스케줄러 tick 시작/종료/스킵 이벤트(03의 overrun 스킵 근거 로깅). */
export interface TickLogEvent extends BaseLogEvent {
  type: 'tick';
  tickId: string;
  phase: 'start' | 'end' | 'skipped';
  /** phase가 `end`일 때만 채워지는 tick 총 소요 시간. */
  durationMs?: number;
}

/** 스케줄러 배치 처리 결과 집계 이벤트(05-logging-design.md 포맷 예시 2). */
export interface BatchLogEvent extends BaseLogEvent {
  type: 'batch';
  batchSize: number;
  succeeded: number;
  failed: number;
}

/** 상태 전이 커밋 이벤트. `withTransition`/`withBatch` 성공 경로에서만 발행된다(거부 건은 error로 기록). */
export interface TransitionLogEvent extends BaseLogEvent {
  type: 'transition';
  jobId: string;
  from: JobStatus;
  to: JobStatus;
  actor: 'api' | 'scheduler';
}

/** 직렬화 큐 임계구역의 대기/점유 시간 측정 이벤트(06 로그 카탈로그 #6과 정합). */
export interface LockLogEvent extends BaseLogEvent {
  type: 'lock';
  jobId: string;
  waitMs: number;
  holdMs: number;
}

/** 4xx/5xx 및 개별 job 처리 실패 등 에러 이벤트. */
export interface ErrorLogEvent extends BaseLogEvent {
  type: 'error';
  errorCode: string;
}

/** job 삭제 커밋 이벤트. `delete` 성공 경로에서만 발행된다(거부 건은 별도 이벤트를 남기지 않는다). */
export interface DeleteLogEvent extends BaseLogEvent {
  type: 'delete';
  jobId: string;
}

/**
 * 뉴스 다이제스트 처리 1건의 결과·소요시간 이벤트(관측성 소스). 고유 필드 `digestDurationMs`로
 * Loki LogQL이 다른 이벤트와 구분하며(FileLoggerAdapter가 `type`을 제외하므로), Grafana 대시보드가
 * 이 필드로 실행시간(quantile)·처리속도(count/rate)·성공률(outcome)을 집계한다.
 */
export interface DigestLogEvent extends BaseLogEvent {
  type: 'digest';
  /** 처리 결과. */
  outcome: 'completed' | 'failed';
  /** 다이제스트 처리 총 소요시간(ms) — fetch+요약+전송 합산. */
  digestDurationMs: number;
  /** 가져온 기사 수. */
  articleCount: number;
  /** 묶인 주제 그룹 수. */
  groupCount: number;
  /** 사용한 Gemini 모델명. */
  model: string;
}

/**
 * `LoggerPort.log`가 받는 구조화 로그 이벤트 판별 유니온(05-logging-design.md 이벤트 유형).
 * `timestamp`/`traceId`/`spanId`는 이 타입에 포함하지 않는다 — 그 값의 발급·주입은
 * infrastructure 구현체(`FileLoggerAdapter`)의 책임이다(아래 {@link LoggerPort} 참조).
 */
export type LogEvent =
  | HttpRequestLogEvent
  | TickLogEvent
  | BatchLogEvent
  | TransitionLogEvent
  | LockLogEvent
  | DigestLogEvent
  | ErrorLogEvent
  | DeleteLogEvent;

/**
 * 구조화 로그 출력 포트. `application`/`adapters` 계층은 이 인터페이스에만 의존하며,
 * NDJSON 직렬화·`logs.txt` append·traceId/spanId/timestamp 주입 등 포맷 조립은 전부
 * infrastructure 구현체(`FileLoggerAdapter`)의 책임이다(05-logging-design.md 헥사고날 배치).
 * 호출자는 이벤트 데이터만 넘기고 최종 로그 라인의 형태를 알지 못한다.
 */
export interface LoggerPort {
  /**
   * 구조화 이벤트 1건을 기록한다. 구현체는 이 호출이 실패하더라도(예: 파일 I/O 오류) 호출자의
   * 원 요청/처리 흐름에 예외를 전파하지 않아야 한다(05-logging-design.md 로깅 실패 격리 조항).
   * @param event 기록할 로그 이벤트
   */
  log(event: LogEvent): void;
}
