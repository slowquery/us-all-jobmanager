---
description: Exported/public functions and domain guards carry Korean TSDoc comments; new Job processors document their flow.
alwaysApply: true
---

# Rule 10 — Code documentation (함수 주석 + Job 흐름도)

번호 매핑: `.gjc/rules/*` 접두 번호는 로드 순서용이며 `docs/rules/rule-N`과 1:1 대응이 아니다(이 파일은 `docs/rules/rule-10-code-documentation.md`에 대응). 60번대는 ponytail 편입 세션을 위해 예약되어 있으며 이 규칙은 사용하지 않는다.

## 함수 주석 — 한글 TSDoc

- 대상 함수는 한글 TSDoc으로 다음을 기술한다: 역할(무엇을 하는 함수인지), `@param`(각 매개변수 설명), `@returns`(반환값 설명), 비자명(non-trivial) 로직이 있으면 그 요약.
- 타입 정보는 시그니처의 타입 어노테이션에 이미 있으므로 TSDoc 본문에 타입을 중복 표기하지 않는다(예: `@param id - 사용자 ID` O, `@param id - string 타입의 사용자 ID` X).
- **필수**: export/public 함수, domain guard(불변식·전제조건을 검증하는 함수).
- **권장**: private 헬퍼 중 로직이 비자명한 경우.

```ts
/**
 * 작업 큐에서 다음 실행 대상 Job을 선택한다.
 * 우선순위(priority) 내림차순, 동률이면 예약 시각(scheduledAt) 오름차순으로 정렬해 첫 항목을 반환한다.
 *
 * @param jobs - 후보 Job 목록(빈 배열 허용)
 * @param now - 기준 시각(테스트 결정론을 위해 주입)
 * @returns 선택된 Job, 후보가 없으면 undefined
 */
function pickNextJob(jobs: Job[], now: Date): Job | undefined {
  // ...
}
```

## Job 흐름도 — 처리기 디렉토리 colocation

- 각 Job 처리기 디렉토리에 `README.md`를 함께 둔다(코드와 근접 배치, 별도 집약 트리 금지).
- 목차 5항목:
  1. 역할
  2. 트리거/함수 흐름
  3. 구조도
  4. 상태 전이 연계
  5. 실패·재시도
- 새 Job을 추가할 때는 해당 `README.md` 작성/갱신을 **동일 PR**에서 완료한다(후속 PR로 미루지 않음).

## Enforcement

어드바이저리 — 훅 하드 강제 없음. Rule 6 PR 리뷰(설계 리뷰어) 체크리스트 항목으로 확인한다.

Normative source of truth for this rule; `docs/rules/rule-10-code-documentation.md`/`AGENTS.md`/`README.md`/`docs/README.md`는 요약·색인만 유지한다.
