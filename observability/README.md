# 관측성 스택 (Grafana + Loki + Tempo + Alloy)

06-observability-design.md / 09-final-design.md가 확정한 설계의 로컬 구현체다. 애플리케이션은
`logs.txt`(NDJSON)만 append하고, Alloy가 그 파일을 tail해 Loki로 push한다. 트레이싱은
`@opentelemetry/sdk-node`가 Tempo(OTLP/HTTP `:4318`)로 직접 전송한다. `logs.txt`의 `traceId`와
Tempo 스팬의 트레이스 ID가 동일 값이므로 Grafana에서 로그 ↔ 트레이스 상호 이동이 가능하다.

## 기동

리포지토리 루트에서 실행한다(`app` 서비스의 빌드 컨텍스트가 `..`이므로 반드시 루트 기준 경로 사용).

```bash
docker compose -f observability/docker-compose.yml up -d --build
```

기동되는 서비스 5개:

| 서비스 | 역할 | 접속 |
| --- | --- | --- |
| `app` | 대상 애플리케이션(NestJS, dist 실행) | http://localhost:8080 |
| `grafana` | 대시보드(익명 조회 허용, 또는 admin/admin) | http://localhost:3000 |
| `loki` | 로그 저장소 | (내부 전용, `:3100`) |
| `tempo` | 트레이스 저장소, OTLP/HTTP 수신 | (내부 전용, `:4318` OTLP / `:3200` query) |
| `alloy` | `logs.txt` tail → JSON 파싱 → Loki push | (내부 전용, `:12345` UI) |

> 앱은 grafana와의 포트 충돌(둘 다 기본 `:3000`)을 피하기 위해 호스트 `8080`으로 노출된다(컨테이너
> 내부는 여전히 `3000`).

## 확인 절차 (traceId 상관 실증 체크리스트)

1. **기동 확인**: `docker compose -f observability/docker-compose.yml ps` — 5개 서비스 모두
   `running`(healthy)인지 확인한다.
2. **트래픽 주입**: job을 몇 건 생성·조회해 HTTP 로그와 상태 전이 로그를 발생시킨다.

   ```bash
   curl -s -X POST http://localhost:8080/jobs \
     -H 'Content-Type: application/json' \
     -d '{"title":"관측성 확인용","description":"observability smoke"}'
   curl -s http://localhost:8080/jobs
   ```

   스케줄러 tick(60초 주기)이 자동으로 `pending → processing → completed` 전이를 만들어내므로,
   1~2분 대기하면 스케줄러 로그(tick/batch/transition/lock)도 함께 쌓인다.
3. **logs.txt 직접 확인(선택)**: `docker compose -f observability/docker-compose.yml exec app cat logs.txt`
   로 NDJSON 라인이 실제로 쌓이는지, `traceId` 필드가 32-hex 소문자로 채워지는지 확인한다.
4. **Grafana 접속**: http://localhost:3000 → 익명(뷰어) 또는 `admin`/`admin`으로 로그인 →
   `Dashboards → UsAllJobManager → UsAllJobManager 관측성` 대시보드를 연다.
5. **6개 패널 데이터 확인**: job 상태 분포 / 처리량·지연 p50·p95 / tick 성공률·소요시간 / 에러율 /
   상태 전이 흐름(from→to 테이블) / 락 대기 시간(waitMs/holdMs) 패널에 모두 데이터가 표시되는지
   확인한다(트래픽 주입 직후에는 비어 있을 수 있으니 시간 범위를 "Last 1 hour" 이상으로 유지).
6. **traceId 상관 실증**: `Explore → Loki`에서 `{source="http"} | json` 쿼리로 아무 로그 라인을
   펼쳐 `traceId` 필드 값을 확인 → 해당 라인의 "Tempo에서 보기" derived field 링크(또는 `Explore`
   패널의 링크 아이콘)를 클릭해 Tempo에서 **동일 traceId**의 스팬 트리(HTTP 루트 스팬, 또는 스케줄러
   tick 루트 스팬 → job 자식 스팬)가 열리는지 확인한다. 이 왕복이 성공하면 로그↔트레이스 상관
   (06 확정 사항)이 실제로 동작함을 실증한 것이다.

## 종료

```bash
docker compose -f observability/docker-compose.yml down
```

데이터(Loki/Tempo 저장 볼륨)까지 초기화하려면 `-v`를 추가한다.

## 참고

- 로그 카탈로그 6종, 트레이싱 범위, 대시보드 패널 설계 근거는
  [`../logs/20260717/implementation-design/06-observability-design.md`](../logs/20260717/implementation-design/06-observability-design.md)
  참조.
- 이 디렉터리와 `Dockerfile`/`.dockerignore`는 S10 슬라이스 산출물이다. 애플리케이션 코드(`src/**`)는
  이 세션에서 수정하지 않았다.
