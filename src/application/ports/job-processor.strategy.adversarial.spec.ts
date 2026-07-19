import { DispatchingJobProcessor, JobProcessor } from './job-processor.strategy';
import { makeJob } from '../testing/job.fixture';

/**
 * QA/red-team adversarial spec for `DispatchingJobProcessor` 격리(isolation) 계약.
 *
 * 목표: 제목이 sentinel과 다른 job은 "네트워크를 타는" 처리기(뉴스 파이프라인을 흉내 낸 fake)를
 * 절대 호출하지 않고 fallback으로만 위임되는지, 그리고 sentinel과 일치하는 job은 정확히
 * matched 처리기로만 위임되는지를 호출 카운터로 검증한다. 실제 네트워크 호출은 발생하지 않는다
 * (fake만 사용). 기존 스펙 파일은 수정하지 않는다.
 */

function makeCountingProcessor(outcome: 'completed' | 'failed' = 'completed'): {
  processor: JobProcessor;
  callCount: () => number;
} {
  let calls = 0;
  const processor: JobProcessor = {
    async process() {
      calls += 1;
      return { outcome };
    },
  };
  return {
    processor,
    callCount: () => calls,
  };
}

describe('QA red-team: DispatchingJobProcessor 네트워크 격리', () => {
  it('제목이 sentinel과 다른 job은 matched(네트워크) 처리기를 절대 호출하지 않고 fallback으로만 간다', async () => {
    const { processor: matched, callCount: matchedCalls } = makeCountingProcessor();
    const { processor: fallback, callCount: fallbackCalls } = makeCountingProcessor();
    const dispatcher = new DispatchingJobProcessor(
      (job) => job.title === 'news-digest',
      matched,
      fallback,
    );

    const outcome = await dispatcher.process(makeJob({
      id: 'not-news',
      title: 'unrelated-title',
    }));

    expect(outcome).toEqual({ outcome: 'completed' });
    expect(matchedCalls()).toBe(0);
    expect(fallbackCalls()).toBe(1);
  });

  it('제목이 sentinel과 정확히 일치하는 job은 matched 처리기로만 가고 fallback은 호출되지 않는다', async () => {
    const { processor: matched, callCount: matchedCalls } = makeCountingProcessor();
    const { processor: fallback, callCount: fallbackCalls } = makeCountingProcessor();
    const dispatcher = new DispatchingJobProcessor(
      (job) => job.title === 'news-digest',
      matched,
      fallback,
    );

    const outcome = await dispatcher.process(makeJob({
      id: 'is-news',
      title: 'news-digest',
    }));

    expect(outcome).toEqual({ outcome: 'completed' });
    expect(matchedCalls()).toBe(1);
    expect(fallbackCalls()).toBe(0);
  });

  it('sentinel과 유사하지만 다른(대소문자·공백·부분일치) 제목은 여전히 fallback으로만 간다', async () => {
    const { processor: matched, callCount: matchedCalls } = makeCountingProcessor();
    const { processor: fallback, callCount: fallbackCalls } = makeCountingProcessor();
    const dispatcher = new DispatchingJobProcessor(
      (job) => job.title === 'news-digest',
      matched,
      fallback,
    );

    const nearMisses = [
      'News-Digest',
      ' news-digest',
      'news-digest ',
      'news-digest-extra',
      '',
    ];
    for (const title of nearMisses) {
      await dispatcher.process(makeJob({
        id: `near-${title}`,
        title,
      }));
    }

    expect(matchedCalls()).toBe(0);
    expect(fallbackCalls()).toBe(nearMisses.length);
  });
});
