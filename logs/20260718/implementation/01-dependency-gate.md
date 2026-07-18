# S0 의존성 설치 + Ponytail 게이트 결정 로그

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc-executor
- Status: accepted

## Context

09-final-design.md(정본)가 확정한 스택을 실제로 `package.json`에 반영하는 구현 세션의 첫 슬라이스(S0)다.
07-ponytail-adoption.md의 "신규 의존성 도입 게이트"는 `node-json-db`, `class-validator`/
`class-transformer`, `@opentelemetry/*`를 신규 의존성 도입 시 사다리 판정 기록이 의무인 항목으로
명시했다(07 §신규 의존성 도입 게이트). 본 문서는 이번에 `yarn add`로 실제 설치한 패키지 각각에 대해
그 사다리 판정을 기록하고, 아직 리포지토리에 없는 `marocchino/sticky-pull-request-comment` GitHub
Action(향후 CI PR 코멘트 자동화 후보)의 SHA 핀 판정을 함께 남겨 후속 세션(CI 확장)이 별도 조사 없이
정확한 커밋 SHA를 참조할 수 있게 한다.

## Chosen design / pattern / technology

### 신규 런타임 의존성 6종 — Ponytail 사다리 판정

| 패키지 | 도달 단 | 판정 근거 | 기각된 대안 |
| --- | --- | --- | --- |
| `node-json-db` | 4단(기존 의존성 — 이번 세션이 채택한 스택 자체) | 02-persistence-concurrency-design.md가 이미 파일 기반 JSON 저장소를 정본으로 확정. 표준 lib(2단)·NestJS 네이티브(3단)로는 영속화 자체가 불가능해 4단에서 멈춤 | SQLite/TypeORM(과잉 — 요구사항이 파일 기반 JSON을 명시), 순수 `fs.writeFile` 직접 구현(6단 최소 커스텀에 해당하나 원자적 쓰기·인덱싱을 직접 재구현하는 비용이 더 큼) |
| `class-validator` | 3단(플랫폼 네이티브 — NestJS `ValidationPipe`가 1급으로 전제하는 검증 라이브러리) | 04-api-layer-design.md가 수동 검증((c))을 "에러 envelope 일관성 훼손"으로 기각하고 데코레이터 기반 검증을 채택. NestJS 공식 문서가 `ValidationPipe`와 함께 사용하는 표준 조합이므로 3단 | 수동 if-검증(안전 경계 축소로 기각, 07 §안전 경계 반증 사례 1), Joi/zod(신규 검증 프레임워크 도입은 NestJS 네이티브 조합 대비 이득 없음) |
| `class-transformer` | 3단(플랫폼 네이티브) | `class-validator` DTO의 타입 변환(`@Type`) 짝으로 NestJS `ValidationPipe`가 `transform: true` 옵션에서 공식 전제하는 동반 패키지 | 수동 `plainToClass` 대체 유틸 직접 작성(6단, 표준 페어링을 두고 재구현할 이유 없음) |
| `@opentelemetry/sdk-node` | 4단(기존 의존성이 아닌 신규 의존성 — 07이 정의한 경계 사례) | 09 확정 #12(트레이싱 Tempo 최소 실장)에 따른 신규 도입. 07의 경계 사례 판정을 그대로 승계: "그 의존성의 기본 기능만 사용하고 그 위에 커스텀 계층을 얹지 않음" | 자동 계측 패키지(`@opentelemetry/auto-instrumentations-node`) 배제 — 06/07이 이미 "자동 계측 패키지는 배제"로 기각 확정 |
| `@opentelemetry/exporter-trace-otlp-http` | 4단(위와 동일 경계 사례) | Tempo가 OTLP/HTTP 수신을 표준 지원하므로, exporter는 SDK의 표준 플러그인 형태로만 사용(커스텀 exporter 구현 없음) | 커스텀 exporter 직접 구현(6단, 표준 OTLP exporter가 이미 요구를 충족해 불필요) |
| `@opentelemetry/api` | 4단(신규 의존성이나 peerDependency 병행 설치 — 아래 별도 절 참조) | — | — |

### `@opentelemetry/api` peerDependency 병행 설치 명기

`@opentelemetry/sdk-node`(설치본 `0.220.0`)의 `package.json`은
`"peerDependencies": { "@opentelemetry/api": ">=1.3.0 <1.10.0" }`를 선언한다(node_modules 확인 완료).
Yarn Berry(PnP 미사용, node-modules 링커) 환경에서도 peerDependency는 자동 설치되지 않고 소비자
프로젝트가 직접 `dependencies`에 명시해야 해석 경고(`YN0002`)와 버전 불일치를 피할 수 있다. 이번
`yarn add` 실행에 `@opentelemetry/api`를 sdk-node·exporter와 **동시에(같은 명령 한 번으로) 병행
설치**해 `^1.9.1`(peerDependency 범위 `>=1.3.0 <1.10.0`를 만족)로 고정했다. 이는 07 §"기존 의존성의
표준 기능만 쓰는지" 원칙을 그대로 따른 것으로, API 패키지 위에 별도 추상 계층을 얹지 않고
계측 코드가 `@opentelemetry/api`를 직접 import하는 표준 사용법만 전제한다.

### `marocchino/sticky-pull-request-comment@SHA` 핀 판정

현재 `.github/workflows/ci.yml`에는 이 Action이 아직 사용되지 않는다(확인 완료 — `search` 결과 0건).
09-final-design.md·07 어느 문서도 PR 코멘트 자동화를 이번 3일 마감 스코프의 필수 항목으로 지정하지
않았으므로, **1단(YAGNI) — 이번 세션에서는 도입하지 않는다**가 사다리 판정이다. 다만 향후 CI 세션이
"lint/coverage 결과를 PR 코멘트로 sticky 갱신"을 요구할 경우를 대비해, GitHub API로 확인한 최신 릴리스
SHA를 아래에 고정 기록해 후속 세션이 재조사 없이 SHA 핀 방식으로 참조할 수 있게 한다.

- 확인 시각 기준 최신 태그: `v2.9.4`
- 전체 커밋 SHA(GitHub API `GET /repos/marocchino/sticky-pull-request-comment/git/refs/tags/v2.9.4`로
  확인): `773744901bac0e8cbb5a0dc842800d45e9b2b405`
- 채택 시 사용 형식: `uses: marocchino/sticky-pull-request-comment@773744901bac0e8cbb5a0dc842800d45e9b2b405 # v2.9.4`
  (버전 태그가 아닌 커밋 SHA 핀 — 서드파티 GitHub Action의 공급망 보안 표준 관행)
- 이번 세션 판정: 미도입(1단, YAGNI). SHA 값만 참조용으로 기록하며 `.github/workflows/ci.yml`은
  수정하지 않는다.

### 테스트 도구(부족분만 추가)

`package.json` 기존 devDependencies 확인 결과 `jest`/`ts-jest`/`@nestjs/testing`/`@types/jest` 전부
부재했다(08-testing-strategy-design.md가 이미 확정한 "(a) NestJS 표준 Jest 스택, 사다리 3단" 판정을
그대로 실장하는 설치이며, 신규 판정은 아니다). `supertest`/`@types/supertest`와 함께 한 번에 설치했고,
`@nestjs/schedule`은 기존 dependencies에 `^6.1.3`으로 이미 존재함을 확인해 재설치하지 않았다.

### `package.json` scripts

`test`(`jest`), `test:cov`(`jest --coverage`), `test:e2e`(`jest --config ./test/jest-e2e.json`)를
추가했다. `.github/workflows/ci.yml`이 이미 `test`/`test:e2e` 스크립트 존재 여부를 조건 분기로 검사하는
구조였으므로(스크립트 부재 시 `::warning::` 후 스킵), 이번 추가로 CI가 실제 테스트를 실행하는 경로로
전환된다. NestJS 표준 스캐폴딩과 동일하게 unit(`src/**/*.spec.ts`, `rootDir: src`)과 e2e
(`test/**/*.e2e-spec.ts`, `test/jest-e2e.json`)를 분리했다(08의 계층별 전략과 1:1 대응).

## Pros

- 07의 신규 의존성 도입 게이트를 실제 `yarn add` 실행 시점에 그대로 적용해, 사다리 판정 없이
  패키지가 슬쩍 추가되는 것을 방지했다.
- `@opentelemetry/api` peerDependency를 명시적으로 병행 설치해 버전 불일치 경고 없이 고정했다.
- marocchino Action의 SHA를 미리 조사·기록해두어, 향후 CI 확장 세션이 SHA 핀 조사 비용 없이 즉시
  채택 여부만 결정하면 된다.

## Cons

- marocchino Action 판정은 "아직 쓰지 않지만 SHA만 기록"하는 선제적 기록이라, 실제 도입 시점에
  SHA가 최신 릴리스 대비 뒤처져 있을 수 있어(릴리스는 계속 나옴) 도입 세션에서 재확인이 필요하다.
- OpenTelemetry 3종을 한 번에 설치해 `yarn.lock`에 44개 하위 의존성이 추가됨(관측성 스택의 일반적
  비용이며, 06/07이 이미 감수하기로 확정한 트레이드오프).

## Performance tradeoffs

- 의존성 설치 자체는 런타임 성능과 무관하다. `yarn install --immutable`(CI)의 콜드 캐시 설치 시간이
  약간 늘어나지만(신규 패키지 약 100개, node_modules +약 53MiB), 3일 마감 CI 실행 시간에 유의미한
  영향은 없다.

## Side effects

- `package.json`의 `dependencies`/`devDependencies`/`jest`/`scripts` 4개 절이 변경되고, `yarn.lock`이
  갱신된다.
- `test/jest-e2e.json`이 신규 생성되어 `test:e2e` 스크립트가 참조하는 설정 파일이 생겼다(아직 실제
  `*.e2e-spec.ts` 파일은 없음 — 04/08 슬라이스에서 추가 예정).
- `.github/workflows/ci.yml`의 조건부 스킵 경로(`test`/`test:e2e` 스크립트 부재 시 warning)가 이번
  변경으로 실행 경로로 전환되므로, 이후 슬라이스가 실제 테스트를 채우지 않으면 e2e 스텝이 "테스트
  파일 없음" 오류로 실패할 수 있다(추후 슬라이스에서 e2e 테스트 추가로 해소 예정, S0 스코프 밖).

## Alternatives considered

- **모든 의존성을 한 번의 `yarn add`로 통합 설치**: 런타임/개발 의존성을 구분해 기록하는 07의 게이트
  취지(패키지군별 판정)와 어긋나 기각 — 실제로는 런타임 6종/개발 4종 두 번의 `yarn add`로 분리
  실행했다.
- **marocchino Action을 이번 세션에 바로 `.github/workflows/ci.yml`에 추가**: 09 최종 설계·
  REQUIREMENTS 어디에도 PR 코멘트 자동화가 필수 요구사항으로 없어 YAGNI(사다리 1단) 위반 → 기각,
  SHA만 기록.
- **`@opentelemetry/api`를 devDependencies로 분리**: 계측 코드가 `src/`(프로덕션 런타임)에서 직접
  import하므로 `dependencies`가 맞다 → 기각.

## Follow-ups

- CI가 PR 코멘트 자동화(커버리지/린트 요약 sticky 코멘트)를 요구하게 되면, 위에 기록한
  `marocchino/sticky-pull-request-comment@773744901bac0e8cbb5a0dc842800d45e9b2b405 # v2.9.4` SHA를
  최신 릴리스 대비 재확인한 뒤 `.github/workflows/ci.yml`에 추가한다.
- `test/jest-e2e.json`을 소비하는 실제 e2e 테스트(`*.e2e-spec.ts`)는 04(API 레이어)·08(테스트 전략)
  슬라이스에서 추가된다 — S0은 스크립트/설정 골격만 제공한다.
- `.gjc/rules/60-ponytail.md` 정규 규칙 편입(07 Follow-up, Rule 5 경유)이 완료되면, 이 문서 형식의
  "결정 로그 관행"에서 PR 설명/커밋 메시지 기록 방식으로 전환할지 재검토한다.
