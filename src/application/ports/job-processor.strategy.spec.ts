import { DefaultJobProcessor, DispatchingJobProcessor, JobProcessor } from './job-processor.strategy';
import { makeJob } from '../testing/job.fixture';
import { Job } from '../../domain/job';

describe('DefaultJobProcessor', () => {
  it('판정 함수를 주입하지 않으면 항상 completed를 반환한다', async () => {
    const processor = new DefaultJobProcessor();

    const outcome = await processor.process(makeJob({
      id: 'a',
      status: 'processing',
    }));

    expect(outcome).toEqual({ outcome: 'completed' });
  });

  it('주입한 판정 함수의 결과를 그대로 반환한다(실패 경로 테스트 가능성)', async () => {
    const processor = new DefaultJobProcessor(() => 'failed');

    const outcome = await processor.process(makeJob({
      id: 'a',
      status: 'processing',
    }));

    expect(outcome).toEqual({ outcome: 'failed' });
  });
});

describe('DispatchingJobProcessor', () => {
  function makeFakeProcessor(outcome: 'completed' | 'failed'): { processor: JobProcessor; calls: Job[] } {
    const calls: Job[] = [];
    const processor: JobProcessor = {
      async process(job: Job) {
        calls.push(job);
        return { outcome };
      },
    };
    return {
      processor,
      calls,
    };
  }

  it('matches가 참이면 matched로 위임하고 fallback은 호출하지 않는다', async () => {
    const matched = makeFakeProcessor('completed');
    const fallback = makeFakeProcessor('completed');
    const dispatcher = new DispatchingJobProcessor(() => true, matched.processor, fallback.processor);
    const job = makeJob({
      id: 'a',
      status: 'processing',
    });

    const outcome = await dispatcher.process(job);

    expect(outcome).toEqual({ outcome: 'completed' });
    expect(matched.calls).toEqual([job]);
    expect(fallback.calls).toEqual([]);
  });

  it('matches가 거짓이면 fallback으로 위임하고 matched는 호출하지 않는다', async () => {
    const matched = makeFakeProcessor('completed');
    const fallback = makeFakeProcessor('completed');
    const dispatcher = new DispatchingJobProcessor(() => false, matched.processor, fallback.processor);
    const job = makeJob({
      id: 'a',
      status: 'processing',
    });

    const outcome = await dispatcher.process(job);

    expect(outcome).toEqual({ outcome: 'completed' });
    expect(fallback.calls).toEqual([job]);
    expect(matched.calls).toEqual([]);
  });

  it('위임한 처리기가 반환한 outcome을 그대로 전달한다(matched=failed, fallback=completed)', async () => {
    const matched = makeFakeProcessor('failed');
    const fallback = makeFakeProcessor('completed');
    const dispatcher = new DispatchingJobProcessor((job) => job.id === 'match-me', matched.processor, fallback.processor);

    const matchedOutcome = await dispatcher.process(makeJob({
      id: 'match-me',
      status: 'processing',
    }));
    const fallbackOutcome = await dispatcher.process(makeJob({
      id: 'other',
      status: 'processing',
    }));

    expect(matchedOutcome).toEqual({ outcome: 'failed' });
    expect(fallbackOutcome).toEqual({ outcome: 'completed' });
  });
});
