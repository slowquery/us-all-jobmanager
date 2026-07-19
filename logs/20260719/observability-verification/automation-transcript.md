# 브라우저 자동화 트랜스크립트 (gjc 내장 브라우저, Chromium headless)

Grafana(localhost:3000)에 대해 실행한 라이브 브라우저 자동화 단계. Explore 접근은 익명 뷰어 제한으로 `admin/admin` basic auth 사용(로그인 폼 비활성이나 basic auth 활성).

## 서피스 1 — SLO 대시보드 (web)
1. `open` tab=grafana, viewport 1600x2200.
2. `page.authenticate(admin/admin)` + Basic Authorization 헤더 설정.
3. `goto` `http://localhost:3000/d/usalljob-slo/97510a1?from=now-1h&to=now&kiosk&refresh=` (domcontentloaded).
4. 내부 스크롤 컨테이너(.scrollbar-view)를 0→2200 스텝 스크롤해 6패널 lazy-render 유도, 상단 복귀.
5. `evaluate`: `.react-grid-item`=6, `No data`=0 확인.
6. `screenshot` → 02-slo-dashboard-full.png (요청수 6행, 가용성 100%, P50 0ms/P99 2ms, 에러율 25%).
7. viewPanel=1/2 전체화면 캡처 → 03-slo-p50-panel.png, 12-quantile-crosscheck.png(P99, DELETE Max 3.86ms).

## 서피스 2 — Tempo 트레이스 (web)
1. `goto` `http://localhost:3000/explore?...panes=<Tempo traceID 7c463668...>` (basic auth).
2. 트레이스 뷰 렌더 대기(9s).
3. `screenshot` → 08-tempo-scheduler-tick.png: scheduler.tick(2.34ms) 루트 + scheduler.process-job 자식 10개(11 spans).
4. traceID 6a6508bd... → 07-tempo-http-get-jobs.png: GET /jobs 85.6µs 단일 스팬.

## 서피스 3 — Loki 로그 (web)
1. `goto` `http://localhost:3000/explore?...panes=<Loki {source="http", level="error"} | json ...>`.
2. `screenshot` → 11-loki-error-logs.png: level=error, 404 NOT_FOUND / 400 VALIDATION_FAILED, error total 240.
3. `{source="http"} | json` → 10-loki-http-logs.png(info 1.11K/error 240).
4. 로그 행 확장 → traceId 23ebaf... 필드 + derived field "Tempo에서 보기" 링크 → 09-loki-to-tempo-derived-field.png.

## 평균 대시보드 (web)
- `goto` `/d/usalljob-avg-latency` kiosk → 06-avg-latency-dashboard.png: 전체평균 단일 시리즈, 엔드포인트별 평균, 처리량, 평균 vs P50.

모든 스크린샷은 범례 수치/툴팁이 보이는 실데이터 상태로 캡처(빈 축 스크린샷 불인정 원칙).
