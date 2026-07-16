# 커밋 메시지 한글 작성 규칙 추가 (Rule 7)

- Date (KST): 20260716 · Session-name: project-governance

## Context
사용자 요청: 커밋 메시지 내용을 한글로 작성하도록 커밋 규칙을 변경.

## 변경
- `.githooks/commit-msg`: Conventional 타입 프리픽스(영문) 뒤 **제목 설명에 한글 포함을 강제**. 판정은 `grep -P '[\x{ac00}-\x{d7a3}]'`(PCRE Hangul syllable 범위) — 로케일 안전하며 영문/악센트 라틴은 거부. 생성 subject(Merge/Revert/fixup!/squash!/amend!)는 예외. SemVer 동기화 검사 유지.
- `.gjc/rules/40-release-flow.md` Rule 7, `.gjc/rules/50-communication-korean.md`, `AGENTS.md` Rule 7에 규칙 반영.

## 트레이드오프
- 장점: 커밋 히스토리 일관성(한글), 훅으로 하드 강제.
- 단점/부작용: 순수 영문 설명 커밋 차단 → 필요 시 `--no-verify`로 우회 가능(권장 안 함). `[가-힣]` 문자클래스는 C.UTF-8에서 "Invalid collation" 오류가 나므로 `grep -P` 유니코드 코드포인트 범위를 사용.
- 대안: 비-ASCII 전체 허용(느슨) 또는 advisory-only(강제 없음) — 사용자 의도(한글 강제)에 맞춰 Hangul 전용 하드 강제 채택.
