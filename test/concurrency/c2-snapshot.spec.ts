import { randomUUID } from 'crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../src/domain/job';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';

/**
 * C-2(08-testing-strategy-design.md "동시성 문제 재현 테스트" 절 표): 무보호 경로에서 read
 * 스냅숏 이후 다른 트랜잭션이 끼어들어 비일관(TOCTOU) 상태가 관측되는 것을 재현하는 baseline과,
 * 보호 경로(실제 `JsonDbJobRepository`)가 항상 일관 스냅숏을 보장함을 대조하는 회귀를 담는다.
 *
 * ### skip 판정을 Jest 수집 시점에 확정하는 이유
 * Jest는 `it`/`it.skip` 등록을 **모듈 로드(수집) 시점에 동기적으로** 확정해야 하며, 이미 시작된
 * 테스트 실행 중에 동적으로 `test.skip`을 호출하는 것은 지원되지 않는다(호출해도 무시되거나
 * 오류가 난다). 따라서 이 파일은 baseline 재현 여부를 **동기 함수**(`probeTornSnapshot`, 아래)로
 * `describe` 등록 시점에 먼저 계산한 뒤, 그 결과에 따라 `it` 또는 `it.skip`을 등록한다 — 실행
 * 시점이 아니라 수집 시점에 skip 여부가 정해진다는 점만 다를 뿐, "N회 반복 중 최소 1회 재현되면
 * 성공, 전혀 재현되지 않으면 skip(사유 로그)"라는 08의 skip 규약은 동일하게 지킨다. 재현
 * 시퀀스 자체(read→write 사이 다른 트랜잭션 개입)는 실제 파일 I/O로 수행하되, 두 트랜잭션의
 * 순서를 이 파일이 직접 orchestrate해 결정론을 확보한다(08 "결정론 확보" 열 — Node는 단일
 * 스레드이므로 진짜 OS 병렬성이 아니라 인터리빙 순서 자체가 재현 대상이다).
 *
 * **이 skip 규약은 baseline 재현 성공조건에만 적용되며, 보호 경로 대조 테스트는 재현 성공
 * 여부와 무관하게 항상 하드 실패(never skip)다**(08 "skip 격리" 열 참조).
 */

const REPEAT_COUNT = 30;

/** 테스트 1건마다 os.tmpdir() 하위에 고유 디렉터리를 만들어 파일 격리한다(각 호출부에서 즉시 삭제). */
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

function readJobsSync(dbPath: string): Job[] {
  return (JSON.parse(readFileSync(dbPath, 'utf-8')) as { jobs: Job[] }).jobs;
}

/**
 * 재현 테스트 전용 — 프로덕션 경로 아님. 02의 직렬화 큐를 우회해 "읽기1(status) → 다른
 * 트랜잭션의 write 커밋 → 읽기2(title)" 순서를 이 함수가 직접 orchestrate한다. 실제 서비스에서는
 * 읽기1/write/읽기2가 서로 다른 요청(예: 목록 조회 도중 다른 PATCH가 끼어듦)이며 그 인터리빙
 * 순서는 스케줄러/이벤트 루프가 결정하지만, 이 헬퍼는 그 순서를 결정론적으로 고정해 08 C-2가
 * 요구하는 재현 가능성을 확보한다(무보호이므로 status/title이 서로 다른 시점의 값으로 뒤섞여도
 * 막을 방법이 없다는 것이 재현 대상). `src/infrastructure`에는 이 경로를 절대 추가하지 않는다.
 */
function tornSnapshotSequence(dbPath: string, id: string): { statusSnapshot: string; titleSnapshot: string } {
  // 읽기1: 다른 트랜잭션 개입 이전의 status.
  const before = readJobsSync(dbPath);
  const statusSnapshot = before.find((job) => job.id === id)?.status ?? '';

  // 개입: 큐 없이 직접 read→write(다른 PATCH를 흉내낸 무보호 커밋).
  const index = before.findIndex((job) => job.id === id);
  const updated: Job = { ...before[index], status: 'processing', title: 'updated-title' };
  const committed = [...before];
  committed[index] = updated;
  writeFileSync(dbPath, JSON.stringify({ jobs: committed }));

  // 읽기2: 개입 이후의 title. 무보호 경로는 읽기1/읽기2를 하나의 스냅숏으로 묶지 못하므로,
  // 서로 다른 시점의 값(옛 status + 새 title)이 뒤섞여 반환될 수 있다.
  const after = readJobsSync(dbPath);
  const titleSnapshot = after.find((job) => job.id === id)?.title ?? '';

  return { statusSnapshot, titleSnapshot };
}

/** N회 반복해 비일관(옛 status + 새 title 조합)이 최소 1회 관측되는지 확인한다(08 C-2 결정론 절). */
function probeTornSnapshot(): { reproduced: boolean; reason?: string } {
  for (let i = 0; i < REPEAT_COUNT; i += 1) {
    const { dir, path } = makeTempDbPath(`c2-probe-${i}-`);
    try {
      const seeded = makeJob({ status: 'pending', title: 'original-title' });
      writeFileSync(path, JSON.stringify({ jobs: [seeded] }));
      const snapshot = tornSnapshotSequence(path, seeded.id);
      if (snapshot.statusSnapshot === 'pending' && snapshot.titleSnapshot === 'updated-title') {
        return { reproduced: true };
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { reproduced: false, reason: `${REPEAT_COUNT}회 반복 내내 status/title이 뒤섞인 비일관 스냅숏이 관측되지 않았다` };
}

const baselineProbe = probeTornSnapshot();
if (!baselineProbe.reproduced) {
  // eslint-disable-next-line no-console -- 08 C-2 skip 규약: 미재현 시 사유를 로그로 남긴다.
  console.log(`[C-2 baseline] skip 처리: ${baselineProbe.reason}`);
}

describe('C-2 스냅숏 비일관(TOCTOU) 재현', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const baselineIt = baselineProbe.reproduced ? it : it.skip;
  baselineIt('baseline(무보호): status/title이 서로 다른 시점 값으로 뒤섞인 비일관 스냅숏이 재현된다', () => {
    ({ dir, path: dbPath } = makeTempDbPath('c2-unguarded-'));
    const seeded = makeJob({ status: 'pending', title: 'original-title' });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));

    const snapshot = tornSnapshotSequence(dbPath, seeded.id);

    expect(snapshot.statusSnapshot).toBe('pending');
    expect(snapshot.titleSnapshot).toBe('updated-title');
  });

  it('대조(보호 경로): 실제 JsonDbJobRepository의 list()는 write와 동일 큐로 직렬화되어 항상 일관 스냅숏이다', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { dir: iterDir, path: iterDbPath } = makeTempDbPath(`c2-guarded-${i}-`);
      const seeded = makeJob({ status: 'pending', title: 'original-title' });
      writeFileSync(iterDbPath, JSON.stringify({ jobs: [seeded] }));
      const repo = new JsonDbJobRepository(iterDbPath);

      const [jobsBeforeOrAfter] = await Promise.all([
        repo.list(),
        repo.withTransition(seeded.id, 'processing', { title: 'updated-title' }),
      ]);

      const observed = jobsBeforeOrAfter[0];
      // 큐 직렬화 덕분에 list()는 write 이전(둘 다 pending/original-title) 또는 write 이후
      // (둘 다 processing/updated-title) 중 하나의 완전한 스냅숏만 관측한다 — 필드가 뒤섞인
      // 조합은 절대 나오지 않는다(하드 assert, skip 대상 아님).
      const isConsistentBefore = observed.status === 'pending' && observed.title === 'original-title';
      const isConsistentAfter = observed.status === 'processing' && observed.title === 'updated-title';
      expect(isConsistentBefore || isConsistentAfter).toBe(true);

      rmSync(iterDir, { recursive: true, force: true });
    }
  });
});
