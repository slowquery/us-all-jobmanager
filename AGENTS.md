# UsAllJobManager — 에이전트 운영 규칙 (목차)

이 파일은 **목차(TOC)**다. 컨텍스트 절약을 위해 규칙 상세는 [`docs/`](./docs/README.md)로 분리했고
**필요할 때 해당 문서를 읽어** 참조한다. 정규(normative) 규칙은 `.gjc/rules/*.md`이며 충돌 시 우선한다.

| # | 규칙 | 한줄 요약 | 가이드(docs) | 정규(.gjc/rules) |
|---|---|---|---|---|
| 1 | 워크트리 | 작업당 전용 git 워크트리, 메인 체크아웃 `src/**` 금지 | [rule-1](./docs/rules/rule-1-worktree.md) | [00-worktree](./.gjc/rules/00-worktree.md) |
| 2 | ralplan | 설계 중요 작업은 합의 후 구현 | [rule-2](./docs/rules/rule-2-ralplan.md) | [10-ralplan-gate](./.gjc/rules/10-ralplan-gate.md) |
| 3 | 아키텍처 | 헥사고날/클린, 의존성 안쪽으로, 도메인에 `@nestjs/*` 금지 | [rule-3](./docs/rules/rule-3-architecture.md) | [20-architecture-hexagonal](./.gjc/rules/20-architecture-hexagonal.md) |
| 4 | 결정 로그 | 트레이드오프를 `logs/<KST-date>/<session-name>/`에 기록 | [rule-4](./docs/rules/rule-4-decision-log.md) | [30-decision-log](./.gjc/rules/30-decision-log.md) |
| 5 | Write 승인 | 변경 전 공지·확인, 하드 게이트는 커밋/푸시 경계 | [rule-5](./docs/rules/rule-5-write-approval.md) | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 6 | PR + 3인 리뷰 | 완료 시 PR(제목 한글) + 설계/보안/성능 리뷰 | [rule-6](./docs/rules/rule-6-review.md) | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 7 | 릴리스 | squash 전용, PR제목·커밋 한글, SemVer, CI(테스트) 통과 후 머지, `HISTORY/` export 커밋 | [rule-7](./docs/rules/rule-7-release.md) | [40-release-flow](./.gjc/rules/40-release-flow.md) |
| 8 | AGENTS/CLAUDE | 이 목차 + `docs/*` 분리, `.gjc/AGENTS.md` 생성 금지 | [rule-8](./docs/rules/rule-8-agents-claude.md) | (본 파일에서 정규) |
| 9 | 한글 | 제안·PR제목·커밋 메시지 내용은 한글 | [rule-9](./docs/rules/rule-9-korean.md) | [50-communication-korean](./.gjc/rules/50-communication-korean.md) |

---
우선순위: `.gjc/rules/*.md`가 정규이며 충돌 시 우선한다. 본 파일과 `CLAUDE.md`는 목차/요약 계층이고,
상세는 `docs/*`를 필요 시 읽어 사용한다. 예외: Rule 8(문서 계층)은 별도 `.gjc/rules` 파일 없이 여기서 정규다.
기본·보호 브랜치는 `master`. PR 제목과 커밋 메시지 내용은 한글로 작성한다(타입 프리픽스만 영문).
