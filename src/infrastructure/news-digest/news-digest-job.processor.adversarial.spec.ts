import { NewsDigestJobProcessor } from './news-digest-job.processor';
import {
  DeliveryLedger,
  DigestGroup,
  NewsArticle,
  NewsDigestBuilder,
  NewsSource,
  SlackNotifier,
} from './news-digest.ports';
import { makeJob } from '../../application/testing/job.fixture';
import { InMemoryLogger } from '../../application/testing/in-memory-logger';

/**
 * QA/red-team adversarial spec for `NewsDigestJobProcessor`.
 *
 * 목표: (1) no-throw 계약이 협력자가 동기 throw/reject/abort로 실패해도, logger가 없어도
 * (undefined) 절대 깨지지 않는지, (2) timeout이 실제로 유계 시간 내에 failed로 종료되는지,
 * (3) dedupe/idempotency가 동일 job.id 재처리와 서로 다른 job.id에 대해 정확히 동작하는지를
 * 실제 네트워크 없이 fake 협력자만으로 검증한다. 기존 스펙 파일은 수정하지 않는다.
 */

const SAMPLE_ARTICLES: NewsArticle[] = [{
  title: 'headline 1',
  snippet: 'snippet',
  link: 'https://example.com',
}];
const SAMPLE_GROUPS: DigestGroup[] = [{
  topic: 'topic',
  summary: 'summary',
  headlines: ['headline 1'],
}];

function makeLedger(initial: Set<string> = new Set()): DeliveryLedger {
  const store = new Set(initial);
  return {
    wasDelivered: (key: string) => store.has(key),
    markDelivered: (key: string) => {
      store.add(key);
    },
  };
}

function neverResolvingNewsSource(): NewsSource {
  return {
    fetchTodayArticles: (signal: AbortSignal) => new Promise<NewsArticle[]>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  };
}

describe('QA red-team: NewsDigestJobProcessor no-throw 계약 견고성', () => {
  it('NewsSource가 동기적으로 throw해도 process는 reject하지 않고 failed를 반환한다', async () => {
    const newsSource: NewsSource = {
      fetchTodayArticles: () => {
        throw new Error('synchronous boom');
      },
    };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    const notifier: SlackNotifier = { notify: async () => undefined };
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });
    const job = makeJob({ id: 'sync-throw-job' });

    await expect(processor.process(job)).resolves.toEqual({ outcome: 'failed' });
  });

  it('builder가 rejected Promise를 반환해도 process는 reject하지 않고 failed를 반환한다', async () => {
    const newsSource: NewsSource = { fetchTodayArticles: async () => SAMPLE_ARTICLES };
    const builder: NewsDigestBuilder = { buildGroupedDigest: () => Promise.reject(new Error('builder rejected')) };
    const notifier: SlackNotifier = { notify: async () => undefined };
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });
    const job = makeJob({ id: 'rejected-promise-job' });

    await expect(processor.process(job)).resolves.toEqual({ outcome: 'failed' });
  });

  it('notifier가 abort로 인해 reject해도(timeout 경합) process는 reject하지 않고 failed를 반환한다', async () => {
    const newsSource: NewsSource = { fetchTodayArticles: async () => SAMPLE_ARTICLES };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    const notifier: SlackNotifier = {
      notify: (_text: string, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('notify aborted')));
      }),
    };
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 20,
      model: 'gemini-test',
    });
    const job = makeJob({ id: 'abort-reject-job' });

    await expect(processor.process(job)).resolves.toEqual({ outcome: 'failed' });
  });

  it('logger가 undefined여도(선택 의존성) 오류 경로에서 throw하지 않는다', async () => {
    const newsSource: NewsSource = {
      fetchTodayArticles: () => {
        throw new Error('boom without logger');
      },
    };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    const notifier: SlackNotifier = { notify: async () => undefined };
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
      logger: undefined,
    });
    const job = makeJob({ id: 'no-logger-job' });

    await expect(processor.process(job)).resolves.toEqual({ outcome: 'failed' });
  });

  it('빈 기사 배열도 던지지 않고 failed로 매핑되며, logger에 digest+error 이벤트가 기록된다', async () => {
    const newsSource: NewsSource = { fetchTodayArticles: async () => [] };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    const notifier: SlackNotifier = { notify: async () => undefined };
    const logger = new InMemoryLogger();
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
      logger,
    });
    const job = makeJob({ id: 'empty-articles-job' });

    const outcome = await processor.process(job);
    expect(outcome).toEqual({ outcome: 'failed' });
    expect(logger.events).toHaveLength(2);
    expect(logger.events[0]).toMatchObject({
      type: 'digest',
      outcome: 'failed',
    });
    expect(logger.events[1]).toMatchObject({
      type: 'error',
      errorCode: 'NEWS_DIGEST_FAILED',
    });
  });

  it('빈 그룹 배열도 던지지 않고 failed로 매핑되며, notifier는 호출되지 않는다', async () => {
    const newsSource: NewsSource = { fetchTodayArticles: async () => SAMPLE_ARTICLES };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => [] };
    let notifyCallCount = 0;
    const notifier: SlackNotifier = {
      notify: async () => {
        notifyCallCount += 1;
      },
    };
    const logger = new InMemoryLogger();
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
      logger,
    });
    const job = makeJob({ id: 'empty-groups-job' });

    const outcome = await processor.process(job);
    expect(outcome).toEqual({ outcome: 'failed' });
    expect(notifyCallCount).toBe(0);
    expect(logger.events[1]).toMatchObject({
      type: 'error',
      errorCode: 'NEWS_DIGEST_FAILED',
    });
  });
});

describe('QA red-team: NewsDigestJobProcessor timeout 경계', () => {
  it('협력자가 abort 전까지 영원히 매달려도 timeoutMs 내에 failed로 유계 종료된다', async () => {
    const newsSource = neverResolvingNewsSource();
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    const notifier: SlackNotifier = { notify: async () => undefined };
    const timeoutMs = 30;
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs,
      model: 'gemini-test',
    });
    const job = makeJob({ id: 'hang-forever-job' });

    const started = Date.now();
    const outcome = await processor.process(job);
    const elapsedMs = Date.now() - started;

    expect(outcome).toEqual({ outcome: 'failed' });
    // 유계 종료 확증: timeoutMs를 과도하게(10배) 초과하지 않아야 한다 — CI 지터를 감안한 여유.
    expect(elapsedMs).toBeLessThan(timeoutMs * 10);
  });
});

describe('QA red-team: NewsDigestJobProcessor dedupe/idempotency', () => {
  it('동일 job.id를 두 번 처리하면 두 번째 호출은 notifier를 호출하지 않고도 completed를 반환한다', async () => {
    const newsSource: NewsSource = { fetchTodayArticles: async () => SAMPLE_ARTICLES };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    let notifyCallCount = 0;
    const notifier: SlackNotifier = {
      notify: async () => {
        notifyCallCount += 1;
      },
    };
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });
    const job = makeJob({ id: 'dedupe-job' });

    const first = await processor.process(job);
    const second = await processor.process(job);

    expect(first).toEqual({ outcome: 'completed' });
    expect(second).toEqual({ outcome: 'completed' });
    expect(notifyCallCount).toBe(1);
  });

  it('서로 다른 job.id는 독립적으로 각자 notifier를 1회씩 호출한다', async () => {
    const newsSource: NewsSource = { fetchTodayArticles: async () => SAMPLE_ARTICLES };
    const builder: NewsDigestBuilder = { buildGroupedDigest: async () => SAMPLE_GROUPS };
    let notifyCallCount = 0;
    const notifier: SlackNotifier = {
      notify: async () => {
        notifyCallCount += 1;
      },
    };
    const processor = new NewsDigestJobProcessor({
      newsSource,
      builder,
      notifier,
      ledger: makeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });

    const first = await processor.process(makeJob({ id: 'job-a' }));
    const second = await processor.process(makeJob({ id: 'job-b' }));

    expect(first).toEqual({ outcome: 'completed' });
    expect(second).toEqual({ outcome: 'completed' });
    expect(notifyCallCount).toBe(2);
  });
});
