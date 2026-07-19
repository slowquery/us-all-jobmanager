# 뉴스 다이제스트 — 주제별 그룹 요약 전환 + 관측성(Tempo·Loki·Grafana)

- Date (KST): 20260719
- Session-name: concurrency-demo-job
- Author/agent: gjc
- Status: accepted

## Context

기존 뉴스 다이제스트는 헤드라인에서 키워드만 뽑아 콤마로 Slack에 보냈다. 요구가 두 가지로 확장됐다:
(1) 헤드라인뿐 아니라 각 기사를 간단히 정리하고 **동일 주제끼리 그룹으로 묶어 각 그룹별로** 전달,
(2) Tempo·Loki에 잘 보이고 Grafana 대시보드에서 **실행시간·처리속도**를 확인할 수 있게 구성.

작업 위치: 워크트리 `feat/news-digest-job`(뉴스 다이제스트 기능이 이 브랜치의 미커밋 변경으로만 존재).
master는 그 사이 `#5`(관리자 페이지·작업 삭제)로 진행됐다 — `observability/`는 `#5`가 건드리지 않아 대시보드
추가는 충돌 없음. `main.ts`/`package.json`은 양쪽 모두 변경돼 PR 시 rebase 충돌 예상(알려진 사항).

## Chosen design / pattern / technology

**기능(주제별 그룹 요약)**
- `NewsSource`가 헤드라인 문자열 대신 **`NewsArticle{title, snippet, link}`** 를 반환(RSS `<item>`의
  title/link/description 파싱, description은 태그·CDATA·엔티티 제거 후 200자 스니펫).
- `KeywordSummarizer` → **`NewsDigestBuilder.buildGroupedDigest(articles) → DigestGroup[]`** 로 교체.
  `GeminiNewsDigestBuilder`가 기사(제목+스니펫)를 주고 **동일 주제 그룹핑 + 그룹별 요약**을 요청하며,
  `generationConfig.responseMimeType: application/json`으로 **구조화 JSON 출력을 강제**해 파싱 안정성을 높였다
  (`maxOutputTokens: 4096`로 절단 방지, 응답 parts 전체를 concat).
- `formatDigestMessage(jobTitle, groups)` 순수 함수가 "주제 → 요약 → 헤드라인" 섹션의 Slack mrkdwn을 만든다.
- 등록/호출·no-throw·timeout·dedupe·DispatchingJobProcessor 라우팅은 기존 설계 그대로 유지.

**관측성(기존 스택에 맞춘 로그·트레이스 기반, 새 메트릭 백엔드 도입 없음)**
- 스택 실측: 트레이스=Tempo(OTLP), 로그=logs.txt→Alloy→Loki, Grafana(익명 뷰어). **Prometheus 없음** →
  "실행시간·처리속도"는 **Loki(LogQL)** 와 **Tempo(스팬 타이밍)** 로 도출.
- **Tempo**: 처리 단계마다 `scheduler.process-job` 아래 `news.fetch`/`news.summarize`/`news.notify` 자식 스팬
  (속성 `news.article_count`/`news.group_count`/`news.model`). infrastructure가 `@opentelemetry/api`를 쓰는 것은
  기존 `FileLoggerAdapter`(infra) 선례와 정합.
- **Loki**: 처리 1건마다 `DigestLogEvent`(고유 필드 `digestDurationMs`, `outcome`/`articleCount`/`groupCount`/
  `model`)를 남긴다. `FileLoggerAdapter`가 `type`을 제외하므로 기존 대시보드 관례대로 **고유 필드 존재로 이벤트를
  구분**한다.
- **Grafana**: `observability/grafana/provisioning/dashboards/news-digest.json`(uid `newsdigest`) 자동 프로비저닝 —
  실행시간 p50/p95, 처리속도(결과별 건수/5m), 성공·실패 분포, 평균 기사/그룹 수, 최근 다이제스트 로그(traceId→Tempo),
  단계별 소요시간 Tempo 안내.

## Pros

- 요구(주제별 그룹 정리·전달)를 정확히 충족. Gemini JSON 모드로 그룹 구조가 안정적.
- 관측성이 **기존 스택 그대로**(새 컨테이너·의존성 0)로 실행시간·처리속도·성공률을 노출. traceId로 로그↔트레이스 상관.
- 포트 seam 유지 → 단위 테스트는 fake로 결정론 검증(실호출 없음), 라이브 스모크는 로컬 수동.

## Cons

- 스니펫 포함 프롬프트가 커 초기엔 응답 절단으로 그룹 0개 실패가 있었음 → `maxOutputTokens`↑ + parts concat로 해소.
- Loki 기반 지표는 Prometheus 히스토그램 대비 정밀도·집계가 제한적(데모 스택 범위에선 충분).
- 인프라 계층에 OTel 스팬 도입(경계상 허용이나 계측 코드가 처리기에 섞임 — FileLoggerAdapter 선례 준용).

## Performance tradeoffs

- 처리는 여전히 저장소 락 **바깥**에서 수행되어 직렬화 큐에 영향 없음. 단계별 스팬은 무시할 오버헤드.
- 그룹 요약은 단일 Gemini 호출(1회)로 유지 — 기사 개별 호출 아님(비용·지연 최소).

## Side effects

- 라이브 스모크 실측(gemini-flash-lite-latest): 15기사 → **5개 주제 그룹** 요약 → Slack 전송 성공(6.2s).
- `DigestLogEvent` 추가로 logs.txt에 새 이벤트 유형 유입(대시보드가 소비). 기존 이벤트 파이프라인 무변경.
- 라이브 모델 이슈(직전 세션): `gemini-1.5-flash` 은퇴(404), `gemini-2.5-flash` thinking 지연→timeout,
  `gemini-2.0-flash*` 429 → 기본 모델 `gemini-flash-lite-latest`로 확정(무료·저지연).

## Alternatives considered

- **각 기사 개별 요약 후 그룹핑(N회 Gemini 호출)**: 비용·지연·rate limit 부담 → 단일 호출 JSON 그룹핑으로 기각.
- **Prometheus + OTel 메트릭 추가**: 정밀 히스토그램 가능하나 새 컨테이너·배선 필요 → 데모 범위 초과로 기각,
  Loki/Tempo 파생 지표 채택.
- **job.type 도메인 필드로 뉴스 판별**: 도메인+영속+DTO+e2e 파급 → 기존 결정대로 제목 sentinel 유지(별도 승인 대상).

## Follow-ups

- PR 시 `feat/news-digest-job`을 현재 master(`#5` 포함)로 rebase — `main.ts`(dotenv vs 정적 서빙)·`package.json`
  (dotenv vs admin-ui 스크립트) 충돌 해소 필요.
- 사용자 `.env` 반영: `NEWS_DIGEST_ENABLED=true`, `GEMINI_MODEL=gemini-flash-lite-latest`(현재 `gemini-1.5-flash`는 404).
- 대시보드는 실데이터 유입 후 임계·패널 미세조정 여지. Prometheus 도입 시 정밀 히스토그램으로 승급 가능.
- Google News RSS 스니펫이 관련기사 목록 HTML이라 노이즈가 있음 — 기사 본문 크롤링/정제는 범위 밖(신뢰성·부하).
