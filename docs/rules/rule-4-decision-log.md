# Rule 4 — 결정/트레이드오프 로그

## 요약
설계 결정마다 `logs/<KST-date>/<session-name>/NN-<slug>.md`에 컨텍스트·선택 패턴/기술·장점·단점·성능 트레이드오프·사이드이펙트·대안을 기록한다. **본문은 한글로 작성**한다(Rule 9, 코드/식별자/경로/URL만 영문 허용). 템플릿: `logs/TEMPLATE.md`.

## 강제
구조/존재는 어드바이저리(설계 리뷰어가 PR에서 확인). **한글 본문은 하드** — 신규/변경 결정 로그에 한글이 없으면 CI `verify`의 `결정 로그 한글 게이트`가 실패시킨다(기존 영문 로그는 소급 안 함).

## 정규
[.gjc/rules/30-decision-log.md](../../.gjc/rules/30-decision-log.md)
