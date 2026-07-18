# GitHub 공개 + 최초 거버넌스 PR (G006)

- Date (KST): 20260716 · Session-name: project-governance
- 저장소: https://github.com/slowquery/us-all-jobmanager (**PUBLIC**, owner slowquery)

## 공개된 상태 (gh로 검증)
- 가시성: PUBLIC · 기본 브랜치: `master`
- 머지 정책: **squash 전용** (mergeCommitAllowed=false, rebaseMergeAllowed=false, squashMergeAllowed=true)
- `master` 브랜치 보호: enforce_admins=true, required_approving_review_count=1, required_linear_history=true, allow_force_pushes=false, allow_deletions=false

## 부트스트랩 노트
- 제네시스 커밋 `894c873`(스켈레톤 + 거버넌스)은 `master`에 `--no-verify`로 커밋·푸시했다: `master` 확립 + 기존 `src/` 스켈레톤 임포트를 위한 **문서화된 일회성 예외**(이후 작업은 모두 훅으로 강제됨). 이후 모든 커밋은 훅 거버넌스를 통과한다.

## 최초 거버넌스 PR (도그푸딩) — Rule 1/6/7
- PR #1: `docs/add-readme` → `master` (https://github.com/slowquery/us-all-jobmanager/pull/1)
- **워크트리**(`../UsAllJobManager.worktrees/20260716-project-governance`, Rule 1)에서 작성.
- 커밋 `48ec925`가 `--no-verify` 없이 훅을 통과(Conventional 제목, 피처 브랜치, 비-src) — 거버넌스 경로가 동작함을 실증.
- 3인 전문 리뷰어가 PR 코멘트 게시(Rule 6):
  - [설계 관점] 실제 문서 오류 발견(README가 `master` 보호를 Rule 8로 매핑했으나 실제는 Rule 7) + 규칙별 링크/추적성 + Rule 5 뉘앙스.
  - [보안 관점] 공개 저장소 노출 경고(HISTORY 트랜스크립트, `.gjc/config.yml`), 시크릿 스크러빙/.env 가이드.
  - [성능 관점] 실행 커맨드/`prepare` 정확성 + `ScheduleModule.forRoot()` 시작 노트.
- 수정 커밋 `833e482`가 세 리뷰를 모두 반영(여전히 훅 거버넌스 통과).

## 사람 게이트 / 잔여
- **머지**: PR #1은 사용자의 명시적 승인 + squash 머지를 대기하며 OPEN 유지(Rule 7 + 브랜치 보호가 1건 승인 리뷰 요구). 에이전트가 머지하지 않음.
- **`/export`**: `HISTORY/<date>-<session-name>/session.html`로의 세션 export는 사용자가 실행하는 Claude/GJC 슬래시 커맨드다(에이전트는 슬래시 커맨드를 호출할 수 없음). `HISTORY/README.md`가 경로/덮어쓰기 규약을 문서화한다.
- **리뷰어 에이전트**: 네이티브 제한 에이전트 `.gjc/agents/review-*.md`는 여기서 쓰인 서브에이전트 task 표면으로는 호출 불가하다. 3건의 리뷰 코멘트는 read + `gh pr comment`로 제약된 번들 executor 에이전트가 생성했다. 대화형 GJC 세션에서는 커스텀 제한 에이전트가 적용된다.
