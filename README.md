# us-all-jobmanager

NestJS 기반 스케줄러 서버.

> ⚠️ 이 저장소는 **public** 입니다. `HISTORY/`에 커밋되는 세션 export와 `.gjc/config.yml`·`.gjc/agents` 등
> 모든 커밋 내용이 공개됩니다. export/커밋 전 반드시 시크릿(키·토큰·내부 경로·개인정보) 스크러빙을 수행하세요.
> 시크릿은 커밋하지 말고 `.env`(gitignore됨)로 분리하세요.

## 개발 규칙 (거버넌스)

이 저장소는 GJC 10개 운영 규칙으로 관리된다. 규칙 원문은 [AGENTS.md](./AGENTS.md), 정규 문서는 `.gjc/rules/`.

| # | 요약 | 정규 문서 |
|---|---|---|
| 1 | 모든 작업은 전용 git worktree에서 진행 — 메인 체크아웃은 파일 변경·커밋 전면 금지 | [00-worktree](./.gjc/rules/00-worktree.md) |
| 2 | 설계 중요 기능만 ralplan 합의 후 구현(사소한 수정은 직접) | [10-ralplan-gate](./.gjc/rules/10-ralplan-gate.md) |
| 3 | Hexagonal/Clean Architecture; 도메인·유스케이스에 `@nestjs/*` 금지 | [20-architecture-hexagonal](./.gjc/rules/20-architecture-hexagonal.md) |
| 4 | 설계 트레이드오프를 `logs/<KST-date>/<session-name>/`에 기록 | [30-decision-log](./.gjc/rules/30-decision-log.md) |
| 5 | 파일 변경 전 사용자 공지·확인, 최종 게이트는 커밋/푸시 경계 | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 6 | 완료 시 PR + 설계/보안/성능 3인 리뷰(코멘트) | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 7 | squash 머지만, Conventional Commits + SemVer, `HISTORY/` export, **`master` 보호** | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 8 | 규칙을 `AGENTS.md`↔`CLAUDE.md` 동기화 (문서 계층만) | AGENTS.md |
| 9 | 사용자 제안은 한국어 | [50-communication-korean](./.gjc/rules/50-communication-korean.md) |
| 10 | export/public 함수·domain guard 한글 TSDoc 필수, Job 처리기 디렉토리에 흐름도 README.md colocation | [70-code-documentation](./.gjc/rules/70-code-documentation.md) |

강제(enforcement):
- **하드**: `.githooks/`(git 훅: master 커밋/푸시·**메인 체크아웃의 모든 커밋**·비-Conventional·SemVer 불일치 차단) + GitHub squash 전용 + `master` 브랜치 보호(Rule 1·7).
- **하드**: 리뷰어 에이전트(`.gjc/agents/review-*.md`)는 프론트매터 `tools:` 화이트리스트로 write/edit 도구 자체를 제외.
- **어드바이저리**: 나머지 규칙은 `AGENTS.md`/`CLAUDE.md`/`.gjc/rules` 프로즈.

## 실행

```bash
yarn install   # prepare 훅이 core.hooksPath=.githooks 설정
yarn start:dev # 개발(watch). 프로덕션은 yarn build && yarn start:prod
```

참고: `app.module.ts`에 `@nestjs/schedule`의 `ScheduleModule.forRoot()`가 등록되어 있어, 등록된 크론/인터벌 잡은 기동 직후 활성화될 수 있습니다. 현재 스켈레톤에는 활성 스케줄 작업이 없습니다.
