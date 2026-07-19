# 라이브 스모크 테스트 결과 — 뉴스 다이제스트 Job (시나리오별)

- 실행일(KST): 20260719
- Session-name: concurrency-demo-job
- 실행자/에이전트: gjc
- 성격: **로컬 수동 스모크**(실제 Gemini/Slack 호출). CI 편입 아님. 프로덕션과 동일한 실제 컴포넌트
  (`HttpNewsSource`·`GeminiKeywordSummarizer`·`WebhookSlackNotifier`·`DispatchingJobProcessor`·
  `NewsDigestJobProcessor`)를 직접 구동해 시나리오를 검증. 하니스: `tmp/smoke-news-digest.ts`(gitignore).
- 비밀 취급: API key·webhook URL은 본 문서·로그에 절대 기록하지 않음(Slack host만 표기).

## 실행 환경(설정, 비밀 마스킹)

| 항목 | 값 |
|---|---|
| 뉴스 피드 | 구글 뉴스(한국) RSS |
| Gemini 모델 | `gemini-flash-lite-latest` (아래 "모델 이슈" 참조) |
| jobTitle sentinel | `news-digest` |
| maxHeadlines | 15 |
| timeoutMs | 10000 |
| Slack host | `hooks.slack.com` (webhook URL 마스킹) |
| Gemini key / Slack webhook | 존재함(값 비공개) |
| `.env`의 `NEWS_DIGEST_ENABLED` | **`false`** (아래 "주의" 참조) |

## 발견: Gemini 모델 이슈(수정함)

최초 스모크에서 뉴스 job이 실패(`failed`)했다. 진단 결과 **키는 유효(ListModels HTTP 200)** 하나
**설정 모델 `gemini-1.5-flash`가 은퇴되어 404**("models/gemini-1.5-flash is not found for API version
v1beta")였다. 사용 가능 모델을 실측 비교:

| 모델 | 결과 |
|---|---|
| `gemini-1.5-flash` | 404 NOT_FOUND (은퇴) |
| `gemini-2.5-flash` | 200이나 **thinking으로 10초+ → 파이프라인 timeout(10s) 초과 실패** |
| `gemini-2.0-flash` / `gemini-2.0-flash-lite` | 429 (해당 키 무료 티어 rate/quota 제한) |
| `gemini-2.5-flash-lite` | 404 (해당 키 미지원) |
| **`gemini-flash-lite-latest`** | **200, ~1s, 정상 키워드 반환** ✅ |

→ 코드 기본 모델을 `gemini-1.5-flash` → **`gemini-flash-lite-latest`**(무료·저지연)로 교체
(`news-digest.config.ts`의 `DEFAULT_GEMINI_MODEL`, `.env.example`). 모델 가용성은 키의 티어/쿼터에
좌우되므로 ListModels로 확인하는 지침도 문서화.

## 시나리오 결과(모델 교체 후 재실행)

| # | 시나리오 | 결과 | 근거 |
|---|---|---|---|
| **S1** | 뉴스 job(title=`news-digest`) → 실제 뉴스→Gemini→Slack | ✅ **completed (2.1s)** | 헤드라인 15건 fetch → Gemini 키워드 `[폭우, 재난, 국제정세, 정치, 갈등]` → **Slack 전송 성공(HTTP ok)**. 실제 메시지: `오늘의 뉴스 키워드 [news-digest]: 폭우, 재난, 국제정세, 정치, 갈등` |
| **S2** | 일반 job(title≠sentinel) → fallback | ✅ **completed** | `DispatchingJobProcessor`가 `DefaultJobProcessor`로 라우팅. 뉴스/Gemini/Slack 호출 **0건**(routing isolation 확인) |
| **S3** | dedupe: 동일 `job.id` 재처리 | ✅ **completed, 재전송 0** | S1 성공으로 원장 마킹됨 → Slack·Gemini 재호출 **0건**(dedupe 스킵 경로 실측). ※ 이 경로는 "전송 성공 후" 재처리 시에만 유효(defense-in-depth) |
| **S4** | 실패/timeout: 도달 불가 피드 + timeout 1.5s | ✅ **failed (1.5s), no-throw** | `process`가 reject하지 않고 `failed` 반환, `NEWS_DIGEST_FAILED` 로그 1건, Slack 미전송. timeout이 유계로 동작 |
| **S5** | config 게이팅 | ✅ | flag=true+비밀2개→`enabled=true`; 비밀 하나라도 없으면 `false`; flag 없으면 `false`. 현재 `.env`는 flag=false라 `enabled=false` |

- 총 실제 Slack 전송: **1건**(S1). S2/S3/S4는 설계대로 미전송.
- 오류 로그: S4의 `NEWS_DIGEST_FAILED` 1건뿐(정상 — 의도된 실패 시나리오).

## 주의 / 후속 안내

1. **서버로 실제 구동하려면**: 현재 `.env`의 `NEWS_DIGEST_ENABLED=false`라, `yarn start`로 띄우면 뉴스
   처리가 **배선되지 않는다**(기존 `DefaultJobProcessor`만 동작). 실제 스케줄러 경유(POST /jobs →
   60초 tick → Slack)로 켜려면 `.env`에서 `NEWS_DIGEST_ENABLED=true`로 바꾸고, `GEMINI_MODEL`을
   `gemini-1.5-flash`(은퇴) → `gemini-flash-lite-latest`로 교체 후 서버 재시작. (본 스모크는 프로세서를
   직접 구동해 `.env` 파일을 변경하지 않았다.)
2. **`gemini-2.5-flash` 회피**: thinking 지연으로 10초 timeout을 넘긴다. 저지연 lite 계열 권장.
   timeout을 늘리는(`NEWS_DIGEST_TIMEOUT_MS`) 대안도 있으나 tick 지연 관점에서 lite 모델이 안전.
3. **at-least-once**: S3는 "성공 후 동일 job 재처리"만 dedupe로 막는다. "전송 성공했으나 이후 실패
   판정된 재시도" 또는 "프로세스 재시작 후" 재처리는 중복 전송이 가능하다(설계상 수용, README §8.5).
4. **PUBLIC 레포 유의**: 실호출 데모의 런타임 데이터가 추적 파일(`jobs.json`)에 남지 않도록 본 스모크는
   저장소를 거치지 않고 프로세서만 구동했다. 서버로 실호출 시 커밋 전 `git diff` 검수 권장.

## 검증(회귀 없음)

모델 기본값 교체 후 전체 게이트 재실행: `yarn build` 0 · `yarn lint` 0 · 유닛+동시성 **208 tests(40 suites)** ·
e2e **18 tests** · 커버리지 **98.47/95.36/93.93/98.74**(임계 97/86/92/98, domain 100) 통과.
