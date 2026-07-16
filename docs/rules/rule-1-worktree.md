# Rule 1 — 작업당 전용 워크트리

## 요약
모든 작업은 전용 git 워크트리에서 진행한다. 메인 체크아웃에서 `src/**`를 편집/커밋하지 않는다.

## 방법
```bash
git worktree add ../UsAllJobManager.worktrees/<KST-date>-<session-name> -b <type>/<slug>
```
`<KST-date>`=`TZ=Asia/Seoul date +%Y%m%d`, `<session-name>`=kebab task-slug.

## 강제
하드(커밋 경계): `.githooks/pre-commit`가 `master` 커밋과 메인 체크아웃의 `src/**` 커밋을 거부.

## 정규
[.gjc/rules/00-worktree.md](../../.gjc/rules/00-worktree.md)
