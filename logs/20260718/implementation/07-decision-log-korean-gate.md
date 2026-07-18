# 결정 로그 한글 강제 — CI 게이트 신설 + 04편 한글화

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
사용자 지적: `logs/20260716/project-governance/04-github-publish.md`가 영어로 작성됐는데 한글이었어야 한다. 근인을 파악하고 재발 방지를 현재 PR에 강제 반영하라.

## 근인 (왜 한글로 작성되지 않았나)
1. **Rule 9의 강제 범위 공백**: 정본 `50-communication-korean.md`가 "사용자 대면 제안/커밋 메시지/출력 문구/HTTP 응답"만 한글로 규정하고, `Implementation code, identifiers, commit messages, and file content follow existing conventions`로 **저장소 문서 내용을 명시적으로 강제에서 제외**했다.
2. **Rule 4에 언어 규정 부재**: `30-decision-log.md`/`rule-4`는 구조(컨텍스트·장단점 등)만 규정하고 언어는 언급 없음. 강제도 "어드바이저리(리뷰어 존재 확인)"뿐.
3. **하드 게이트 부재**: `commit-msg` 훅은 커밋 **제목**의 한글만 검사할 뿐 커밋에 포함된 파일 내용은 검사 안 함. CI에도 문서 언어 검사 없음.
→ 즉 04가 영어여도 이를 막을 규칙·게이트가 애초에 없었다. 스캔 결과 같은 세션의 `00·01·02`도 완전 영문(PR #4 범위 밖이라 이번엔 미수정, Follow-up).

## Chosen design / pattern / technology
1. **CI 하드 게이트 신설**: `.github/workflows/ci.yml` `verify`에 `결정 로그 한글 게이트` 추가. `pull_request`에서 `git diff --diff-filter=AM origin/<base>...HEAD -- logs/**/*.md`로 추가/변경된 결정 로그만 골라(TEMPLATE 제외), 한글 문자(`\uAC00-\uD7A3`)가 전혀 없는 파일이 있으면 실패. 기존 영문 로그는 diff에 안 잡히므로 소급하지 않는다.
2. **정본/문서 명문화**: Rule 4(`30-decision-log.md`·`rule-4`)에 "본문 한글" + 하드 강제, Rule 9(`50-communication-korean.md`·`rule-9`)에 결정 로그 예외 조항 추가, gated-command 표에 게이트 행 추가.
3. **04편 한글화**: 본문 영어 서술을 한글로 재작성(저장소 상태·부트스트랩 예외·PR #1 도그푸딩·리뷰·잔여 항목 정보 보존).

## Pros
- 완전 영문 결정 로그를 CI에서 하드 차단 → 재발 불가(브랜치 보호 required check `verify`에 자동 편입).
- "한글 문자 존재" 기준이라 코드/식별자/경로가 섞인 정상 한글 문서를 오탐하지 않음.
- diff 기준이라 기존 영문 로그를 강제로 다시 쓰게 하지 않음(점진 적용).

## Cons
- "한글 1자라도 있으면 통과"라 부분 영문(대부분 영어 + 한글 몇 줄)은 못 잡는다. 04처럼 명시 지적된 케이스는 수동 한글화로 보완. 임계 비율 게이트는 오탐 위험이 커 채택 안 함.

## Performance tradeoffs
- 무시 가능. `git diff` 1회 + 소수 파일 read. SemVer 게이트와 동일한 `fetch-depth:0`(이미 설정됨) 재사용.

## Side effects
- CI SemVer 게이트 대상 → 0.2.1 → 0.2.2(patch).
- `00·01·02` 영문 로그는 미수정으로 남음(PR #4 범위 밖, Follow-up).

## Alternatives considered
- commit-msg 훅에서 파일 내용 검사: 훅은 스테이징 파일 접근이 번거롭고 `--no-verify`·web merge 우회 가능 → CI가 신뢰 경계라 기각.
- 한글 비율 임계치(예: 30%↑): 정상 문서 오탐 위험 커 기각, "존재 여부"로 단순·견고하게.

## Follow-ups
- `00·01·02` 영문 결정 로그 한글화(별도 세션/PR, 20260716-project-governance 범위).
- 필요 시 부분 영문 탐지를 리뷰 체크리스트로 보완(어드바이저리).
