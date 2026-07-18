import { JobSchedulerAdapter } from './job-scheduler.adapter';
import { ProcessPendingJobsUseCase } from '../../application/use-cases/process-pending-jobs.use-case';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';

/**
 * `ProcessPendingJobsUseCase`의 목. `execute`가 언제 시작·종료되는지 테스트가 직접 제어할 수 있도록
 * 외부에서 resolve 가능한 Promise를 반환한다(overrun 겹침을 결정론적으로 재현하기 위함, 08 C-4).
 */
function makeControllableUseCase() {
  const resolvers: Array<() => void> = [];
  const execute = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        resolvers.push(() => resolve());
      }),
  );
  const useCase = { execute } as unknown as ProcessPendingJobsUseCase;
  return {
    useCase,
    execute,
    finishExecute: () => {
      const pending = resolvers.splice(0, resolvers.length);
      pending.forEach((resolve) => resolve());
    },
  };
}

describe('JobSchedulerAdapter', () => {
  it('tick()을 수동 호출하면 ProcessPendingJobsUseCase.execute를 위임 호출하고 시작/종료 이벤트를 남긴다', async () => {
    const logger = new InMemoryLogger();
    const execute = jest.fn().mockResolvedValue({ batchSize: 0, succeeded: 0, failed: 0 });
    const useCase = { execute } as unknown as ProcessPendingJobsUseCase;
    const adapter = new JobSchedulerAdapter(useCase, logger);

    await adapter.tick();

    expect(execute).toHaveBeenCalledTimes(1);
    const tickEvents = logger.events.filter((event) => event.type === 'tick');
    expect(tickEvents).toHaveLength(2);
    expect(tickEvents[0]).toMatchObject({ type: 'tick', phase: 'start' });
    expect(tickEvents[1]).toMatchObject({ type: 'tick', phase: 'end' });
    expect(tickEvents[1]).toHaveProperty('durationMs');
    // 시작/종료 두 이벤트가 동일 tick을 가리키는 tickId를 공유해야 한다.
    expect(tickEvents[0]).toHaveProperty('tickId', (tickEvents[1] as { tickId: string }).tickId);
  });

  it('스킵 가드가 켜진 상태(기본값)에서 이전 tick이 실행 중이면 겹치는 tick을 스킵하고 스킵 로그 1건을 남긴다', async () => {
    const logger = new InMemoryLogger();
    const { useCase, execute, finishExecute } = makeControllableUseCase();
    const adapter = new JobSchedulerAdapter(useCase, logger);

    const firstTick = adapter.tick();
    const secondTick = adapter.tick();

    // 두 번째 tick은 첫 번째가 실행 중인 동안 즉시 스킵되어야 한다(await 없이 동기적으로 반환).
    await secondTick;
    expect(execute).toHaveBeenCalledTimes(1);
    const skipEvents = logger.events.filter((event) => event.type === 'tick' && event.phase === 'skipped');
    expect(skipEvents).toHaveLength(1);

    finishExecute();
    await firstTick;
    // 첫 번째 tick 종료 후 execute는 여전히 정확히 1회만 호출된 상태여야 한다.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('스킵 가드를 끄면(skipGuardEnabled=false) 겹치는 tick 실행이 허용되어 execute가 두 번 모두 호출된다', async () => {
    const logger = new InMemoryLogger();
    const { useCase, execute, finishExecute } = makeControllableUseCase();
    const adapter = new JobSchedulerAdapter(useCase, logger, false);

    const firstTick = adapter.tick();
    const secondTick = adapter.tick();

    expect(execute).toHaveBeenCalledTimes(2);
    const skipEvents = logger.events.filter((event) => event.type === 'tick' && event.phase === 'skipped');
    expect(skipEvents).toHaveLength(0);

    finishExecute();
    await Promise.all([firstTick, secondTick]);
  });
});
