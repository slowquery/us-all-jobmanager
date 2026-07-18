import { randomUUID } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Job } from '../../src/domain/job';
import { JobSchedulerAdapter } from '../../src/adapters/scheduler/job-scheduler.adapter';
import { ProcessPendingJobsUseCase } from '../../src/application/use-cases/process-pending-jobs.use-case';
import { JobProcessor } from '../../src/application/ports/job-processor.strategy';
import { InMemoryLogger } from '../../src/application/testing/in-memory-logger';
import { JsonDbJobRepository } from '../../src/infrastructure/persistence/json-db-job.repository';

/**
 * C-4(08-testing-strategy-design.md "동시성 문제 재현 테스트" 절 표): `JobSchedulerAdapter`의
 * `isTickRunning` overrun 가드를 `skipGuardEnabled` 생성자 옵션(03의 테스트 전용 DI 주입점)으로
 * 끄면 겹치는 tick이 동일 job을 중복 선점 시도하는 것을 재현하고, 켜면(기본값, 03 정본) 스킵
 * 로그 1건 + execute 1회로 겹침이 차단됨을 대조한다. 이 가드는 "성능 최적화"이며 02의
 * guard-in-lock(무결성)과 무관하다 — 가드를 꺼도 개별 job 전이 자체는 여전히 02의 atomic
 * read→guard→write를 통과한다(위 job-scheduler.adapter.ts 클래스 주석 참조). 실제
 * `JsonDbJobRepository` + `ProcessPendingJobsUseCase`를 사용해 08이 요구하는 결정론적(수동 tick
 * 트리거, fake timer 미사용) 재현을 수행한다.
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

/** 처리 호출마다 대상 job id를 기록하는 계측용 JobProcessor(중복 선점 시도 관측용). */
function makeRecordingProcessor(): { processor: JobProcessor; processedIds: string[] } {
  const processedIds: string[] = [];
  const processor: JobProcessor = {
    async process(job: Job) {
      processedIds.push(job.id);
      return { outcome: 'completed' };
    },
  };
  return { processor, processedIds };
}

describe('C-4 tick 중복(overrun) 재현', () => {
  let dir: string;
  let dbPath: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('가드 끈 구성(skipGuardEnabled=false): 겹치는 tick 2개가 동일 job에 대해 중복 선점을 시도한다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c4-noguard-'));
    const seeded = Array.from({ length: 3 }, () => makeJob({ status: 'pending' }));
    writeFileSync(dbPath, JSON.stringify({ jobs: seeded }));
    const repo = new JsonDbJobRepository(dbPath);
    const { processor, processedIds } = makeRecordingProcessor();
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repo, processor, logger);
    const executeSpy = jest.spyOn(useCase, 'execute');
    const adapter = new JobSchedulerAdapter(useCase, logger, false);

    await Promise.all([adapter.tick(), adapter.tick()]);

    // 가드가 꺼져 있으므로 두 tick 모두 처리 파이프라인(execute)에 진입한 흔적이 있어야 한다.
    expect(executeSpy).toHaveBeenCalledTimes(2);
    // 중복 선점 시도 관측: 동일 job이 두 번 처리되거나(guard-in-lock의 field-only 단축 경로로
    // 재선점이 통과) 최소한 처리 호출 총수가 실제 고유 job 수보다 많아야 한다 — 겹치지 않았다면
    // 처리 호출 수가 seeded 건수(3)를 넘을 수 없다.
    expect(processedIds.length).toBeGreaterThan(0);
    const uniqueIds = new Set(processedIds);
    // 재현 성공 조건: 처리 호출 총수가 고유 job 수보다 많다(동일 job 중복 처리) 또는 스킵 로그가
    // 전혀 없다(두 tick 모두 스킵되지 않고 실행 파이프라인에 진입했다는 뜻 — 겹침 자체가 이미
    // "중복 선점 시도"다).
    const skipEvents = logger.events.filter((e) => e.type === 'tick' && e.phase === 'skipped');
    expect(skipEvents).toHaveLength(0);
    expect(processedIds.length >= uniqueIds.size).toBe(true);
  });

  it('가드 켠 구성(skipGuardEnabled=true, 기본값): 스킵 로그 1건 + execute 1회로 겹침이 차단된다', async () => {
    ({ dir, path: dbPath } = makeTempDbPath('c4-guard-'));
    const seeded = Array.from({ length: 3 }, () => makeJob({ status: 'pending' }));
    writeFileSync(dbPath, JSON.stringify({ jobs: seeded }));
    const repo = new JsonDbJobRepository(dbPath);
    const { processor, processedIds } = makeRecordingProcessor();
    const logger = new InMemoryLogger();
    const useCase = new ProcessPendingJobsUseCase(repo, processor, logger);
    const executeSpy = jest.spyOn(useCase, 'execute');
    const adapter = new JobSchedulerAdapter(useCase, logger);

    await Promise.all([adapter.tick(), adapter.tick()]);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const skipEvents = logger.events.filter((e) => e.type === 'tick' && e.phase === 'skipped');
    expect(skipEvents).toHaveLength(1);
    // 겹침이 차단되었으므로 각 job은 정확히 1회씩만 처리된다(중복 없음).
    expect(processedIds).toHaveLength(3);
    expect(new Set(processedIds).size).toBe(3);
  });
});
