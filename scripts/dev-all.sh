#!/usr/bin/env bash
#
# dev-all.sh — start the full Bazi dev stack in one command:
#   web (:3000)  +  API (:4000)  +  Python Bazi engine (:5001)
# plus a Postgres/Redis prereq check and a health-checked status table.
#
# Why: the dashboard needs all three app services up, and each feature degrades
# SILENTLY when its backend is down (credit badge hides, banner falls back, the
# daily-fortune card renders nothing) — so a missing service looks like a bug.
# `npm run dev` (turbo) only starts the JS apps; the Python engine has no
# package.json and must be launched separately. This script closes that gap.
#
# Notes:
#  - Idempotent: any service already listening is left alone (not restarted,
#    and NOT stopped on exit).
#  - Ctrl+C stops ONLY the services this script started. Pre-existing services
#    (and Postgres/Redis, which persist across sessions) are never touched.
#  - `[n] …` / `[n]+ Done` lines are normal shell job-control output, not errors.
#
# See CLAUDE.md § "Worktree Development Guide" / "Important Notes".

set -uo pipefail   # NOT -e: expected-nonzero curl/lsof/kill must not abort us
set -m             # job control: each backgrounded service gets its own group

# ---- locate repo root + detect worktree ------------------------------------
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "✗ not inside a git repo"; exit 1; }
cd "$ROOT"

IS_WORKTREE=0
if [ "$(git rev-parse --git-dir 2>/dev/null)" != "$(git rev-parse --git-common-dir 2>/dev/null)" ]; then
  IS_WORKTREE=1
fi

export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
NODE_BIN="$ROOT/node_modules/.bin"

# ---- launch tracking (appended ONLY on an actual launch) -------------------
STARTED_PIDS=()
STARTED_PORTS=()

# ---- helpers ---------------------------------------------------------------
port_up()   { lsof -iTCP:"$1" -sTCP:LISTEN -P -t >/dev/null 2>&1; }
health_ok() { curl -sf --max-time 5 "$1" >/dev/null 2>&1; }
# web: no -f (Next dev may 404 while compiling); exit 0 = connected/serving.
web_ok()    { curl -s -o /dev/null --max-time 5 "http://localhost:3000/" >/dev/null 2>&1; }

# ---- cleanup (re-entry-guarded; only touches what WE started) ---------------
_CLEANED=""
cleanup() {
  [ -n "$_CLEANED" ] && return
  _CLEANED=1
  trap - EXIT INT TERM
  if [ "${#STARTED_PIDS[@]}" -gt 0 ]; then
    echo ""
    echo "→ stopping services started by this script…"
    for pid in "${STARTED_PIDS[@]}"; do
      [ -n "${pid:-}" ] || continue
      pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
      if [ -n "${pgid:-}" ]; then kill -TERM "-$pgid" 2>/dev/null || true; fi
    done
  fi
  if [ "${#STARTED_PORTS[@]}" -gt 0 ]; then
    sleep 3 || true
    ports="$(IFS=,; echo "${STARTED_PORTS[*]}")"
    pids="$(lsof -ti:"$ports" 2>/dev/null || true)"
    if [ -n "${pids:-}" ]; then echo "$pids" | xargs kill -9 2>/dev/null || true; fi
    echo "→ done."
  fi
}
trap cleanup EXIT INT TERM

# ---- prereqs: Postgres + Redis (check-only, never auto-started) -------------
missing=""
port_up 5432 || missing="Postgres(:5432)"
port_up 6379 || missing="${missing:+$missing, }Redis(:6379)"
if [ -n "$missing" ]; then
  echo "✗ Required background services not running: $missing"
  echo "  These are Homebrew services (they persist across sessions), so this"
  echo "  script does not start them. See CLAUDE.md § Important Notes / Worktree"
  echo "  Development Guide for the correct 'brew services start …' command for"
  echo "  this machine (the Postgres formula version differs per setup)."
  exit 1
fi

echo "▶ Bazi dev stack — context: $([ "$IS_WORKTREE" = 1 ] && echo 'git worktree' || echo 'main repo')"
echo "  Postgres :5432 ✓   Redis :6379 ✓   (not managed by this script)"

# ---- engine :5001 ----------------------------------------------------------
ENGINE_NOTE="already running (not managed)"
if ! port_up 5001; then
  UVICORN="$ROOT/packages/bazi-engine/.venv/bin/uvicorn"
  if [ ! -x "$UVICORN" ]; then
    echo "✗ Bazi engine venv not found ($UVICORN)."
    echo "  Setup (see CLAUDE.md): cd packages/bazi-engine && python -m venv .venv \\"
    echo "    && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
  fi
  ( cd "$ROOT/packages/bazi-engine" && exec "$UVICORN" app.main:app --host 0.0.0.0 --port 5001 --reload ) &
  epid=$!
  STARTED_PIDS+=("$epid"); STARTED_PORTS+=("5001")
  ENGINE_NOTE="started (pid $epid)"
fi

# ---- web :3000 -------------------------------------------------------------
WEB_NOTE="already running (not managed)"
if ! port_up 3000; then
  ( cd "$ROOT/apps/web" && exec "$NODE_BIN/next" dev --port 3000 ) &
  wpid=$!
  STARTED_PIDS+=("$wpid"); STARTED_PORTS+=("3000")
  WEB_NOTE="started (pid $wpid)"
fi

# ---- api :4000 -------------------------------------------------------------
API_NOTE="already running (not managed)"
if ! port_up 4000; then
  if [ "$IS_WORKTREE" = 1 ]; then
    # In a worktree `nest start --watch` (turbo's dev task) fails on @repo/shared
    # resolution — use the documented build + tsx-loader path instead.
    echo "→ (worktree) building API (no hot-reload in worktree mode)…"
    if ! ( cd "$ROOT/apps/api" && "$NODE_BIN/nest" build ); then
      echo "✗ API build failed. Check the @repo/shared symlink (CLAUDE.md worktree guide)."
      exit 1
    fi
    # Claude Code sets ANTHROPIC_API_KEY empty in-shell — source it from .env,
    # stripping surrounding quotes (the file mixes quoted + unquoted values).
    KEY="$(grep '^ANTHROPIC_API_KEY=' "$ROOT/apps/api/.env" 2>/dev/null | cut -d= -f2- \
            | sed -e 's/^[[:space:]]*//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
    if [ -z "$KEY" ]; then
      echo "✗ ANTHROPIC_API_KEY missing/empty in apps/api/.env — refusing to start a"
      echo "  keyless API (it would pass /health but every AI call would fail silently)."
      exit 1
    fi
    ( cd "$ROOT/apps/api" && exec env ANTHROPIC_API_KEY="$KEY" node --import tsx dist/main.js ) &
    apid=$!
    STARTED_PIDS+=("$apid"); STARTED_PORTS+=("4000")
    API_NOTE="started (pid $apid) — worktree: no watch, rebuild+restart to pick up API changes"
  else
    ( exec "$NODE_BIN/turbo" run dev --filter=api ) &
    apid=$!
    STARTED_PIDS+=("$apid"); STARTED_PORTS+=("4000")
    API_NOTE="started (pid $apid)"
  fi
fi

# ---- readiness poll (real /health for api+engine; connect check for web) ----
echo ""
echo "→ waiting for services to become ready…"
ready_web=0; ready_api=0; ready_engine=0
tries=0
while [ "$tries" -lt 90 ]; do
  [ "$ready_engine" -eq 1 ] || { health_ok "http://localhost:5001/health" && ready_engine=1; }
  [ "$ready_api"    -eq 1 ] || { health_ok "http://localhost:4000/health" && ready_api=1; }
  [ "$ready_web"    -eq 1 ] || { web_ok && ready_web=1; }
  { [ "$ready_web" -eq 1 ] && [ "$ready_api" -eq 1 ] && [ "$ready_engine" -eq 1 ]; } && break
  tries=$((tries + 1))
  sleep 1
done

mark() { [ "$1" -eq 1 ] && printf "✓ ready    " || printf "✗ NOT READY"; }
echo ""
echo "──────────────────────── dev stack ────────────────────────"
printf "  web     %s  %s\n" "$(mark "$ready_web")"    "http://localhost:3000  — $WEB_NOTE"
printf "  api     %s  %s\n" "$(mark "$ready_api")"    "http://localhost:4000  — $API_NOTE"
printf "  engine  %s  %s\n" "$(mark "$ready_engine")" "http://localhost:5001  — $ENGINE_NOTE"
printf "  db      ✓ ready     %s\n" ":5432  — Postgres (not managed)"
printf "  cache   ✓ ready     %s\n" ":6379  — Redis (not managed)"
echo "────────────────────────────────────────────────────────────"

# ---- hand off / stream logs ------------------------------------------------
if [ "${#STARTED_PIDS[@]}" -gt 0 ]; then
  echo "  Streaming logs. Ctrl+C stops the services this script started."
  echo "  ('[n]…' / '[n]+ Done' lines are normal shell job-control output.)"
  echo ""
  wait
else
  echo "  Everything was already running — nothing started, nothing to stop."
  exit 0
fi
