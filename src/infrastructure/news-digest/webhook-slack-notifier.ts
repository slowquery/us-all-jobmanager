import { SlackNotifier } from './news-digest.ports';

/**
 * `SlackNotifier`의 Slack Incoming Webhook 구현체.
 */
export class WebhookSlackNotifier implements SlackNotifier {
  /**
   * @param webhookUrl Slack Incoming Webhook URL(비밀 값 — 하드코딩 금지, 호출부에서 환경변수로 주입)
   * @param fetchImpl 주입 가능한 fetch 구현체(테스트용 fake 대체, 기본값은 전역 fetch)
   */
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * 메시지를 Slack Webhook으로 전송한다. 응답이 비정상(`!res.ok`)이면 예외를 던져 상위
   * `NewsDigestJobProcessor`가 `{ outcome: 'failed' }`로 매핑하도록 한다.
   * @param text 전송할 텍스트
   * @param signal 상위 processor가 부과한 timeout/취소 신호
   */
  async notify(text: string, signal: AbortSignal): Promise<void> {
    const res = await this.fetchImpl(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    });
    if (!res.ok) {
      throw new Error(`Slack 알림 전송 실패: HTTP ${res.status}`);
    }
  }
}
