# Rule 1 — 작업당 전용 워크트리

## 요약
모든 작업은 전용 git 워크트리에서 진행한다. 산출물 종류 불문(`src/**`·`docs/**`·`logs/**`·md 전용 작업 포함) — 메인 체크아웃에서는 파일을 만들지도, 고치지도, 커밋하지도 않는다.

## 방법
```bash
git worktree add ../UsAllJobManager.worktrees/<KST-date>-<session-name> -b <type>/<slug>
```
`<KST-date>`=`TZ=Asia/Seoul date +%Y%m%d`, `<session-name>`=kebab task-slug.

세션 시작 자가 점검(첫 파일 변경 전 필수):
```bash
[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] || echo "메인 체크아웃 — 워크트리 먼저 생성"
```

## 강제
하드(커밋 경계): `.githooks/pre-commit`가 `master` 커밋과 **메인 체크아웃의 모든 커밋**을 거부(경로 무관). 파일 작성 단계는 정규 규칙의 세션 시작 자가 점검(어드바이저리)으로 커버.

## 위반 시 복구
워크트리를 즉시 생성하고 산출물을 이동(`diff -r`로 동일성 검증 후 메인 체크아웃에서 제거).

## 정규
[.gjc/rules/00-worktree.md](../../.gjc/rules/00-worktree.md)
