# Rule 7 — 릴리스(스쿼시/커밋/export)

## 요약
- 머지는 사용자 명시 승인 후 **squash 전용**.
- **PR 제목**과 **커밋 메시지 내용**은 **한글**로 작성(Conventional 타입 프리픽스만 영문).
- Conventional Commits + `package.json` SemVer 동기화.
- 모든 PR 생성/수정 시 `scripts/export-session.sh <session-name>`로 export한 `HISTORY/<KST-session-date>/<session-name>/session.html`을 **커밋 포함**(고정 경로=덮어쓰기).

## 테스트 게이트 (머지 전제)
- 머지 전 CI `verify`(lint→build→unit→e2e) 통과 필수. 테스트가 있으면 반드시 통과.
- 테스트 실패/부재로 게이트를 만족 못 하면 머지 금지 → 원인 분석 후 사용자 재확인.
- 구현 후 branch protection required check(`verify`)로 하드 강제.

## 강제
하드: `.githooks/{commit-msg,pre-merge-commit,pre-push}` + GitHub squash 전용 + `master` 브랜치 보호. 커밋 메시지 한글은 `commit-msg` 훅이 강제. PR 제목 한글/머지 승인은 컨벤션(리뷰).

## 정규 + 명령표
[.gjc/rules/40-release-flow.md](../../.gjc/rules/40-release-flow.md) (canonical gated-command table 포함)
