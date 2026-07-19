import { WebhookSlackNotifier } from './webhook-slack-notifier';

/** 테스트용 fake fetch 응답을 만든다. */
function fakeResponse(opts: { ok: boolean; status?: number }): Response {
  return {
    ok: opts.ok,
    status: opts.status ?? (opts.ok ? 200 : 500),
  } as unknown as Response;
}

describe('WebhookSlackNotifier', () => {
  it('webhookUrl로 POST하며 body에 text를 JSON으로 담는다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({ ok: true }));
    const notifier = new WebhookSlackNotifier('https://hooks.slack.example/T000/B000', fetchImpl);
    const { signal } = new AbortController();

    await notifier.notify('오늘의 키워드: 경제, 금리', signal);

    expect(fetchImpl).toHaveBeenCalledWith('https://hooks.slack.example/T000/B000', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '오늘의 키워드: 경제, 금리' }),
      signal,
    });
  });

  it('HTTP 응답이 비정상이면 예외를 던진다', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(fakeResponse({
      ok: false,
      status: 404,
    }));
    const notifier = new WebhookSlackNotifier('https://hooks.slack.example/T000/B000', fetchImpl);

    await expect(notifier.notify('텍스트', new AbortController().signal)).rejects.toThrow();
  });
});
