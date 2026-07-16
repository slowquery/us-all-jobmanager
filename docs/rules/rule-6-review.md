# Rule 6 — 완료 시 PR + 3인 전문 리뷰

## 요약
완료 시 워크트리에서 PR 생성(**제목은 한글**) → 사용자 확인 → 설계/보안/성능 3인 리뷰어(`.gjc/agents/review-*.md`)가 PR 코멘트로 개선점 제시 → 사용자에게 검증·수정 제안.

## 강제
하드: 리뷰어 에이전트 프론트매터 `tools:` 화이트리스트로 write/edit/ast_edit 제외 + 읽기·PR코멘트 전용 `bashAllowedPrefixes`. 오케스트레이션 순서는 어드바이저리.

## 정규
[.gjc/rules/40-release-flow.md](../../.gjc/rules/40-release-flow.md)
