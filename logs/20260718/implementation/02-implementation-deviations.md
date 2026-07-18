# 구현 세션 확정 이탈 3건 — 09 정본 supersede 기록

- Date (KST): 20260718
- Session-name: implementation
- Author/agent: gjc
- Status: accepted

## Context
09-final-design.md는 "코드가 문서와 어긋나면 문서를 먼저 supersede해야 한다"고 규정한다. 구현 중 S2/S3/S7 실측에서 확정된 이탈 3건이 코드·테스트·주석에는 기록되었으나 결정 로그와 09 supersede 목록에 미기재 상태였고, 게이트 리뷰(Architect P2, QA HIGH)가 이 추적성 공백을 지적했다. 본 문서가 그 공백을 해소한다.

## Chosen design / pattern / technology
1. **`withBatch(ids, target)` 시그니처**: 09 포트 표기 `withBatch(ids, transitionFn)` 대신 단일 target 상태를 받는 시그니처를 정본으로 확정. ProcessPendingJobs는 완료 커밋 시 succeeded/failed id를 분리해 2회 호출한다(선점 1회 + 완료 최대 2회 write — 무배치 대비 여전히 tick당 rewrite 대폭 감소).
2. **동일-target PATCH = idempotent no-op**: `target === 현재 status`(임계구역 내 재조회 기준)이면 guard 평가를 생략하고 patch만 반영, 2xx 반환. 09 L67 전이표의 "pending→pending 거부(409)" 문언을 supersede — 근거: field-only PATCH(title/description만)가 매 요청 409가 되는 부조리 제거(04 "비상태 필드 PATCH는 guard 평가 대상 아님"과 정합), 동시 재시도 중복 클릭 시에도 retryCount 중복 증가 없음(무손실 불변식은 회귀 테스트가 하드 보장).
3. **`TransitionResult.transitioned`/`previousStatus` 확장**: 실제 전이 커밋 여부와 전이 직전 status를 임계구역 내부에서 확정해 반환. transition 로그 이벤트(05 카탈로그 #4 "커밋된 전이만 기록")의 emit 판정을 락 밖 stale 읽기가 아닌 이 값으로 수행 — S7 동시성 실측에서 관측된 no-op 중복 emit 결함의 근본 수정.

## Pros
- 코드-문서 정합 회복(정본 자임 문서의 supersede 경로 준수), API 시맨틱이 필드 갱신과 상태 전이를 자연스럽게 겸용.
- 이벤트 정합(커밋된 전이만 기록)이 동시성 하에서도 보장됨(임계구역 내 판정).

## Cons
- 09 원문 "1성공/1거부" 재현 서사(동시 PATCH)가 "무손실 불변식 보장"으로 완화됨 — 08 재현 테스트 문서와 코드 주석에 괴리 사유 명시로 완화.
- 포트 성공 결과에 필드 2개 추가(소비자는 무시 가능, 하위 호환).

## Performance tradeoffs
- withBatch 2회 호출(완료 커밋)은 write 최대 2회 — 배치 없는 개별 커밋(최대 10회) 대비 이득 유지.

## Side effects
- PATCH {status:'pending'}을 이미 pending인 job에 보내면 409가 아닌 200(no-op) — README API 문서에 반영됨.

## Alternatives considered
- **자기 전이 명시 요청만 409로 구분**: "명시적 status 포함 + 동일 상태"를 별도 거부하는 분기 — 필드 갱신과 재시도 요청의 구분 로직이 어댑터·포트에 이중 산개하고, 클라이언트 재시도 멱등성(같은 요청 재전송 안전)을 깨뜨려 기각.
- **withBatch(ids, fn) 함수 시그니처 유지**: 임계구역 내부에서 임의 함수 실행을 허용하면 락 보유 시간이 호출자 코드에 종속되어 병목·오용 표면이 커짐 — 단일 target 시그니처가 계약을 좁혀 안전.

## Follow-ups
- 09-final-design.md supersede 목록에 ⑨⑩⑪로 반영(동일 커밋).
- 게이트 지적 잔여: 검색 빈 문자열 파라미터 의미론(INFO), lock 이벤트 source 고정(INFO) — 후속 개선 후보.
