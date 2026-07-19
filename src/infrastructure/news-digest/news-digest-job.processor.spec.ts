import { makeJob } from '../../application/testing/job.fixture';
import { LogEvent, LoggerPort } from '../../application/ports/logger.port';
import {
  DeliveryLedger,
  DigestGroup,
  NewsArticle,
  NewsDigestBuilder,
  NewsSource,
  SlackNotifier,
} from './news-digest.ports';
import { NewsDigestJobProcessor } from './news-digest-job.processor';

const DEFAULT_ARTICLES: NewsArticle[] = [
  {
    title: '헤드라인1',
    snippet: '요약1',
    link: 'https://example.com/1',
  },
  {
    title: '헤드라인2',
    snippet: '요약2',
    link: 'https://example.com/2',
  },
];

const DEFAULT_GROUPS: DigestGroup[] = [
  {
    topic: '경제',
    summary: '금리 인상 이슈',
    headlines: ['헤드라인1'],
  },
  {
    topic: 'IT',
    summary: 'AI 발표',
    headlines: ['헤드라인2'],
  },
];

/** 테스트용 fake `NewsSource`. */
class FakeNewsSource implements NewsSource {
  constructor(
    private readonly articles: NewsArticle[] = DEFAULT_ARTICLES,
    private readonly shouldThrow = false,
  ) {}

  async fetchTodayArticles(): Promise<NewsArticle[]> {
    if (this.shouldThrow) throw new Error('news source 오류');
    return this.articles;
  }
}

/** 테스트용 fake `NewsDigestBuilder`. */
class FakeBuilder implements NewsDigestBuilder {
  constructor(
    private readonly groups: DigestGroup[] = DEFAULT_GROUPS,
    private readonly shouldThrow = false,
  ) {}

  async buildGroupedDigest(): Promise<DigestGroup[]> {
    if (this.shouldThrow) throw new Error('builder 오류');
    return this.groups;
  }
}

/** 테스트용 fake `SlackNotifier`. 호출 텍스트를 기록한다. */
class FakeNotifier implements SlackNotifier {
  calls: string[] = [];
  constructor(private readonly shouldThrow = false) {}

  async notify(text: string): Promise<void> {
    if (this.shouldThrow) throw new Error('notifier 오류');
    this.calls.push(text);
  }
}

/** timeoutMs 안에 절대 자발적으로 끝나지 않고, abort 시에만 reject하는 fake notifier. */
class HangingNotifier implements SlackNotifier {
  async notify(_text: string, signal: AbortSignal): Promise<void> {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  }
}

/** 테스트용 in-memory fake `DeliveryLedger`. */
class FakeLedger implements DeliveryLedger {
  private readonly delivered = new Set<string>();
  wasDelivered(key: string): boolean {
    return this.delivered.has(key);
  }
  markDelivered(key: string): void {
    this.delivered.add(key);
  }
}

/** 테스트용 fake `LoggerPort`. 기록된 이벤트를 보관한다. */
class FakeLogger implements LoggerPort {
  events: LogEvent[] = [];
  log(event: LogEvent): void {
    this.events.push(event);
  }
}

describe('NewsDigestJobProcessor', () => {
  it('해피패스: completed를 반환하고 그룹 포맷 텍스트로 notifier를 1회 호출하며 markDelivered·digest 로그를 남긴다', async () => {
    const job = makeJob({
      id: 'job-1',
      title: '오늘의 뉴스',
    });
    const notifier = new FakeNotifier();
    const ledger = new FakeLedger();
    const logger = new FakeLogger();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(),
      builder: new FakeBuilder(),
      notifier,
      ledger,
      timeoutMs: 1000,
      model: 'gemini-test',
      logger,
    });

    const result = await processor.process(job);

    expect(result).toEqual({ outcome: 'completed' });
    expect(notifier.calls).toHaveLength(1);
    expect(notifier.calls[0]).toContain('경제');
    expect(notifier.calls[0]).toContain('IT');
    expect(notifier.calls[0]).toContain('금리 인상 이슈');
    expect(notifier.calls[0]).toContain('헤드라인1');
    expect(notifier.calls[0]).toContain('헤드라인2');
    expect(notifier.calls[0]).toContain('오늘의 뉴스');
    expect(ledger.wasDelivered('job-1')).toBe(true);
    expect(logger.events).toHaveLength(1);
    expect(logger.events[0]).toMatchObject({
      type: 'digest',
      level: 'info',
      source: 'scheduler',
      outcome: 'completed',
      articleCount: 2,
      groupCount: 2,
      model: 'gemini-test',
    });
  });

  it('newsSource가 throw해도 reject하지 않고 failed를 반환하며 digest+error 로그를 남긴다', async () => {
    const job = makeJob({ id: 'job-2' });
    const logger = new FakeLogger();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(undefined, true),
      builder: new FakeBuilder(),
      notifier: new FakeNotifier(),
      ledger: new FakeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
      logger,
    });

    const result = await processor.process(job);

    expect(result).toEqual({ outcome: 'failed' });
    expect(logger.events).toHaveLength(2);
    expect(logger.events[0]).toMatchObject({
      type: 'digest',
      outcome: 'failed',
      articleCount: 0,
      groupCount: 0,
    });
    expect(logger.events[1]).toMatchObject({
      type: 'error',
      errorCode: 'NEWS_DIGEST_FAILED',
    });
  });

  it('builder가 throw해도 reject하지 않고 failed를 반환하며 digest+error 로그를 남긴다', async () => {
    const job = makeJob({ id: 'job-3' });
    const logger = new FakeLogger();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(),
      builder: new FakeBuilder(undefined, true),
      notifier: new FakeNotifier(),
      ledger: new FakeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
      logger,
    });

    const result = await processor.process(job);

    expect(result).toEqual({ outcome: 'failed' });
    expect(logger.events).toHaveLength(2);
    expect(logger.events[0]).toMatchObject({
      type: 'digest',
      outcome: 'failed',
      articleCount: 2,
      groupCount: 0,
    });
    expect(logger.events[1]).toMatchObject({
      type: 'error',
      errorCode: 'NEWS_DIGEST_FAILED',
    });
  });

  it('notifier가 throw해도 reject하지 않고 failed를 반환하며 digest+error 로그를 남긴다', async () => {
    const job = makeJob({ id: 'job-4' });
    const logger = new FakeLogger();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(),
      builder: new FakeBuilder(),
      notifier: new FakeNotifier(true),
      ledger: new FakeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
      logger,
    });

    const result = await processor.process(job);

    expect(result).toEqual({ outcome: 'failed' });
    expect(logger.events).toHaveLength(2);
    expect(logger.events[0]).toMatchObject({
      type: 'digest',
      outcome: 'failed',
      articleCount: 2,
      groupCount: 2,
    });
    expect(logger.events[1]).toMatchObject({
      type: 'error',
      errorCode: 'NEWS_DIGEST_FAILED',
    });
  });

  it('logger가 undefined여도 실패 경로에서 throw하지 않는다', async () => {
    const job = makeJob({ id: 'job-4b' });
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(undefined, true),
      builder: new FakeBuilder(),
      notifier: new FakeNotifier(),
      ledger: new FakeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });

    await expect(processor.process(job)).resolves.toEqual({ outcome: 'failed' });
  });

  it('timeout: notifier가 매달려도 timeoutMs 안에 failed로 결말난다', async () => {
    const job = makeJob({ id: 'job-5' });
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(),
      builder: new FakeBuilder(),
      notifier: new HangingNotifier(),
      ledger: new FakeLedger(),
      timeoutMs: 10,
      model: 'gemini-test',
    });

    const started = Date.now();
    const result = await processor.process(job);
    const elapsedMs = Date.now() - started;

    expect(result).toEqual({ outcome: 'failed' });
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('dedupe: 동일 job.id로 두 번 처리하면 두 번째는 notifier를 추가 호출하지 않고 completed를 반환한다', async () => {
    const job = makeJob({ id: 'job-6' });
    const notifier = new FakeNotifier();
    const ledger = new FakeLedger();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(),
      builder: new FakeBuilder(),
      notifier,
      ledger,
      timeoutMs: 1000,
      model: 'gemini-test',
    });

    const first = await processor.process(job);
    const second = await processor.process(job);

    expect(first).toEqual({ outcome: 'completed' });
    expect(second).toEqual({ outcome: 'completed' });
    expect(notifier.calls).toHaveLength(1);
    expect(ledger.wasDelivered('job-6')).toBe(true);
  });

  it('빈 기사: fetchTodayArticles가 빈 배열을 반환하면 failed를 반환하고 notifier는 호출되지 않는다', async () => {
    const job = makeJob({ id: 'job-7' });
    const notifier = new FakeNotifier();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource([]),
      builder: new FakeBuilder(),
      notifier,
      ledger: new FakeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });

    const result = await processor.process(job);

    expect(result).toEqual({ outcome: 'failed' });
    expect(notifier.calls).toHaveLength(0);
  });

  it('빈 그룹: buildGroupedDigest가 빈 배열을 반환하면 failed를 반환하고 notifier는 호출되지 않는다', async () => {
    const job = makeJob({ id: 'job-8' });
    const notifier = new FakeNotifier();
    const processor = new NewsDigestJobProcessor({
      newsSource: new FakeNewsSource(),
      builder: new FakeBuilder([]),
      notifier,
      ledger: new FakeLedger(),
      timeoutMs: 1000,
      model: 'gemini-test',
    });

    const result = await processor.process(job);

    expect(result).toEqual({ outcome: 'failed' });
    expect(notifier.calls).toHaveLength(0);
  });
});
