# 관측성 검증 — 문제 해결 기록 (troubleshooting)

각 항목은 **증상 → 원인 → 조치 → 재검증** 순으로 기록한다. 관측성 검증 과정에서 실제로 발생한 문제와 해결 과정이다.

---

## 문제 1 — `DELETE /jobs/:id`가 404("Cannot DELETE") + Loki에 DELETE 로그·204 부재 (런타임 결함)

- **증상**
  - 트래픽 1차 실행 시 정상 요청 누계 `ok=600 = 5/round`(6이어야 정상). DELETE만 성공 미집계.
  - 방금 생성(201)한 job을 즉시 DELETE → **404**, 응답 바디 `{"code":"NOT_FOUND","message":"Cannot DELETE /jobs/<id>"}`.
  - `logs.txt`에 `"method":"DELETE"` 0건, `"statusCode":204` 0건. Loki 엔드포인트 그룹핑에서 DELETE 행 부재, 대신 method 빈 `/jobs/:id` 행(락 이벤트) 등장.
- **원인**
  - 응답 메시지 `"Cannot DELETE /jobs/:id"`는 애플리케이션 `ApiException`이 아니라 **Nest/Express 기본 미매칭 라우트 404**다.
  - Nest 부팅 로그 `RouterExplorer`가 **5개 라우트만 Mapped**(POST/GET/GET search/GET :id/PATCH) — `DELETE /jobs/:id` 미등록.
  - 커밋된 소스(`c47cad0`)와 워크트리 소스에는 `@Delete(':id')`(jobs.controller.ts:365)가 **존재**. 즉 소스 결함이 아님.
  - 실행 이미지 `observability-app:latest`는 이전 세션에서 **DELETE 기능 추가 이전 커밋으로 빌드된 stale 이미지**였고, 최초 `up --build`가 백그라운드에서 조기 종료되어 재빌드가 실제로 완료되지 않았다 → stale 이미지로 컨테이너 기동됨.
- **조치**
  - `docker compose -f observability/docker-compose.yml build --no-cache app`로 현재 소스 클린 재빌드.
  - (빌드 실패 → 문제 2 해결 후) 재빌드 성공 → `up -d app`로 컨테이너 재생성.
- **재검증**
  - Nest 부팅 로그에 `Mapped {/jobs/:id, DELETE} route` 등장(6개 라우트 전부).
  - 생성 후 DELETE → **204**, 재삭제 → 404(정상). `logs.txt`에 `statusCode 204` 123건.
  - Loki 엔드포인트 그룹핑에 `DELETE /jobs/:id`(123건, P50 1ms/P99 3.56ms) 정상 표시.
- **결론**: 소스 코드 수정 없이(=src 무침투 원칙 유지) **이미지 재빌드만으로 해결**. 소스 결함이 아니라 배포/캐시 문제였다.

---

## 문제 2 — `docker compose build`가 `.yarn` 미존재로 실패

- **증상**
  - `build --no-cache app` 실행 시 `failed to compute cache key: "/.yarn": not found` (Dockerfile 13행 `COPY .yarn ./.yarn`).
- **원인**
  - `.gitignore`가 `.yarn/*`를 무시(추적 파일은 `.yarn/releases` 등 예외뿐이며 실제로는 없음)하여 **git worktree에는 `.yarn` 디렉터리가 체크아웃되지 않는다**.
  - 메인 체크아웃에는 `.yarn/install-state.gz`가 존재(gitignore된 빌드 산출물). Dockerfile은 이 디렉터리가 있는 컨텍스트(=메인 체크아웃)에서 빌드되도록 설계됨.
  - `.yarnrc.yml`은 `nodeLinker: node-modules`이고 `yarnPath` 미지정 → corepack yarn 사용. `.yarn` 자체는 `yarn install --immutable`이 재생성하므로 내용은 중요치 않으나 **디렉터리 존재는 필요**.
- **조치**
  - gitignore된 빌드 툴링 디렉터리를 워크트리로 복사(추적/커밋 대상 아님):
    `cp -r ../UsAllJobManager/.yarn ./.yarn`
- **재검증**
  - `build --no-cache app` 성공(`Image observability-app Built`).
- **후속 제안(범위 외)**: Dockerfile의 `COPY .yarn ./.yarn`가 gitignore된 디렉터리에 의존하는 것은 클린 클론/워크트리에서 취약하다. `.yarn/releases`를 커밋하거나 `COPY .yarn* ...` 옵션화를 후속 슬라이스에서 검토 권장.

---

## 문제 3 — Grafana Explore가 익명 접근에서 홈으로 리다이렉트

- **증상**: `/explore?...` URL로 이동 시 대시보드가 아닌 "Welcome to Grafana" 홈으로 리다이렉트.
- **원인**: compose의 익명 접근은 `Viewer` 역할(`GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer`)이며, **Explore는 기본적으로 Editor 이상 권한**을 요구한다. 대시보드 조회는 익명으로 가능하나 Explore는 불가.
- **조치**: `GF_AUTH_DISABLE_LOGIN_FORM=true`로 로그인 폼은 비활성이나 **basic auth는 활성**이므로, 브라우저에서 `admin/admin` basic auth 헤더로 Explore 접근.
- **재검증**: Explore에서 Tempo 트레이스 뷰·Loki 로그 뷰 정상 렌더(`07`~`11` 스크린샷).

---

## 문제 4 — 백그라운드 프로세스가 도구 호출 종료 시 함께 종료

- **증상**: `nohup ... &`로 실행한 `docker compose up --build` / 트래픽 스크립트가 조기 종료(로그 0바이트, 컨테이너/데이터 미생성).
- **원인**: 도구 셸 세션이 종료되면 그 프로세스 그룹의 백그라운드 자식도 함께 정리됨.
- **조치**: 오래 걸리는 작업(빌드, 120라운드 트래픽)을 **포그라운드(충분한 타임아웃)** 로 실행.
- **재검증**: 빌드·트래픽 정상 완료(`ok=720`, 컨테이너 5개 Up, Loki/Tempo 데이터 축적).

---

## 문제 5 — Grafana 대시보드 헤드리스 스크린샷이 공백(툴바만)

- **증상**: `fullPage` 스크린샷에 상단 시간범위 툴바만 보이고 패널 영역이 공백.
- **원인**: Grafana(Scenes)는 패널을 **내부 스크롤 컨테이너에서 뷰포트 진입 시 지연 렌더**한다. `fullPage`(window 기준)는 이 내부 컨테이너를 담지 못하고, 패널은 스크롤 전 언마운트 상태.
- **조치**: 충분한 뷰포트 높이 설정 → 내부 스크롤 컨테이너를 위→아래→위로 스크롤해 전 패널 렌더 유도 → **뷰포트 스크린샷**(fullPage 아님). 단일 패널은 `?viewPanel=N`로 전체 화면 캡처.
- **재검증**: 6패널 전부 실데이터 렌더(`.react-grid-item`=6, `No data`=0), 범례 수치 노출 상태로 캡처 성공(`02`,`03`,`06`,`12`,`13`).

---

## 참고 — 비차단 관측

- **tempo `/ready`**: "Ingester not ready: waiting for 15s after being ready" 문구를 반환하나, 트레이스 저장·TraceQL 조회는 정상(§Tempo 실증). Tempo ingester 준비 grace 메시지로, 기능 영향 없음.
- **409 미유도**: 진행 중(processing) 삭제 창이 극히 짧아 best-effort로 재현되지 않음. AC5의 level=error 실선은 404·400으로 충족. (비차단)
