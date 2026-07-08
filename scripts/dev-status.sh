#!/usr/bin/env bash
#
# dev-status.sh — read-only "what's up?" check for the Bazi dev stack.
# Verifies web (:3000), API (:4000), Bazi engine (:5001), Postgres (:5432),
# Redis (:6379). Starts nothing, stops nothing. See also: scripts/dev-all.sh.

set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

port_up()   { lsof -iTCP:"$1" -sTCP:LISTEN -P -t >/dev/null 2>&1; }
health_ok() { curl -sf --max-time 3 "$1" >/dev/null 2>&1; }
web_ok()    { curl -s -o /dev/null --max-time 3 "http://localhost:3000/" >/dev/null 2>&1; }
row()       { printf "  %-8s %s\n" "$1" "$2"; }

echo "──────────── Bazi dev stack status ────────────"
web_ok                                    && row web    "✓ serving   :3000" || row web    "✗ down      :3000  (npm run dev:all)"
health_ok "http://localhost:4000/health"  && row api    "✓ ready     :4000" || row api    "✗ down      :4000  (npm run dev:all)"
health_ok "http://localhost:5001/health"  && row engine "✓ ready     :5001" || row engine "✗ down      :5001  (npm run dev:all)"
port_up 5432                              && row db     "✓ up        :5432" || row db     "✗ down      :5432  (Postgres — see CLAUDE.md)"
port_up 6379                              && row cache  "✓ up        :6379" || row cache  "✗ down      :6379  (Redis — see CLAUDE.md)"
echo "────────────────────────────────────────────────"
