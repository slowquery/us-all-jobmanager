import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../src/domain/job';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';
import { PatchJobUseCase } from '../../src/application/use-cases/patch-job.use-case';
import { InMemoryLogger } from '../../src/application/testing/in-memory-logger';

/**
 * 02-persistence-concurrency-design.md의 race 시나리오(동시 PATCH, PATCH↔스케줄러 배치)를
 * `Promise.all`로 재현하는 **보호 경로(guarded) 회귀 테스트**다(08-testing-strategy-design.md
 * "동시성 회귀 테스트" 절). 이 파일의 assert는 **항상 하드 실패해야 하며 어떤 경우에도 skip하지
 * 않는다** — "문제가 실재했음을 보여주는 데모"인 test/concurrency/c1~c5(baseline 재현)와 반대로,
 * 이 파일은 "항상 통과해야 하는 안전망"이다(08 "역할 구분" 참조). 실제 `JsonDbJobRepository` +
 * `os.tmpdir()` 격리 임시 파일을 사용해 02의 직렬화 큐 구현 자체를 통과시킨다(08이 요구하는 e2e
 * 수준). 원래 `src/infrastructure/persistence/json-db-job.repository.spec.ts`에 있던 두 회귀
 * 케이스를 이 파일로 이동해 중복을 제거했다(S7 정리).
 *
 * ### 08 원문 assert①과의 괴리(S3 확정 사항, S7 실측으로 재확인)
 * 08 원문은 "동시 PATCH pending×2 → 정확히 1건 성공 + 1건 409 거부"를 assert 조건으로 서술했으나,
 * `JsonDbJobRepository.withTransition`의 field-only 단축 경로(target===현재 status면 guard
 * 평가 없이 성공 처리, `job-repository.port.ts` S2 계약)가 이 서술을 supersede한다: 두 번째
 * PATCH가 재조회한 시점에 이미 첫 번째가 `pending`으로 커밋해 두었으면 "target==='pending' ===
 * 현재 status"가 되어 guard 자체가 생략되고 두 번째도 2xx(ok:true)를 반환한다(재현 실측 완료,
 * S7 IRC 교신). 이는 "동일-target PATCH는 idempotent no-op"이라는 S2 계약과 정합하는 확정
 * 동작이므로 이 테스트는 08 원문의 "1거부" 문언 대신 **실제로 보장되어야 하는 무손실 불변식**
 * (retryCount 정확히 1회만 증가 + 최종 상태가 pending으로 정확히 1회 전이)을 하드 assert한다.
 * `transition` 로그 이벤트가 no-op 두 번째 호출에서도 중복 emit되는 것은 실결함으로 관측되었으나
 * (05 로그 카탈로그 #4 "커밋된 전이만 기록" 위반), 리더가 이후 세션에서 `PatchJobUseCase`를
 * 수정할 예정이므로 이 테스트는 이벤트 **개수**를 assert로 고정하지 않는다(수정 시 깨지는 것을
 * 방지).
 */

/** 테스트 1건마다 os.tmpdir() 하위에 고유 디렉터리를 만들어 파일 격리(afterEach에서 삭제)한다. */
function makeTempDbPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'concurrency-regression-'));
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

describe('동시성 회귀(보호 경로, 02 race 시나리오)', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('① failed 시딩 + 동시 PATCH pending×2: 무손실(retryCount 정확히 1회 증가, 최종 pending 1회 전이)', async () => {
    ({ dir, path: dbPath } = makeTempDbPath());
    const seeded = makeJob({ status: 'failed', retryCount: 0 });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
    const repo = new JsonDbJobRepository(dbPath);
    const logger = new InMemoryLogger();
    const useCase = new PatchJobUseCase(repo, logger);

    const [first, second] = await Promise.all([
      useCase.execute({ id: seeded.id, status: 'pending' }),
      useCase.execute({ id: seeded.id, status: 'pending' }),
    ]);

    // 위 클래스 주석 "08 원문 assert①과의 괴리" 참조: 둘 다 2xx(ok:true)를 반환하는 것이
    // 현재 S2 계약상 정상 동작이다. 핵심은 무손실 — retryCount 중복 증가가 없어야 한다.
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const final = await repo.findById(seeded.id);
    expect(final?.status).toBe('pending');
    expect(final?.retryCount).toBe(1);
  });

  it('② PATCH↔스케줄러 배치: processing job에 대해 무효 PATCH는 항상 거부되고 스케줄러 커밋만 반영된다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath());
    const seeded = makeJob({ status: 'processing', retryCount: 0 });
    writeFileSync(dbPath, JSON.stringify({ jobs: [seeded] }));
    const repo = new JsonDbJobRepository(dbPath);

    // processing → pending은 01 전이 표에 없어 순서와 무관하게 항상 거부되어야 한다(무효 전이
    // 방지). completed 커밋(스케줄러 배치 대역)은 손실 없이 반영되어야 한다(무손실).
    const [invalidPatch, schedulerComplete] = await Promise.all([
      repo.withTransition(seeded.id, 'pending'),
      repo.withBatch([seeded.id], 'completed'),
    ]);

    expect(invalidPatch).toEqual({ ok: false, reason: 'INVALID_TRANSITION' });
    expect(schedulerComplete.rejected).toHaveLength(0);
    expect(schedulerComplete.committed).toHaveLength(1);
    expect(schedulerComplete.committed[0].status).toBe('completed');

    const final = await repo.findById(seeded.id);
    expect(final?.status).toBe('completed');
  });

  it('③ withBatch 원자성: 일부 거부되어도 write는 1회이며 커밋/거부 스냅숏이 일관된다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath());
    const okJob = makeJob({ status: 'pending', retryCount: 0 });
    const alreadyCompleted = makeJob({ status: 'completed', retryCount: 0 });
    writeFileSync(dbPath, JSON.stringify({ jobs: [okJob, alreadyCompleted] }));
    const repo = new JsonDbJobRepository(dbPath);
    const dbPushSpy = jest.spyOn(
      (repo as unknown as { db: { push: (...args: unknown[]) => Promise<void> } }).db,
      'push',
    );

    const result = await repo.withBatch([okJob.id, alreadyCompleted.id, 'missing-id'], 'processing');

    expect(result.committed).toEqual([expect.objectContaining({ id: okJob.id, status: 'processing' })]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        { id: alreadyCompleted.id, reason: 'INVALID_TRANSITION' },
        { id: 'missing-id', reason: 'NOT_FOUND' },
      ]),
    );
    // ensureInitialized의 최초 push 호출은 이미 파일이 존재하는 시딩 경로라 발생하지 않으므로,
    // withBatch 자신의 write만 1회여야 한다(09 확정 #2, tick당 rewrite 최소화).
    expect(dbPushSpy).toHaveBeenCalledTimes(1);

    // 거부 건은 원 상태 그대로 보존되어야 한다(스냅숏 일관성).
    const stillCompleted = await repo.findById(alreadyCompleted.id);
    expect(stillCompleted?.status).toBe('completed');
    const stillMissing = await repo.findById('missing-id');
    expect(stillMissing).toBeNull();
  });
});
