# 관리자 페이지 브라우저 E2E 테스트 케이스 (tests-first)

> 이 문서는 **구현 이전에** 작성된 tests-first 산출물이다. 아래 케이스는 GJC 내장 브라우저로
> 실제 빌드된 `public/`(`admin-ui` Vite 빌드 산출물)를 NestJS(`/admin/`)가 서빙하는 상태에서 실행하며,
> 실행 증거(스크린샷 `E2E-XX-<slug>.png`, `e2e-report.md`, `e2e-run.json`)는 이 디렉터리에 저장한다.
> Vite dev 서버가 아니라 **빌드 산출물**을 대상으로 한다(프로덕션 서빙과 동일 경로 검증).

## 실행 전제(공통)
- 대상 URL: `http://localhost:3000/admin/`
- 사전 시딩: 테스트 시작 시 API(`POST /jobs`, 필요시 `PATCH /jobs/:id`)로 알려진 상태의 작업을 생성한다.
  - 최소 시드: pending 2건, completed 1건, failed 1건(제목에 식별 토큰 포함, 예: `E2E-SEED-<slug>`).
  - `processing` 상태가 필요한 케이스(E2E-09b)는 스케줄러 tick 또는 저장소 직접 조작으로 준비하거나,
    준비 불가 시 서버측 409 경합 경로를 대체 증거로 사용한다(리포트에 방식 명시).
- 인증 없음(범위 외) — 별도 로그인 단계 없음.
- 라이브 상태: 폴링 5초, `SCHEDULER_TICK_MS=60s` → 전이 반영 대기 상한 ≈ 70초(1 tick + 1 poll).
- 각 케이스: `id`, `전제`, `단계`, `기대(DOM/API)`, `증거` 순으로 검증하고 판정을 `e2e-run.json`에 기록.

## 상태 색상 규약(뱃지)
- pending=amber(#f59e0b), processing=blue(#3b82f6, 은은한 pulse), completed=green(#22c55e), failed=red(#ef4444)
- 다크 표면 위 WCAG AA(≥4.5:1) 대비.

---

| ID | 케이스 | 단계 | 기대 결과 | 증거 |
|---|---|---|---|---|
| **E2E-01** | `/admin/` 로드 + 다크 테마 + bento 타일 | `/admin/` 접속 | 빌드된 SPA 로드; 다크 테마 적용; bento stat 타일(total/pending/processing/completed/failed)이 시드 카운트와 일치 | `E2E-01-load.png` + 타일 텍스트 |
| **E2E-02** | 리스트 렌더 | 페이지 로드 후 테이블 관찰 | 모든 시드 작업이 행으로 렌더, 상태 뱃지 색/텍스트 정확; 행 수 == `GET /jobs` count | `E2E-02-list.png` + 행수 비교 |
| **E2E-03** | 제목 검색(부분·대소문자 무시) | 검색 입력에 시드 토큰 일부 입력(디바운스 300ms 대기) | 일치 행만 표시(부분 일치), 대소문자 무시 | `E2E-03-search-before.png` / `-after.png` |
| **E2E-04** | 상태 필터 + 제목+상태 AND | 상태 Select=pending 선택; 이어서 제목+상태 동시 지정 | pending 행만; AND 조건이 좁혀짐 | `E2E-04-filter.png` |
| **E2E-05** | 빈 검색 결과 빈 상태 | 존재하지 않는 제목 검색 | 깨진 테이블이 아니라 빈 상태 패널 표시 | `E2E-05-empty.png` |
| **E2E-06** | 상세 모달 + 키보드 접근성 | 임의 행 클릭 | 다이얼로그 오픈(title/description/status/createdAt/updatedAt 표시, retryCount 미표시); ESC로 닫힘; 포커스가 호출 행으로 복귀 | `E2E-06-modal.png` + 포커스 확인 |
| **E2E-07** | 수정(PATCH) 지속성 | 모달에서 title/description 수정→저장 | `PATCH /jobs/:id` 200; 모달 닫힘; 행 갱신; 성공 토스트; 수동 새로고침 후에도 유지 | `E2E-07-edit.png`(reload 후) |
| **E2E-08** | 재시도(failed→pending) + 409 | failed 작업에서 Retry 클릭; (음성) 비-failed에서는 Retry 부재/차단 | 상태 pending 전환; 전이 불가 경로는 409 → 에러 토스트(엔벨로프 메시지) | `E2E-08-retry.png` |
| **E2E-09** | 삭제(비-processing) | pending/completed/failed 행에서 삭제→AlertDialog 확인 | `DELETE /jobs/:id` 204; 행 제거; 새로고침 후 `GET /jobs/:id`→404 `NOT_FOUND`; 카운트 감소 | `E2E-09-delete.png` + 카운트 감소 |
| **E2E-09b** | processing 삭제 차단(409) | processing 행 관찰 → 삭제 버튼 비활성/툴팁; 강제/stale 시도 | 삭제 버튼 disabled; 강제·경합 시 409 `JOB_IN_PROGRESS` → '진행 중 작업은 삭제할 수 없습니다' 토스트; 행 잔존 | `E2E-09b-disabled.png` + 토스트 |
| **E2E-10** | 라이브 상태 폴링 | 작업 생성 후 최대 1 tick+1 poll(≤~70s) 대기(수동 새로고침 없음) | 뱃지가 pending→processing/completed로 자동 전이 | `E2E-10-t0.png` / `E2E-10-t1.png`(타임스탬프 2장) |
| **E2E-11** | 에러 상태 회복력 | 다른 탭에서 삭제된(또는 없는) id에 대해 액션 | 에러 토스트 노출, UI는 사용 가능 상태 유지(크래시 없음) | `E2E-11-error.png` |

## 산출물
- `e2e-cases.md` (본 문서, 구현 이전 작성)
- 케이스별 스크린샷 `E2E-XX-<slug>.png`
- `e2e-report.md` — 케이스 → 판정(pass/fail) → 증거 스크린샷 → 관측 API 상태
- `e2e-run.json` — 기계 판독 판정 배열: `[{ id, status: "pass"|"fail", evidence: ["<png>"], observedApi: "<status/code>", notes }]`
- (선택) 브라우저 콘솔/네트워크 로그 발췌
