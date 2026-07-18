import { randomUUID } from 'crypto';
import { Config, JsonDB } from 'node-json-db';
import { Job, JobStatus } from '../../domain/job';
import { transitionError } from '../../domain/job-transitions';
import { LoggerPort } from '../../application/ports/logger.port';
import {
  BatchRejection,
  BatchResult,
  CreateJobData,
  JobPatch,
  JobRepository,
  JobSearchQuery,
  TransitionResult,
} from '../../application/ports/job-repository.port';

/** node-json-db 루트에서 job 배열이 위치하는 데이터패스. REQUIREMENTS 스키마 `{ jobs: [...] }`와 정합. */
const JOBS_PATH = '/jobs';

/**
 * node-json-db 기반 `JobRepository` 구현체.
 *
 * ### 큐 설계 (02-persistence-concurrency-design.md 채택안 (a))
 * node-json-db의 `ReadWriteLock`은 `getData()`/`push()` 개별 호출만 보호하고, 이 저장소가 필요로 하는
 * "재조회 → guard 평가 → 저장"의 compound read-modify-write 시퀀스 전체는 보호하지 않는다(개별 호출
 * 사이의 TOCTOU 경쟁이 남는다). 이를 막기 위해 이 클래스는 **단일 `Promise` 체인**을 인프로세스
 * 직렬화 큐로 사용해 모든 읽기/쓰기 작업(조회 포함)을 단일 writer로 순차 실행한다 — 새 작업은 항상
 * `this.queue`(직전 작업의 완료 Promise)에 체이닝되며, 다음 작업이 시작되기 전에 이전 작업이 반드시
 * 끝난다. node-json-db 자체 락은 "파일 I/O 원자성"(한 번의 read/write가 깨지지 않음)만 책임지고,
 * 이 큐는 "전이 원자성"(여러 호출에 걸친 시퀀스 전체의 원자적 수행)을 책임진다 — 두 계층은 대체
 * 관계가 아니라 보완 관계다.
 *
 * ### guard-in-lock (02 원자성 계약)
 * `withTransition`/`withBatch`는 큐의 임계구역 **내부에서** 최신 상태를 재조회한 뒤 domain의
 * `transitionError`를 평가한다(guard-in-lock). guard를 락 밖에서 미리 평가해 캐싱하는 것은 금지된다
 * — 락 획득과 guard 평가 사이에 다른 작업이 끼어들 여지를 두면 read-check-then-act(TOCTOU) 경쟁이
 * 재현되기 때문이다. guard가 거짓이면 아무 것도 쓰지 않고(무쓰기 거부) 임계구역을 벗어난다.
 */
export class JsonDbJobRepository implements JobRepository {
  private readonly db: JsonDB;

  /** 인프로세스 직렬화 큐의 현재 tail. 다음 작업은 이 Promise 완료 이후에만 시작된다. */
  private queue: Promise<unknown> = Promise.resolve();

  /** `/jobs` 루트 구조 초기화가 완료되었는지 여부(멱등 보장용, 큐 내부에서만 갱신). */
  private initialized = false;

  /**
   * @param dbPath node-json-db가 사용할 파일 경로(테스트 격리를 위해 주입, 기본 `jobs.json`)
   * @param logger 큐 임계구역의 대기/점유 시간(waitMs/holdMs)을 측정해 기록할 LoggerPort(선택)
   */
  constructor(
    private readonly dbPath = 'jobs.json',
    private readonly logger?: LoggerPort,
  ) {
    this.db = new JsonDB(new Config(this.dbPath, true, false, '/'));
  }

  /**
   * `/jobs` 루트 구조를 보장한다. 파일이 이미 존재하면(시딩된 `jobs.json` 포함) 그대로 두고 덮어쓰지
   * 않으며(02 시딩 전략: 시딩 보존), 데이터패스가 없을 때만(최초 실행) 빈 배열로 초기화한다. 큐
   * 임계구역 내부에서만 호출되므로 별도 락이 필요 없다.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const exists = await this.db.exists(JOBS_PATH);
    if (!exists) {
      await this.db.push(JOBS_PATH, [], true);
    }
    this.initialized = true;
  }

  /**
   * 작업 하나를 직렬화 큐에 등록하고, 큐 순번이 돌아왔을 때 실행한다. `jobId`가 주어지면 대기
   * 시간(waitMs, 큐 등록~실행 시작)과 점유 시간(holdMs, 실행 시작~종료)을 측정해 LoggerPort에
   * `lock` 이벤트로 남긴다(05 로그 카탈로그 #6). `jobId`가 없는 조회성 작업(list/search 등)은
   * 동일하게 직렬화는 되지만 락 이벤트는 남기지 않는다(잡 단위 지표가 아니므로).
   */
  private enqueue<T>(task: () => Promise<T>, jobId?: string): Promise<T> {
    const enqueuedAt = Date.now();
    const run = this.queue.then(async () => {
      const startedAt = Date.now();
      try {
        await this.ensureInitialized();
        return await task();
      } finally {
        if (jobId !== undefined) {
          const waitMs = startedAt - enqueuedAt;
          const holdMs = Date.now() - startedAt;
          this.emitLockEvent(jobId, waitMs, holdMs);
        }
      }
    });
    // 다음 작업은 이전 작업의 성공/실패와 무관하게 이어져야 큐가 멈추지 않는다.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 락 이벤트 기록 실패가 저장소 동작(및 호출자)에 전파되지 않도록 격리한다. */
  private emitLockEvent(jobId: string, waitMs: number, holdMs: number): void {
    try {
      this.logger?.log({
        type: 'lock',
        level: 'info',
        // 저장소는 호출자가 HTTP 요청인지 스케줄러 tick인지 알지 못한다(포트에 actor 정보가 없음,
        // S2 포트 계약 유지). 소스 구분이 필요해지면 포트 확장 없이는 정확히 표기할 수 없어
        // 'http'를 보수적 기본값으로 사용한다(알려진 한계, PR 설명에 명시).
        source: 'http',
        message: 'lock section measured',
        jobId,
        waitMs,
        holdMs,
      });
    } catch {
      // 로깅 실패는 저장소 동작에 영향을 주지 않는다.
    }
  }

  async findById(id: string): Promise<Job | null> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      return jobs.find((job) => job.id === id) ?? null;
    });
  }

  async list(): Promise<Job[]> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      return [...jobs];
    });
  }

  async search(query: JobSearchQuery): Promise<Job[]> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      return jobs.filter((job) => {
        const titleMatches = query.title === undefined
          || job.title.toLowerCase().includes(query.title.toLowerCase());
        const statusMatches = query.status === undefined || job.status === query.status;
        return titleMatches && statusMatches;
      });
    });
  }

  async create(data: CreateJobData): Promise<Job> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      const now = new Date().toISOString();
      const job: Job = {
        id: randomUUID(),
        title: data.title,
        description: data.description,
        status: 'pending',
        retryCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await this.db.push(JOBS_PATH, [...jobs, job], true);
      return job;
    });
  }

  async listByStatus(status: JobStatus, limit: number): Promise<Job[]> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      return jobs.filter((job) => job.status === status).slice(0, limit);
    });
  }

  /**
   * atomic read→guard→write. `target`이 현재 status와 같으면(field-only PATCH) guard 평가를
   * 건너뛰고 patch만 반영한다(S2 포트 계약). 거부 시 무쓰기(파일에 어떤 write도 발생하지 않음).
   */
  async withTransition(id: string, target: JobStatus, patch?: JobPatch): Promise<TransitionResult> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      const index = jobs.findIndex((job) => job.id === id);
      if (index === -1) {
        return { ok: false, reason: 'NOT_FOUND' };
      }

      const current = jobs[index];
      const isFieldOnlyUpdate = target === current.status;
      if (!isFieldOnlyUpdate) {
        const error = transitionError(current, target);
        if (error) {
          return { ok: false, reason: error };
        }
      }

      const retryCount = current.status === 'failed' && target === 'pending'
        ? current.retryCount + 1
        : current.retryCount;
      const updated: Job = {
        ...current,
        title: patch?.title ?? current.title,
        description: patch?.description ?? current.description,
        status: target,
        retryCount,
        updatedAt: new Date().toISOString(),
      };

      const nextJobs = [...jobs];
      nextJobs[index] = updated;
      await this.db.push(JOBS_PATH, nextJobs, true);
      return { ok: true, job: updated };
    }, id);
  }

  /**
   * 임계구역 1회 진입 → 스냅숏 read 1회 → 각 id에 대해 guard-in-lock 평가(거부 건은 사유와 함께
   * `rejected`에 적재, 나머지 job은 스냅숏 그대로 보존) → 파일 write 1회로 원자 커밋한다(09 확정
   * #2, tick당 rewrite 최소화). 커밋 대상이 0건이어도 write는 항상 1회 수행해 "이 tick의 배치
   * 처리가 원자적으로 완료됨"을 일관되게 보장한다.
   */
  async withBatch(ids: string[], target: JobStatus): Promise<BatchResult> {
    return this.enqueue(async () => {
      const jobs = await this.db.getData(JOBS_PATH) as Job[];
      const byId = new Map(jobs.map((job) => [job.id, job] as const));
      const committed: Job[] = [];
      const rejected: BatchRejection[] = [];
      const now = new Date().toISOString();

      for (const id of ids) {
        const current = byId.get(id);
        if (!current) {
          rejected.push({ id, reason: 'NOT_FOUND' });
          continue;
        }

        const isFieldOnlyUpdate = target === current.status;
        const error = isFieldOnlyUpdate ? null : transitionError(current, target);
        if (error) {
          rejected.push({ id, reason: error });
          continue;
        }

        const retryCount = current.status === 'failed' && target === 'pending'
          ? current.retryCount + 1
          : current.retryCount;
        const updated: Job = { ...current, status: target, retryCount, updatedAt: now };
        byId.set(id, updated);
        committed.push(updated);
      }

      const nextJobs = jobs.map((job) => byId.get(job.id) as Job);
      await this.db.push(JOBS_PATH, nextJobs, true);
      return { committed, rejected };
    });
  }
}
