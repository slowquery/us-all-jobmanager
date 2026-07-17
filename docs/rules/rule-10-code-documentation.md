# Rule 10 — 코드 문서화(함수 주석 + Job 흐름도)

## 요약
export/public 함수와 domain guard는 한글 TSDoc(역할·`@param`·`@returns`·비자명 로직 요약)을 필수로 달고,
Job 처리기 디렉토리에는 `README.md`(목차 5항목: 역할/트리거·함수 흐름/구조도/상태 전이 연계/실패·재시도)를
colocation한다. 새 Job 추가 시 흐름도 md 작성은 동일 PR에서 완료한다.

## 강제
어드바이저리 — 훅 하드 강제 없음. Rule 6 PR 리뷰(설계 리뷰어) 체크리스트로 확인한다.

## 정규
[.gjc/rules/70-code-documentation.md](../../.gjc/rules/70-code-documentation.md)

## 예시(한글 JSDoc)

```js
/**
 * 재시도 가능한 오류인지 판단한다.
 * 네트워크 타임아웃/5xx 응답만 재시도 대상으로 취급하고, 4xx는 즉시 실패로 처리한다.
 *
 * @param error - 처리기에서 발생한 오류 객체
 * @returns 재시도 대상이면 true
 */
function isRetryable(error) {
  // ...
}
```
