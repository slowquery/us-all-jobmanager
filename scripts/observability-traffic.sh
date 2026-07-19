#!/usr/bin/env bash
#
# observability-traffic.sh — 관측성 검증용 HTTP 트래픽 생성기.
#
# 목적: Grafana SLO/평균 Latency 대시보드·Tempo 트레이스·Loki 로그에 실데이터가 표시되도록
#   6개 엔드포인트(POST/GET/GET search/GET :id/PATCH/DELETE)를 반복 호출하고, 에러율/가용성
#   패널용 4xx(404·400)와 스케줄러 자식 스팬용 pending 잔류를 의도적으로 생성한다.
#
# 사용법:  observability-traffic.sh [ROUNDS]     (기본 ROUNDS=120)
#          BASE_URL=http://localhost:8080 observability-traffic.sh 120
#
# 산출: 라운드 수·정상/에러 요청 수·잔류 pending id 목록을 stdout 요약으로 출력한다
#   (검증 문서 logs/.../verification.md에 그대로 첨부). P99 분위수 유효성을 위해 엔드포인트당
#   ≥100 샘플을 확보하려면 ROUNDS는 최소 100 이상을 권장한다(n=30이면 P99≈max로 무의미).
set -uo pipefail

BASE="${BASE_URL:-http://localhost:8080}"
ROUNDS="${1:-120}"
PENDING_KEEP="${PENDING_KEEP:-3}"

ok_count=0
err404_count=0
err400_count=0
err409_count=0
declare -a KEPT_IDS=()

# HTTP 상태코드만 반환하는 헬퍼(-o /dev/null: 바디 버림). --connect-timeout/--max-time으로
# 앱이 hang 되어도 스크립트가 무기한 블록되지 않게 보호한다.
http_code() { curl -s --connect-timeout 5 --max-time 15 -o /dev/null -w '%{http_code}' "$@"; }

# POST /jobs 를 호출해 생성된 job id를 stdout으로 반환한다(jq 미설치 환경 대비 sed 추출).
create_job() {
  local title="$1" desc="$2"
  curl -s --connect-timeout 5 --max-time 15 -X POST "$BASE/jobs" \
    -H 'Content-Type: application/json' \
    -d "{\"title\":\"$title\",\"description\":\"$desc\"}" \
    | sed -n 's/.*"id":"\([0-9a-fA-F-]\{36\}\)".*/\1/p'
}

echo "== observability-traffic 시작: BASE=$BASE ROUNDS=$ROUNDS =="

for i in $(seq 1 "$ROUNDS"); do
  # 1) 생성(201)
  id="$(create_job "obs-traffic-R$i" "round $i smoke")"
  [ -n "$id" ] && ok_count=$((ok_count+1))

  # 2) 목록(200)
  [ "$(http_code "$BASE/jobs")" = "200" ] && ok_count=$((ok_count+1))

  # 3) 검색(200) — ASCII title 부분 일치로 URL 인코딩 회피
  [ "$(http_code "$BASE/jobs/search?title=obs")" = "200" ] && ok_count=$((ok_count+1))

  if [ -n "$id" ]; then
    # 4) 단건(200)
    [ "$(http_code "$BASE/jobs/$id")" = "200" ] && ok_count=$((ok_count+1))
    # 5) 수정(200)
    [ "$(http_code -X PATCH "$BASE/jobs/$id" -H 'Content-Type: application/json' -d '{"description":"updated"}')" = "200" ] && ok_count=$((ok_count+1))
    # 6) 삭제(204)
    [ "$(http_code -X DELETE "$BASE/jobs/$id")" = "204" ] && ok_count=$((ok_count+1))
  fi

  # 에러 주입: 404(미존재 단건) + 400(title 누락 생성)
  [ "$(http_code "$BASE/jobs/00000000-0000-0000-0000-000000000000")" = "404" ] && err404_count=$((err404_count+1))
  [ "$(http_code -X POST "$BASE/jobs" -H 'Content-Type: application/json' -d '{}')" = "400" ] && err400_count=$((err400_count+1))

  if [ $((i % 20)) -eq 0 ]; then
    echo "  라운드 $i/$ROUNDS 완료 (ok=$ok_count, 404=$err404_count, 400=$err400_count)"
  fi
done

# scheduler.process-job 자식 스팬 유도: 삭제하지 않는 pending POST 를 PENDING_KEEP 건 잔류.
echo "== pending 잔류 생성(scheduler.process-job 자식 스팬 유도): $PENDING_KEEP 건 =="
for k in $(seq 1 "$PENDING_KEEP"); do
  kid="$(create_job "obs-pending-keep-$k" "retained for scheduler tick")"
  if [ -n "$kid" ]; then
    KEPT_IDS+=("$kid")
    echo "  잔류 pending id: $kid"
  fi
done

# 409(진행 중 삭제 금지) best-effort: tick(60초)이 pending→processing 전이시킨 뒤 삭제 시도.
echo "== 409 유도 best-effort: scheduler tick 대기(최대 90초) 후 잔류 id 삭제 시도 =="
sleep 90
for kid in "${KEPT_IDS[@]}"; do
  code="$(http_code -X DELETE "$BASE/jobs/$kid")"
  echo "  DELETE $kid → $code"
  [ "$code" = "409" ] && err409_count=$((err409_count+1))
done

echo
echo "==== 트래픽 요약 ===="
echo "라운드 수            : $ROUNDS"
echo "정상 요청(2xx) 누계  : $ok_count"
echo "주입 404 건수        : $err404_count"
echo "주입 400 건수        : $err400_count"
echo "유도 409 건수        : $err409_count (best-effort, tick 타이밍 의존)"
echo "잔류 pending id      : ${KEPT_IDS[*]:-(없음)}"
echo "===================="
