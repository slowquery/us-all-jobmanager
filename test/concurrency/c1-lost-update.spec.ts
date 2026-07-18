import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job, JobStatus } from '../../src/domain/job';
import { transitionError } from '../../src/domain/job-transitions';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';

/**
 * C-1(08-testing-strategy-design.md "동시성 문제 재현 테스트" 절 표): 02의 직렬화 큐를 우회한
 * "무보호"(unguarded) 리포지토리로 lost update를 재현하는 baseline A, 그리고 동일 시나리오를
 * 보호 경로(실제 `JsonDbJobRepository`)로 대조하는 baseline B를 모두 담는다. 시나리오는
 * `processing` job에 대해 서로 다른 두 유효 목표(`completed`/`failed`, 01 전이 표상 둘 다
 * `processing`에서 개별적으로는 허용됨)로 동시 전이를 시도하는 것이다 — 두 목표가 서로
 * 배타적이므로(둘 다 커밋되면 모순) 무보호 경로에서는 둘 다 "성공"을 보고하면서 실제로는 하나가
 * 조용히 덮어써지는 고전적 lost update가 재현된다. 보호 경로는 guard-in-lock 덕분에 먼저
 * 커밋한 쪽만 반영되고 나머지는 재조회 시 이미 바뀐 상태(`completed`는 종단 상태, `failed`는
 * `pending`만 허용)를 근거로 INVALID_TRANSITION으로 거부된다(실측 확인 완료).
 *
 * A는 재현 성공(두 응답 모두 2xx)이 기대치이고, B는 정확히 1건만 성공(나머지는 409
 * INVALID_TRANSITION 거부)해야 한다(08 표 assert 열). A/B 모두 이 파일 안에서 하드 assert
 * (스냅숏 비일관과 달리 lost update는 read-이후-지연 주입으로 결정론적 재현이 가능하므로 skip
 * 대상이 아니다).
 */

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
 * 재현 테스트 전용 — 프로덕션 경로 아님. 02의 직렬화 큐(`JsonDbJobRepository.enqueue`)를 전혀
 * 거치지 않고, node-json-db 파일을 직접 read → (인위적 지연 주입) → guard → write하는 "무보호"
 * 헬퍼다. read와 write 사이에 지연을 넣어 race window를 결정론적으로 확대한다(08 C-1 "결정론
 * 확보" 열). `src/infrastructure`에는 이 경로를 절대 추가하지 않는다 — 이 함수는 이 스펙 파일
 * 내부에만 존재한다.
 */
async function unguardedWithTransition(
  dbPath: string,
  id: string,
  target: JobStatus,
  delayMs: number,
): Promise<{ ok: true; job: Job } | { ok: false; reason: string }> {
  // read: 락/큐 없이 파일을 직접 읽는다(02의 atomic read→guard→write 계약을 의도적으로 우회).
  const jobs = readJobs(dbPath);
  const index = jobs.findIndex((job) => job.id === id);
  if (index === -1) {
    return { ok: false, reason: 'NOT_FOUND' };
  }
  const current = jobs[index];

  // 지연 주입: read 완료 후 guard/write 이전에 다른 호출이 끼어들 시간을 인위적으로 확보한다.
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  // guard: 지연 동안 파일이 바뀌었어도 이 guard는 read 시점 스냅숏(current)만 보고 판정한다
  // (무보호 시나리오의 핵심 결함 — stale 데이터 기준 판정).
  const error = transitionError(current, target);
  if (error) {
    return { ok: false, reason: error };
  }

  // write: 큐 없이 직접 파일 전체를 다시 쓴다(다른 동시 write와 경합 가능).
  const updated: Job = { ...current, status: target, updatedAt: new Date().toISOString() };
  const latestJobs = readJobs(dbPath);
  const latestIndex = latestJobs.findIndex((job) => job.id === id);
  latestJobs[latestIndex] = updated;
  writeFileSync(dbPath, JSON.stringify({ jobs: latestJobs }));
  return { ok: true, job: updated };
}

describe('C-1 무보호 lost update A/B', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('A(무보호): processing job에 대한 배타적 동시 전이 2건이 stale guard로 둘 다 성공해 lost update가 재현된다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c1-unguarded-'));
    const seeded = makeJob({ status: 'processing' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));

    // 두 호출 모두 read 시점에는 서로의 write를 보지 못하도록(둘 다 processing을 읽도록) 동일한
    // 지연을 준다 — 이것이 무보호 경로의 race window를 결정론적으로 확대하는 지점이다. completed/
    // failed는 서로 배타적(둘 다 반영될 수 없음)이므로 둘 다 성공 응답이면 lost update가 재현된
    // 것이다.
    const [first, second] = await Promise.all([
      unguardedWithTransition(dbPath, seeded.id, 'completed', 20),
      unguardedWithTransition(dbPath, seeded.id, 'failed', 20),
    ]);

    // 재현 성공 조건(08 C-1 assert 열 "A"): 두 응답 모두 성공해야 한다.
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  });

  it('B(보호 경로 대조): 동일 시나리오를 실제 JsonDbJobRepository로 수행하면 정확히 1건만 성공한다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c1-guarded-'));
    const seeded = makeJob({ status: 'processing' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
    const repo = new JsonDbJobRepository(dbPath);

    const [first, second] = await Promise.all([
      repo.withTransition(seeded.id, 'completed'),
      repo.withTransition(seeded.id, 'failed'),
    ]);

    const successes = [first, second].filter((r) => r.ok);
    // completed/failed는 서로 배타적 목표이고 target !== 재조회 시 current.status이므로
    // field-only 단축 경로를 타지 않는다 — 먼저 커밋한 쪽만 반영되고 나머지는 guard-in-lock에
    // 의해 INVALID_TRANSITION으로 거부된다(실측 확인 완료, 반대 결과가 나오면 baseline 재현이
    // 실효성이 없거나 보호 경로가 깨진 것).
    expect(successes).toHaveLength(1);
    const rejected = [first, second].find((r) => !r.ok);
    expect(rejected).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
  });
});
