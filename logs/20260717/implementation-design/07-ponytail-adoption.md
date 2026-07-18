# Ponytail 결정 사다리 운영 방식

- Date (KST): 20260717
- Session-name: implementation-design
- Author/agent: gjc-executor
- Status: proposed

## Context

01~06·08 문서 전체에 걸쳐 "Ponytail 사다리 판정"이라는 동일한 서술 패턴이 반복 사용되었다(예: 01의
상태 전이 표, 02의 직렬화 큐, 03의 스케줄러 파이프라인, 04의 DTO 검증, 05의 로깅, 06의 트레이싱/로그
파이프라인, 08의 테스트 러너). 이 판정은 지금까지 각 문서 저자(본 세션의 executor)가 개별적으로
`logs/TEMPLATE.md`의 자유 서술 영역에 삽입하는 **비정규 관행**으로 수행되었을 뿐, 강제하는 규칙이나
검증 게이트는 존재하지 않는다. 구현 세션(코드 작성 단계)에서도 동일한 판정 습관이 유지되지 않으면
node-json-db·class-validator 등 이미 결정된 최소해 대신 과잉 패턴(Unit of Work, 커스텀 상태머신 등)이
슬쩍 재도입될 위험이 있다. 본 문서는 (1) 원본 Ponytail(DietrichGebert/ponytail) 6단 사다리를 원문
순서·의미대로 인용하고 본 과제의 실제 판정 사례에 매핑하며, (2) 검증/에러 처리/동시성 안전 경계는
사다리 판정과 무관하게 축소 불가함을 명문화하고, (3) 구현 세션 이후 이 관행을 어떻게 제도화할지
(정규 규칙 편입 vs 결정 로그 관행 지속 vs PR 체크리스트) 결정한다.

## Chosen design / pattern / technology

### 원본 6단 사다리 원문 인용·매핑

원본은 [DietrichGebert/ponytail README](https://github.com/DietrichGebert/ponytail)의
"How it works" 절에 7행으로 제시된다("생략" 1행 + "이미 코드베이스에 있는가" 1행 + 표준lib/플랫폼/의존성/
한줄/최소 커스텀 5행). 01~06·08 전 문서는 이 중 "이미 코드베이스에 있는가"(원문 2행, 재사용 체크)를
별도 단으로 번호를 매기지 않고 각 단 판정 이전의 **암묵적 선행 체크**로 흡수해 사용해왔다(예: 02가
01의 `canTransition`을 재사용하고 03이 02의 `JobRepository` 포트를 재사용). 이 관행을 그대로 승계해,
본 세션이 실제로 사용해 온 표기를 "6단 사다리"로 고정하고 원문과의 1:1 대응을 아래 표로 명문화한다.

| 본 세션 표기 | 원문(영어, README 인용) | 의미(국문) |
| --- | --- | --- |
| 1단 — 생략(YAGNI) | "1. Does this need to exist? → no: skip it (YAGNI)" | 애초에 만들 필요가 있는지부터 묻고, 없으면 만들지 않는다. |
| *(선행 체크, 별도 번호 없음)* | "2. Already in this codebase? → reuse it, don't rewrite" | 이미 코드베이스에 있으면 재작성하지 않고 재사용한다. 본 세션은 이 체크를 이후 각 단 판정 이전에 암묵적으로 선행 적용한다(예: 도메인 guard·포트 재사용). |
| 2단 — 표준 lib | "3. Stdlib does it? → use it" | 언어 표준 라이브러리/문법으로 되면 그것을 쓴다. |
| 3단 — 플랫폼 네이티브 | "4. Native platform feature? → use it" | 채택한 프레임워크(NestJS)가 1급으로 제공하는 기능이면 그것을 쓴다. |
| 4단 — 기존 의존성 | "5. Installed dependency? → use it" | 이미 스택에 포함된(또는 스택이 표준으로 삼는) 의존성이 해결하면 신규 패키지를 더하지 않는다. |
| 5단 — 한 줄 | "6. One line? → one line" | 한 줄로 표현 가능하면 한 줄로 끝낸다. |
| 6단 — 최소 커스텀 | "7. Only then: the minimum that works" | 위 5개 단 모두 해당하지 않을 때만, 필요한 최소한의 커스텀 코드를 작성한다. |

원문의 부연 — "The ladder runs *after* it understands the problem, not instead of it" 및
"Lazy, not negligent: trust-boundary validation, data-loss handling, security, and accessibility
are never on the chopping block" — 은 아래 안전 경계 절에서 그대로 계승한다.

### 본 과제 맥락 예시 (01~06·08 실제 판정 사례 인용)

각 단이 본 세션에서 실제로 어떻게 도달·기각되었는지, 1:1로 사례를 인용한다.

| 단 | 본 과제 판정 사례 | 출처 |
| --- | --- | --- |
| 1단(생략) | 재시도 횟수 제한/backoff 정책을 "요구사항이 재시도 정책을 명시하지 않았고, 카운터 필드 추가는 과잉 설계"로 판단해 이번 스코프에서 아예 도입하지 않고 보류(Follow-ups로만 남김) | [01-state-transition-design.md](./01-state-transition-design.md) |
| 2단(표준 lib) | 상태 전이를 `Record<Status, Status[]>` 상수 + `canTransition` 순수 함수(표준 TypeScript 문법)만으로 표현, State 패턴·XState 도입 없이 종결 | [01-state-transition-design.md](./01-state-transition-design.md) |
| 3단(플랫폼 네이티브) | `@nestjs/schedule`의 `@Interval` 데코레이터로 tick 발화(신규 큐/워커 없이); class-validator/`ValidationPipe`/전역 `ExceptionFilter`로 DTO 검증·에러 응답 통일; `Interceptor` + 스케줄러의 명시적 `logger.log(...)`로 로깅; NestJS 표준 Jest(`@nestjs/testing`) 스택으로 테스트 | [03](./03-scheduler-processing-design.md), [04](./04-api-layer-design.md), [05](./05-logging-design.md), [08](./08-testing-strategy-design.md) |
| 4단(기존 의존성) | logs.txt↔Loki 공존 방안에서 Promtail/Alloy의 `static` 파일 discovery + JSON 파이프라인 스테이지(코드 변경 없는 기존 인프라 도구의 표준 설정)를 채택 | [06-observability-design.md](./06-observability-design.md) |
| 5단(한 줄) | 인프로세스 직렬화 큐를 단일 `Promise` 체인(한 줄짜리 체이닝)으로 구현, `async-mutex` 같은 표준 유틸 도입도 이 단에서 허용 | [02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md) |
| 6단(최소 커스텀) | 위 5단으로 부족할 때만 "큐 클래스 하나"로 확장(02), 처리 로직이 실제 상태별로 분화되는 시점에만 "얇은 Strategy 인터페이스 하나"로 국소 확장(03) | [02](./02-persistence-concurrency-design.md), [03-scheduler-processing-design.md](./03-scheduler-processing-design.md) |

**신규 의존성 도입의 경계 사례**: 06의 트레이싱 계측은 `@opentelemetry/sdk-node` +
`@opentelemetry/exporter-trace-otlp-http` 최소 2개 패키지를 신규로 도입하면서도 자동 계측 패키지는
배제해 "4단(스택이 아직 갖지 않은 의존성이지만, 그 의존성 자체의 기본 기능만 사용하고 그 위에 커스텀
계층을 얹지 않음)"으로 판정·기록했다. 이는 원문 5행("Installed dependency")이 전제하는 "이미 설치된
의존성"과 정확히 일치하지는 않는 **경계 사례**이며, 바로 이 지점이 아래 "신규 의존성 도입 게이트"가
필요한 이유다 — 신규 의존성을 들이더라도 "그 의존성의 표준 사용법만 쓰는지, 그 위에 커스텀 추상화를
더 얹는지"를 사다리 판정 형태로 반드시 기록해야 한다.

### 안전 경계 (검증/에러 처리/동시성은 제거 금지)

원문의 "Lazy, not negligent" 원칙과 본 계획의 Principle 1("검증/에러 처리/동시성 안전 경계는 절대
축소하지 않는다")을 다음과 같이 명문화한다.

- **어떤 사다리 단 판정도 검증·에러 처리·동시성 안전장치를 생략·축소하는 근거로 사용할 수 없다.**
  사다리는 "무엇을 새로 만들지"의 최소화 도구이지, "무엇을 검증할지"의 축소 도구가 아니다.
- 실제 반증 사례: 04에서 수동 검증((c))은 사다리 1~2단으로 내려가는 것처럼 보이지만, 5개 엔드포인트에
  검증 로직이 중복 산개해 에러 envelope 일관성이 깨지는 결과를 낳으므로 **안전 경계 축소로 간주해
  기각**했다([04-api-layer-design.md](./04-api-layer-design.md)). 즉 사다리 하단처럼 보여도 안전
  경계를 해친다면 채택하지 않는다.
- 실제 반증 사례 2: 02에서 write-behind 캐시((c))는 "인프로세스 큐 직렬화"보다 구현이 더 단순해
  보일 수 있으나, 크래시 시 데이터 유실 가능성이 있어 "데이터가 손실되지 않아야 한다"는 REQUIREMENTS의
  안전 경계를 위반할 소지가 있다는 이유로 사다리 단수와 무관하게 기각했다([02-persistence-concurrency-design.md](./02-persistence-concurrency-design.md)).
- 동시성 안전 경계는 02가 소유하는 atomic read→guard→write / guard-in-lock 계약이며, 이 계약을
  우회하는 어떤 "더 간단한" 구현도(사다리 단수가 낮아 보여도) 채택 대상에서 배제된다.

### 채택 결정 (Chosen)

Intent Reconciliation #2(00 문서 참조)에서 확정된 대로, 다음 두 가지를 **함께** 채택한다.

- **(b) 정규 규칙 편입 [채택·확정]**: 후속 세션에서 `.gjc/rules/60-ponytail.md`로 위 6단 사다리·
  안전 경계·신규 의존성 도입 게이트를 정규 규칙으로 편입한다. 편입은 **Rule 5(write-approval) 승인을
  경유**해야 하며, 본 세션은 규칙 파일을 생성하지 않고 아래 "정규 규칙 초안 골격"만 편입 세션의 입력으로
  남긴다.
- **(a) 결정 로그 관행 [과도기 병행 채택]**: `.gjc/rules/60-ponytail.md`가 편입되기 전까지는, 이번
  세션에서 실제로 사용한 방식 그대로 각 결정 로그 문서의 "Ponytail 사다리 판정" 절 관행을
  **과도기 운영 방식으로 계속 병행**한다. 즉 정규 규칙이 없다고 해서 구현 세션에서 판정 기록을
  생략하지 않는다 — 편입 전까지는 결정 로그(md) 형태가 유일한 강제 지점이다.

두 옵션을 동시에 채택하는 이유는, 정규 규칙 편입에는 Rule 5 승인이라는 별도 절차·시간이 필요하고
(본 세션 non-goal), 그 사이 구현 세션이 먼저 시작될 수 있기 때문이다. 과도기 병행이 없으면 규칙
편입 전 구현 착수 시 사다리 판정을 기록할 곳이 없어지는 공백이 생긴다.

### 정규 규칙 초안 골격 (편입 세션 입력용)

후속 편입 세션이 그대로 확장해 `.gjc/rules/60-ponytail.md`로 작성할 수 있도록, 아래 골격을 남긴다
(본 세션은 이 골격을 파일로 생성하지 않는다 — 편입 세션 + Rule 5 승인 이후 실행).

```
# Rule 60 — Ponytail 결정 사다리

## 사다리 6단 (원문: DietrichGebert/ponytail README "How it works")
1. 생략(YAGNI) — 애초에 필요한가?
   (선행 체크: 이미 코드베이스에 있는가? 있으면 재사용)
2. 표준 lib — 언어 표준 라이브러리/문법으로 되는가?
3. 플랫폼 네이티브 — 채택 프레임워크의 1급 기능인가?
4. 기존 의존성 — 이미 스택에 있는 의존성이 해결하는가?
5. 한 줄 — 한 줄로 되는가?
6. 최소 커스텀 — 위 전부 아니면, 필요한 최소 커스텀 코드.

## 안전 경계 (절대 축소 금지)
- 검증(validation), 에러 처리, 동시성 안전장치(atomic read→guard→write 등)는
  어떤 사다리 단 판정으로도 생략·축소할 수 없다.
- 사다리 하단 판정이 안전 경계를 해치면(예: 검증 로직 산개로 일관성 훼손), 그 판정 자체를 기각한다.

## 신규 의존성 도입 게이트
- node-json-db, class-validator, async-mutex, @opentelemetry 등 신규 의존성을 도입할 때는
  PR/커밋에 사다리 판정(어느 단에서 멈췄는지 + 기각된 대안)을 기록해야 한다.
- 이미 설치된 의존성의 표준 기능만 쓰는지, 그 위에 커스텀 추상화를 더 얹는지 구분해 기록한다.
- 기록 위치: 편입 이후에는 PR 설명 또는 커밋 메시지(형식은 편입 세션에서 확정); 편입 이전 과도기에는
  결정 로그(md) "Ponytail 사다리 판정" 절.

## 참조
- 원문: https://github.com/DietrichGebert/ponytail
- 본 과제 적용 사례: logs/20260717/implementation-design/07-ponytail-adoption.md
```

### 신규 의존성 도입 게이트

과도기(정규 규칙 편입 전)와 편입 후 모두에 적용되는 절차로, 아래 항목에 신규 의존성을 도입할 때는
**사다리 판정 기록이 의무**다: `node-json-db`(02), `class-validator`/`class-transformer`(04),
`async-mutex`(02, 5단 확장 후보로만 언급됨 — 실제 채택 시 판정 기록 필요), `@opentelemetry/*`(06).
기록해야 할 최소 항목은 (1) 도달한 사다리 단, (2) 기각한 대안과 이유, (3) 안전 경계 침해 여부
점검 결과다. 이는 위 표의 인용 사례들이 실제로 이미 이 형식을 따르고 있음을 확인 근거로 한다.

## Pros

- 문서 9편 전체에서 이미 관행적으로 쓰인 6단 표기를 원문과 명시적으로 대조·고정함으로써, 향후
  구현 세션에서 "몇 단인지" 논쟁 없이 동일한 척도로 판정을 이어갈 수 있다.
- (b)+(a) 병행 채택으로, 정규 규칙 편입까지의 공백 기간에도 판정 기록이 끊기지 않는다.
- 안전 경계를 사다리 판정과 명시적으로 분리해, "단수가 낮다"는 이유로 검증/동시성이 약화되는 오독을
  차단한다(04·02의 반증 사례로 이미 실증됨).

## Cons

- 원문 사다리(7행)와 본 세션 6단 표기 사이에 "이미 코드베이스에 있는가"라는 선행 체크가 번호 없이
  흡수되어 있어, 편입 세션에서 정규 규칙을 작성할 때 이 선행 체크를 별도 조항으로 승격할지 재검토가
  필요하다(Follow-ups).
- 과도기 병행((a))은 정규 규칙((b))이 편입되기 전까지 강제력이 "문서 작성 관행"에 머물러, 코드
  리뷰 없이는 실제 준수 여부를 기계적으로 검증할 수 없다(08의 동시성 회귀 테스트처럼 코드 검증
  가능한 항목이 아니다).

## Performance tradeoffs

문서/프로세스 결정이므로 런타임 성능에는 영향이 없다. 다만 신규 의존성 도입 게이트가 기록 의무를
추가하므로, 구현 세션의 "결정 기록 오버헤드"가 약간 증가한다 — 이는 R1(문서 비대화 리스크)과
동일한 종류의 트레이드오프이며, 항목당 몇 줄 수준의 기록이므로 3일 마감에 유의미한 영향은 없다.

## Side effects

- 구현 세션이 이 문서의 신규 의존성 목록(node-json-db·class-validator·async-mutex·@opentelemetry)에
  해당하는 패키지를 `package.json`에 추가할 때마다, 사다리 판정 기록이 없으면 리뷰에서 반려될 수 있는
  절차적 결합이 생긴다.
- `.gjc/rules/60-ponytail.md` 편입 세션은 Rule 5(write-approval) 승인 절차를 경유해야 하므로, 편입
  시점이 구현 세션 착수 시점보다 늦어질 수 있다 — 이 지연이 (a) 과도기 병행 채택의 직접적 근거다.

## Alternatives considered

- **(c) PR 리뷰 체크리스트에 사다리 판정 항목 추가**: PR 템플릿에 "이 변경이 사다리 몇 단인가?"
  체크박스를 추가하는 방식. 강제 시점이 코드 작성 이후(리뷰 단계)로 늦어져 이미 과잉 구현이 끝난
  뒤에야 발견되며, 기록이 PR마다 산발적으로 흩어져 결정 로그처럼 한곳에서 조회할 수 없다 → 기각.
  다만 (b) 정규 규칙 편입 이후에는 신규 의존성 도입 게이트의 기록 위치 후보(PR 설명)로 부분
  재활용될 수 있음을 골격에 남긴다.
- **(d) CI에서 신규 의존성 추가 시 자동으로 사다리 판정을 강제하는 린트/훅 도입**: `package.json`
  diff를 감지해 사다리 판정 문구가 커밋 메시지에 없으면 실패시키는 방식. 3일 마감 과제에 CI 인프라를
  새로 구축하는 비용이 이득보다 크고, 이 강제 도구 자체를 만드는 행위가 "Ponytail 강제 장치의
  과잉 설계"라는 자기모순에 빠진다(사다리 1단 "이게 필요한가?"에서 이미 걸러져야 할 대상) → 기각.

## Follow-ups

- `.gjc/rules/60-ponytail.md` 정규 규칙 편입 세션(Rule 5 승인 경유) — 위 초안 골격을 입력으로 사용.
  편입 시 원문 "이미 코드베이스에 있는가" 선행 체크를 별도 조항으로 승격할지 함께 결정한다.
- 편입 이후 신규 의존성 도입 게이트의 기록 위치(PR 설명 vs 커밋 메시지 vs 둘 다)를 편입 세션에서
  확정한다.
- 코드 구현 세션(트레이싱 최소 실장 계측 포함)에서 실제로 `@opentelemetry/*` 등을 도입할 때, 본
  문서가 정의한 게이트 절차를 그대로 적용해 판정을 기록해야 한다(06의 R7 참조).
