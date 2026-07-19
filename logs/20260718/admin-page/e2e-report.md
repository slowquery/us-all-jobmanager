# 관리자 페이지 브라우저 E2E 실행 리포트

- **실행기**: GJC 내장 브라우저(puppeteer/Chromium)
- **대상**: `http://localhost:3200/admin/` — NestJS가 정적 서빙하는 **커밋된 admin-ui Vite 빌드 산출물**(dev 서버 아님)
- **일시**: 2026-07-18 (KST)
- **결과**: **12 / 12 PASS** (E2E-01~11 + E2E-09b)
- **시드 데이터**: pending 2, processing 1, completed 1, failed 1 (임시 cwd `/tmp/e2e-run/jobs.json` — 워크트리 오염 방지)
- **인증**: 범위 외(보안 리뷰 인지). 스케줄러 `SCHEDULER_TICK_MS=60s`로 시드 pending 작업이 실행 중 completed로 전이되는 것은 정상 동작.

| ID | 케이스 | 판정 | 관측 API | 증거 스크린샷 |
|---|---|---|---|---|
| E2E-01 | 로드 + 다크 테마 + bento 타일 | ✅ | GET /jobs 200 | E2E-01-load.png |
| E2E-02 | 리스트 렌더 + 상태 뱃지 | ✅ | GET /jobs 200 | E2E-01-load.png |
| E2E-03 | 제목 부분 검색 | ✅ | GET /jobs/search?title=로그 200 | E2E-03-search-title.png |
| E2E-04 | 상태 필터 + 제목·상태 AND | ✅ | GET /jobs/search?status=... 200 | E2E-04-filter-completed.png, E2E-04-filter-pending.png |
| E2E-05 | 빈 검색 결과 빈 상태 | ✅ | GET /jobs/search 200(0건) | E2E-05-empty.png |
| E2E-06 | 상세 모달 + ESC + 포커스 복귀 | ✅ | (client) | E2E-06-detail-modal.png, E2E-06-07-fixed.png |
| E2E-07 | 수정(PATCH) + 저장 후 닫힘 + 지속성 | ✅ | PATCH /jobs/:id 200 | E2E-07-edit.png, E2E-06-07-fixed.png |
| E2E-08 | 재시도 failed→pending | ✅ | PATCH /jobs/:id {status:pending} 200 | E2E-08-retry-before.png, E2E-08-retry-after.png |
| E2E-09 | 삭제(비-processing) 204 | ✅ | DELETE 204 → GET 404 NOT_FOUND | E2E-09-confirm.png, E2E-09-after.png |
| E2E-09b | processing 삭제 차단(disabled + 409) | ✅ | DELETE 409 JOB_IN_PROGRESS | E2E-09-after.png, E2E-01-load.png |
| E2E-10 | 라이브 상태(폴링, 수동 새로고침 없음) | ✅ | POST 201 + 스케줄러 전이 | E2E-10-t0-pending.png, E2E-10-t1-advanced.png |
| E2E-11 | 에러 상태 회복력 | ✅ | DELETE stale → 404 NOT_FOUND | E2E-11-error-state.png |

## 검증 상세
- **E2E-01/02**: `html.dark`, `body` 배경 `rgb(2,6,23)`(slate-950), bento 타일 카운트가 시드와 정확히 일치, 4개 상태 뱃지 색상 규약 적용.
- **E2E-03/04/05**: 제목 부분검색·상태 필터·AND 조건·폴백(`GET /jobs`)·빈 상태 패널 모두 정상. (초기 `status=pending` 0건은 스케줄러 tick으로 pending이 completed로 전이된 실데이터 반영 — 앱 버그 아님. completed=3/processing=1/failed=1로 재검증.)
- **E2E-06**: Radix Dialog(focus-trap/ESC/aria) + 커스텀 포커스 복귀(닫을 때 `data-job-id`로 호출 행 재포커스, `activeElement.tagName==='TR'` 확인). retryCount는 응답·화면 모두 미노출.
- **E2E-07**: 수정 → `PATCH` 200 → 성공 토스트 → **다이얼로그 자동 닫힘** → 행 갱신 → 페이지 재로드 후에도 유지.
- **E2E-08**: `failed`에서만 재시도 버튼 노출 → Pending 전이 + 토스트, API로 `status=pending` 확인.
- **E2E-09/09b**: 확인 다이얼로그 → 204 행 제거 및 GET 404; processing 행 삭제 버튼 `disabled`, 강제 API DELETE는 서버가 409 `JOB_IN_PROGRESS`로 방어.
- **E2E-10**: 신규 작업이 **수동 새로고침 없이** 5초 폴링으로 목록·타일에 반영(Pending) 후 스케줄러 tick+poll로 Completed 자동 전이(2장 타임 스크린샷).
- **E2E-11**: 백엔드에서 선삭제된 작업을 UI에서 삭제 시도 → 404 → '이미 삭제된 작업입니다' 에러 토스트, UI(행/검색/새로고침) 정상 유지.

## 수정 이력(관찰 → 조치 → 재검증)
초기 실행에서 두 편차를 관찰하고 프론트엔드를 수정한 뒤 재검증 통과:
1. **E2E-06 포커스 복귀**: 다이얼로그가 프로그래밍 방식으로 열려 Radix가 트리거를 몰라 포커스가 body로 흩어짐 → `App.tsx` `onOpenChange`에서 닫힐 때 `[data-job-id]`로 호출 행 재포커스. 재검증: `activeElement`가 해당 행(TR)로 복귀.
2. **E2E-07 저장 후 닫힘**: 저장 후 다이얼로그가 열린 채 유지됨 → `job-detail-dialog.tsx` `handleSave` 성공 시 `onOpenChange(false)` 호출. 재검증: 저장 후 다이얼로그 닫힘 확인.

## 산출물
`e2e-cases.md`(구현 이전 작성), 케이스별 스크린샷 `E2E-*.png`, `e2e-report.md`(본 문서), `e2e-run.json`(기계 판독 판정).

---

## 추가 실행(2026-07-19) — KST 표기 + 생성 기능
사용자 요청으로 (1) 모든 시각을 KST로 표기, (2) 누락되어 있던 새 작업 생성 기능을 구현하고 스크린샷을 재촬영했다.

| ID | 케이스 | 판정 | 관측 API | 증거 |
|---|---|---|---|---|
| KST | 목록/상세 시각 KST 표기 | ✅ | — | E2E-01-load.png(Updated 열), E2E-06-detail-modal.png(Created/Updated) |
| E2E-12 | 새 작업 생성(버튼→모달→POST) | ✅ | POST /jobs 201 (pending) | E2E-12-create-modal.png, E2E-12-create-after.png |

- **KST**: `admin-ui/src/lib/format.ts`의 `formatKst`가 `Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour12:false})`로 포맷. 시드 `09:00:00Z`가 목록·모달 모두 `2026. 07. 18. 18:00:00 KST`로 표기됨을 브라우저에서 확인.
- **생성**: `새 작업` 버튼 → `create-job-dialog`(제목 필수 검증, 설명 선택) → `createJob` → 201 → 목록 즉시 반영(refresh), 신규 행 Pending. 브라우저 확인: 카운트 5→6, `POST /jobs` status=pending.
- E2E-01/06/07/12 스크린샷을 KST 표기 상태로 재촬영.
