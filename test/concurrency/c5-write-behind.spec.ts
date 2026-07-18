/**
 * 02 기각안 실측 — Ponytail 1단 판정의 사용자 확정 예외.
 *
 * C-5(08-testing-strategy-design.md "동시성 문제 재현 테스트" 절 표): 02가 기각한 "(c) write-behind
 * 캐시 + 주기 flush" 대안을 테스트 더블로 구현해, flush 이전에 프로세스가 죽으면 커밋된 데이터가
 * 유실됨을 실증한다. write-behind 더블은 원래 Ponytail 사다리 1단(생략 가능) 판정 대상이었으나,
 * "재현→해결→기각안 실측" 서사 완결을 위해 사용자가 구현을 명시적으로 확정했다(post-interview
 * 게이트 C, 02-persistence-concurrency-design.md "C-5 Ponytail 사용자 확정 예외" 절 참조). 02
 * 채택안((a) 즉시 write + 인프로세스 직렬화 큐)은 동일 시나리오에서 유실이 없어야 한다(대조군).
 */

import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../src/domain/job';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';

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
 * 재현 테스트 전용 — 프로덕션 경로 아님. 02가 기각한 "(c) write-behind" 대안의 테스트 더블이다.
 * `commitToBuffer`는 인메모리 버퍼만 갱신하고 파일에는 아무 것도 쓰지 않는다 — 실제 파일 반영은
 * `flush`가 별도로, 그리고 지연되어 수행된다(주기적 배치 flush를 흉내). `src/infrastructure`에는
 * 이 write-behind 경로를 절대 추가하지 않는다(02가 기각한 대안이며, REQUIREMENTS의 "데이터가
 * 손실되지 않아야 한다" 안전 경계를 위반할 소지가 있어 채택되지 않았다).
 */
class WriteBehindRepositoryDouble {
  private buffer: Job[];

  constructor(private readonly dbPath: string) {
    this.buffer = readJobs(dbPath);
  }

  /** 커밋을 메모리 버퍼에만 반영한다(파일 미반영, 02 기각 근거의 핵심). */
  commitToBuffer(updatedJob: Job): void {
    const index = this.buffer.findIndex((job) => job.id === updatedJob.id);
    this.buffer[index] = updatedJob;
  }

  /** 버퍼 전체를 파일에 지연 반영한다(주기 flush 시뮬레이션). */
  flush(): void {
    writeFileSync(this.dbPath, JSON.stringify({ jobs: this.buffer }));
  }
}

describe('C-5 크래시 유실 시뮬레이션(기각안 write-behind 실증)', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('write-behind 더블: flush 전 강제 예외로 크래시하면 커밋 데이터가 재조회 시 사라져 있다', () => {
    ({ dir, path: dbPath } = makeTempDbPath('c5-write-behind-'));
    const seeded = makeJob({ status: 'pending' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));

    const double = new WriteBehindRepositoryDouble(dbPath);
    const committed: Job = { ...seeded, status: 'processing', updatedAt: new Date().toISOString() };

    // flush 전 크래시 시뮬레이션: commitToBuffer 이후 flush를 호출하기 전에 강제로 예외를
    // 던져 프로세스 죽음을 결정론적으로 재현한다(실제 kill이 아닌 테스트 더블 내 결정론적 실패
    // 주입, 08 C-5 "결정론 확보" 열).
    expect(() => {
      double.commitToBuffer(committed);
      throw new Error('simulated crash before flush');
      // eslint-disable-next-line no-unreachable -- flush()가 호출되지 않았음을 명시하기 위해 남긴다.
      double.flush();
    }).toThrow('simulated crash before flush');

    // "재기동": 동일 파일을 새로 읽는다(더블이 flush하지 않았으므로 파일은 크래시 이전 상태 그대로).
    const reloaded = readJobs(dbPath);
    const reloadedJob = reloaded.find((job) => job.id === seeded.id);
    // 재현 성공 조건: 커밋했던 processing이 사라지고 크래시 이전 pending이 남아 있어야 한다(유실 실증).
    expect(reloadedJob?.status).toBe('pending');
  });

  it('대조(02 채택안, 즉시 write): 동일 시나리오에서 커밋 직후 크래시해도 유실이 없다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c5-immediate-write-'));
    const seeded = makeJob({ status: 'pending' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
    const repo = new JsonDbJobRepository(dbPath);

    // withTransition은 큐 임계구역 내부에서 즉시 파일에 write하므로, 커밋이 반환된 시점에
    // 이미 파일에 반영되어 있다 — 그 직후 "크래시"(프로세스 재시작 시뮬레이션: 새 인스턴스로
    // 파일을 재로드)해도 데이터가 남아 있어야 한다.
    const result = await repo.withTransition(seeded.id, 'processing');
    expect(result.ok).toBe(true);

    // "재기동": 새 JsonDbJobRepository 인스턴스로 동일 파일을 재로드한다.
    const restarted = new JsonDbJobRepository(dbPath);
    const reloadedJob = await restarted.findById(seeded.id);
    expect(reloadedJob?.status).toBe('processing');
  });
});
