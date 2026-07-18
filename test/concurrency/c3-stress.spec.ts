import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../src/domain/job';
import { MAX_RETRY_COUNT } from '../../src/domain/job-transitions';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';

/**
 * C-3(08-testing-strategy-design.md "동시성 문제 재현 테스트" 절 표): N=50 고정 동시 요청으로
 * 고부하 스트레스 불변식을 검증한다. 보호 경로(실제 `JsonDbJobRepository`)는 불변식을 100%
 * 유지해야 하며(하드 assert, skip 없음), 무보호 대조군은 불변식 위반이 반드시 관측되어야
 * 재현 성공이다(08: "위반이 없으면 스트레스 강도 부족으로 재검토" — 이 파일은 read↔write 사이에
 * 지연을 주입해 위반이 결정론적으로 관측되도록 강도를 조정했다).
 */

const N = 50;

/** 테스트 1건마다 os.tmpdir() 하위에 고유 디렉터리를 만들어 파일 격리(afterEach에서 삭제)한다. */
function makeTempDbPath(prefix: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
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

function readJobs(dbPath: string): Job[] {
  return (JSON.parse(readFileSync(dbPath, 'utf-8')) as { jobs: Job[] }).jobs;
}

/**
 * 재현 테스트 전용 — 프로덕션 경로 아님. 02의 직렬화 큐를 완전히 우회한 "무보호" create다.
 * read(현재 배열) → 지연 주입(다른 동시 create가 끼어들 시간 확보) → write(배열 전체 rewrite)
 * 순서로, N건이 동시에 몰리면 모두 read 시점에 서로의 결과를 보지 못한 채 write해 lost update가
 * 발생한다(08 C-3 "결정론 확보" 열). `src/infrastructure`에는 이 경로를 절대 추가하지 않는다.
 */
async function unguardedCreate(dbPath: string, title: string, delayMs: number): Promise<Job> {
  const jobs = readJobs(dbPath);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  const job = makeJob({ title, status: 'pending' });
  writeFileSync(dbPath, JSON.stringify({ jobs: [...jobs, job] }));
  return job;
}

describe('C-3 고부하 스트레스 불변식(N=50)', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('보호 경로: N=50 동시 PATCH+POST+GET 혼합에도 불변식(성공 수=커밋 수, 총 job 수, JSON 무결, retryCount≤3)이 유지된다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c3-guarded-'));
    // 시딩 고정: failed job 20건(재시도 PATCH 대상) — 08 "결정론 확보" 열: N과 시딩 모두 상수 고정.
    const seededFailedJobs = Array.from({ length: 20 }, () => makeJob({ status: 'failed', retryCount: 0 }));
    writeFileSync(dbPath, JSON.stringify({ jobs: seededFailedJobs }));
    const repo = new JsonDbJobRepository(dbPath);

    type OpResult = { kind: 'create' | 'patch' | 'get'; ok: boolean };

    const patchTargets = seededFailedJobs.slice(0, 20);
    const operations: Array<() => Promise<OpResult>> = [
      ...Array.from({ length: 20 }, (_, i) => async (): Promise<OpResult> => {
        await repo.create({ title: `stress-${i}`, description: 'd' });
        return { kind: 'create', ok: true };
      }),
      ...patchTargets.map((job) => async (): Promise<OpResult> => {
        const result = await repo.withTransition(job.id, 'pending');
        return { kind: 'patch', ok: result.ok };
      }),
      ...Array.from({ length: 10 }, () => async (): Promise<OpResult> => {
        await repo.list();
        return { kind: 'get', ok: true };
      }),
    ];
    expect(operations).toHaveLength(N);

    const results = await Promise.all(operations.map((op) => op()));

    // 불변식 1: 응답 성공 수(create/patch만, get은 실패 개념이 없어 제외) = 실제 커밋 수.
    const createSuccesses = results.filter((r) => r.kind === 'create' && r.ok).length;
    const patchSuccesses = results.filter((r) => r.kind === 'patch' && r.ok).length;
    expect(createSuccesses).toBe(20);
    expect(patchSuccesses).toBe(20);

    // 불변식 2: job 총수 = 시딩 20 + 생성 20. 시딩된 20건은 failed→pending 재시도 커밋되고
    // 생성된 20건도 항상 pending으로 시작하므로(create 계약), 최종적으로 failed 잔존 0건이어야
    // 한다(성공 수=커밋 수와 정합하는 상태 분포 불변식).
    const finalJobs = await repo.list();
    expect(finalJobs).toHaveLength(40);
    expect(finalJobs.filter((j) => j.status === 'pending')).toHaveLength(40);
    expect(finalJobs.filter((j) => j.status === 'failed')).toHaveLength(0);

    // 불변식 3: 파일 JSON 파싱 무결.
    expect(() => readJobs(dbPath)).not.toThrow();

    // 불변식 4: retryCount ≤ MAX_RETRY_COUNT(3) 전 job.
    for (const job of finalJobs) {
      expect(job.retryCount).toBeLessThanOrEqual(MAX_RETRY_COUNT);
    }
  });

  it('무보호 대조군: N=50 동시 create가 lost update로 불변식(총 job 수=생성 수)을 위반한다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c3-unguarded-'));
    writeFileSync(dbPath, JSON.stringify({ jobs: [] }));

    // 모든 create가 동일 지연(10ms)으로 read 시점을 동시에 맞춰, write가 서로를 덮어쓰도록
    // race window를 결정론적으로 확대한다(08: "미관측 시 지연 주입 강도 재검토").
    await Promise.all(Array.from({ length: N }, (_, i) => unguardedCreate(dbPath, `stress-${i}`, 10)));

    const finalJobs = readJobs(dbPath);
    // 재현 성공 조건: lost update로 인해 총 job 수가 생성 시도 건수(N)보다 적어야 한다(대부분의
    // write가 서로를 덮어써 마지막 write 1건만 남는 것이 전형적 증상).
    expect(finalJobs.length).toBeLessThan(N);
  });
});
