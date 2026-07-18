# architect·planner 에이전트 모델을 Fable 5로 지정

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
사용자 요청: 앞으로 gjc 세션에서 `architect`, `planner` 에이전트가 Fable 5 모델을 사용하도록 하고 현재 PR에 반영.

`architect`/`planner`는 번들 기본 역할 에이전트이며, 모델은 워크스페이스 설정 `.gjc/config.yml`의 `task.agentModelOverrides`(role → "provider/modelId[:effort]" 셀렉터)로 세션마다 바인딩된다(GJC `src/config/model-registry.ts`, `src/task/index.ts`에서 소비). `planner`는 이미 `anthropic/claude-fable-5`였고, `architect`만 `anthropic/claude-opus-4-8`이었다.

## Chosen design / pattern / technology
- `.gjc/config.yml`의 `task.agentModelOverrides.architect`를 `anthropic/claude-opus-4-8` → `anthropic/claude-fable-5`로 변경. `planner`는 기존 Fable 5 유지 확인.
- 셀렉터는 기존 라인들과 일관되게 bare(effort suffix 없음)로 유지. GJC가 프로필/레지스트리에서 effort를 클램프한다.
- 이 설정은 이 레포에서 시작되는 모든 gjc 세션에 project 레벨로 병합 적용된다.

## Pros
- architect/planner 모두 Fable 5로 통일 — 요청대로 앞으로의 세션에 일괄 적용.
- 코드 변경 없이 선언적 설정 1파일로 반영, 회귀 위험 없음.

## Cons
- critic/executor는 각각 Opus 4.8/Sonnet 5 유지(요청 범위 밖) — 역할별 모델이 혼재.

## Performance tradeoffs
- 런타임 앱 성능과 무관. 에이전트 추론 품질/비용 특성만 모델별로 달라짐.

## Side effects
- CI SemVer 게이트(04편) 대상이므로 version 0.1.0 → 0.1.1(patch) bump.
- `HISTORY/20260718-implementation/session2.html`를 본 세션분으로 재export.

## Alternatives considered
- 모델 프로필(`claude-fable`) 전체 전환: default/executor/critic까지 바뀌어 요청 범위를 초과 → 기각, 역할 오버라이드만 수정.
- effort suffix 명시(`:xhigh`/`:low`): 기존 config가 bare 셀렉터라 일관성 위해 미도입.

## Follow-ups
- 없음. critic/executor 모델 변경이 필요하면 동일 파일에서 후속.
