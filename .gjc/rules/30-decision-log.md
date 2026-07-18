---
description: Every design decision records its technical tradeoffs into logs/<KST-date>/<session-name>/.
alwaysApply: true
---

# Rule 4 — Decision / tradeoff logs

- For each design decision, write a tradeoff note under
  `logs/<KST-YYYYMMDD>/<session-name>/NN-<slug>.md` (KST via `TZ=Asia/Seoul date +%Y%m%d`).
- Each note MUST cover: context, chosen design pattern/tech, pros, cons, performance tradeoffs,
  side effects, alternatives considered. Use `logs/TEMPLATE.md`.
- **본문은 한글로 작성한다**(Rule 9). 헤더 라벨·코드/식별자·파일 경로·URL은 영문을 허용하되 서술
  프로즈는 한글이어야 한다. 신규/변경 결정 로그에 한글이 전혀 없으면 CI `verify`의
  `결정 로그 한글 게이트`가 실패시킨다(하드). 기존 영문 로그는 소급하지 않는다(diff 기준).
- Enforcement: 구조/존재는 advisory(설계 리뷰어가 PR에서 확인); 한글 본문은 hard(CI 게이트).
