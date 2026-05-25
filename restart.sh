#!/usr/bin/env bash
set -euo pipefail

# SIMUGO restart script
# Usage:
#   ./restart.sh
# Optional envs:
#   APP_PORT=5173 SERVER_PORT=8000 APP_LOG=/tmp/simugo-app.log SERVER_LOG=/tmp/simugo-server.log

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
SERVER_DIR="$ROOT_DIR/server"

APP_PORT="${APP_PORT:-5173}"
SERVER_PORT="${SERVER_PORT:-8000}"
APP_LOG="${APP_LOG:-/tmp/simugo-app.log}"
SERVER_LOG="${SERVER_LOG:-/tmp/simugo-server.log}"

APP_PID_FILE="/tmp/simugo-app.pid"
SERVER_PID_FILE="/tmp/simugo-server.pid"

log() {
  echo "$(date '+%F %T') [restart] $*"
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -t -i TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "killing listeners on :$port (pids: $pids)"
    kill -9 $pids || true
  fi
}

kill_stale() {
  pkill -f "vite --host 0.0.0.0 --port $APP_PORT" || true
  pkill -f "uv run uvicorn app.main:app --reload --port $SERVER_PORT" || true
  pkill -f "uvicorn app.main:app --reload --port $SERVER_PORT" || true
}

wait_for_port() {
  local port="$1"
  local max=12
  local i=1
  while [ $i -le $max ]; do
    if lsof -i TCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i+1))
  done
  return 1
}

log "stopping existing processes"
kill_stale
kill_port "$APP_PORT"
kill_port "$SERVER_PORT"
sleep 1

log "starting frontend at :$APP_PORT"
(
  cd "$APP_DIR"
  nohup npm run dev -- --host 0.0.0.0 --port "$APP_PORT" >"$APP_LOG" 2>&1 &
  echo $! >"$APP_PID_FILE"
)

log "starting backend at :$SERVER_PORT"
(
  cd "$SERVER_DIR"
  nohup uv run uvicorn app.main:app --reload --port "$SERVER_PORT" >"$SERVER_LOG" 2>&1 &
  echo $! >"$SERVER_PID_FILE"
)

if wait_for_port "$APP_PORT"; then
  log "frontend ready on http://localhost:$APP_PORT"
else
  log "WARN: frontend may not have started; check $APP_LOG"
fi

if wait_for_port "$SERVER_PORT"; then
  log "backend ready on http://127.0.0.1:$SERVER_PORT"
else
  log "WARN: backend may not have started; check $SERVER_LOG"
fi

echo ""
echo "Restart done."
echo "Frontend PID: $(cat "$APP_PID_FILE" 2>/dev/null || echo unknown)"
echo "Backend PID: $(cat "$SERVER_PID_FILE" 2>/dev/null || echo unknown)"
echo "Frontend log: $APP_LOG"
echo "Backend  log: $SERVER_LOG"
