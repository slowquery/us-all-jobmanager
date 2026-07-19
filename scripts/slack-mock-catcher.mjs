// slack-mock-catcher.mjs — news-digest 검증용 로컬 Slack Incoming Webhook 목(mock) 수신기.
//
// 목적: WebhookSlackNotifier가 POST하는 `{ text }` 본문(= 뉴스 다이제스트 "결과 문구")을 캡처한다.
//   실제 Slack 워크스페이스 없이 파이프라인의 news.notify 단계를 완주시키고 결과 문구를 증거로 남긴다.
//
// 필수 계약(MUST-3): 모든 요청에 **즉시 200 OK**를 응답한다. 지연/비200 응답 시
//   WebhookSlackNotifier가 예외를 던져 NewsDigestJobProcessor가 outcome=failed로 오탐 처리한다.
//
// 의존성 0(node 내장 http만). 수신 본문은 stdout(주 증거 채널: `docker compose logs slack-mock`)과
//   보조 파일(/srv/out/slack-mock.log, 볼륨 없으면 무시)에 기록한다. 비밀(webhook URL·API key)은
//   본문에 담기지 않으므로 로그하지 않는다 — 기록 대상은 다이제스트 텍스트뿐이다.

import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';

const PORT = Number(process.env.SLACK_MOCK_PORT ?? 9090);
const OUT_FILE = process.env.SLACK_MOCK_OUT ?? '/srv/out/slack-mock.log';

/** 수신 본문에서 Slack 메시지 텍스트를 추출한다(JSON 파싱 실패 시 원문 반환). */
function extractText(raw) {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.text === 'string' ? parsed.text : raw;
  } catch {
    return raw;
  }
}

const server = createServer((req, res) => {
  // 계약(MUST-3): body 수신 여부와 무관하게 **즉시** 200을 응답한다. 응답을 req 스트림 종료
  // 콜백에 두면 느린/끊긴 업로드에서 응답이 지연·누락돼 WebhookSlackNotifier가 오탐(throw)할 수
  // 있으므로, 핸들러 진입 즉시 응답을 완료한다. 본문은 이후 로깅용으로만 비동기 수집한다.
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');

  if (req.method !== 'POST') {
    req.resume(); // 본문 드레인(소켓 정체 방지)
    return;
  }

  const chunks = [];
  // 소켓 오류로 'end'가 발화하지 못해도 커넥션이 무한 대기하지 않도록 에러를 흡수한다.
  req.on('error', () => {});
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const text = extractText(raw);
    const at = new Date().toISOString();
    // req.url은 이 목(mock)의 고정 내부 경로(/webhook, 토큰 없음)만 들어오므로 그대로 기록한다.
    const line = `\n===== slack-mock 수신 @ ${at} (${req.url}) =====\n${text}\n===== end =====`;
    // stdout(주 증거)
    process.stdout.write(line + '\n');
    // 보조 파일(볼륨 미마운트 시 조용히 무시)
    appendFile(OUT_FILE, line + '\n').catch(() => {});
  });
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(`slack-mock-catcher 기동: 0.0.0.0:${PORT} (모든 요청 즉시 200 OK)\n`);
});
