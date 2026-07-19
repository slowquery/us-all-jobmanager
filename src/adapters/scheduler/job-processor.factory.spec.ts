import { randomUUID } from 'crypto';
import { Job } from '../../domain/job';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';
import { NewsDigestConfig } from '../../infrastructure/config/news-digest.config';
import { createSchedulerJobProcessor } from './job-processor.factory';
import { TracingJobProcessor } from './tracing-job.processor';

/**
 * `createSchedulerJobProcessor` 팩토리(등록/호출 조립 지점) 단위 검증.
 *
 * 활성 경로는 협력자 생성자만 호출(네트워크 없음)하므로 process()를 호출하지 않고 조립 자체를
 * 검증한다. 라우팅 동작(뉴스 job vs 일반 job)은 비-뉴스 job을 fallback으로 처리해 네트워크 없이 확인한다.
 */
function makeConfig(overrides: Partial<NewsDigestConfig> = {}): NewsDigestConfig {
  return {
    enabled: false,
    jobTitle: 'news-digest',
    newsFeedUrl: 'https://example.test/rss',
    maxHeadlines: 5,
    geminiApiKey: 'test-key',
    geminiModel: 'gemini-1.5-flash',
    slackWebhookUrl: 'https://example.test/webhook',
    timeoutMs: 1000,
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: 'title',
    description: 'description',
    status: 'processing',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('createSchedulerJobProcessor', () => {
  it('비활성 설정: TracingJobProcessor로 감싼 기본 처리기를 반환하고 임의 job을 completed로 처리한다', async () => {
    const processor = createSchedulerJobProcessor(makeConfig({ enabled: false }), new InMemoryLogger());
    expect(processor).toBeInstanceOf(TracingJobProcessor);
    await expect(processor.process(makeJob({ title: 'anything' }))).resolves.toEqual({ outcome: 'completed' });
  });

  it('활성 설정: 뉴스 처리기+분배기를 조립해 TracingJobProcessor로 감싼 처리기를 반환한다', () => {
    const processor = createSchedulerJobProcessor(makeConfig({ enabled: true }), new InMemoryLogger());
    expect(processor).toBeInstanceOf(TracingJobProcessor);
  });

  it('활성 설정: sentinel 제목과 다른 job은 뉴스 파이프라인이 아니라 기본 처리기(fallback)로 라우팅되어 네트워크 없이 completed 처리된다', async () => {
    const processor = createSchedulerJobProcessor(
      makeConfig({
        enabled: true,
        jobTitle: 'news-digest',
      }),
      new InMemoryLogger(),
    );
    // 제목이 sentinel('news-digest')과 다르므로 DispatchingJobProcessor가 fallback(DefaultJobProcessor)으로 보낸다.
    await expect(processor.process(makeJob({ title: 'ordinary-job' }))).resolves.toEqual({ outcome: 'completed' });
  });
});
