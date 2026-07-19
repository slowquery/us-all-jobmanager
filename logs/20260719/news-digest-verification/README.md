# news-digest 관리자 등록·실행·관측 검증 결과

- 작업일(KST): 2026-07-19
- 브랜치/워크트리: `feature/observability-verification` (`../UsAllJobManager-observability-verification`) — 관측성 검증 PR #7에 증분
- 승인 계획: ralplan pending-approval.md (run 019f7995-91b3-7000-9dca-779b1b9f50ca) — 옵션 A(실제 GEMINI_API_KEY + 로컬 slack-mock)
- 대상: 이전 세션 머지된 news-digest 기능(sentinel 제목 라우팅 + Gemini 그룹 요약 + Slack 전송)

## 0. 요약 (Acceptance Criteria)

| AC | 내용 | 결과 | 증거 |
| --- | --- | --- | --- |
| AC1 | 관리자 페이지에서 news-digest 등록 | ✅ | `01-admin-create-dialog.png`, `02-admin-job-registered.png` |
| AC2 | 크론(tick) 처리·상태 전이 | ✅ | `03-admin-job-completed.png`, `logs-txt-snapshot.txt` |
| AC3 | Loki digest 이벤트(메타데이터) | ✅ | `04-loki-digest-event.png`, `queries.md` |
| AC4 | Tempo news.* 스팬 계층 | ✅ | `05-tempo-trace-news-spans.png`, `queries.md` |
| AC5 | 결과 문구(다이제스트 텍스트) 캡처 | ✅ | `07-slack-mock-digest-text.txt` |
| AC6 | logs.txt 크론(tick) 로그 스냅샷 | ✅ | `logs-txt-snapshot.txt` |
| AC7 | 문서·비밀 무노출 | ✅ | 본 문서 + grep 검수 |
| AC8 | src/**·admin-ui/** 무변경(.dockerignore 예외) | ✅ | §5 |
| AC9 | PR #7 반영·범위 갱신 | 진행(PR 단계) | — |

> **검증 중 런타임 결함 2건 발견·해결**(troubleshooting §4): (1) `.env`의 `GEMINI_MODEL=gemini-1.5-flash`가 폐기되어 Gemini 404 → 가용 모델 `gemini-flash-lite-latest`로 오버라이드, (2) Loki 쿼리 `type="digest"`는 미매칭(FileLoggerAdapter가 `type` discriminator를 로그 라인에서 제외) → 필드 존재 기반 쿼리로 정정.

## 1. 등록 방식과 크론

- **등록**: 관리자 페이지(`http://localhost:8080/admin/`)의 `new-job-btn`("새 작업") → CreateJobDialog의 `create-title-input`에 제목 `news-digest` 입력 → `create-submit-btn`("생성")으로 `POST /jobs`. sentinel 제목(`NEWS_DIGEST_JOB_TITLE=news-digest`)과 일치하는 job만 뉴스 파이프라인으로 라우팅된다(`DispatchingJobProcessor`).
- **크론**: `JobSchedulerAdapter.tick()`에 `@Interval(60_000)`. 60초마다 pending job을 조회·처리한다. 등록 후 다음 tick(≤60초)에 실행되며, tick 로그(`phase` start/end, `source=scheduler`)가 logs.txt에 남는 것이 "크론 실행 로그"다.

## 2. 활성화 (비밀 무커밋)

앱 컨테이너는 `.env`를 포함하지 않으므로, compose `environment:`에 `${VAR:-}` 보간을 추가하고 값은 **호스트 env로만** 주입한다(리터럴 커밋 금지, PUBLIC repo). 메인 체크아웃의 gitignored `.env`를 안전 파싱(`&` 포함 값의 shell 해석 방지)해 병합 env 파일(`/tmp`, 미커밋)을 만들고 `docker compose --env-file`로 전달했다.

사용 env(비밀 마스킹):

| 키 | 값 |
| --- | --- |
| `NEWS_DIGEST_ENABLED` | `true` (오버라이드; .env 원본은 false) |
| `GEMINI_API_KEY` | `SET(len=53, 마스킹)` — .env의 실제 키(유효) |
| `GEMINI_MODEL` | `gemini-flash-lite-latest` (**오버라이드**; .env 원본 `gemini-1.5-flash`는 폐기됨 → §4) |
| `SLACK_WEBHOOK_URL` | `http://slack-mock:9090/webhook` (로컬 mock 오버라이드; .env의 실제 Slack 미사용) |
| `NEWS_DIGEST_TIMEOUT_MS` | `30000` (오버라이드; 기본 10s는 Gemini 지연 시 오탐 위험) |
| `NEWS_FEED_URL` | 구글 뉴스(한국) RSS(키 불필요) |

추가로 `.dockerignore`에 `.env`/`.env.*`를 넣어 `--build` 시 루트 .env가 build 스테이지 이미지 레이어에 박제되는 위생 구멍을 차단했다.

## 3. 실행 실증

- **등록**: `01`(생성 다이얼로그, 제목 news-digest) → `02`(목록에 Pending 등록, 토스트 "작업이 생성되었습니다").
- **크론 처리**: 첫 등록 job은 다음 tick에서 **failed**(폐기 모델 404, §4 문제 1) → GEMINI_MODEL 오버라이드 후 **동일 방식으로 재등록**한 news-digest job이 다음 tick에 **completed** 전이(`03`은 Failed 18:31:32 + Completed 18:34:21 두 job을 함께 표시). 성공 job의 logs.txt digest 이벤트: `outcome=completed`, `articleCount=15`, `groupCount=4`, `model=gemini-flash-lite-latest`, `digestDurationMs=3394`.
- **결과 문구**: slack-mock이 다이제스트 텍스트를 수신(`07-slack-mock-digest-text.txt`) — "📰 오늘의 뉴스 다이제스트 [news-digest] — 주제 4개"(재난/기상, 정치, 국제 정세, 경제/산업 4개 그룹 + 각 요약·헤드라인). **주의(아키텍처 사실)**: 결과 문구는 Slack(mock)으로 전송되고 Loki에는 digest 메타데이터만 남는다.
- **Loki**(`04`): `{source="scheduler"} |= "news digest" | json` — completed(gemini-flash-lite-latest)·failed(gemini-1.5-flash) digest 이벤트와 필드(articleCount/groupCount/model/outcome).
- **Tempo**(`05`): trace `1a723bea…` — `scheduler.tick`(3.4s) → `scheduler.process-job` → `news.fetch`(200ms, article_count=15) / `news.summarize`(3.19s, model=gemini-flash-lite-latest, group_count=4) / `news.notify`(3.28ms). 5 spans 계층.
- **logs.txt 크론 스냅샷**(`logs-txt-snapshot.txt`): 성공 tick(tickId `83e26623…`, traceId `1a723bea…`)의 `tick start → news digest completed → tick end → transition committed(processing→completed) → tick completed` 5라인 상관 발췌. 상관 절차: **tick end 라인의 traceId → 동일 traceId digest/transition 라인**(tick start 라인은 withSpan 이전 기록이라 fallback traceId, tickId로 매칭).

## 4. 문제 해결 (troubleshooting)

### 문제 1 — Gemini 404 (폐기된 모델), news-digest 첫 실행 failed
- **증상**: 첫 등록 job이 tick에서 즉시 **failed**. logs.txt digest 이벤트 `outcome=failed, articleCount=15, groupCount=0, digestDurationMs=425`(RSS는 성공, Gemini 단계 실패). slack-mock 미수신.
- **원인**: 컨테이너에서 Gemini API를 직접 호출해 확인 → **HTTP 404 `models/gemini-1.5-flash is not found for API version v1beta`**. `.env`의 `GEMINI_MODEL=gemini-1.5-flash`가 Google에서 폐기됨. **키 자체는 유효**(404 model-not-found이지 401/403 아님; ListModels는 HTTP 200).
- **조치**: `GEMINI_MODEL`을 가용 모델 `gemini-flash-lite-latest`(앱 기본값, ListModels 확인)로 오버라이드 후 app 재생성. 소스 무침투(env 오버라이드만, 모델명은 비밀 아님).
- **재검증**: Gemini 직접 호출 HTTP 200. 신규 news-digest job → **completed**(groupCount=4), slack-mock 결과 문구 수신.

### 문제 2 — Loki `type="digest"` 쿼리 미매칭
- **증상**: `{source="scheduler"} | json | type="digest"` → No logs found.
- **원인**: `FileLoggerAdapter`가 LogEvent 유니온의 `type` discriminator를 직렬화 시 로그 라인에서 **제외**한다(설계 확정). 로그 라인에 `type` 필드가 없다.
- **조치**: 필드 존재/메시지 기반 쿼리로 정정 — `{source="scheduler"} |= "news digest" | json`(또는 `| json | model=~"gemini.+"`). digest 이벤트는 `model`·`groupCount` 필드 존재로 식별.

## 5. 변경 반경 (AC8)

- **신규**: `scripts/slack-mock-catcher.mjs`, `logs/20260719/news-digest-verification/*`.
- **수정**: `observability/docker-compose.yml`(app env 보간 + slack-mock 서비스, profile 게이팅, 비밀 리터럴 없음), `.dockerignore`(`.env`/`.env.*` 추가 — 빌드 메타).
- **무변경**: `src/**`, `admin-ui/**` 전체. 기존 관측성 검증 산출물 불변.

## 6. 비밀 위생 (AC7)

- 비밀(GEMINI_API_KEY·실제 Slack webhook)은 git·compose·산출물·스크린샷 어디에도 없다. compose는 `${VAR:-}` 보간만 커밋. 값은 호스트 env(병합 파일 `/tmp`, 미커밋)로만 주입.
- 활성 확인도 값 미출력(`enabled` 한 단어). 산출물 grep 검수: `AIza|AQ\.|hooks.slack.com` **무검출**.
- `.dockerignore` 반영으로 이미지 레이어 박제 차단.

## 7. 한계 / 후속

- 결과 문구는 Slack(mock)에만 존재, Loki는 digest 메타데이터만(아키텍처). 실제 Slack 검증은 실 webhook 제공 시 가능.
- `.env`의 `GEMINI_MODEL`이 폐기된 값(gemini-1.5-flash)으로 남아 있다 — 사용자 `.env`(메인 체크아웃) 갱신 권장(본 검증은 런타임 오버라이드로 우회, .env 미수정).
- news-digest 실패 경로는 원인 텍스트를 로그/스팬에 남기지 않는다(processor catch가 원인 삼킴) — 개선은 별도 슬라이스(옵션 C 계열).
- digest 이벤트 식별이 로그 메시지 substring/필드 존재(`model`·`groupCount`)에 의존한다 — `FileLoggerAdapter`가 `type` discriminator를 제외하므로 로그 문구가 사실상 LogQL 계약이 된다. 안정 `event` 필드 추가는 대시보드/쿼리 내구성 개선용 후속 슬라이스(범위 외, 기존 src).
