import { randomUUID } from 'crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../domain/job';
import { MAX_RETRY_COUNT } from '../../domain/job-transitions';
import { LoggerPort } from '../../application/ports/logger.port';
import { JsonDbJobRepository } from './json-db-job.repository';

/** 테스트 1건마다 os.tmpdir() 하위에 고유 디렉터리를 만들어 파일 격리(afterEach에서 삭제)한다. */
function makeTempDbPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'json-db-job-repository-'));
  return { dir, path: join(dir, 'jobs.json') };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: 'title',
    description: 'description',
    status: 'pending',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('JsonDbJobRepository', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    ({ dir, path: dbPath } = makeTempDbPath());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('초기화/시딩', () => {
    it('파일이 없으면 빈 jobs 구조로 초기화한다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const jobs = await repo.list();
      expect(jobs).toEqual([]);
      expect(existsSync(dbPath)).toBe(true);
    });

    it('파일이 이미 존재하면 시딩 데이터를 보존한 채 그대로 로드한다', async () => {
      const seeded = makeJob({ title: 'seeded job' });
      writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));

      const repo = new JsonDbJobRepository(dbPath);
      const jobs = await repo.list();

      expect(jobs).toEqual([seeded]);
    });
  });

  describe('조회/생성', () => {
    it('create로 생성한 job은 pending/retryCount 0으로 고정되고 findById로 조회된다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const created = await repo.create({ title: 'a task', description: 'desc' });

      expect(created.status).toBe('pending');
      expect(created.retryCount).toBe(0);

      const found = await repo.findById(created.id);
      expect(found).toEqual(created);
    });

    it('findById는 존재하지 않으면 null을 반환한다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const found = await repo.findById('missing-id');
      expect(found).toBeNull();
    });

    it('list는 전체 job을 반환한다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      await repo.create({ title: 'one', description: 'd1' });
      await repo.create({ title: 'two', description: 'd2' });

      const jobs = await repo.list();
      expect(jobs).toHaveLength(2);
    });

    it('search는 title 부분일치(대소문자 무시)와 status 일치를 AND로 좁힌다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      await repo.create({ title: 'Deploy service', description: 'd' });
      await repo.create({ title: 'Deploy infra', description: 'd' });
      const other = await repo.create({ title: 'cleanup logs', description: 'd' });
      await repo.withTransition(other.id, 'processing');

      const byTitle = await repo.search({ title: 'deploy' });
      expect(byTitle).toHaveLength(2);

      const byTitleAndStatus = await repo.search({ title: 'deploy', status: 'processing' });
      expect(byTitleAndStatus).toHaveLength(0);
    });

    it('listByStatus는 지정 status만 최대 limit건 반환한다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const jobs = await Promise.all(
        Array.from({ length: 3 }, (_, i) => repo.create({ title: `job-${i}`, description: 'd' })),
      );
      await repo.withTransition(jobs[0].id, 'processing');
      await repo.withTransition(jobs[1].id, 'processing');

      const processing = await repo.listByStatus('processing', 1);
      expect(processing).toHaveLength(1);
      expect(processing[0].status).toBe('processing');
    });
  });

  describe('withTransition', () => {
    it('허용된 전이는 성공하고 상태/시각이 갱신된다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const job = await repo.create({ title: 't', description: 'd' });

      const result = await repo.withTransition(job.id, 'processing');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.job.status).toBe('processing');
        expect(result.job.retryCount).toBe(0);
      }
    });

    it('전이 표에 없는 전이는 INVALID_TRANSITION으로 거부되고 무쓰기다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const job = await repo.create({ title: 't', description: 'd' });

      const result = await repo.withTransition(job.id, 'completed');

      expect(result).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
      const stored = await repo.findById(job.id);
      expect(stored?.status).toBe('pending');
    });

    it('retryCount 상한 초과 재시도는 RETRY_LIMIT_EXCEEDED로 거부된다', async () => {
      const seeded = makeJob({ status: 'failed', retryCount: MAX_RETRY_COUNT });
      writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
      const repo = new JsonDbJobRepository(dbPath);

      const result = await repo.withTransition(seeded.id, 'pending');

      expect(result).toEqual({ ok: false, reason: 'RETRY_LIMIT_EXCEEDED' });
    });

    it('존재하지 않는 id는 NOT_FOUND로 거부된다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const result = await repo.withTransition('missing-id', 'processing');
      expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    });

    it('target이 현재 status와 같으면 guard 없이 patch만 반영한다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const job = await repo.create({ title: 'old title', description: 'old desc' });

      const result = await repo.withTransition(job.id, 'pending', { title: 'new title' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.job.status).toBe('pending');
        expect(result.job.title).toBe('new title');
        expect(result.job.description).toBe('old desc');
      }
    });

    it('failed → pending 재시도 성공 시 retryCount가 1 증가한다', async () => {
      const seeded = makeJob({ status: 'failed', retryCount: 1 });
      writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
      const repo = new JsonDbJobRepository(dbPath);

      const result = await repo.withTransition(seeded.id, 'pending');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.job.retryCount).toBe(2);
      }
    });

    it('동시 PATCH 경쟁(동일 target)에서도 큐 직렬화 덕분에 retryCount가 중복 증가하지 않는다(02 race 시나리오 회귀)', async () => {
      const seeded = makeJob({ status: 'failed', retryCount: 0 });
      writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
      const repo = new JsonDbJobRepository(dbPath);

      const [first, second] = await Promise.all([
        repo.withTransition(seeded.id, 'pending'),
        repo.withTransition(seeded.id, 'pending'),
      ]);

      // 둘 다 큐를 거쳐 순차 실행되므로 각자 재조회한 상태를 기준으로 응답한다: 첫 번째는
      // failed→pending 전이(성공), 두 번째는 재조회 시 이미 pending이라 field-only 단축 경로를
      // 탄다(S2 포트 계약: target===현재 status면 guard 생략). 두 경로 모두 ok:true이지만
      // retryCount는 failed→pending 전이 시에만 증가하므로 중복 증가가 없다(무손실 검증 핵심).
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const final = await repo.findById(seeded.id);
      expect(final?.status).toBe('pending');
      expect(final?.retryCount).toBe(1);
    });

    it('PATCH↔스케줄러 배치 경쟁에서도 guard-in-lock이 무효 전이를 항상 거부한다(02 race 시나리오 회귀)', async () => {
      const seeded = makeJob({ status: 'processing', retryCount: 0 });
      writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
      const repo = new JsonDbJobRepository(dbPath);

      // processing → pending은 전이 표에 없어 순서와 무관하게 항상 거부되어야 한다.
      const [invalidPatch, schedulerComplete] = await Promise.all([
        repo.withTransition(seeded.id, 'pending'),
        repo.withTransition(seeded.id, 'completed'),
      ]);

      expect(invalidPatch).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
      expect(schedulerComplete.ok).toBe(true);

      const final = await repo.findById(seeded.id);
      expect(final?.status).toBe('completed');
    });
  });

  describe('withBatch', () => {
    it('전건 성공 시 모두 committed에 담기고 write는 1회다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const jobs = await Promise.all([
        repo.create({ title: 'a', description: 'd' }),
        repo.create({ title: 'b', description: 'd' }),
      ]);


      const dbPushSpy = jest.spyOn((repo as unknown as { db: { push: (...args: unknown[]) => Promise<void> } }).db, 'push');

      const result = await repo.withBatch(jobs.map((j) => j.id), 'processing');

      expect(result.committed).toHaveLength(2);
      expect(result.rejected).toHaveLength(0);
      expect(dbPushSpy).toHaveBeenCalledTimes(1);
    });

    it('일부 거부되어도 커밋 건은 반영되고 거부 건은 원 상태 그대로 보존되며 write는 1회다', async () => {
      const repo = new JsonDbJobRepository(dbPath);
      const ok = await repo.create({ title: 'ok', description: 'd' });
      const alreadyCompleted = makeJob({ status: 'completed' });
      const seededExtra = { jobs: [alreadyCompleted] };
      // create()로 만든 job과 별도로 completed 상태 job을 파일에 직접 병합해 둔다.
      const currentRaw = JSON.parse(readFileSync(dbPath, 'utf-8')) as { jobs: Job[] };
      writeFileSync(dbPath, JSON.stringify({ jobs: [...currentRaw.jobs, ...seededExtra.jobs] }));

      const freshRepo = new JsonDbJobRepository(dbPath);
      const dbPushSpy = jest.spyOn((freshRepo as unknown as { db: { push: (...args: unknown[]) => Promise<void> } }).db, 'push');

      const result = await freshRepo.withBatch([ok.id, alreadyCompleted.id, 'missing-id'], 'processing');

      expect(result.committed).toHaveLength(1);
      expect(result.committed[0].id).toBe(ok.id);
      expect(result.rejected).toEqual(
        expect.arrayContaining([
          { id: alreadyCompleted.id, reason: 'INVALID_TRANSITION' },
          { id: 'missing-id', reason: 'NOT_FOUND' },
        ]),
      );
      expect(dbPushSpy).toHaveBeenCalledTimes(1);

      const stillCompleted = await freshRepo.findById(alreadyCompleted.id);
      expect(stillCompleted?.status).toBe('completed');
    });
  });

  describe('락 이벤트 로깅', () => {
    it('withTransition은 jobId와 함께 waitMs/holdMs를 포함한 lock 이벤트를 기록한다', async () => {
      const events: unknown[] = [];
      const logger: LoggerPort = { log: (event) => events.push(event) };
      const repo = new JsonDbJobRepository(dbPath, logger);
      const job = await repo.create({ title: 't', description: 'd' });

      events.length = 0;
      await repo.withTransition(job.id, 'processing');

      const lockEvents = events.filter((e) => (e as { type: string }).type === 'lock');
      expect(lockEvents).toHaveLength(1);
      const lockEvent = lockEvents[0] as { jobId: string; waitMs: number; holdMs: number };
      expect(lockEvent.jobId).toBe(job.id);
      expect(typeof lockEvent.waitMs).toBe('number');
      expect(typeof lockEvent.holdMs).toBe('number');
    });

    it('list처럼 jobId가 없는 조회 작업은 lock 이벤트를 남기지 않는다', async () => {
      const events: unknown[] = [];
      const logger: LoggerPort = { log: (event) => events.push(event) };
      const repo = new JsonDbJobRepository(dbPath, logger);

      await repo.list();

      const lockEvents = events.filter((e) => (e as { type: string }).type === 'lock');
      expect(lockEvents).toHaveLength(0);
    });
  });
});
