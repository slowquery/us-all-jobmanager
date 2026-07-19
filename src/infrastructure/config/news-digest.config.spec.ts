import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAX_HEADLINES,
  DEFAULT_NEWS_DIGEST_JOB_TITLE,
  DEFAULT_NEWS_DIGEST_TIMEOUT_MS,
  DEFAULT_NEWS_FEED_URL,
  readNewsDigestConfig,
} from './news-digest.config';

describe('readNewsDigestConfig', () => {
  it('플래그·비밀이 모두 없으면 enabled=false이고 전 항목 기본값을 사용한다', () => {
    const config = readNewsDigestConfig({});

    expect(config).toEqual({
      enabled: false,
      jobTitle: DEFAULT_NEWS_DIGEST_JOB_TITLE,
      newsFeedUrl: DEFAULT_NEWS_FEED_URL,
      maxHeadlines: DEFAULT_MAX_HEADLINES,
      geminiApiKey: '',
      geminiModel: DEFAULT_GEMINI_MODEL,
      slackWebhookUrl: '',
      timeoutMs: DEFAULT_NEWS_DIGEST_TIMEOUT_MS,
    });
  });

  it('플래그만 켜고 비밀이 없으면 enabled=false다', () => {
    const config = readNewsDigestConfig({ NEWS_DIGEST_ENABLED: 'true' });

    expect(config.enabled).toBe(false);
  });

  it('비밀(geminiApiKey·slackWebhookUrl)만 있고 플래그가 없으면 enabled=false다', () => {
    const config = readNewsDigestConfig({
      GEMINI_API_KEY: 'gemini-key',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });

    expect(config.enabled).toBe(false);
  });

  it('geminiApiKey만 있고 slackWebhookUrl이 없으면 enabled=false다', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true',
      GEMINI_API_KEY: 'gemini-key',
    });

    expect(config.enabled).toBe(false);
  });

  it('slackWebhookUrl만 있고 geminiApiKey가 없으면 enabled=false다', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });

    expect(config.enabled).toBe(false);
  });

  it('플래그(대소문자 무관)와 두 비밀이 모두 있으면 enabled=true다', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'TRUE',
      GEMINI_API_KEY: 'gemini-key',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });

    expect(config.enabled).toBe(true);
    expect(config.geminiApiKey).toBe('gemini-key');
    expect(config.slackWebhookUrl).toBe('https://hooks.slack.test/webhook');
  });

  it('커스텀 env 값을 그대로 반영한다', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true',
      GEMINI_API_KEY: 'gemini-key',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
      NEWS_DIGEST_JOB_TITLE: 'custom-title',
      NEWS_FEED_URL: 'https://example.test/feed.rss',
      NEWS_DIGEST_MAX_HEADLINES: '7',
      GEMINI_MODEL: 'gemini-2.0-pro',
      NEWS_DIGEST_TIMEOUT_MS: '5000',
    });

    expect(config).toEqual({
      enabled: true,
      jobTitle: 'custom-title',
      newsFeedUrl: 'https://example.test/feed.rss',
      maxHeadlines: 7,
      geminiApiKey: 'gemini-key',
      geminiModel: 'gemini-2.0-pro',
      slackWebhookUrl: 'https://hooks.slack.test/webhook',
      timeoutMs: 5000,
    });
  });

  it('잘못된 숫자 env(비수치·음수·0)는 기본값으로 폴백한다', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_MAX_HEADLINES: 'not-a-number',
      NEWS_DIGEST_TIMEOUT_MS: '-100',
    });

    expect(config.maxHeadlines).toBe(DEFAULT_MAX_HEADLINES);
    expect(config.timeoutMs).toBe(DEFAULT_NEWS_DIGEST_TIMEOUT_MS);
  });

  it('jobTitle sentinel: 미지정 시 DEFAULT_NEWS_DIGEST_JOB_TITLE(news-digest)로 라우팅 sentinel을 유지한다', () => {
    const config = readNewsDigestConfig({});

    expect(config.jobTitle).toBe('news-digest');
    expect(config.jobTitle).toBe(DEFAULT_NEWS_DIGEST_JOB_TITLE);
  });
});
