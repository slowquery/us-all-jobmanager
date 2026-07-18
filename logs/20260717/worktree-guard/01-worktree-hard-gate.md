# Rule 1 워크트리 강제를 커밋 전면 차단으로 확장

- Date (KST): 20260717
- Session-name: worktree-guard
- Author/agent: gjc
- Status: proposed

## Context
20260717 implementation-design 세션에서 결정 로그 9편이 메인 체크아웃에서 작성되는 Rule 1 위반이 발생했다(사후에 워크트리로 이전해 복구). 원인은 두 가지: (1) 기존 `.githooks/pre-commit`이 메인 체크아웃에서 `src/**` 커밋만 거부해 "md/logs 산출물은 예외"라는 해석 여지가 있었고, (2) 규칙 문면에 세션 시작 시 자가 점검 절차가 없었다.

## Chosen design / pattern / technology
`.githooks/pre-commit`의 워크트리 가드를 경로 기반(`src/**`)에서 **체크아웃 정체성 기반**으로 교체: `git rev-parse --git-dir` == `--git-common-dir`(즉 메인 체크아웃)이면 경로·브랜치 무관 모든 커밋을 거부한다. 병행하여 정규 규칙(`.gjc/rules/00-worktree.md`)에 (a) 산출물 종류 무관 무예외 조항, (b) 첫 파일 변경 전 자가 점검 명령, (c) 위반 시 복구 절차(diff -r 검증 후 이동)를 명문화하고, AGENTS.md/README/docs 요약 계층을 동기화했다.

## Pros
- 커밋 경계에서 우회 불가능한 하드 게이트 — 경로 목록 유지보수 없이 "메인 체크아웃 = 읽기 전용"이라는 규칙 의도를 그대로 코드화.
- 자가 점검 명령이 정규 규칙(alwaysApply)에 있어 에이전트 세션이 파일 변경 전에 위반을 자각할 수 있음.

## Cons
- 파일 작성 단계 자체는 여전히 어드바이저리(git 훅은 커밋 시점에만 개입) — 커밋 없는 dirty 메인 체크아웃은 잡지 못함.
- 메인 체크아웃에서의 긴급 hotfix 커밋도 차단됨 — 의도된 동작이나, 우회가 필요하면 `--no-verify`가 아니라 워크트리 생성이 정답임을 규칙에 명시.

## Performance tradeoffs
훅에 `git rev-parse` 2회 추가 — 커밋당 수 ms 수준으로 무시 가능.

## Side effects
- 거버넌스 문서(AGENTS/README/rules) 편집도 이제 워크트리 경유가 강제됨(본 변경 자체도 `chore/worktree-guard` 워크트리에서 수행).
- 기존 `src/**` 전용 가드 메시지는 제거됨(전면 차단이 상위 집합).

## Alternatives considered
- **경로 목록 확장(src/** + docs/** + logs/**)**: 새 경로가 생길 때마다 목록 갱신 필요, "목록에 없는 경로는 예외"라는 동일한 해석 여지 재생산 → 기각.
- **pre-write 수준 강제(에이전트 훅/파일워처)**: git 훅 밖의 별도 인프라가 필요하고 저장소 이식성이 깨짐. 정규 규칙의 자가 점검(어드바이저리)으로 대체 → 기각.
- **현상 유지(프로즈만 강화)**: 이번 위반이 프로즈만으로는 부족함을 실증 → 기각.

## Follow-ups
- 본 변경이 master에 머지된 뒤부터 메인 체크아웃 훅이 갱신됨(그 전까지는 기존 훅 동작).
- 필요 시 `pre-push`에도 동일한 메인 체크아웃 가드 추가 검토(현재는 커밋 경계로 충분).
