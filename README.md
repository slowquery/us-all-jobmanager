# us-all-jobmanager

NestJS 기반 스케줄러 서버.

## 개발 규칙 (거버넌스)

이 저장소는 GJC 9개 운영 규칙으로 관리된다. 상세는 [AGENTS.md](./AGENTS.md) 참고.

- 모든 작업은 전용 git worktree에서 진행 (Rule 1)
- 설계 중요 기능은 ralplan 합의 후 구현 (Rule 2)
- Hexagonal/Clean Architecture (Rule 3)
- 설계 트레이드오프는 `logs/<KST-date>/<session-name>/`에 기록 (Rule 4)
- 파일 변경은 커밋/PR 경계에서 승인 (Rule 5)
- 완료 시 PR + 설계/보안/성능 3인 리뷰 (Rule 6)
- squash 머지만, Conventional Commits + SemVer, 세션 export to `HISTORY/` (Rule 7)
- 규칙은 `AGENTS.md`/`CLAUDE.md`에 반영, `master` 보호 (Rule 8)
- 사용자 제안은 한국어 (Rule 9)

강제: `.githooks/`(git 훅) + GitHub squash 전용/`master` 브랜치 보호 + `.gjc/agents` 리뷰어 권한 제한.

## 실행

```bash
yarn install   # prepare 훅이 core.hooksPath=.githooks 설정
yarn start:dev
```
