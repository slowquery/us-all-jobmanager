import { DefaultJobProcessor } from './job-processor.strategy';
import { makeJob } from '../testing/job.fixture';

describe('DefaultJobProcessor', () => {
  it('판정 함수를 주입하지 않으면 항상 completed를 반환한다', async () => {
    const processor = new DefaultJobProcessor();

    const outcome = await processor.process(makeJob({ id: 'a', status: 'processing' }));

    expect(outcome).toEqual({ outcome: 'completed' });
  });

  it('주입한 판정 함수의 결과를 그대로 반환한다(실패 경로 테스트 가능성)', async () => {
    const processor = new DefaultJobProcessor(() => 'failed');

    const outcome = await processor.process(makeJob({ id: 'a', status: 'processing' }));

    expect(outcome).toEqual({ outcome: 'failed' });
  });
});
