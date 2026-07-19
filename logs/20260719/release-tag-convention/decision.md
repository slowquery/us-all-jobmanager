# 릴리스 머지 subject 형식 + 자동 태깅 결정 로그

- Date (KST): 20260719
- Session-name: release-tag-convention
- Author/agent: gjc
- Status: proposed

## Context

머지(squash) 커밋 메시지를 `<type>: (X.Y.Z) 한글설명` 형태로 강제하고, 머지 시 `vX.Y.Z` 태그가
자동으로 붙도록 릴리스 플로우를 확장한다. 기존 릴리스 규칙(Rule 7)은 Conventional Commits +
`package.json` SemVer 동기화만 정의했고, 버전을 subject에 노출하거나 태그를 부착하는 절차는 없었다.

## Chosen design / pattern / technology

- **subject 형식 = `<type>: (X.Y.Z) 한글설명`**: `(X.Y.Z)`는 `package.json` `version`과 바이트 일치.
  사용자 확정 ①에 따라 type은 항상 `chore`로 고정하지 않고 변경 성격(feat/fix/chore…)을 유지한다 —
  Conventional Commits의 major/minor/patch 신호를 보존하기 위함.
- **태그 접두사 = `v`**(사용자 확정 ②): `v0.8.0`. 대다수 릴리스 도구가 `v` 접두사를 가정한다.
- **자동 태깅 위치 = CI(사용자 확정 ③-a)**: 신규 워크플로를 만들지 않고(사용자 지시) 기존
  `.github/workflows/ci.yml`에 `tag` job을 추가한다. `needs: verify` + `if: github.event_name == 'push'`
  로 verify 통과 후 master push에서만 돌며, `package.json` version 기준으로 `v<version>` 태그를 멱등
  생성·push한다(`contents: write`). 같은 job이 머지 subject의 형식·버전 일치·한글을 사후 검증한다.
- **이중 강제**:
  - `.githooks/commit-msg`(로컬, feature 브랜치 커밋) — subject에 `(X.Y.Z)` 괄호 버전이 **있으면**
    `package.json` version과 일치 검사(선택적, 하위호환). 개발 중 개별 커밋은 자유.
  - CI `tag` job(master 머지 커밋) — 괄호 버전 형식을 **필수** 강제(사후). 최종 머지 subject만 형식 강제.

## 실측 검증

- `commit-msg` 훅: 버전 일치+한글 PASS / 버전 불일치 FAIL / 한글 없음 FAIL / 괄호 없는 기존 형식 PASS(하위호환) / 무형식 FAIL.
- CI `tag` job subject 검증 로직: 형식·버전·한글 위반 각각 FAIL, `Merge …` 생성 subject는 SKIP.

## Ponytail 사다리 판정

- **선행 체크(재사용)**: 신규 워크플로 파일을 만들지 않고 기존 `ci.yml`에 job을 추가 — "이미 있는 것 재사용".
- **3단(플랫폼 네이티브)**: 태깅은 `git tag`/`git push` 표준 명령 + GitHub Actions 네이티브 job 스케줄로 해결.
- **6단(최소 커스텀)**: subject 형식 검증만 짧은 node 스크립트로 추가. 신규 의존성 없음(신규 의존성 게이트 대상 아님).
- **안전 경계**: SemVer bump 게이트·테스트 게이트를 축소하지 않는다. 태깅은 `needs: verify` 뒤라 실패한 빌드를 태깅하지 않는다.

## Pros

- 버전이 머지 메시지·태그 양쪽에 노출돼 릴리스 추적이 쉬워진다.
- verify 통과 후에만 태깅하므로 깨진 커밋에 태그가 붙지 않는다(멱등이라 재실행 안전).

## Cons / Trade-offs

- **사후 검증 한계**: 웹 UI/`gh pr merge`의 subject를 사전 차단할 수는 없다(기존 honest note와 동일). 형식
  위반은 이미 master에 머지된 뒤 CI 빨간불로 신고된다 — 사전 차단이 아니라 사후 게이트.
- commit-msg(선택적) vs CI(필수)의 강제 수준 차이는 의도적이다(개발 커밋 자유 + 머지 형식 강제).

## Alternatives considered

- **type을 항상 `chore` 고정**: 사용자 예시(`chore: (semver)`) 그대로. 그러나 feat/fix 신호가 사라져
  SemVer 의미가 약화 → 형식만 채택하고 type은 성격 유지로 확정(사용자 ①).
- **신규 `release-tag.yml` 워크플로 분리**: 관심사 분리는 깔끔하나 사용자가 기존 워크플로 통합을 지시 → ci.yml `tag` job으로 통합.
- **태그 접두사 없이 `0.8.0`**: 도구 호환성 이유로 `v` 접두사 채택(사용자 ②).

## Follow-ups

- master branch protection에 `tag` job이 아닌 `verify`만 required로 두어, 태그 push 실패가 머지를 막지
  않도록 유지(태깅은 머지 이후 단계).
- 이 PR 머지 시 첫 적용 사례가 된다: 머지 subject를 `chore: (0.8.0) 릴리스 머지 subject 형식 + 자동 태깅 도입`
  형태로 지정해야 CI `tag` job이 통과한다.
