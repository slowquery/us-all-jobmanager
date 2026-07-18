#!/usr/bin/env bash
# Export a GJC session to HISTORY/<KST-session-date>/<session-name>/session.html.
# Agent- and user-runnable alternative to the interactive /export slash command (Rule 7).
#
# Usage: scripts/export-session.sh <session-name> [session-id] [out-filename]
#   <session-name>  kebab task-slug (e.g. project-governance)
#   [session-id]    defaults to $GJC_SESSION_ID
#   [out-filename]  출력 파일명, 기본값 session.html (예: session2.html 로 동일 세션 별도 스냅샷)
# Overrides: GJC_SESSION_FILE=<path .jsonl>, GJC_SESSION_DATE=<YYYYMMDD>.
#
# The KST date is derived from the SESSION START time (JSONL timestamp), NOT "now",
# so the output path is stable across re-exports and re-exports overwrite in place.
set -euo pipefail

name="${1:?사용법: scripts/export-session.sh <session-name> [session-id] [out-filename]}"
sid="${2:-${GJC_SESSION_ID:-}}"
out_name="${3:-session.html}"
repo_root="$(git rev-parse --show-toplevel)"

# Resolve the session JSONL.
jsonl="${GJC_SESSION_FILE:-}"
if [ -z "$jsonl" ] && [ -n "$sid" ]; then
  jsonl="$(ls -1t "$HOME"/.gjc/shared-sessions/*/*"$sid"*.jsonl 2>/dev/null | head -1 || true)"
fi
if [ -z "$jsonl" ]; then
  jsonl="$(ls -1t "$HOME"/.gjc/shared-sessions/*/*.jsonl 2>/dev/null | head -1 || true)"
fi
if [ -z "$jsonl" ] || [ ! -f "$jsonl" ]; then
  echo "export-session: 세션 JSONL을 찾지 못했습니다 — GJC_SESSION_FILE을 설정하거나 session-id를 인자로 전달하세요." >&2
  exit 1
fi

# Derive stable KST date from the session-start timestamp encoded in the JSONL basename
# (e.g. 2026-07-16T07-50-32-178Z_<id>.jsonl). Fall back to current KST date on parse failure.
date="${GJC_SESSION_DATE:-}"
if [ -z "$date" ]; then
  ts="$(basename "$jsonl")"; ts="${ts%%_*}"     # 2026-07-16T07-50-32-178Z
  d="${ts%%T*}"; t="${ts#*T}"; t="${t%Z}"       # d=2026-07-16 ; t=07-50-32-178
  hh="${t%%-*}"; r="${t#*-}"; mm="${r%%-*}"; r="${r#*-}"; ss="${r%%-*}"
  iso="${d}T${hh}:${mm}:${ss}Z"
  date="$(TZ=Asia/Seoul date -d "$iso" +%Y%m%d 2>/dev/null || true)"
  [ -n "$date" ] || date="$(TZ=Asia/Seoul date +%Y%m%d)"
fi

outdir="$repo_root/HISTORY/${date}-${name}"
mkdir -p "$outdir"

# `gjc --export` writes gjc-session-*.html into CWD; render in a temp dir, then move to the fixed path.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
( cd "$tmp" && gjc --export "$jsonl" >/dev/null )
html="$(ls -1t "$tmp"/gjc-session-*.html 2>/dev/null | head -1 || true)"
if [ -z "$html" ] || [ ! -f "$html" ]; then
  echo "export-session: gjc --export가 HTML을 생성하지 못했습니다." >&2
  exit 1
fi
mv -f "$html" "$outdir/$out_name"               # 고정 경로 => 덮어쓰기, 사본 난립 방지
echo "export-session: ${outdir#$repo_root/}/$out_name 기록 완료 (원본 $(basename "$jsonl"))"
