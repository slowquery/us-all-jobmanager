# news-digest 검증에 사용한 쿼리 (LogQL / TraceQL)

Grafana(http://localhost:3000, 익명 Viewer / Explore는 admin·admin basic auth) 기준.

## Loki (LogQL)

### digest 이벤트(성공/실패) — 04-loki-digest-event.png
```logql
{source="scheduler"} |= `news digest` | json outcome, digestDurationMs, articleCount, groupCount, model, errorCode
```
- 결과: `outcome=completed`(model=gemini-flash-lite-latest, articleCount=15, groupCount=4, digestDurationMs=3394) / `outcome=failed`(model=gemini-1.5-flash, groupCount=0).
- **주의**: `type="digest"` 필터는 **미동작** — `FileLoggerAdapter`가 `type` discriminator를 로그 라인에서 제외한다. digest 이벤트는 `model`/`groupCount` 필드 존재 또는 메시지(`|= "news digest"`)로 식별.

### digest 실패 에러 로그
```logql
{source="scheduler"} | json | errorCode=`NEWS_DIGEST_FAILED`
```
- 실패 시 job id + errorCode만 기록(원인 텍스트는 미기록 — processor catch 한계).

### 집계(outcome별)
```logql
sum by (outcome, model) (count_over_time({source="scheduler"} | json | model=~`gemini.+` [30m]))
```

## Tempo (TraceQL)

### news-digest 성공 트레이스 — 05-tempo-trace-news-spans.png
```traceql
1a723beaa6959ac46385b5bee7e2c845
```
또는 스팬명 검색:
```traceql
{ name="news.summarize" }
{ name="news.notify" }
```
- 계층: `scheduler.tick` → `scheduler.process-job` → `news.fetch`(news.article_count=15) / `news.summarize`(news.model=gemini-flash-lite-latest, news.group_count=4) / `news.notify`. 5 spans.

## logs.txt (컨테이너 cwd=/app/run)

```bash
docker compose -f observability/docker-compose.yml exec app sh -c 'tail -n 200 logs.txt'
```
- 크론(tick) 로그 상관 발췌: tick end 라인의 `traceId` → 동일 `traceId` 의 digest/transition 라인. tick start 라인은 `tickId`로 매칭(withSpan 이전 기록이라 fallback traceId). 결과는 `logs-txt-snapshot.txt`.

## slack-mock (결과 문구)

```bash
docker compose -f observability/docker-compose.yml logs slack-mock
```
- WebhookSlackNotifier가 POST한 `{text}`(다이제스트 결과 문구)를 stdout에 기록. 결과는 `07-slack-mock-digest-text.txt`.

## Gemini 진단(문제 해결용)

```bash
# 모델 가용성/키 유효성 확인(컨테이너 내부, 키 마스킹)
docker compose exec app node -e '기존 model generateContent 호출 → HTTP status 확인'
# 404 models/... not found → 폐기 모델. ListModels(HTTP 200)로 가용 모델 목록 확인.
```
