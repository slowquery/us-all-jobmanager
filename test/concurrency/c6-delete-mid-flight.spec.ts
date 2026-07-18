import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../src/domain/job';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';

/**
 * C-6(가드 DELETE 슬라이스 동시성 회귀): `delete`와 `withBatch`(스케줄러 선점 경로)가 동일
 * 직렬화 큐(`JsonDbJobRepository.enqueue`)를 경유하므로, 두 작업이 겹치더라도 큐에 등록된
 * 순서대로 순차 실행되어 race가 발생하지 않음을 검증한다. `enqueue`는 호출 시점에 동기적으로
 * `this.queue`에 체이닝되므로(await 이전), `Promise.all([a(), b()])`에서 `a()`가 먼저
 * 호출되면 큐 순서도 항상 `a` → `b`다(02 직렬화 큐 설계, c1/c4 스펙과 동일 전제).
 *
 * 시나리오 (i): withBatch가 먼저 큐에 들어가 job을 processing으로 선점 완료한 뒤, 뒤이은
 * delete가 같은 id를 대상으로 실행되면 guard-in-lock이 재조회한 최신 상태(processing)를
 * 근거로 FORBIDDEN_PROCESSING으로 거부한다 — job은 제거되지 않고, 먼저 커밋된 withBatch의
 * 결과는 그대로 유지된다.
 *
 * 시나리오 (ii): delete가 먼저 큐에 들어가 job을 제거한 뒤, 뒤이은 withBatch가 같은 id를
 * 후보로 포함해 호출되면 재조회 시점에 해당 id가 스냅숏에 없으므로 NOT_FOUND로 스킵되고
 * (committed에 포함되지 않음) 파일에는 그 job이 여전히 부재한다.
 */

/** 테스트 1건마다 os.tmpdir() 하위에 고유 디렉터리를 만들어 파일 격리(afterEach에서 삭제)한다. */
function makeTempDbPath(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    path: join(dir, 'jobs.json'),
  };
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

function readJobs(dbPath: string): Job[] {
  return (JSON.parse(readFileSync(dbPath, 'utf-8')) as { jobs: Job[] }).jobs;
}

describe('C-6 delete와 withBatch 선점의 큐 직렬화 회귀', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('(i) withBatch 선점(processing)이 먼저 커밋되면 뒤이은 delete는 FORBIDDEN_PROCESSING으로 거부되고 job은 유지된다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c6-claim-first-'));
    const seeded = makeJob({ status: 'pending' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
    const repo = new JsonDbJobRepository(dbPath);

    // withBatch를 먼저 호출해 큐에 먼저 등록한다(동기 enqueue 전제, 위 파일 주석 참조).
    const [claimResult, deleteResult] = await Promise.all([
      repo.withBatch([seeded.id], 'processing'),
      repo.delete(seeded.id),
    ]);

    expect(claimResult.committed).toHaveLength(1);
    expect(claimResult.committed[0].status).toBe('processing');
    expect(claimResult.rejected).toHaveLength(0);

    expect(deleteResult).toEqual({
      ok: false,
      reason: 'FORBIDDEN_PROCESSING',
    });

    const stored = await repo.findById(seeded.id);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('processing');
    expect(readJobs(dbPath).find((job) => job.id === seeded.id)).toBeDefined();
  });

  it('(ii) delete가 먼저 커밋되면 뒤이은 withBatch는 같은 id를 NOT_FOUND로 스킵하고 job은 파일에서 계속 부재한다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c6-delete-first-'));
    const seeded = makeJob({ status: 'pending' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
    const repo = new JsonDbJobRepository(dbPath);

    // delete를 먼저 호출해 큐에 먼저 등록한다.
    const [deleteResult, claimResult] = await Promise.all([
      repo.delete(seeded.id),
      repo.withBatch([seeded.id], 'processing'),
    ]);

    expect(deleteResult).toEqual({ ok: true });

    expect(claimResult.committed).toHaveLength(0);
    expect(claimResult.rejected).toEqual([{
      id: seeded.id,
      reason: 'NOT_FOUND',
    }]);

    const stored = await repo.findById(seeded.id);
    expect(stored).toBeNull();
    expect(readJobs(dbPath).find((job) => job.id === seeded.id)).toBeUndefined();
  });
});
