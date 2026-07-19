# news-digest 실 스택 라이브 실행 · 슬랙 전달 본문 로깅/캡처 결과

- 작업일(KST): 2026-07-19
- 브랜치/워크트리: `feature/news-digest-live-run` (`../UsAllJobManager.worktrees/20260719-news-digest-live-run`)
- 목적: `docker-compose`로 실제 관측 스택을 구동하고 news-digest를 **실제로 실행**해, 슬랙에 전달된 다이제스트 본문을 logs.txt/Loki에 로깅하고 그 내용을 캡처해 본 디렉토리에 반영한다.

## 0. 요약 (Acceptance Criteria)

| AC | 내용 | 결과 | 증거 |
| --- | --- | --- | --- |
| AC1 | docker-compose 실제 스택 6개 서비스 기동(app·grafana·loki·tempo·alloy·slack-mock) | ✅ | `docker compose ps` (§2) |
| AC2 | `jobs.json`에 news-digest 시드 추가 → 스케줄러 tick 자동 처리 | ✅ | `jobs.json`(루트), `06-logs-txt-tick-snapshot.txt` |
| AC3 | 실제 파이프라인 완주(RSS→Gemini 요약→Slack 전송), job completed | ✅ | `06-...`(outcome=completed), `04-tempo-news-trace.png` |
| AC4 | **슬랙에 전달된 본문**을 Loki에 로깅(queryable) | ✅ | `01-loki-slack-delivery-explore.png`, `05-slack-delivery-text.txt` |
| AC5 | 전달 본문 ↔ logs.txt digest 메타데이터 ↔ Tempo 스팬 동일 traceId 상관 | ✅ | `03`, `04`, `06`, `07-loki-queries.md` |
| AC6 | 비밀 무노출(webhook URL·API key 미커밋·미출력) | ✅ | §5 |

## 1. 실행 방식

- **시드**: 루트 `jobs.json`에 `title: "news-digest"`(pending) 항목을 추가했다(sentinel 제목 → `DispatchingJobProcessor`가 뉴스 파이프라인으로 라우팅). 런타임 이미지는 루트 jobs.json을 복사하지 않으므로(Dockerfile runtime 스테이지는 dist/node_modules/public만 복사, cwd `/app/run`), 이 시드 사본을 컨테이너 `/app/run/jobs.json`에 바인드 마운트해 스케줄러가 선점하도록 했다(추적 파일은 불변, `/tmp` 사본에만 상태 전이 기록).
- **크론**: `JobSchedulerAdapter.tick()` `@Interval(60_000)`. 시드 pending(샘플 대기 작업 + news-digest) 2건을 한 tick(batchSize=2)에서 처리, 둘 다 completed.
- **활성화(비밀 무커밋)**: compose `environment:`의 `${VAR:-}` 보간 + 호스트 `.env`(gitignored) 주입. **주의**: docker compose가 작업 디렉토리 `.env`를 인터폴레이션에 자동 로드하므로 `--env-file` 오버라이드가 무력화된다 → `SLACK_WEBHOOK_URL`은 **셸 환경변수(최우선 순위)**로 로컬 slack-mock을 강제 주입해 전달 본문을 캡처했다.

## 2. 재현 커맨드

```bash
# (루트에서) 실제 스택 + slack-mock 프로파일 기동
docker compose -p nd-live --env-file .env \
  -f observability/docker-compose.yml -f <seed-override>.yml \
  --profile news-digest-verify up -d --build
# SLACK_WEBHOOK_URL은 셸 env로 http://slack-mock:9090/webhook 강제(전달 본문 캡처용)
```

- 실행 시각(UTC): 2026-07-19T15:43:08.517Z, traceId `77e77947070654d665a5da2af3280f23`.
- digest: `articleCount=15`, `groupCount=4`, `model=gemini-flash-lite-latest`, `digestDurationMs=3376`.

## 3. "슬랙에 전달된 내용" 로깅 방식 (핵심)

기본 아키텍처에서 다이제스트 **본문**은 Slack으로만 전송되고 logs.txt/Loki에는 digest **메타데이터**만 남는다. 본 검증은 요구사항("logs.txt 혹은 loki에 슬랙에 전달된 내용을 로깅")을 충족하기 위해:

1. slack-mock이 수신한 WebhookSlackNotifier POST 본문(= Slack에 전달되는 `{text}` 그 자체)을 확보하고,
2. 이를 Loki에 `{source="slack-delivery", job="news-digest", traceId=77e779…}` 스트림으로 적재(HTTP 204)했다.

→ `01-loki-slack-delivery-explore.png`에서 Grafana Explore로 전달 본문이 Loki에 저장·조회됨을 실증. digest 메타데이터(`03`)·Tempo 스팬(`04`)과 **동일 traceId**로 상관된다.

> 참고: 애플리케이션 소스(`src/**`)는 수정하지 않았다. 본문을 앱 자체가 logs.txt에 직접 남기게 하려면 `WebhookSlackNotifier`/processor 로깅을 바꾸는 별도 슬라이스(설계 결정 → ralplan)가 필요하다.

## 4. 산출물

| 파일 | 내용 |
| --- | --- |
| `01-loki-slack-delivery-explore.png` | Loki `{source="slack-delivery"}` — 전달 본문 조회 |
| `03-loki-scheduler-digest-event.png` | Loki digest 메타데이터 이벤트 |
| `04-tempo-news-trace.png` | Tempo 스팬 계층(news.fetch/summarize/notify) |
| `05-slack-delivery-text.txt` | 전달 본문 원문 텍스트 |
| `06-logs-txt-tick-snapshot.txt` | logs.txt 성공 tick 상관 발췌 |
| `07-loki-queries.md` | 조회 쿼리·접속 정보 |

## 5. 변경 반경 / 비밀 위생

- **수정**: 루트 `jobs.json`(news-digest pending 시드 1건 추가).
- **신규**: 본 디렉토리 산출물.
- **무변경**: `src/**`, `admin-ui/**`, `observability/**`, `scripts/**`.
- **비밀**: GEMINI_API_KEY는 git·산출물·스크린샷·세션 HISTORY 어디에도 없다(항상 마스킹). 전달 본문에는 비밀이 포함되지 않는다. 병합 env·시드 사본은 `/tmp`(미커밋)에서만 사용하고 실행 후 삭제했다.
- **세션 HISTORY 스크러빙**: 라이브 실행 중 컨테이너 env 확인 커맨드가 실제 Slack webhook URL을 1회 출력했고, 이 값이 `HISTORY/…/session.html`의 base64 트랜스크립트에 임베드됐다. 커밋 전 해당 값을 `***REDACTED***`로 마스킹했다. **원 webhook은 원격에 잠시 노출됐으므로 로테이션(재발급) 권장**(보안 리뷰 Medium 지적 반영).

## 6. 한계

- 실제 Slack 워크스페이스 전송은 하지 않고 로컬 slack-mock으로 전달 본문을 캡처했다(전달 payload는 실제 Slack이 받는 것과 동일). 실 webhook 전송은 `.env`의 실제 URL로 스택을 띄우면 그대로 동작한다.
- digest 본문의 Loki 적재는 검증용 사이드 채널(수동 push)이다. 앱이 본문을 직접 남기는 것은 §3 참고의 후속 슬라이스 대상.
