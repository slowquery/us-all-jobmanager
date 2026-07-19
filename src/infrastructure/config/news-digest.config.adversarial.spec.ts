import { readNewsDigestConfig } from './news-digest.config';

/**
 * QA/red-team adversarial spec for `readNewsDigestConfig`의 게이팅 안전성.
 *
 * 목표: `NEWS_DIGEST_ENABLED=true`이더라도 필수 비밀(Gemini API key, Slack webhook URL) 중
 * 하나라도 없으면 `enabled`가 반드시 `false`로 떨어지는지 각 조합에 대해 검증한다. 실제
 * `process.env`를 건드리지 않고 매 케이스마다 독립된 env 객체를 주입한다. 기존 스펙 파일은
 * 수정하지 않는다.
 */

describe('QA red-team: readNewsDigestConfig 비밀 누락 게이팅', () => {
  it('플래그 true + Gemini key만 있고 Slack webhook이 없으면 enabled=false', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true',
      GEMINI_API_KEY: 'gemini-secret',
      SLACK_WEBHOOK_URL: '',
    });
    expect(config.enabled).toBe(false);
  });

  it('플래그 true + Slack webhook만 있고 Gemini key가 없으면 enabled=false', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true',
      GEMINI_API_KEY: '',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });
    expect(config.enabled).toBe(false);
  });

  it('플래그 true + 두 비밀 모두 공백만 있는 문자열이면 trim 후에도 enabled=false', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true',
      GEMINI_API_KEY: '   ',
      SLACK_WEBHOOK_URL: '   ',
    });
    expect(config.enabled).toBe(false);
  });

  it('플래그가 없고(undefined) 두 비밀이 모두 있어도 enabled=false(명시적 opt-in 필수)', () => {
    const config = readNewsDigestConfig({
      GEMINI_API_KEY: 'gemini-secret',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });
    expect(config.enabled).toBe(false);
  });

  it('플래그가 "TRUE"(대소문자 변형)이고 두 비밀이 모두 있으면 enabled=true(회귀 대조)', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'TRUE',
      GEMINI_API_KEY: 'gemini-secret',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });
    expect(config.enabled).toBe(true);
  });

  it('플래그가 "true "처럼 트레일링 공백을 포함해도 정상 파싱되어 enabled=true(회귀 대조)', () => {
    const config = readNewsDigestConfig({
      NEWS_DIGEST_ENABLED: 'true ',
      GEMINI_API_KEY: 'gemini-secret',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.test/webhook',
    });
    expect(config.enabled).toBe(true);
  });
});
