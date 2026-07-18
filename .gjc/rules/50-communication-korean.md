---
description: User-facing proposals, suggestions, and recommendations are written in Korean.
alwaysApply: true
---

# Rule 9 — Korean-language proposals

- Write all user-facing proposals / suggestions / recommendations in Korean (한국어).
- Implementation code, identifiers, commit messages, and file content follow existing
  conventions; this rule governs proposal/communication prose to the user. **단, 결정 로그
  (`logs/**/*.md`)의 서술 본문은 한글로 작성한다**(Rule 4, 코드/식별자/경로/URL만 영문 허용).
- 커밋 메시지 내용도 한글로 작성한다(타입 프리픽스만 영문). 이는 Rule 7의 `commit-msg` 훅으로 강제된다.
- 거버넌스 스크립트(`.githooks/*`, `scripts/export-session.sh`)와 CI 워크플로(`.github/workflows/*`)의 **사용자 노출 출력 문구(echo/`::error`/`::warning`/step summary)는 한글로 작성**한다. 애플리케이션 사용자 대면 메시지(HTTP 에러 응답 등)도 한글을 따른다. 코드 식별자·주석·로그 키는 기존 컨벤션을 따른다.
- Enforcement: 제안 프로즈는 advisory; 커밋 메시지 한글은 hard(commit-msg 훅); 결정 로그 본문 한글은 hard(CI `결정 로그 한글 게이트`); 출력 문구 한글은 리뷰 어드바이저리(Rule 9).
