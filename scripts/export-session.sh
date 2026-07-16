#!/usr/bin/env bash
# Export a GJC session to HISTORY/<KST-session-date>/<session-name>/session.html.
# Agent- and user-runnable alternative to the interactive /export slash command (Rule 7).
#
# Usage: scripts/export-session.sh <session-name> [session-id]
#   <session-name>  kebab task-slug (e.g. project-governance)
#   [session-id]    defaults to $GJC_SESSION_ID
# Overrides: GJC_SESSION_FILE=<path .jsonl>, GJC_SESSION_DATE=<YYYYMMDD>.
#
# The KST date is derived from the SESSION START time (JSONL timestamp), NOT "now",
# so the output path is stable across re-exports and re-exports overwrite in place.
set -euo pipefail

name="${1:?usage: scripts/export-session.sh <session-name> [session-id]}"
sid="${2:-${GJC_SESSION_ID:-}}"
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
  echo "export-session: could not resolve session JSONL; set GJC_SESSION_FILE or pass a session-id" >&2
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
  echo "export-session: gjc --export produced no HTML" >&2
  exit 1
fi
mv -f "$html" "$outdir/session.html"            # fixed path => overwrite, no proliferating copies
echo "export-session: wrote ${outdir#$repo_root/}/session.html (from $(basename "$jsonl"))"
