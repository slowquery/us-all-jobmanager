# Rule 7 — 릴리스(스쿼시/커밋/export)

## 요약
- 머지는 사용자 명시 승인 후 **squash 전용**.
- **PR 제목**과 **커밋 메시지 내용**은 **한글**로 작성(Conventional 타입 프리픽스만 영문).
- Conventional Commits + `package.json` SemVer 동기화. **소스/기능 변경 PR은 `package.json` version을 base보다 반드시 상향**(CI `verify`의 `SemVer bump 게이트`가 하드 강제).
- **머지(squash) subject 형식 = `<type>: (X.Y.Z) 한글설명`**(type은 변경 성격 유지, `(X.Y.Z)`=`package.json` version). 예: `feat: (0.8.0) 릴리스 자동 태깅 추가`.
- **머지 시 `vX.Y.Z` 태그 자동 부착**: master push 때 CI `verify` 통과 후 `tag` job이 version 기준으로 태그를 멱등 생성·push하고, 머지 subject 형식·버전·한글을 사후 검증(위반 시 CI 실패).
- 모든 PR 생성/수정 시 `scripts/export-session.sh <session-name>`로 export한 `HISTORY/<KST-session-date>/<session-name>/session.html`을 **커밋 포함**(고정 경로=덮어쓰기).

## 테스트 게이트 (머지 전제)
- 머지 전 CI `verify`(lint→build→unit→e2e) 통과 필수. 테스트가 있으면 반드시 통과.
- 테스트 실패/부재로 게이트를 만족 못 하면 머지 금지 → 원인 분석 후 사용자 재확인.
- 구현 후 branch protection required check(`verify`)로 하드 강제.

## 강제
하드: `.githooks/{commit-msg,pre-merge-commit,pre-push}` + GitHub squash 전용 + `master` 브랜치 보호 + CI `tag` job(태깅·subject 형식 검증). 커밋 메시지 한글·subject `(X.Y.Z)` 일치는 `commit-msg` 훅이 강제. PR 제목 한글/머지 승인은 컨벤션(리뷰).

## 정규 + 명령표
[.gjc/rules/40-release-flow.md](../../.gjc/rules/40-release-flow.md) (canonical gated-command table 포함)
