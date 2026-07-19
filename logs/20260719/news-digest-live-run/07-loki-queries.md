# Loki / Tempo 조회 쿼리 (news-digest 라이브 실행 증거)

실행 시각(UTC): 2026-07-19T15:43:08.517Z · 상관 traceId: `77e77947070654d665a5da2af3280f23`

## 1. 슬랙에 전달된 본문 (Loki) — `01-loki-slack-delivery-explore.png`

```logql
{source="slack-delivery"}
```

- WebhookSlackNotifier가 Slack Incoming Webhook으로 POST한 다이제스트 본문 그 자체를 Loki에 적재한 스트림.
- 라벨: `job=news-digest`, `outcome=completed`, `traceId=77e77947070654d665a5da2af3280f23`.
- 본문: "📰 오늘의 뉴스 다이제스트 [news-digest] — 주제 4개" + 4개 그룹(국내 사건/재난·정치/정책·국제 정세/분쟁·기상/경제)과 요약·헤드라인.

## 2. digest 메타데이터 이벤트 (Loki) — `03-loki-scheduler-digest-event.png`

```logql
{source="scheduler"} |= "news digest" | json
```

- `logs.txt`(NDJSON) → Alloy tail → Loki push 경로로 들어온 애플리케이션 원본 로그.
- 필드: `outcome=completed`, `articleCount=15`, `groupCount=4`, `model=gemini-flash-lite-latest`, `digestDurationMs=3376`.

## 3. 뉴스 파이프라인 트레이스 (Tempo) — `04-tempo-news-trace.png`

```traceql
77e77947070654d665a5da2af3280f23
```

- 스팬 계층(6 spans): `scheduler.tick` → `scheduler.process-job`(news-digest) → `news.fetch`(198ms) / `news.summarize`(3.17s, Gemini) / `news.notify`(6.82ms, Slack 전송).
- traceId가 1·2와 동일 → 로그(전달 본문·메타데이터) ↔ 트레이스 왕복 상관 실증.

## 접속

- Grafana: http://localhost:3000 (익명 뷰어 또는 admin/admin — Explore는 admin 권한 필요, 본 캡처는 HTTP Basic admin으로 접근)
- Loki push(전달 본문 적재)는 관측성 네트워크 내부에서 `POST http://loki:3100/loki/api/v1/push`(HTTP 204)로 수행.

> **주의(보안)**: `admin/admin`·익명 뷰어는 **로컬 검증 스택 전용** 기본값(`observability/docker-compose.yml`)입니다. 관측성 스택을 로컬 밖으로 노출할 때는 반드시 자격증명을 변경하세요.
