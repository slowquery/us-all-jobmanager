import { Job, JobStatus } from '../../domain/job';

/**
 * `search` 유스케이스가 사용하는 검색 조건. `title`은 부분 일치(대소문자 무시)이며
 * `status`와 함께 지정되면 AND 조건으로 좁힌다(04-api-layer-design.md 검색 쿼리 설계).
 */
export interface JobSearchQuery {
  title?: string;
  status?: JobStatus;
}

/**
 * 작업 생성 시 필요한 입력. `status`는 항상 서버가 `pending`으로 고정하므로 이 타입에는
 * 포함하지 않는다(04-api-layer-design.md POST /jobs).
 */
export interface CreateJobData {
  title: string;
  description: string;
}

/**
 * PATCH로 갱신 가능한 비상태 필드 패치. `withTransition`의 세 번째 인자로 전달되어
 * 전이 커밋과 동일 임계구역에서 원자적으로 반영된다.
 */
export type JobPatch = Partial<Pick<Job, 'title' | 'description'>>;

/**
 * 전이가 거부될 경우의 사유 구분 값. domain의 {@link TransitionError}에 `NOT_FOUND`
 * (id에 해당하는 job이 존재하지 않는 경우)를 더한 상위 집합이다.
 */
export type TransitionFailureReason = 'NOT_FOUND' | 'INVALID_TRANSITION' | 'RETRY_LIMIT_EXCEEDED';

/**
 * `withTransition` 호출 결과 판별 유니온. 성공 시 갱신된 job을, 실패 시 사유를 담는다.
 * 04-api-layer-design.md의 에러 코드(`JOB_NOT_FOUND`/`INVALID_TRANSITION`/`RETRY_LIMIT_EXCEEDED`)와
 * 1:1로 매핑되도록 설계되어 adapter가 그대로 HTTP 상태 코드로 변환할 수 있다.
 */
export type TransitionResult =
  | {
    ok: true;
    job: Job;
    /** 임계구역 내부 판정 기준으로 실제 status 변화가 커밋됐는지(true) / field-only no-op였는지(false). 락 밖 stale 읽기 기반 판정을 금지하기 위해 구현체가 임계구역 안에서 확정한다. */
    transitioned: boolean;
    /** 임계구역 내부에서 재조회한 전이 직전 status(transition 이벤트의 from 정본). */
    previousStatus: JobStatus;
  }
  | { ok: false; reason: TransitionFailureReason };

/**
 * 배치 전이에서 개별 건이 거부된 경우의 식별 정보.
 */
export interface BatchRejection {
  id: string;
  reason: TransitionFailureReason;
}

/**
 * `withBatch` 호출 결과. 거부된 건은 스킵되고 나머지만 커밋되며, 어느 쪽이든 파일 write는
 * 1회로 원자 커밋된다(09-final-design.md 확정 #2).
 */
export interface BatchResult {
  committed: Job[];
  rejected: BatchRejection[];
}

/**
 * 작업(Job) 영속화 포트. `application` 계층은 이 인터페이스에만 의존하며, node-json-db 등
 * 구체 저장소·동시성 구현은 `infrastructure` 계층의 구현체(`JsonDbJobRepository` 등)가 담당한다
 * (Rule 3, 헥사고날 경계).
 *
 * ### 동시성 계약 (02-persistence-concurrency-design.md 소유, 09-final-design.md 확정 #2)
 * `withTransition`/`withBatch`를 구현하는 adapter는 반드시 **atomic read→guard→write**를
 * 준수해야 한다: 인프로세스 직렬화 큐(단일 writer)의 임계구역에 진입 → 대상 job의 최신 상태를
 * 재조회(stale 캐시 금지) → domain의 `canTransition`/`transitionError` guard를 **임계구역
 * 내부에서** 평가(guard-in-lock) → 참이면 갱신 후 저장, 거짓이면 아무 것도 쓰지 않고 임계구역을
 * 벗어난다. guard를 임계구역 밖에서 미리 평가해 캐싱하는 것은 TOCTOU 경쟁을 유발하므로 금지된다.
 * `application` 계층(유스케이스)은 이 포트를 호출하는 것으로 계약 준수를 위임하며, 락/큐의 구현
 * 세부는 알지 못한다.
 */
export interface JobRepository {
  /**
   * id로 job 단건을 조회한다.
   * @param id 조회할 job의 id
   * @returns 존재하면 Job, 없으면 null
   */
  findById(id: string): Promise<Job | null>;

  /**
   * 전체 job 목록을 조회한다(현재 스코프는 페이지네이션 없이 전량 반환, 04 Follow-ups).
   * @returns 전체 Job 배열
   */
  list(): Promise<Job[]>;

  /**
   * 제목 부분 일치·상태 일치 조건으로 job을 검색한다.
   * @param query 검색 조건(title 부분 일치, status 완전 일치, 둘 다 지정 시 AND)
   * @returns 조건에 맞는 Job 배열
   */
  search(query: JobSearchQuery): Promise<Job[]>;

  /**
   * 새 job을 생성한다. 생성된 job의 status는 항상 `pending`, retryCount는 0으로 고정된다.
   * @param data 생성 입력(title/description)
   * @returns 생성된 Job(id/createdAt/updatedAt 포함)
   */
  create(data: CreateJobData): Promise<Job>;

  /**
   * 특정 status를 가진 job을 최대 limit건 조회한다(스케줄러 배치 선점 대상 조회용,
   * 03-scheduler-processing-design.md).
   * @param status 조회할 상태
   * @param limit 최대 반환 건수
   * @returns 조건에 맞는 Job 배열(limit 이하)
   */
  listByStatus(status: JobStatus, limit: number): Promise<Job[]>;

  /**
   * 단건 상태 전이를 atomic read→guard→write로 수행한다. `target`이 현재 status와 동일하면
   * (상태 변경 없는 field-only PATCH) guard 평가 없이 `patch`만 반영한다
   * (04-api-layer-design.md: "비상태 필드만 있는 PATCH는 guard 평가 대상이 아니다").
   * @param id 대상 job id
   * @param target 목표 상태(field-only 갱신 시 현재 상태와 동일한 값을 전달)
   * @param patch 전이와 함께 원자적으로 반영할 title/description 패치(선택)
   * @returns 성공 시 갱신된 Job, 실패 시 사유(NOT_FOUND/INVALID_TRANSITION/RETRY_LIMIT_EXCEEDED)
   */
  withTransition(id: string, target: JobStatus, patch?: JobPatch): Promise<TransitionResult>;

  /**
   * 여러 job을 동일한 목표 상태로 일괄 전이한다. 임계구역에 1회만 진입해 스냅숏을 읽고,
   * 각 id에 대해 guard를 개별 평가한 뒤(거부 건은 스킵) 파일 write는 1회로 원자 커밋한다
   * (09-final-design.md 확정 #2, tick당 rewrite 20회→2회 근거).
   * @param ids 전이 대상 job id 목록
   * @param target 공통 목표 상태
   * @returns 커밋된 Job 목록과 거부된 id/사유 목록
   */
  withBatch(ids: string[], target: JobStatus): Promise<BatchResult>;
}
