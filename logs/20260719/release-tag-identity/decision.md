# CI `tag` job tagger identity 버그 수정 결정 로그

- Date (KST): 20260719
- Session-name: release-tag-identity
- Author/agent: gjc
- Status: proposed

## Context

PR #10(릴리스 자동 태깅 도입)이 머지된 뒤 첫 자기적용에서 CI `tag` job이 exit 128로 실패했다.
로그: `Committer identity unknown / Please tell me who you are`. 원인은 `git tag -a`(annotated
태그)가 tagger identity(`user.name`/`user.email`)를 요구하는데 GitHub Actions 러너에는 git user가
설정돼 있지 않았기 때문이다. 그 결과 `v0.8.0` 태그가 자동 생성되지 못했다(수동으로 보정 부착함).

## Chosen design / pattern / technology

`tag` job의 태깅 스텝 첫머리에 러너용 봇 identity를 설정한다:

```
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
```

annotated 태그(`-a`)를 유지한다 — tagger·메시지·시각이 태그 객체에 기록돼 릴리스 이력 추적에 유리하다.
`package.json`은 0.8.0 → 0.8.1(patch)로 올려 SemVer bump 게이트를 충족한다.

## Ponytail 사다리 판정

- **3단(플랫폼 네이티브)**: GitHub Actions의 표준 봇 identity(`github-actions[bot]`)를 그대로 사용.
  별도 계정·시크릿·서명키 도입 없음(신규 의존성 게이트 대상 아님).
- annotated 유지 + identity 2줄이 lightweight 태그(identity 불필요)보다 정보량이 많아 릴리스 태그에 적합.

## Pros / Cons

- Pros: 최소 변경(2줄)으로 자동 태깅이 실제 동작. 이 fix 머지 시 `v0.8.1`이 자동 생성되어 수정이 실증된다.
- Cons: `v0.8.0`은 자동 태깅 실패분이라 수동 부착으로 보정했다(이력상 첫 태그만 수동, 이후는 자동).

## Alternatives considered

- **lightweight 태그(`git tag "$tag"`)**: identity 불필요해 더 단순하나, tagger/메시지가 없어 릴리스
  추적성이 떨어진다 → annotated + identity 설정 채택.

## Follow-ups

- 이 PR 머지 후 push 이벤트에서 `tag` job이 `v0.8.1`을 자동 생성하는지 실측 확인한다(수정 실증).
