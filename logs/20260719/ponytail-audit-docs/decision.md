# Ponytail 전수 감사 + 문서 이원화(README/ARCHITECTURE) + 미구현 작업 거부

- Date (KST): 20260719
- Session-name: ponytail-audit-docs
- Author/agent: gjc (ralplan 합의 → ultragoal 실행)
- Status: accepted

## Context

승인된 ralplan 최종 플랜(pending-approval.md, Architect CLEAR/APPROVE · Critic OKAY · reconciled-clean)을
실행한다. 목표는 (1) Ponytail 결정 사다리 렌즈로 아키텍처·디자인패턴·유지보수 전수 감사 후 확정 이탈 최소
수정, (2) README를 정중체·간결·실행/검증 중심으로 재작성, (3) 상세 설계를 ARCHITECTURE.md로 신설·이관이다.
실행 중 사용자 지시로 두 story가 추가되었다: (4) API가 "구현되지 않은 작업"을 등록하면 오류가 나도록 변경
(현재는 무동작 성공), (5) README에 스케줄러 tick 처리·job 등록·실행 과정을 시나리오로 서술 + Swagger 접근법.

## Chosen design / pattern / technology

### 감사 옵션 A — news-digest.ports.ts 위치: **A1(현행 유지) 확정** (사용자 확인)
로컬 인프라 포트를 유지하고, ARCHITECTURE.md §0.1에 저장소 배치 관례("infrastructure = outbound
어댑터+배선, adapters = inbound+합성")를 명문화해 Rule 3 문언과의 긴장을 해소한다. seam 소비자가 전부
`infrastructure/news-digest` 내부에 공존하므로 이동은 안전성 이득 0인 순수 churn → Ponytail 1단(생략) 판정.

### 감사 옵션 B — README §8 분할: **B1(요약 존치 + 상세 이관) 확정**
REQUIREMENTS.md 52~56행이 "본인 코멘트"의 README 포함을 강제하므로 요약본은 존치하고, 상세 설계 근거·
동시성 재현 서사·뉴스 파이프라인 상세는 ARCHITECTURE.md로 이관한다.

### 신규 기능 — 미구현 작업 유형 등록 거부(사용자 story)
`POST /jobs`가 구현된 작업 유형이 아닌 요청을 **400 `UNSUPPORTED_JOB_TYPE`**로 거부한다. 구현 유형 판별은
신규 application 포트 `SupportedJobTypes`(+ `AllowListJobTypes` 구현)에 위임하고, 운영 배선은 스케줄러가
실제 라우팅하는 유형(뉴스 다이제스트 sentinel 제목 `news-digest`)으로 구성한다. 검증은 use-case에서
수행하고 컨트롤러가 판별 유니온을 HTTP로 매핑한다(Rule 3 유지). 관리자 화면은 기존 `ApiError`→toast
경로로 오류를 표기한다(코드 변경 불요).

#### Ponytail 사다리 판정(신규 포트)
- 안전 경계(입력 검증)를 **추가**하는 변경이므로 carve-out 원칙에 부합(검증은 축소 금지 대상이며, 여기서는 강화).
- 6단(최소 커스텀): 기존 코드에 "이 작업 유형이 구현되었는가"를 판별하는 seam이 없어 최소 포트 1개 + 구현 1개로 신설.
  값 배열 주입(5단)도 가능하나, 저장소가 전 계층에 포트를 쓰는 관례와 테스트 대체성(AllowAll/AllowList)을 위해
  얇은 포트로 감쌌다(05 LoggerPort 선례와 동일 근거). 신규 의존성 0.

## Pros
- "무동작 성공" job 생성이 원천 차단되어 API 계약이 정직해진다(요청이 실제 처리 가능한 작업만 수락).
- 구현 유형 목록이 주입형이라 향후 처리기 추가 시 배선 1줄로 확장(운영), 테스트는 격리 유지(blast radius 최소).
- 문서 이원화로 README는 사용자 관점(실행/검증), ARCHITECTURE는 설계 상세로 관심사가 분리된다.

## Cons
- 운영 배선에서는 `news-digest` 외 임의 제목 job을 더 이상 생성할 수 없다(제네릭 job 생성 표면 축소).
  기존에 커밋된 시드 샘플(제네릭 제목)은 이미 영속화된 데이터라 조회는 가능하나 재생성은 불가하다.
- README §8 이관으로 두 문서 간 중복 제거 편집 비용 발생(아래 이관표로 관리).

## Performance tradeoffs
- 생성 경로에 Set 조회 1회(O(1))만 추가되어 런타임 영향은 무시할 수준. 스케줄러/동시성 경로는 무변경.

## Side effects / Blast radius (미구현 작업 거부)
- **테스트**: 생성 검증이 관심사가 아닌 단위/컨트롤러/e2e 테스트는 `AllowAllJobTypes` 더블/오버라이드로 임의
  제목을 유지(격리). 저장소·도메인·동시성 테스트는 POST를 거치지 않아 무영향. 거부/허용 전용 테스트를 신설.
- **검증 결과**: `yarn build` OK, `yarn lint` clean, `yarn test` 250/250, `yarn test:e2e` 24/24,
  coverage 98.73/94.26/95.12/98.96(임계 97/86/92/98 충족), domain/application→adapters/infrastructure import 0건.
- **REQUIREMENTS 정합**: 명세는 "자유 설계 + 본인 해석을 README에 명시"를 허용하므로, 이 결정은 README 본인
  코멘트에 의도적 해석으로 기록한다.

## README §8 → ARCHITECTURE.md 이관표
| 원문(README) | 새 위치(ARCHITECTURE.md) |
| --- | --- |
| 8.1 상태 전이·동시성 자유 설계 해석(상세 근거) | §2 스케줄러 + §1 API 상세 |
| 8.2 C-1~C-5 재현→해결 서사(전문) | §2 스케줄러 "동시성 재현→해결" |
| 8.5 뉴스 다이제스트 설계/동시성/관측성(상세) | §3 뉴스 전달 프로그램 |
| §5·§6 심층 설명 문단 | §2 스케줄러 / 관측성 |
| 8.3 커버리지 실측 | README 테스트 절 2줄 요약 존치 |
| 8.4 Follow-ups | README §8 요약 불릿 존치 |

## Alternatives considered
- 미구현 거부 옵션 B(하위호환 type 필드) — "제목만 준 제네릭 job이 그냥 성공"하는 버그를 그대로 남겨 사용자
  요구를 부분만 충족 → 기각. 옵션 C(등록 허용, 처리 단계 failed) — "api에서 오류" 요구와 불일치 → 기각.
- 판별 seam으로 도메인 `type` 필드 신설 — 도메인/저장소/응답 스키마 변경으로 blast radius가 커지고, 기존
  news-digest가 이미 title sentinel로 라우팅하는 관례와 불일치 → 기각(title 레지스트리 재사용 채택).
- `.gjc/rules/60-ponytail.md` 정식 편입 — Rule 5 승인 거버넌스 세션 필요, 이번 범위 밖(F4, 사용자 확인).

## Follow-ups
- `.gjc/rules/60-ponytail.md` 정식 편입(Rule 5 승인 세션).
- 구현 작업 유형이 늘면 `SUPPORTED_JOB_TYPES` 배선 확장(현재 news-digest 1종).
- eslint-plugin-boundaries/dependency-cruiser 경계 강제(advisory).
- 검증 로그(docker compose 기동 실측 등)는 실행 후 본 문서에 append.
