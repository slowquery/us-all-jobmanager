# 결정 로그 — 관리자 페이지 구현 (20260718 / admin-page)

승인된 ralplan 합의(stage-06)를 ultragoal로 실행. 주요 트레이드오프와 근거를 기록한다.

## 1. UI 구현 방식: MCP 폐기 → 커밋시 직접 빌드
- **맥락**: 최초 요구는 "실제 html/css/js만". ralplan 중 사용자가 Option C(React+shadcn/Tailwind via Magic MCP)를 선택했다가, 승인 게이트에서 **"magic mcp가 아니라 커밋시에 직접 빌드해서 서빙"**으로 재변경.
- **결정**: React + shadcn/ui(Radix) + Tailwind + **Vite** 스택 유지, **MCP 미사용**(shadcn 스타일 컴포넌트 직접 작성/Radix 사용). `admin-ui/`를 **Vite로 빌드해 커밋된 `public/`**를 NestJS가 정적 서빙.
- **근거**: 외부 MCP/API 키 의존 제거, 런타임/도커에 프론트 툴체인 불필요. 대가: 빌드 산출물 커밋(일반적 안티패턴)이나, pre-push + **CI 권위 게이트**로 신선도 강제해 상쇄.
- **패키지 매니저**: admin-ui는 yarn berry 마찰 회피를 위해 **npm**(커밋된 `package-lock.json`) 채택. 루트 `build:admin`·pre-push·CI를 npm 기준으로 정합화.

## 2. 정적 서빙 경로: `__dirname` 고정
- **결정**: `app.useStaticAssets(join(__dirname,'..','public'),{prefix:'/admin/'})`.
- **근거**: 도커 런타임이 `WORKDIR /app/run`(app-logs 볼륨)이라 `process.cwd()` 기준은 404. `dist/main.js` 기준 `__dirname/../public`은 nest start·node dist/main.js·Docker 모두에서 불변. Docker smoke로 검증(컨테이너 `/admin/`·assets 200).

## 3. 삭제 정책: `processing` 차단(409 JOB_IN_PROGRESS)
- **결정**: 도메인 guard(`deleteError`)로 `processing` 삭제 금지, 단일 라이터 임계구역 내 atomic read→guard→delete. 204 / 404 NOT_FOUND / **409 JOB_IN_PROGRESS**.
- **근거**: 사용자 선택(진행 중 작업 보호). `INVALID_TRANSITION` 오버로드 대신 별도 코드로 엔벨로프 택소노미 유지. `c6-delete-mid-flight` 동시성 스펙으로 스케줄러 `withBatch`와의 경합 안전성 증명.
- **감사**: 성공 시 `DeleteLogEvent`(메시지 `job deleted id=<id>`) 발행 — FileLoggerAdapter가 NDJSON에서 `type`을 제거하므로 메시지 문자열이 감사 마커.

## 4. 라이브 상태: 5초 폴링
- **결정**: SSE/WebSocket 없이 5초 폴링(탭 숨김 시 일시정지) + 수동 새로고침.
- **근거**: 백엔드에 push/pagination 없음. `SCHEDULER_TICK_MS=60s`이므로 전이 반영 상한 ≈ tick+poll(~70s). E2E-10에서 신규 작업 pending→completed 자동 반영 확인.

## 5. 인증: 범위 외(수용 리스크)
- 관리자 페이지·mutating 엔드포인트(신규 DELETE 포함)는 미인증 접근 가능. **알려진 수용 리스크**로 보안 리뷰에 명시. 보상통제로 삭제 감사 로그. 후속: /admin·write 라우트 authn/z 또는 네트워크 제한.

## 6. 검증 요약
- 백엔드 유닛 169 pass(도메인·delete-job.use-case·job-delete 100%), 임계 유지. 
- supertest e2e 22 pass(204/404/이중삭제/processing 409).
- 브라우저 E2E **12/12 PASS**(GJC 내장 브라우저, 커밋된 빌드 대상). 산출물: `e2e-cases.md`(구현 전), 스크린샷, `e2e-report.md`, `e2e-run.json`.
- lint/build/Docker smoke 통과.
