# 머지 테스트 게이트 추가 (Rule 7)

- Date (KST): 20260716 · Session-name: project-governance

## Context
사용자 요청: 사용자가 머지를 수락하더라도 unit/e2e 테스트가 동작·통과하는지 확인하고, 통과해야만 머지. 실패 시 원인 분석 후 사용자 재확인.

## 변경
- `.github/workflows/ci.yml`: PR/푸시(master)에서 `verify` 잡 실행 — install→lint→build→unit(`yarn test`)→e2e(`yarn test:e2e`). 테스트 스크립트가 있으면 실행·실패 시 red, 없으면 경고(현재 미구현 상태 정직 반영).
- `.gjc/rules/40-release-flow.md`, `docs/rules/rule-7-release.md`, `AGENTS.md`에 "머지 전 CI 통과 필수, 실패 시 머지 금지·원인분석·사용자 확인" 규칙 반영.

## 현재 상태(근거)
- `yarn test` → exit 1(스크립트 없음), `yarn lint` → 통과, `yarn build` → 통과. 프로젝트에 jest/spec/테스트 스크립트가 전무.
- 따라서 unit/e2e 테스트 게이트를 **긍정적으로 만족시킬 수 없음**. PR #1은 문서/거버넌스 전용(src 변경 없음).

## 트레이드오프
- CI 소프트가드(테스트 미존재 시 경고)는 노이즈를 줄이나, 하드 강제는 required status check(`verify`) + 실제 테스트 구현 후 활성화 필요.
- 대안: 최소 smoke 테스트(jest unit + e2e)를 지금 추가해 게이트를 즉시 하드화.
