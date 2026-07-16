# Rule 5 — Write 승인 게이트

## 요약
인터랙티브 세션에서 파일 변경 전 사용자에게 공지·확인한다. 최종 하드 게이트는 커밋/푸시 경계(승인 granularity = per-commit/per-PR). 서브에이전트의 워크트리 쓰기는 허용되고 커밋/푸시/PR 경계에서 포착된다.

## 강제
하드: `.githooks/`(커밋/푸시). 참고: `.gjc/**`는 런타임 소유 — `.gjc/*` 거버넌스 파일은 셸로 작성.

## 정규
[.gjc/rules/40-release-flow.md](../../.gjc/rules/40-release-flow.md)
