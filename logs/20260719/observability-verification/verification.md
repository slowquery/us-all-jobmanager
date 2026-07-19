# 관측성(Observability) 검증 결과 — SLO/평균 Latency 대시보드 + Tempo/Loki 실증

- 작업일(KST): 2026-07-19
- 세션명: observability-verification
- 브랜치/워크트리: `feature/observability-verification` (`../UsAllJobManager-observability-verification`)
- 승인 계획: ralplan `pending-approval.md` (run 019f78c3-5e5d-7000-9063-639036df478d) — 옵션 A(LogQL 정규화, 소스 무침투)
- 대상 스택: `observability/docker-compose.yml` (app · grafana · loki · tempo · alloy)

## 0. 요약 (Acceptance Criteria 충족 현황)

| AC | 내용 | 결과 | 증거 |
| --- | --- | --- | --- |
| AC1 | 스택 5개 서비스 running + 헬스체크 | ✅ | `01-compose-ps.txt` |
| AC2a | SLO 대시보드 P50/P99 6개 엔드포인트 실데이터 + 요청수 정확히 6행 | ✅ | `02`,`03`,`12` |
| AC2b | 엔드포인트별 실측 샘플 수 ≥100 | ✅ (전 엔드포인트 ≥120) | §3 표 |
| AC2c | 6 endpoint × route × 요청수 × P50/P99 교차표 + 원시 unwrap 대조 | ✅ | §3, §4 |
| AC3 | 평균 Latency 대시보드 전체/엔드포인트별 실데이터 | ✅ | `06-avg-latency-dashboard.png` |
| AC4 | Tempo: GET /jobs 트레이스 + scheduler.tick→process-job + derived field 왕복 | ✅ | `07`,`08`,`09` |
| AC5 | Loki: 6개 엔드포인트 필드 + level=error(404/400) | ✅ | `10`,`11` |
| AC6 | 가용성 100%(5xx 부재 기대값·한계 명문화) + 에러율 0구간 0% | ✅ | §5 |
| AC7 | 스크린샷↔AC↔쿼리 매핑표 + 정규화 JSON 원문 표 | ✅ | §6, §2 |
| AC8 | src/** 무변경, dashboards.yaml 무변경 | ✅ | §7 |
| AC9 | 워크트리 + 한글 커밋/PR + Rule6 3인 리뷰 + Rule7 CI | 진행(PR 단계) | — |

> 검증 과정에서 **런타임 결함 1건(스케줄러 백엔드 이미지 stale → DELETE 라우트 미등록)** 을 발견·해결했다. 상세는 `troubleshooting.md` 참조.

## 1. 스택 기동 · 헬스체크 (AC1)

```
docker compose -f observability/docker-compose.yml up -d --build
```

5개 서비스 모두 `Up`. 헬스체크: app `GET /jobs` → 200, grafana `/api/health` → 200, loki `/ready` → ready, tempo는 트레이스 수신·조회 정상(§4). 전체 출력은 `01-compose-ps.txt`.

> 참고: tempo `/ready` 엔드포인트가 "Ingester not ready: waiting for 15s after being ready" 문구를 반환하는 경우가 있으나, 이는 Tempo ingester의 준비 grace 메시지일 뿐 기능(트레이스 저장·TraceQL 조회)은 정상 동작함을 §4에서 실증했다.

## 2. per-endpoint 정규화 (옵션 A) — 라이브 Loki 검증 완료

Latency 원천은 Loki HTTP 요청 로그(`latencyMs`)뿐이다(Prometheus/Tempo metrics-generator 부재). `path`=`request.originalUrl`(파라미터·쿼리 포함)이므로 LogQL `label_format`로 라우트 6종 + `unmatched`(404 전용)로 정규화한다.

정규화 체인(`<EP_NORM>`, Explore 단계별 검증 후 확정):

```logql
{source="http"} | json method, path, statusCode, latencyMs
  | label_format path_stripped=`{{ regexReplaceAll "\\?.*$" .path "" }}`
  | label_format route=`{{ if eq .statusCode "404" }}unmatched{{ else if eq .path_stripped "/jobs" }}/jobs{{ else if eq .path_stripped "/jobs/search" }}/jobs/search{{ else }}/jobs/:id{{ end }}`
  | label_format endpoint=`{{ .method }} {{ .route }}`
```

엔드포인트 6종 격리 필터: `| method != "" | route != "unmatched"`
- `route != "unmatched"`: 404 라인 제외(빠른 404 latency의 분위수 오염 방지).
- `method != ""`: **저장소 락 이벤트(LockLogEvent) 제외.** 락 이벤트는 `source="http"`이지만 `method`가 없고 `path`에 job id를 담아 `/jobs/:id`로 접힌다 — 검증 중 실측으로 발견해 필터를 추가했다.

`regexReplaceAll`은 **인자형만** 사용한다(파이프형 `.path | regexReplaceAll`은 grafana/loki#10176로 미동작). 대시보드 JSON 삽입 시 백틱 정규식은 이중 이스케이프된다. **최종 JSON 원문**(SLO P50 패널):

```json
"quantile_over_time(0.50, {source=\"http\"} | json method, path, statusCode, latencyMs | label_format path_stripped=`{{ regexReplaceAll \"\\\\?.*$\" .path \"\" }}` | label_format route=`{{ if eq .statusCode \"404\" }}unmatched{{ else if eq .path_stripped \"/jobs\" }}/jobs{{ else if eq .path_stripped \"/jobs/search\" }}/jobs/search{{ else }}/jobs/:id{{ end }}` | label_format endpoint=`{{ .method }} {{ .route }}` | method != \"\" | route != \"unmatched\" | unwrap latencyMs [5m]) by (endpoint)"
```

## 3. 엔드포인트별 P50/P99/평균/샘플수 교차표 (AC2a/2b/2c)

트래픽 스크립트 `scripts/observability-traffic.sh 120`(라운드당 6엔드포인트, 404·400 주입, pending ≥3 잔류) 실행 후 1시간 창 실측:

| endpoint | 정규화 route | 요청수(1h) | P50(ms) | P99(ms) | 평균(ms) |
| --- | --- | ---: | ---: | ---: | ---: |
| `DELETE /jobs/:id` | `/jobs/:id` | 123 | 1.0 | 3.56 | 0.634 |
| `GET /jobs` | `/jobs` | 125 | 0.0 | 1.0 | 0.104 |
| `GET /jobs/:id` | `/jobs/:id` | 120 | 0.0 | 1.0 | 0.100 |
| `GET /jobs/search` | `/jobs/search` | 120 | 0.0 | 1.0 | 0.175 |
| `PATCH /jobs/:id` | `/jobs/:id` | 120 | 1.0 | 2.0 | 0.608 |
| `POST /jobs` | `/jobs` | 255 | 0.0 | 2.46 | 0.408 |

- **정규 엔드포인트 행이 정확히 6개** → 정규화 정확성 증명(AC2a). 요청수 테이블 스크린샷 `02`.
- **전 엔드포인트 ≥120 샘플**(모두 ≥100) → P99 통계 유효성(AC2b).
- `POST /jobs`=255는 생성(201) + 400 주입(VALIDATION_FAILED) + 잔류/테스트 POST를 합산한 것(둘 다 `/jobs` 경로).
- 수치는 조회 시점 스냅샷 기준이라 스크린샷과 ±수 건 차이가 날 수 있다(예: `GET /jobs` 125↔스크린샷 02의 124 — 트래픽 버스트 진행 중 조회 시점 차이). AC2a(정확히 6행)·AC2b(≥100 샘플)에는 영향 없다.

## 4. 원시 unwrap 대조 (AC2c 정확도 실증)

`DELETE /jobs/:id`(latency가 유의미한 엔드포인트)의 원시 `latencyMs` 표본을 직접 조회해 패널 분위수와 대조:

- 원시 표본: n=123, min=0ms, max=5ms
- 원시 계산 P50=**1.0ms**(패널 P50 표시 1ms와 일치), P99=4.0ms(nearest-rank)
- 패널 `quantile_over_time` P99=**3.56ms** — Loki의 5분 창 보간 방식 특성상 nearest-rank 4.0ms와 정합(P99 패널 `12-quantile-crosscheck.png`의 DELETE Max 3.86ms 근접).

→ 패널의 per-endpoint 분위수가 원시 데이터와 일치함을 실증.

## 5. Tempo 트레이스 · Loki 로그 실증

### Tempo (AC4)
- **AC4-a** HTTP 트레이스: `us-all-jobmanager: GET /jobs` (85.6µs) 단일 스팬 — `07-tempo-http-get-jobs.png`. per-id 스팬명 검색은 카디널리티상 사용하지 않고 안정 스팬명 `GET /jobs`로 조회.
- **AC4-b** 스케줄러 트레이스: `scheduler.tick`(2.34ms) 루트 + **`scheduler.process-job` 자식 10개**(총 11 spans) — `08-tempo-scheduler-tick.png`. pending 12건을 잔류시켜 다음 tick(60초)이 배치 처리하도록 유도.
- **AC4-c** 로그↔트레이스 왕복: Loki 로그 라인 확장 → `traceId=23ebaf342190e21aed0477de07ced596` 필드 + **derived field "Tempo에서 보기"** 링크 — `09-loki-to-tempo-derived-field.png`. 동일 traceId가 Tempo 스팬에도 존재.

### Loki (AC5, AC6)
- HTTP 로그: `{source="http"} | json` — 6개 엔드포인트의 `method/path/statusCode/latencyMs/traceId` 필드. Logs volume info **1.11K** / error **240** — `10-loki-http-logs.png`.
- 에러 로그: `{source="http", level="error"}` — `statusCode 404 / errorCode NOT_FOUND`(120건), `statusCode 400 / errorCode VALIDATION_FAILED`(120건) — `11-loki-error-logs.png`.
- **에러율 SLO**: `(sum(rate({source="http", level="error"} | json method | method != "" [5m])) or vector(0)) / sum(rate({source="http"} | json method | method != "" [5m]))` — 관측 ≈**25%**(에러 2건/라운드 주입 반영). 분자·분모 **모두** `method != ""`로 http_request 라인만 집계한다(lock/transition/delete 이벤트도 `source="http"`라 미필터 시 분모가 부풀어 에러율이 ≈18%로 희석되거나 5xx 시 분자가 중복 집계되던 것을 완료 게이트 리뷰에서 발견·정정). `or vector(0)`로 에러 0구간 No data 방지(AC6).
- **가용성 SLO**(비-5xx): 관측 **100%**. 이 앱은 의도적 5xx 경로가 없어(404/409/400만) **100%가 기대값이며, 5xx 검출 능력은 본 세션에서 미검증(한계)**. 에러율(4xx 포함)과 가용성(5xx만)은 정의가 다르다.

### 409(진행 중 삭제) 한계
409는 스케줄러 tick이 job을 `processing`으로 전이한 극히 짧은 창에서만 발생한다. best-effort 시도에서 잔류 job이 이미 `completed`/`pending` 상태여서 DELETE가 204로 처리됨(409 미유도). level=error 실선은 404·400으로 충분히 확보되어 AC5는 충족. (재현하려면 tick 배치 처리 중 동시 DELETE가 필요.)

## 6. 증거 매핑 (스크린샷 ↔ AC ↔ 쿼리)

| 파일 | 증명 대상 | 도구/쿼리 |
| --- | --- | --- |
| `01-compose-ps.txt` | AC1 | `docker compose ps` + curl 헬스체크 |
| `02-slo-dashboard-full.png` | AC2a·AC6(패널4~6) | SLO 대시보드 전체(패널 1~6, 범례 수치) |
| `03-slo-p50-panel.png` | AC2a | P50 패널 전체(6 엔드포인트 범례) |
| `12-quantile-crosscheck.png` | AC2c | P99 패널(DELETE Max 3.86ms) |
| `06-avg-latency-dashboard.png` | AC3 | 평균 Latency 대시보드(4패널) |
| `07-tempo-http-get-jobs.png` | AC4-a | Tempo `GET /jobs` 트레이스 |
| `08-tempo-scheduler-tick.png` | AC4-b | Tempo `scheduler.tick`→`process-job`×10 |
| `09-loki-to-tempo-derived-field.png` | AC4-c | Loki 로그 traceId → "Tempo에서 보기" |
| `10-loki-http-logs.png` | AC5 | `{source="http"} | json` |
| `11-loki-error-logs.png` | AC5 | `{source="http", level="error"}` |
| `13-legacy-dashboard.png` | 기존 대시보드 회귀 없음 | 기존 6패널 |

## 7. 변경 반경 (AC8)

- **신규**: `observability/grafana/provisioning/dashboards/us-all-job-manager-slo.json`, `...-avg-latency.json`, `scripts/observability-traffic.sh`, `logs/20260719/observability-verification/*`.
- **수정**: `observability/README.md`(신규 대시보드·스크립트 안내).
- **무변경**: `src/**` 전체, `dashboards.yaml`(디렉토리 스캔 자동 로드), tempo/loki/alloy 설정.

## 8. 열린 이슈 / 후속

1. **[런타임 결함, 해결됨]** 스케줄러 백엔드 이미지가 stale 상태로 `DELETE /jobs/:id` 라우트가 미등록되어 있었다(→ 404 "Cannot DELETE"). `docker compose build --no-cache app`로 현재 소스 재빌드하여 해결. `troubleshooting.md` 문제 1 참조. **소스 코드 결함이 아니라 빌드 캐시/이미지 stale 문제**였다.
2. **[관측 한계]** 저장소 락 이벤트가 `source="http"`로만 기록되어(호출자 미구분) 엔드포인트 패널에서 `method != ""` 필터로 배제해야 한다 — 기존 `06-observability-design.md`에 명시된 알려진 한계.
3. **[관측 한계]** 가용성 SLO 5xx 검출력 미검증(앱에 5xx 경로 부재). 실운영 SLO에는 옵션 B(인터셉터 route 필드) + 5xx 경로가 필요 — 후속 슬라이스.
4. **[운영 취약]** latencyMs가 로그에만 존재해 장기 SLO 집계에는 옵션 B/C(메트릭 파이프라인)가 바람직 — Follow-up 로드맵.
5. **[완료 게이트 정정, 해결됨]** 전역 요약/평균/처리량/에러율 보조 패널이 (a) `| json ... | unwrap`을 스트림 집계 없이 실행해 `level`(info/error) 스트림으로 갈라지고, (b) 분모가 lock/transition 라인까지 세는 결함이 게이트 리뷰(architect COMMENT + executor QA)에서 발견됐다. `method != ""`로 http_request 라인만 집계하고 전역 요약은 `by ()`로 단일 그룹 병합하도록 정정했다(SLO 패널 4·6, 평균 패널 1·3·4). stat 패널의 `Value #A/#B` 라벨과 요청수 테이블 컬럼도 displayName으로 정정.
6. **[사전 결함, 범위 외]** 기존 대시보드 `us-all-job-manager.json` 패널 2/3/6은 필드 미제한 `| json` 후 집계 없는 `unwrap`으로 요청 1건당 시리즈가 분열된다(사실상 분위수가 아님, executor QA DEF-2). 패널3 tick 성공률은 0/0 가드(`or vector(0)`) 부재로 배치 없는 구간에서 NaN(DEF-3). **본 세션 신규 SLO 대시보드는 `| json method,path,statusCode,latencyMs` 필드 제한 + `by (endpoint)` 명시 집계로 이 문제를 회피했다.** 기존 대시보드 교정은 별도 슬라이스(이번 변경 세트 범위 외).
7. **[환경 공백, 코드 결함 아님]** `news-digest.json` 대시보드는 `NEWS_DIGEST_ENABLED`+`GEMINI_API_KEY`+`SLACK_WEBHOOK_URL` 3요건 미충족(기본 off)으로 본 세션에 실데이터 없음. 대시보드 쿼리 문법은 정상.
8. **[LOW]** POST /jobs latency 패널에 400(VALIDATION_FAILED) 응답이 포함된다(404는 unmatched로 분리하나 400은 POST의 정상 라우트라 포함). 빠른 실패라 POST P50/P99를 소폭 하향시킬 수 있으나 엔드포인트 정의상 400도 POST /jobs 요청이므로 의도적. 필요 시 후속에서 statusCode 기준 일관화.
