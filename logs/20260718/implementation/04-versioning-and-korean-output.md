# SemVer bump 하드 강제 + 거버넌스 출력 문구 한글화

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
사용자 지적: `package.json`의 버저닝이 동작하지 않는다. 조사 결과 근인은 **Rule 7의 SemVer 강제가 opt-in(no-op) 설계**였다.

- `.githooks/commit-msg`의 SemVer 검사는 커밋 메시지에 `version: X.Y.Z` 트레일러가 **있을 때만** 동작한다(`if [ -n "$ver_line" ]`). 트레일러를 안 쓰면 아무 검사도 안 한다.
- 검사 내용도 "트레일러 == package.json version" **일치**만 볼 뿐, **bump가 일어났는지**는 전혀 강제하지 않는다.
- CI에도 버전 게이트가 없었다.
- 결과: S0~S11 전체 기능 구현(12 커밋, +12397 라인)이 진행되는 동안 `version`이 `0.0.1`에 고정된 채 방치됐다. 규칙이 "안 지켜진" 게 아니라 **강제 수단이 없었다**.

추가 지시: 거버넌스 스크립트/훅·CI의 사용자 노출 출력 문구를 한글로 강제하고, 본 PR에 반영.

## Chosen design / pattern / technology
1. **CI 하드 게이트 신설** — `.github/workflows/ci.yml`의 `verify` 잡에 `SemVer bump 게이트` 스텝 추가. `pull_request` 이벤트에서 `git show origin/<base>:package.json`으로 base version을 읽어, head `package.json` version이 base보다 **엄격히 상향(numeric SemVer 비교)** 되지 않으면 `exit 1`. `actions/checkout`에 `fetch-depth: 0` 추가(base 비교용). push(master)에는 base가 없어 스텝 skip.
2. **버전 bump** — `0.0.1 → 0.1.0`(pre-1.0 신규 기능 = minor).
3. **commit-msg 훅 유지** — 트레일러 일치 검사는 그대로(보완 방어). 정본 표현을 "version 트레일러 일치 검사"로 정정.
4. **출력 문구 한글화** — `.githooks/{pre-commit,pre-merge-commit,pre-push}`의 영문 `echo` 4개, `scripts/export-session.sh`의 영문 `echo` 3개를 한글로 교체. export 스크립트는 3번째 인자로 출력 파일명(`session2.html`)을 받도록 인자화.
5. **정본/문서 반영** — `.gjc/rules/40-release-flow.md`(SemVer bump 하드 조항 + gated-command 표 2행), `docs/rules/rule-7-release.md`, `.gjc/rules/50-communication-korean.md`, `docs/rules/rule-9-korean.md`.

## Pros
- bump 누락이 **CI에서 하드 차단**된다 — 트레일러 유무와 무관하게 우회 불가(브랜치 보호 required check에 편입 가능).
- 숫자 비교라 `0.9.9 → 0.10.0` 같은 사전식 함정이 없다(로컬 10-케이스 테스트 통과).
- 출력 문구 한글화로 거버넌스 UX가 Rule 9와 정합.

## Cons
- 버전만 올리고 실제 변경이 없어도 게이트는 통과(bump 존재만 검사, 의미론적 정합까지는 검증 안 함). 리뷰로 보완.
- base version이 파싱 불가하면 게이트를 skip(fail-open) — 정상 상태에선 발생 안 함.

## Performance tradeoffs
- `fetch-depth: 0`로 전체 히스토리 fetch → 현재 레포 규모에서 무시할 수준. 게이트 스텝은 `git show` 1회 + Node 파싱으로 수백 ms.

## Side effects
- 이 PR 자체가 신설 게이트의 첫 대상: base `0.0.1` → head `0.1.0`으로 PASS 확인.
- 향후 모든 소스 변경 PR은 version bump 없이는 CI 실패 → 개발 흐름에 bump 단계가 강제된다.

## Alternatives considered
- commit-msg 훅에서 bump 강제: 로컬 훅은 `--no-verify`·web UI로 우회 가능하고 base 비교가 어려워 기각. CI가 신뢰 경계.
- 자동 bump(semantic-release 등): 커밋 컨벤션 전면 도입 필요 + squash 정책과 충돌 소지 → 현 스코프 과대, 기각.

## Follow-ups
- 브랜치 보호 required status check에 `verify`가 이미 편입돼 있으므로 SemVer 게이트도 자동 하드화됨(별도 설정 불필요).
- 출력 문구 한글 강제를 CI lint(영문 echo 탐지)로 승격하는 것은 선택 후속.
