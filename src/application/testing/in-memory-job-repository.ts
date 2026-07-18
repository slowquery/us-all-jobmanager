import { randomUUID } from 'crypto';
import { Job, JobStatus } from '../../domain/job';
import { transitionError } from '../../domain/job-transitions';
import {
  BatchResult,
  CreateJobData,
  JobPatch,
  JobRepository,
  JobSearchQuery,
  TransitionResult,
} from '../ports/job-repository.port';

/**
 * 테스트 전용 인메모리 `JobRepository` 더블. 02의 atomic read→guard→write/guard-in-lock 계약을
 * 단일 프로세스 동기 배열 연산으로 흉내 낸다(단위 테스트 목적, 실제 직렬화 큐 구현은
 * infrastructure 세션의 책임).
 */
export class InMemoryJobRepository implements JobRepository {
  private readonly jobs = new Map<string, Job>();

  /** 테스트 시딩용 헬퍼. 이미 완성된 Job을 그대로 저장소에 넣는다. */
  seed(job: Job): void {
    this.jobs.set(job.id, job);
  }

  async findById(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async list(): Promise<Job[]> {
    return [...this.jobs.values()];
  }

  async search(query: JobSearchQuery): Promise<Job[]> {
    return [...this.jobs.values()].filter((job) => {
      const titleMatches = query.title === undefined || job.title.toLowerCase().includes(query.title.toLowerCase());
      const statusMatches = query.status === undefined || job.status === query.status;
      return titleMatches && statusMatches;
    });
  }

  async create(data: CreateJobData): Promise<Job> {
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
    this.jobs.set(job.id, job);
    return job;
  }

  async listByStatus(status: JobStatus, limit: number): Promise<Job[]> {
    return [...this.jobs.values()].filter((job) => job.status === status).slice(0, limit);
  }

  async withTransition(id: string, target: JobStatus, patch?: JobPatch): Promise<TransitionResult> {
    const current = this.jobs.get(id);
    if (!current) {
      return {
        ok: false,
        reason: 'NOT_FOUND',
      };
    }

    const isFieldOnlyUpdate = target === current.status;
    if (!isFieldOnlyUpdate) {
      const error = transitionError(current, target);
      if (error) {
        return {
          ok: false,
          reason: error,
        };
      }
    }

    const retryCount = current.status === 'failed' && target === 'pending' ? current.retryCount + 1 : current.retryCount;
    const updated: Job = {
      ...current,
      ...patch,
      title: patch?.title ?? current.title,
      description: patch?.description ?? current.description,
      status: target,
      retryCount,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, updated);
    return {
      ok: true,
      job: updated,
      transitioned: !isFieldOnlyUpdate,
      previousStatus: current.status,
    };
  }

  async withBatch(ids: string[], target: JobStatus): Promise<BatchResult> {
    const committed: Job[] = [];
    const rejected: BatchResult['rejected'] = [];

    for (const id of ids) {
      const result = await this.withTransition(id, target);
      if (result.ok) {
        committed.push(result.job);
      } else {
        rejected.push({
          id,
          reason: result.reason,
        });
      }
    }

    return {
      committed,
      rejected,
    };
  }
}
