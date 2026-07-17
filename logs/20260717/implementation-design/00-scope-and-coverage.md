# 구현 설계 문서 세트 개요와 요구사항 커버리지

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

UsAllJobManager(NestJS 채용 과제)의 실제 코드 구현에 앞서, 요구사항 관심사별 결정 로그 9편(00~08)을
`logs/20260717/implementation-design/NN-<slug>.md`로 작성하기로 ralplan에서 확정했다(계획 전문:
`.gjc/_session-019f6e06-096b-7000-a088-4c6c53cde829/plans/ralplan/019f6e06-096b-7000-a088-4c6c53cde829/pending-approval.md`).
본 문서는 그 세트의 진입점으로, (1) 문서 지도, (2) post-interview에서 확정된 Intent Reconciliation 3건 요약,
(3) REQUIREMENTS.md 항목 ↔ 담당 문서 커버리지 매트릭스를 제공한다. 코드 변경은 이 세션의 범위 밖이며,
본 문서 세트 자체가 구현 세션의 확정 입력이 된다.

스코프: `src/**`, `package.json`, `.gjc/**`는 건드리지 않으며, 산출물은 md 문서뿐이다. 각 문서는
`logs/TEMPLATE.md`의 8섹션(영어 헤딩 유지, 본문 한국어)을 준수하고 "추천 1개 확정 + 대안 기각" 형식을 따른다.

## Chosen design / pattern / technology

**Option A — 관심사별 결정 로그 분해(9편)를 채택한다.** 요구사항 관심사 1개당 결정 로그 1편(01~08) +
진입점/횡단 문서(00)로 구성한다. 각 문서는 독립적으로 리뷰·supersede 가능하며, 구현 단계에서 관심사별로
바로 참조할 수 있다.

문서 세트 자체의 구성 방식이 이 세션의 첫 번째 결정 대상이므로, 대안 두 가지를 함께 기각 근거와 함께
기록한다(Alternatives considered 참조).

### 문서 지도 (01~09)

| 문서 | 한줄 설명 |
| --- | --- |
| [01-state-transition-design.md](./01-state-transition-design.md) | 작업 상태 enum·전이 테이블·guard 계약 |
| [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) | node-json-db 영속화, 원자성 계약(atomic read→guard→write), 샘플 시딩 |
| [03-scheduler-processing-design.md](./03-scheduler-processing-design.md) | 스케줄러 tick·배치 처리·overrun 방지 |
| [04-api-layer-design.md](./04-api-layer-design.md) | DTO/검증/에러 응답/상태 코드 규약 |
| [05-logging-design.md](./05-logging-design.md) | `logs.txt` 요청·처리 로깅 포맷 |
| [06-observability-design.md](./06-observability-design.md) | Grafana/Loki/Tempo 관측성 설계(트레이싱 최소 실장 확정) |
| [07-ponytail-adoption.md](./07-ponytail-adoption.md) | Ponytail 결정 사다리 운영 방식(정규 규칙 편입 확정) |
| [08-testing-strategy-design.md](./08-testing-strategy-design.md) | API·스케줄러 테스트 전략 |
| [09-final-design.md](./09-final-design.md) | **최종 설계 확정본(사용자 컨펌 14건 통합, 구현 정본 — 충돌 시 01~08에 우선)** |

## Pros

- 각 문서가 관심사 단위로 독립 리뷰·supersede 가능해 구현 세션에서 필요한 결정만 골라 참조할 수 있다.
- `logs/TEMPLATE.md`의 "결정마다 1문서" 취지(Rule 4)와 정합한다.
- 00이 매트릭스와 링크 지도를 겸해, 후속 검수(Verification)에서 커버리지 누락을 기계적으로 확인할 수 있다.

## Cons

- 문서 간 교차 참조(동시성↔스케줄러↔로깅↔테스트)를 수동으로 관리해야 하는 비용이 발생한다. 00과
  Verification #3(교차 참조 무결성)으로 완화한다.
- 9편이라는 총량이 처음 보기에 많아 보일 수 있으나, 00 개요 문서가 지도 역할을 하여 탐색 비용을 낮춘다.

## Performance tradeoffs

문서 산출물이므로 런타임 성능에는 영향이 없다. 다만 문서 분량 가이드(문서당 200줄 내외)를 지켜
구현 세션에서의 "읽기 비용"을 통제한다.

## Side effects

- 구현 세션은 본 9편을 확정 입력으로 삼아야 하며, 코드가 문서와 어긋나면 문서를 먼저 supersede해야 한다.
- `.gjc/rules/60-ponytail.md` 정규 규칙 편입(07 참조)과 트레이싱 계측(06 참조)은 이 세션에서 실행하지
  않고 후속 세션으로 이관된다.

## Alternatives considered

- **Option B — 단일 종합 설계서 1편 + 부록**: 교차 참조는 불필요해지지만, `logs/TEMPLATE.md`가 전제하는
  "단일 결정 단위" 구조와 불일치한다. 결정 6개 이상이 한 파일에 뭉쳐 개별 supersede·리뷰 단위가 깨지고
  Rule 4 취지를 위반한다 → 기각.
- **Option C — 패턴 카탈로그(패턴 1개당 1문서)**: 문서 수가 15편 이상으로 폭증하고, 요구사항→패턴이 아닌
  패턴→요구사항 방향으로 뒤집혀 채점 관점(REQUIREMENTS 커버리지) 가치가 희석된다. 문서 차원의 YAGNI
  위반이므로 기각.

## Follow-ups

- ~~아래 요구사항 커버리지 매트릭스는 구조(행·담당 문서 열)만 이 시점에 확정했다~~ → **완료**: 01~08
  작성 완료 후 00 최종 검수 단계에서 각 셀의 세부 내용을 실제 문서와 1:1 대조해 확정했다(Sequencing
  10단계: "00 매트릭스 완성·상호 링크 검수" 수행 완료). 아래 매트릭스는 구조뿐 아니라 근거 열까지
  포함한 최종본이다.
- Intent Reconciliation 항목 중 열린 확인 사항은 없음(계획 문서 기준 "사용자 이연 잔존: 없음").
- `.gjc/rules/60-ponytail.md` 정규 규칙 편입 세션(Rule 5 승인 경유) — 07의 Follow-ups와 동일 항목.
- 코드 구현 세션(트레이싱 최소 실장 계측 포함) — 본 문서 세트 accepted 이후 별도 ralplan으로 진행.
- docker-compose 기반 Grafana/Loki/Tempo 로컬 구축 — 후속.

## Intent Reconciliation 확정 사항 요약 (post-ralplan interview, 3건)

1. **Tempo 최소 실장 확정**: 06의 트레이싱은 "최소 실장 vs 설계-only 조건부 분기"를 폐기하고 최소 실장으로
   확정한다. 범위는 HTTP 인바운드 스팬 + 스케줄러 tick 루트 스팬 → job별 자식 스팬이며, 계측은 adapter
   계층 한정(도메인 무침투)이다. 설계-only 옵션은 06의 Alternatives considered에 기각 근거와 함께 강등
   기록한다. 실제 계측 코드·docker-compose 구축은 여전히 본 세션 non-goal.
2. **Ponytail 정규 규칙 편입 확정**: 07의 추천은 옵션 (b) — 후속 세션에서 `.gjc/rules/60-ponytail.md`
   정규 규칙 편입(Rule 5 승인 경유)으로 확정한다. 이번 세션은 문서만 작성하고 편입 실행은 Follow-ups에
   기록한다. 옵션 (a) 결정 로그 "Ponytail 판정" 섹션 관행은 편입 전까지 과도기 운영 방식으로 병행 채택한다.
   옵션 (c) PR 리뷰 체크리스트는 대안으로 기록한다.
3. **session-name = `implementation-design` 확정**: 헤드리스 가정이 사용자 확정으로 대체되어 R5 리스크가
   해소되었다.

## 요구사항 커버리지 매트릭스 (확정)

| REQUIREMENTS.md 항목 | 담당 문서 | 확정 근거 (실제 문서 내용 대조) |
| --- | --- | --- |
| API 5종 (POST/GET 목록/GET 검색/GET 단건/PATCH) | [04-api-layer-design.md](./04-api-layer-design.md) | 04의 "엔드포인트별 요청/응답 스키마"·에러 응답 구조·상태 코드 매핑 표가 5개 엔드포인트 전부를 다룸 |
| 데이터 스키마 | [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) | 02의 "초기화/샘플 시딩" 절이 `jobs.json` 루트 구조(`{ "jobs": [...] }`)와 `getData("/jobs")` 계약을 확정 |
| 영속화 (node-json-db) | [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) | 02의 "node-json-db 특성 조사"(공식 README 근거: saveOnPush, 전체 파일 rewrite, 비동기 API)와 `JobRepository` 어댑터 배치 |
| 스케줄러 (백그라운드 처리) | [03-scheduler-processing-design.md](./03-scheduler-processing-design.md) | 03의 tick 주기(60초)·배치 크기(10건)·overrun 스킵 결정과 `@Interval` 어댑터 배치 |
| 동시성 (API↔스케줄러 동시 접근) | [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) | 02의 atomic read→guard→write 원자성 계약과 race 시나리오 표(동시 PATCH·PATCH↔스케줄러·생성↔조회 3건, 무효 전이 방지 열 포함) |
| `logs.txt` 로깅 | [05-logging-design.md](./05-logging-design.md) | 05의 로깅 대상 정의(HTTP 요청/응답, 스케줄러 tick·배치 결과, 에러)와 로그 라인 포맷·파일 append 안전성 절 |
| 테스트 | [08-testing-strategy-design.md](./08-testing-strategy-design.md) | 08의 계층별 전략(도메인/유스케이스/e2e), 결정론적 스케줄러 테스트, 02 race 시나리오 회귀 테스트(`Promise.all`), node-json-db 임시 파일 격리 절 |
| README (실행법/API 사용법/코멘트) | [04-api-layer-design.md](./04-api-layer-design.md), [05-logging-design.md](./05-logging-design.md) | 04가 API 사용법(요청/응답 예시)의 근거를, 05가 로깅 관련 구현 코멘트(포맷 결정 근거)의 근거를 제공 — 03의 tick 주기·배치 크기 가정도 "README에 동일하게 기록" 지시를 04/05 인용과 함께 참조 |
| 샘플 데이터 (`jobs.json` 시딩) | [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) | 02의 "`jobs.json` seed 전략"(저장소에 미리 포함된 샘플 파일 사용, 초기화 로직이 덮어쓰지 않음) 절이 직접 확정 |

담당 문서 없는 행은 0개, 공란 셀은 0개(모든 행에 근거 열까지 채움). 문서 지도(01~08)와 위 매트릭스의
파일명 링크는 실제 `logs/20260717/implementation-design/` 디렉터리 파일명과 1:1 일치함을 확인했다
(검수 완료). 위 매핑은 ralplan "문서 목록 설계" 섹션의 목적 기술과 일치한다.
