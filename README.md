# us-all-job-manager

NestJS 기반 작업(Job) 관리 백엔드 — 어스얼라이언스 백엔드 엔지니어 채용 과제
([REQUIREMENTS.md](./REQUIREMENTS.md)) 구현체. RESTful API로 작업을 생성·조회·검색하고, 백그라운드
스케줄러가 주기적으로 `pending` 작업을 처리(`processing → completed|failed`)한다. 데이터는 단일 JSON
파일(`jobs.json`, [node-json-db](https://www.npmjs.com/package/node-json-db))에 영속화하며, API 요청과
스케줄러가 같은 파일에 동시에 접근하는 환경에서 데이터 손실·깨짐이 없도록 인프로세스 직렬화 큐로
동시성을 제어한다.

> ⚠️ 이 저장소는 **public** 입니다. `HISTORY/`에 커밋되는 세션 export와 `.gjc/config.yml`·`.gjc/agents` 등
> 모든 커밋 내용이 공개됩니다. export/커밋 전 반드시 시크릿(키·토큰·내부 경로·개인정보) 스크러빙을 수행하세요.
> 시크릿은 커밋하지 말고 `.env`(gitignore됨)로 분리하세요.

## 목차

1. [소개](#1-소개)
2. [설치·실행](#2-설치실행)
3. [테스트](#3-테스트)
4. [API 사용법](#4-api-사용법)
5. [스케줄러 동작](#5-스케줄러-동작)
6. [관측성](#6-관측성-observability)
7. [개발 규칙(거버넌스)](#7-개발-규칙거버넌스)
8. [구현에 대한 본인 코멘트](#8-구현에-대한-본인-코멘트)

---

## 1. 소개

- 아키텍처: 헥사고날(Hexagonal/Clean Architecture) — `domain`(상태·전이 순수 함수) →
  `application`(유스케이스·포트) ← `adapters`(HTTP 컨트롤러, 스케줄러) ← `infrastructure`(node-json-db
  저장소, 파일 로거). 의존성은 항상 안쪽(도메인)으로만 향하고, 도메인·유스케이스에는 `@nestjs/*`를
  포함한 프레임워크 의존성을 두지 않는다.
- 엔드포인트 5종(`POST /jobs`, `GET /jobs`, `GET /jobs/search`, `GET /jobs/:id`, `PATCH /jobs/:id`),
  상태 4종(`pending`/`processing`/`completed`/`failed`) + 재시도 상한(`retryCount < 3`), 60초 주기
  스케줄러(1틱당 최대 10건), 모든 요청·처리 결과를 `logs.txt`(NDJSON)에 기록.
- 설계 결정의 정본 문서는 [`logs/20260717/implementation-design/09-final-design.md`](./logs/20260717/implementation-design/09-final-design.md)이며,
  개별 설계 로그(00~08)와 충돌 시 09가 우선한다. 8절에 재현→해결 서사와 설계 해석을 정리했다.

## 2. 설치·실행

실증 환경: **Node.js v24.11.1**(`package.json`의 `engines.node`는 `>=24`). Yarn(Berry, `.yarnrc.yml`)이
1급 패키지 매니저이며, 기본 Node 환경(`npm`)에서도 그대로 동작하도록 `yarn.lock`과 함께
`package-lock.json` 생성 없는 순수 `npm install` 경로도 검증했다.

```bash
# Yarn (권장, corepack이 .yarnrc.yml의 버전을 자동 사용)
yarn install      # prepare 훅이 core.hooksPath=.githooks 설정
yarn start:dev    # 개발(watch)
yarn build && yarn start:prod   # 프로덕션: dist/main.js 실행

# npm (REQUIREMENTS "기본 Node 환경에서 npm install 후 실행" 요건)
npm install
npm run build && npm run start:prod
```

기본 포트는 `3000`(`PORT` 환경변수로 override 가능, `src/main.ts`). 기동 시 다음이 함께 초기화된다.

- `jobs.json`(리포지토리 루트, `process.cwd()` 기준 상대 경로): 파일이 이미 있으면(이 저장소에 커밋된
  샘플 시딩 포함) **그대로 보존**하고, 없을 때만 빈 `{ "jobs": [] }`로 최초 생성한다
  (`JsonDbJobRepository.ensureInitialized`, 시딩 데이터 보존 전략).
- `logs.txt`(리포지토리 루트): 모든 HTTP 요청/스케줄러 tick/전이/락 대기 이벤트가 NDJSON으로
  append된다(`FileLoggerAdapter`, 단일 write stream).
- OTel SDK(`src/otel.bootstrap.ts`)가 상시 초기화된다 — Tempo가 떠 있지 않은 호스트 단독 실행에서는
  OTLP export가 실패하고 콘솔에 연결 오류/경고가 찍히지만, **애플리케이션 동작에는 영향이 없다**(6절
  참조. 이 경고는 정상이다).

### 2.1 환경변수(.env) 설정 — 뉴스 다이제스트 기능

비밀(API key·webhook URL)과 기능 플래그는 `.env`로 주입한다(`dotenv`가 `src/main.ts` 최상단에서 로드).
저장소에는 `.env.example`만 커밋되고 `.env`는 `.gitignore`로 추적 제외된다(비밀 유출 방지 — 이 저장소는 PUBLIC).

```bash
cp .env.example .env    # 그런 다음 필요한 값을 채운다
```

- 기본값(`NEWS_DIGEST_ENABLED=false`)에서는 뉴스 기능이 꺼진 채 서버가 정상 기동한다(비밀 불필요, 기존 동작 그대로).
- 뉴스 다이제스트를 켜려면 `.env`에 `GEMINI_API_KEY`·`SLACK_WEBHOOK_URL`을 채우고 `NEWS_DIGEST_ENABLED=true`로 둔다.
- 전체 키 설명은 `.env.example` 주석과 아래 [8.5절](#85-뉴스-다이제스트-job--동시성-실증-예제설정등록호출) 참조.

## 3. 테스트

```bash
yarn test          # 유닛 테스트(도메인 guard, 유스케이스, adapter, 동시성 회귀·재현 C-1~C-5)
yarn test:cov       # 커버리지 게이트 포함(임계값은 아래 참조)
yarn test:e2e       # supertest 기반 API e2e(5 엔드포인트 성공/실패 경로, 임시 파일 격리)
```

- `test/`(루트) 아래 e2e는 `test/jest-e2e.json`으로 별도 실행되며, `test/concurrency/`는 유닛 테스트
  러너(`package.json` `jest.roots`)에 포함되어 `yarn test`/`yarn test:cov`로 함께 돈다.
- 모든 저장소 테스트(유닛·e2e·동시성)는 `os.tmpdir()` 하위에 매 테스트 격리 디렉터리를 만들어
  `JsonDbJobRepository`에 별도 경로를 주입한다 — 리포지토리 루트의 `jobs.json`/`logs.txt`는 어떤
  테스트도 건드리지 않는다.
- 커버리지 임계값(`package.json` `jest.coverageThreshold`): 전역 statements 97% / branches 86% /
  functions 92% / lines 98%, `src/domain/`은 100%/100%/100%/100%(guard 순수 함수 전량 커버 강제).
  실측치는 8절 참조.
- **C-2 baseline skip 규약**: `test/concurrency/c2-snapshot.spec.ts`(스냅숏 비일관 재현)는 무보호
  경로에서 read→write 사이 인터리빙이 실제로 걸렸을 때만 "재현 성공" 테스트를 등록한다. Jest는
  `it`/`it.skip` 등록을 테스트 수집(모듈 로드) 시점에 동기적으로 확정해야 하므로, 파일 로드 시
  동기 프로브(`probeTornSnapshot`)로 30회 반복 재현을 시도하고 그 결과에 따라 `it` 또는 `it.skip`을
  등록한다 — "N회 반복 중 최소 1회 재현되면 성공, 전혀 재현되지 않으면 skip(사유 콘솔 로그)". **이
  skip은 baseline(무보호) 쪽에만 적용되며, 보호 경로(`JsonDbJobRepository`) 대조 assert는 재현 성공
  여부와 무관하게 항상 하드 실패다.**

## 4. API 사용법

성공 응답은 리소스(또는 `{ items, count }`)를 그대로 반환하고, 실패 응답은 공통 에러 envelope
`{ code, message, details? }`을 반환한다(`code`는 SCREAMING_SNAKE_CASE 머신 판별용 상수, `message`는
한국어 요약, `details`는 필드별 원인 배열). Job 리소스 응답 형태:
`{ id, title, description, status, createdAt, updatedAt }` — **`retryCount`는 재시도 상한 판정용
내부 필드라 HTTP 응답에는 포함하지 않는다**(`JobResponse`/`toJobResponse`, `src/adapters/http/job-response.ts`).

### 4.1 `POST /jobs` — 작업 생성

```bash
curl -s -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"Task 1","description":"Do something"}'
```

성공(201, `status`는 요청으로 받지 않고 서버가 항상 `pending`으로 고정):

```json
{ "id": "b3f1...", "title": "Task 1", "description": "Do something", "status": "pending",
  "createdAt": "2026-07-18T09:00:00.000Z", "updatedAt": "2026-07-18T09:00:00.000Z" }
```

실패(400, `title` 누락 — `ValidationPipe` 기본 검증 실패):

```json
{ "code": "VALIDATION_FAILED", "message": "요청이 유효하지 않습니다.",
  "details": [{ "reason": "title should not be empty" }] }
```

### 4.2 `GET /jobs` — 전체 목록 조회

```bash
curl -s http://localhost:3000/jobs
```

```json
{ "items": [ { "id": "92dc6bef-...", "title": "샘플 대기 작업", "description": "...", "status": "pending",
  "createdAt": "...", "updatedAt": "..." } ], "count": 4 }
```

쿼리 파라미터 없이 전량 반환한다(페이지네이션 미도입 — 8.4절 "시간이 더 있다면" 참조).

### 4.3 `GET /jobs/search` — 검색

```bash
curl -s 'http://localhost:3000/jobs/search?title=샘플&status=pending'
```

`title`(부분 일치, 대소문자 무시)과 `status`(완전 일치, 4값 열거) 모두 선택이나 **최소 1개는
필수**다(`GET /jobs`와 책임 분리). 둘 다 오면 AND 조건.

```json
{ "items": [ { "id": "92dc6bef-...", "title": "샘플 대기 작업", "status": "pending", "...": "..." } ], "count": 1 }
```

실패(400, 파라미터 둘 다 없음):

```json
{ "code": "VALIDATION_FAILED", "message": "검색 파라미터가 유효하지 않습니다.",
  "details": [{ "field": "title|status", "reason": "title 또는 status 중 최소 1개는 필요합니다." }] }
```

### 4.4 `GET /jobs/:id` — 단일 조회

```bash
curl -s http://localhost:3000/jobs/92dc6bef-1f52-41cb-bea7-f6e1beb882ec
```

실패(404, 미존재 — `:id` 형식 자체는 검증하지 않는다. 비-UUID 값도 "존재하지 않는 id"로 취급해
동일하게 404를 반환한다. 04 설계 초안의 "UUID 형식 오류 400" 구분은 구현하지 않았다 — 8.2절 참조):

```json
{ "code": "NOT_FOUND", "message": "id=abc 인 작업을 찾을 수 없습니다." }
```

### 4.5 `PATCH /jobs/:id` — 작업 수정(재시도 포함)

요청 바디는 `title?`/`description?`/`status?`(모두 optional, 최소 1개 필요) — `status`는
`'pending'` 단일 값만 허용한다(`failed → pending` 재시도 전용, `processing`/`completed`는 스케줄러
전용 전이라 애초에 DTO 열거형에 없음).

```bash
curl -s -X PATCH http://localhost:3000/jobs/a76e966a-c9bf-4fb9-aa7b-cdc3f83cd977 \
  -H 'Content-Type: application/json' \
  -d '{"status":"pending"}'
```

성공(200, 재시도 전이 — `retryCount`가 내부적으로 +1):

```json
{ "id": "a76e966a-...", "title": "샘플 실패 작업", "description": "...", "status": "pending",
  "createdAt": "...", "updatedAt": "2026-07-18T09:05:00.000Z" }
```

실패 예시 1(409, `INVALID_TRANSITION` — 예: `completed` job에 `status: "pending"` 요청):

```json
{ "code": "INVALID_TRANSITION", "message": "현재 상태에서 허용되지 않는 전이입니다.",
  "details": [{ "field": "status", "reason": "허용된 전이: failed → pending" }] }
```

실패 예시 2(409, `RETRY_LIMIT_EXCEEDED` — `failed` job의 `retryCount`가 이미 3):

```json
{ "code": "RETRY_LIMIT_EXCEEDED", "message": "재시도 상한(3회)을 초과해 더 이상 재시도할 수 없습니다.",
  "details": [{ "field": "status", "reason": "retryCount가 상한에 도달했습니다." }] }
```

실패(404, 미존재 job PATCH): `{ "code": "NOT_FOUND", "message": "id=... 인 작업을 찾을 수 없습니다." }`.

`title`/`description`만 있는 PATCH는 상태 전이 guard와 무관하게 항상 허용되고(직렬화 큐는 동일하게
경유해 무손실 보장), 예기치 못한 서버 오류는 어떤 엔드포인트든 500 `INTERNAL`로 고정 응답한다(스택/
내부 경로는 응답 body에 노출하지 않고 `logs.txt`에만 기록 — 보안 조항).

### 상태 전이 규칙 표

| from \ to | pending | processing | completed | failed |
|---|---|---|---|---|
| pending | — | 스케줄러 전용 | — | — |
| processing | — | — | 스케줄러 전용 | 스케줄러 전용 |
| failed | **PATCH 전용, `retryCount < 3`일 때만** | — | — | — |
| completed | — | — | — | — (종단 상태) |

`retryCount`는 0으로 생성되고 `failed → pending` 전이가 커밋될 때만 +1 된다(최대 3, 상한 도달 시
409 `RETRY_LIMIT_EXCEEDED`). 전이 판정(`canTransition`/`transitionError`, `src/domain/job-transitions.ts`)은
순수 함수이며, 반드시 직렬화 큐 임계구역 내부에서 최신 상태를 재조회한 뒤 평가된다(guard-in-lock,
5절·8.1절 참조).

### 상태 코드 매핑

| 상태 코드 | 발생 상황 |
|---|---|
| 200 | GET(목록/검색/단일), PATCH 성공 |
| 201 | POST 성공 |
| 400 | DTO 검증 실패(`VALIDATION_FAILED`) — `ValidationPipe` 기본값 그대로 사용(422 미채택, 8.2절) |
| 404 | 대상 job 미존재(`NOT_FOUND`) |
| 409 | 무효 전이(`INVALID_TRANSITION`) 또는 재시도 상한 초과(`RETRY_LIMIT_EXCEEDED`) |
| 500 | 예기치 못한 서버 오류(`INTERNAL`, 상세는 응답에 미노출) |

## 5. 스케줄러 동작

- `@nestjs/schedule`의 `@Interval(60_000)`로 **60초마다** `JobSchedulerAdapter.tick()`이 호출된다.
- 매 tick: `listByStatus('pending', 10)`으로 **최대 10건** 조회 → `withBatch(..., 'processing')`로
  일괄 선점 → 각 job을 `JobProcessor`(현재 구현체 `DefaultJobProcessor` 1개, Strategy 인터페이스로
  확장 여지만 열어둠)로 처리 → 성공/실패 판정을 각각 `withBatch(..., 'completed'|'failed')`로 일괄
  커밋(전이당 파일 rewrite 1회, tick당 최대 2회로 상한).
- **overrun 스킵**: 이전 tick이 60초 안에 끝나지 않아 다음 tick과 겹치면 `isTickRunning` 플래그가
  새 tick을 즉시 스킵(drop)하고 `{ type: 'tick', phase: 'skipped' }` 로그를 남긴다. 이는 데이터
  무결성 방어선이 아니라(guard-in-lock이 이미 보장) 큐 대기 낭비를 줄이는 성능 최적화다.
- 스케줄러가 자동으로 재시도를 수행하지는 않는다 — `failed` job의 재시도는 사용자가 `PATCH
  /jobs/:id`로 명시적으로 트리거해야 한다.
- 테스트는 fake timer 대신 `tick()`을 수동으로 직접 호출하는 결정론적 전략을 쓴다(3절).

## 6. 관측성 (Observability)

전체 스택(Grafana + Loki + Tempo + Alloy) 구축·확인 절차는
[`observability/README.md`](./observability/README.md)에 상세 문서화되어 있다. 요약:

```bash
docker compose -f observability/docker-compose.yml up -d --build   # 리포지토리 루트에서 실행
```

- 앱은 컨테이너 내부 3000 → 호스트 `8080`(grafana와의 `:3000` 충돌 회피), Grafana는 호스트 `3000`.
- `logs.txt`(NDJSON)를 Alloy가 tail해 Loki로 push, 트레이싱은 `@opentelemetry/sdk-node`가 Tempo
  (OTLP/HTTP `:4318`)로 직접 전송 — `logs.txt`의 `traceId`와 Tempo 스팬의 트레이스 ID가 동일 값이라
  Grafana에서 로그 ↔ 트레이스 상호 이동이 가능하다.
- 대시보드 패널 6종: 상태 분포, 처리량·지연 p50/p95, tick 성공률·소요, 에러율, 상태 전이 흐름,
  락 대기 시간(waitMs/holdMs).
- **호스트에서 `yarn start:prod`/`node dist/main.js`를 단독 실행하면(Tempo 없이) OTLP export가
  실패하고 콘솔에 연결 오류/경고가 출력된다 — 이는 정상이다.** OTel SDK는 상시 초기화가 정본이므로
  (traceId 발급을 active span에서 항상 얻기 위함, 6.2절 아래) Tempo 부재와 무관하게 애플리케이션
  요청 처리·로깅·스케줄러 동작에는 아무 영향이 없다. active span이 없을 때는 동일 형식(32-hex)의
  fallback traceId를 매 로그 라인마다 새로 발급한다(요청/tick 내 상관은 보장하지 않음, 명시적 한계).

## 7. 개발 규칙(거버넌스)

이 저장소는 GJC 10개 운영 규칙으로 관리된다. 규칙 원문은 [AGENTS.md](./AGENTS.md), 정규 문서는 `.gjc/rules/`.

| # | 요약 | 정규 문서 |
|---|---|---|
| 1 | 모든 작업은 전용 git worktree에서 진행 — 메인 체크아웃은 파일 변경·커밋 전면 금지 | [00-worktree](./.gjc/rules/00-worktree.md) |
| 2 | 설계 중요 기능만 ralplan 합의 후 구현(사소한 수정은 직접) | [10-ralplan-gate](./.gjc/rules/10-ralplan-gate.md) |
| 3 | Hexagonal/Clean Architecture; 도메인·유스케이스에 `@nestjs/*` 금지 | [20-architecture-hexagonal](./.gjc/rules/20-architecture-hexagonal.md) |
| 4 | 설계 트레이드오프를 `logs/<KST-date>/<session-name>/`에 기록 | [30-decision-log](./.gjc/rules/30-decision-log.md) |
| 5 | 파일 변경 전 사용자 공지·확인, 최종 게이트는 커밋/푸시 경계 | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 6 | 완료 시 PR + 설계/보안/성능 3인 리뷰(코멘트) | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 7 | squash 머지만, Conventional Commits + SemVer, `HISTORY/` export, **`master` 보호** | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 8 | 규칙을 `AGENTS.md`↔`CLAUDE.md` 동기화(문서 계층만) | AGENTS.md |
| 9 | 사용자 제안은 한국어 | [50-communication-korean](./.gjc/rules/50-communication-korean.md) |
| 10 | export/public 함수·domain guard 한글 TSDoc 필수, Job 처리기 디렉토리에 흐름도 README.md colocation | [70-code-documentation](./.gjc/rules/70-code-documentation.md) |

강제(enforcement):
- **하드**: `.githooks/`(git 훅: master 커밋/푸시·**메인 체크아웃의 모든 커밋**·비-Conventional·SemVer 불일치 차단) + GitHub squash 전용 + `master` 브랜치 보호(Rule 1·7).
- **하드**: 리뷰어 에이전트(`.gjc/agents/review-*.md`)는 프론트매터 `tools:` 화이트리스트로 write/edit 도구 자체를 제외.
- **어드바이저리**: 나머지 규칙은 `AGENTS.md`/`CLAUDE.md`/`.gjc/rules` 프로즈.

## 8. 구현에 대한 본인 코멘트

REQUIREMENTS.md가 "자유 설계"로 열어둔 항목(상태 전이 규칙, 응답 포맷, 에러 구조, 동시성 처리)에
대한 해석과 근거는 설계 세션 산출물(정본:
[`logs/20260717/implementation-design/09-final-design.md`](./logs/20260717/implementation-design/09-final-design.md),
개별 문서: [00](./logs/20260717/implementation-design/00-scope-and-coverage.md)~[08](./logs/20260717/implementation-design/08-testing-strategy-design.md))에
결정 로그로 기록했다. 아래는 그 요지와, 구현 중 실제로 재현·검증한 내용이다.

### 8.1 상태 전이·동시성 자유 설계 해석

- **상태 전이**: `pending → processing → completed|failed`는 스케줄러 전용, `failed → pending`
  재시도만 API(`PATCH`) 전용으로 설계했다. `completed`는 종단 상태. REQUIREMENTS는 재시도 상한을
  요구하지 않았지만, 무제한 재시도가 무한 루프를 만들 수 있다고 판단해 `retryCount < 3` 상한을
  자체 확정했다(설계 로그 01 Follow-up → 09에서 사용자 컨펌 채택).
- **에러 응답 코드 체계**: `class-validator` + `ValidationPipe`의 기본 실패 코드가 400이라, 초기
  설계 초안(04)은 "422로 의미론적으로 구분"을 검토했으나 최종적으로 **설정 최소화를 위해
  `ValidationPipe` 기본값(400) 그대로 사용**하는 쪽으로 되돌렸다(09 확정 #6 — "되돌린 결정"의
  대표 사례). 리소스 부재는 404, 규칙상 불허 전이·재시도 상한 초과는 409(`INVALID_TRANSITION`/
  `RETRY_LIMIT_EXCEEDED`)로 구분했다.
- **`GET /jobs/:id`의 id 형식 검증은 구현하지 않았다** — 초기 설계 문서(04)는 "UUID 형식이 아니면
  400"을 검토했지만, 실제로는 `id`를 형식 검사 없이 그대로 조회해 미존재 시 404로 응답한다(비-UUID
  문자열도 "찾을 수 없음"으로 취급). 시간 대비 가치가 낮다고 판단해 의도적으로 생략했다.
- **동시성**: node-json-db 자체 `ReadWriteLock`은 `getData()`/`push()` 개별 호출만 보호하고,
  "재조회 → guard 평가 → 저장"이라는 compound read-modify-write 전체는 보호하지 못한다(TOCTOU
  경쟁 잔존). 이를 인프로세스 **단일 Promise 체인 직렬화 큐**로 감쌌고, guard 평가는 반드시 큐
  임계구역 **내부에서 최신 상태를 재조회한 뒤** 수행한다(guard-in-lock) — 락 밖에서 미리 평가해
  캐싱하는 경로는 두지 않았다. 스케줄러 배치 전이는 `withBatch`로 별도 최적화해 tick당 파일
  rewrite를 이론상 최대 20회(10건 × 선점/커밋)에서 2회(선점 1회 + 완료 1회)로 줄였다.

### 8.2 C-1~C-5 재현→해결 서사

REQUIREMENTS는 "동시 요청 상황에서도 데이터가 손실되거나 깨지지 않도록 고려"만 요구했지만,
"보호 코드가 있으니 안전할 것"이라는 주장을 코드 리뷰만으로 검증하기 어렵다고 판단해, **무보호
baseline을 실제로 재현한 뒤 보호 경로와 대조**하는 방식으로 확인했다(`test/concurrency/`).

- **C-1 무보호 lost update 재현**: 큐를 우회하는 헬퍼(테스트 파일 내부 한정, `src/infrastructure`에는
  추가하지 않음)로 동일 `processing` job에 `completed`/`failed` 두 목표를 동시에 전이 시도했다.
  read와 write 사이에 인위적 지연을 주입해 race window를 결정론적으로 확대한 결과, 무보호 경로에서는
  두 요청 모두 "성공"을 보고하면서 실제로는 하나가 조용히 덮어써지는 고전적 lost update가 재현됐다
  (baseline A). 동일 시나리오를 실제 `JsonDbJobRepository`(직렬화 큐 + guard-in-lock)로 재실행하면
  정확히 1건만 성공하고 나머지는 재조회 시 이미 바뀐 상태를 근거로 409 `INVALID_TRANSITION`으로
  거부됐다(baseline B, 해결 확인).
- **C-2 스냅숏 비일관(TOCTOU) 재현**: 무보호 경로에서 read→write 사이에 다른 트랜잭션이 끼어들면
  `status`/`title`처럼 서로 다른 시점 값이 뒤섞인 "찢어진" 스냅숏이 관측될 수 있는지 30회 반복
  프로브로 재현을 시도했고(재현 성공 시에만 테스트 등록, 3절 skip 규약), 보호 경로는 항상 완전한
  스냅숏만 관측됨을 하드 assert로 확인했다.
- **C-3 고부하 스트레스 불변식(N=50)**: 50건 동시 요청에서도 최종 상태 집합에 무효 전이·중복
  커밋이 없다는 불변식을 검증했다.
- **C-4 tick 중복(overrun) 재현**: `isTickRunning` 가드를 끈 구성(테스트 전용 플래그 주입)으로
  겹치는 tick이 동일 job을 중복 선점 시도하는 것을 재현했다. 가드를 꺼도 개별 전이는 여전히
  guard-in-lock을 통과하므로 데이터는 깨지지 않지만, 큐 대기 낭비가 관측된다 — 가드는 안전성이
  아니라 성능 최적화라는 설계 판단을 실측으로 뒷받침했다.
- **C-5 크래시 유실 시뮬레이션(write-behind 기각안 실측)**: 설계 단계에서 "write-behind 캐시 +
  주기 flush"를 대안으로 검토했으나, flush 이전 크래시 시 데이터 유실 가능성이 REQUIREMENTS의
  "데이터가 손실되지 않아야 한다"는 요구와 충돌해 기각했다(02-persistence-concurrency-design.md).
  이 기각 근거를 코드로 실증하기 위해 write-behind 테스트 더블(인메모리 버퍼 → 지연 flush)을
  만들어 flush 전 강제 실패를 주입했고, 실제로 커밋 데이터가 재조회 시 사라짐을 확인했다(기각
  근거 실증). 대조로 현재 채택안(즉시 write)은 동일 시나리오에서 유실이 없었다. 이 더블 구현은
  Ponytail 사다리 1단(생략 가능) 판정 대상이었지만, "재현→해결→기각안 실측" 서사를 완결하기 위해
  구현을 명시적으로 확정했다(09 확정 #14 계열, 사용자 확정 예외).

### 8.3 커버리지 실측

`yarn test:cov` 실측(2026-07-18, 25 test suites / 130 tests 모두 통과):

| | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| 전역 | 98.48% | 95.07% | 93.47% | 98.68% |
| `src/domain/`(guard 순수 함수) | 100% | 100% | 100% | 100% |

전역 임계값(97/86/92/98)과 domain 임계값(100/100/100/100) 모두 충족. 미커버 라인은 `otel.bootstrap.ts`의
SDK shutdown 에러 핸들러 일부(51-55행, 실제 SDK 종료 실패 경로라 유닛 테스트로 결정론적 재현이
어려움)와 `json-db-job.repository.ts`의 방어적 브랜치 2곳(52, 263행) 등 실전에서 도달하기 어려운
방어 코드에 집중되어 있다.

### 8.4 시간이 더 있다면 (Follow-ups)

09-final-design.md 및 개별 설계 로그의 Follow-ups를 인용한다.

- **`GET /jobs` 페이지네이션**: 현재는 전량 반환. job 수가 커지면 `limit`/`offset` 쿼리 파라미터
  추가 검토(04-api-layer-design.md Follow-ups).
- **`retryCount` backoff**: 현재는 상한(3회)만 있고 재시도 간격 제한이 없다. 지수 백오프 등 시간
  기반 재시도 제약 추가 여지(01-state-transition-design.md Follow-up 계열).
- **큐/워커 확장 경로**: 현재 "처리"는 상태 전이뿐이라 인메모리 큐+워커 도입은 순비용(이중 대기열,
  처리량 이득 0)으로 판단해 미도입 확정. 향후 job 처리가 외부 API 호출 등 직렬화되지 않는 실작업을
  갖게 되면 그 시점에 Strategy 뒤로 큐+워커를 도입하고, jobId dedup·파일=정본 원칙(크래시 시 다음
  tick 재적재)·큐 대기시간 지표를 함께 추가한다(09-final-design.md 확정 #14, 03-scheduler-processing-design.md).
- **write-behind/배치 flush 재검토**: job 수가 커져 전체 파일 rewrite 비용이 체감되면, 크래시 유실
  완화책(예: WAL, 주기적 스냅숏)을 동반한 write-behind 전략을 재검토 후보로 남긴다
  (02-persistence-concurrency-design.md Follow-ups).
- **`GET /jobs/:id` id 형식 검증**: 비-UUID id에 대해 400과 404를 구분하는 검증을 추가할 수 있다
  (8.1절 참조, 현재는 미구현).

### 8.5 뉴스 다이제스트 Job — 동시성 실증 예제(설정·등록·호출)

REQUIREMENTS의 "동시성"은 API와 스케줄러가 같은 JSON 파일에 동시 접근해도 손실·깨짐이 없어야 한다는
**공유 데이터 무결성**이며, 이는 이미 직렬화 큐+guard-in-lock과 C-1~C-5로 해결·증명돼 있다(8.1/8.2절).
그 위에서 "실제 외부 I/O를 하는 job"이 드러내는 **다른 층위의 동시성 성질**(락 밖 처리 규율, tick overrun,
at-least-once/idempotency, timeout)을 실증하기 위해, `JobProcessor` Strategy 확장점 뒤에 뉴스→Gemini→Slack
처리기를 붙였다(위 371~374행 Follow-up의 "외부 API 호출 실작업" 확장 경로 실현).

**동작**: 제목이 `NEWS_DIGEST_JOB_TITLE`(기본 `news-digest`)인 pending job이 tick에 선점되면, 오늘의 뉴스
기사(RSS: 제목+스니펫)를 가져와 Gemini로 **동일 주제끼리 그룹으로 묶고 각 그룹을 1~2문장 요약**한 뒤, 주제별로
정리한 다이제스트를 Slack Incoming Webhook으로 전송한다(그룹핑은 Gemini의 JSON 출력을 파싱).

**등록/호출 설계(핵심 결정)**: `JOB_PROCESSOR`는 스케줄러 전역 단일 바인딩이라, 뉴스 어댑터를 그대로
바인딩하면 API로 만든 *모든* job이 뉴스 전송을 타는 사고가 난다. 그래서 도메인 스키마를 바꾸지 않고
`DispatchingJobProcessor`(application 계층, Strategy+Composite)로 **제목 sentinel이 일치하는 job만**
`NewsDigestJobProcessor`로 라우팅하고 나머지는 기존 `DefaultJobProcessor`로 보낸다. 배선은
`src/adapters/scheduler/job-processor.factory.ts`가 담당하며, 어떤 delegate든 `TracingJobProcessor`로 감싸
job별 스팬 계측을 유지한다(infrastructure→adapters 역참조 없음, Rule 3).

**호출 예시**:

```bash
# .env에 GEMINI_API_KEY/SLACK_WEBHOOK_URL 채우고 NEWS_DIGEST_ENABLED=true 로 둔 뒤 서버 기동
curl -s -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title":"news-digest","description":"오늘의 뉴스 키워드 다이제스트"}'
# 다음 tick(<=60초)에 스케줄러가 선점 → 뉴스 처리 → Slack 전송, 성공 시 completed 커밋
```

**동시성·견고성 설계**:

- **락 밖 처리**: 외부 I/O(RSS/Gemini/Slack)는 저장소 임계구역 *바깥*에서 실행된다(선점 → 락 밖 처리 → 커밋
  파이프라인). 느린 외부 호출이 직렬화 큐를 막지 않는다.
- **no-throw 오류 계약**: `JobProcessor` 구현체는 절대 예외를 던지지 않고 모든 오류(실패·timeout·비정상 응답)를
  `outcome:'failed'`로 매핑한다. 유스케이스에도 per-job try/catch 안전망을 두어, 계약 위반 구현체 1건이 배치
  잔여 job을 `processing`에 고착시키지 못하게 한다.
- **timeout**: 뉴스 처리 파이프라인 **전체**에 `AbortController`로 `NEWS_DIGEST_TIMEOUT_MS`(기본 10초) 상한을
  부과한다(fetch+Gemini+Slack 합산). 응답 없는 호출이 tick을 무한 지연시키지 못한다.
- **idempotency(dedupe, 방어적)**: 전송 완료(`markDelivered`)한 `job.id`를 인프로세스 원장에 기록해 재전송을
  줄인다. 다만 `completed`는 종단이라 정상 성공 job은 재선점되지 않으므로 이 경로는 **defense-in-depth**이며,
  전송은 성공했으나(Slack 수신) 이후 처리 오류로 `failed` 판정된 job이 `failed→pending` PATCH로 재처리되면
  **중복 전송이 발생할 수 있다**(외부 부수효과와 내부 상태의 dual-write는 원자적이지 않다).
- **알려진 한계(at-least-once)**: 위 이유로 본 파이프라인은 at-least-once다 — (a) 전송 성공 후 실패 판정된 job의
  재시도, (b) 인프로세스 원장이 비워지는 프로세스 재시작 후 재처리에서 중복이 가능하다. exactly-once는 전송 전
  dedupe 마킹+durable 원장 또는 outbox 패턴이 필요하며 본 데모 범위 밖이다. 커밋 직전 크래시로 `processing`에
  고아로 남는 job의 복구도 도메인 전이표 변경(`processing→pending`)이 필요해 별도 승인 대상이다.
- **로컬 스모크 실행 주의(PUBLIC 레포)**: 실호출 데모 시 `jobs.json`은 추적 파일이라 런타임 데이터가 커밋될 수
  있다 — 실행용 DB 경로를 분리하거나 데모 후 원복하고 커밋 전 `git diff`로 검수한다.

**관측성(Tempo·Loki·Grafana)**:

- **Tempo(트레이스)**: 처리 단계마다 `scheduler.process-job` 아래 `news.fetch`·`news.summarize`·`news.notify`
  자식 스팬을 남긴다(속성: `news.article_count`·`news.group_count`·`news.model`). 각 단계 실행시간이 트레이스
  waterfall로 보인다.
- **Loki(로그)**: 처리 1건마다 `digest` 이벤트(`digestDurationMs`·`articleCount`·`groupCount`·`outcome`·`model`)를
  `logs.txt`에 남기고 Alloy가 Loki로 push한다. 고유 필드 `digestDurationMs`로 다이제스트 이벤트를 구분한다.
- **Grafana 대시보드**: `observability/grafana/provisioning/dashboards/news-digest.json`(uid `newsdigest`)이 자동
  프로비저닝된다 — 실행시간 p50/p95, 처리속도(결과별 건수/5m), 성공·실패 분포, 평균 기사/그룹 수, 최근 다이제스트
  로그(traceId→Tempo 링크) 패널. 스택 기동 `docker compose -f observability/docker-compose.yml up -d` → Grafana
  http://localhost:3000.

**검증**: 뉴스 처리기 단위 테스트(해피패스 그룹 전송 / no-throw 3종 / timeout / dedupe / 빈 기사·빈 그룹), 기사
파서·Gemini 그룹핑 빌더·Slack 포맷터·config 게이팅·분배기 라우팅·유스케이스 예외 안전망, 그리고 C-4 tick overrun을
결정론적 slow 더블로 실측 연장하는 테스트로 커버한다(모두 fake 주입, 실호출 없음 — CI 결정론). 실호출 데모는 로컬
수동만 허용한다(키는 env-only).
