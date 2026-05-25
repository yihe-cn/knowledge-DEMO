#!/usr/bin/env bash
set -euo pipefail

# SIMUGO unified restart script
# Usage:
#   ./restart.sh            # restart both services (default)
#   ./restart.sh start      # start both
#   ./restart.sh stop       # stop both
#   ./restart.sh status     # show ports and pids
#   ./restart.sh help       # usage
#
# Optional env vars:
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

APP_PATTERN="vite --host 0.0.0.0 --port $APP_PORT"
SERVER_PATTERN="uv run uvicorn app.main:app --reload --port $SERVER_PORT"

log() {
  echo "$(date '+%F %T') [simugo] $*"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

kill_pid_file() {
  local pid_file="$1"
  local name="$2"
  local pids pid

  if [ -f "$pid_file" ]; then
    pids="$(cat "$pid_file")"
    for pid in $pids; do
      if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        log "stopping $name by pid $pid"
        kill "$pid" || true
      fi
    done
    rm -f "$pid_file"
  fi
}

kill_by_port() {
  local port="$1"
  local pids
  pids="$(lsof -t -i TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "killing listeners on :$port (pids: $pids)"
    kill $pids 2>/dev/null || true
  fi
}

kill_pattern() {
  pkill -f "$1" >/dev/null 2>&1 || true
}

wait_for_port() {
  local port="$1"
  local target="$2"   # on|off
  local max="${3:-12}"
  local i=1

  while [ "$i" -le "$max" ]; do
    if lsof -i TCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      if [ "$target" = "on" ]; then
        return 0
      fi
    else
      if [ "$target" = "off" ]; then
        return 0
      fi
    fi
    sleep 1
    i=$((i+1))
  done
  return 1
}

hard_kill_leftovers() {
  local port="$1"
  local pids
  pids="$(lsof -t -i TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    log "force stopping remaining pids on :$port ($pids)"
    kill -9 $pids 2>/dev/null || true
  fi
}

status_service() {
  local name="$1"
  local port="$2"
  local pid_file="$3"
  local status="stopped"

  if lsof -i TCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    status="running"
  fi

  local listener_pids
  listener_pids="$(lsof -t -i TCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//')"

  local file_pid="unknown"
  if [ -f "$pid_file" ]; then
    file_pid="$(cat "$pid_file")"
    if [ -n "$file_pid" ] && kill -0 "$file_pid" 2>/dev/null; then
      file_pid="${file_pid} (alive)"
    else
      file_pid="${file_pid} (stale)"
    fi
  fi

  echo "$name: $status | listen :$port | listener_pids=${listener_pids:-none} | pidfile=$file_pid"
}

stop_services() {
  log "stop: terminating frontend + backend"
  kill_pid_file "$APP_PID_FILE" "frontend"
  kill_pid_file "$SERVER_PID_FILE" "backend"
  kill_pattern "$APP_PATTERN"
  kill_pattern "$SERVER_PATTERN"
  kill_by_port "$APP_PORT"
  kill_by_port "$SERVER_PORT"

  wait_for_port "$APP_PORT" off 8 || true
  wait_for_port "$SERVER_PORT" off 8 || true
  hard_kill_leftovers "$APP_PORT"
  hard_kill_leftovers "$SERVER_PORT"
}

start_services() {
  log "start: launching frontend on :$APP_PORT"
  (
    cd "$APP_DIR"
    nohup npm run dev -- --host 0.0.0.0 --port "$APP_PORT" >"$APP_LOG" 2>&1 &
    echo $! >"$APP_PID_FILE"
  )

  log "start: launching backend on :$SERVER_PORT"
  (
    cd "$SERVER_DIR"
    nohup uv run uvicorn app.main:app --reload --port "$SERVER_PORT" >"$SERVER_LOG" 2>&1 &
    echo $! >"$SERVER_PID_FILE"
  )
}

wait_services_ready() {
  local ok=true

  if wait_for_port "$APP_PORT" on 12; then
    log "frontend ready: http://localhost:$APP_PORT"
  else
    log "WARN: frontend not listening on :$APP_PORT, see $APP_LOG"
    ok=false
  fi

  if wait_for_port "$SERVER_PORT" on 12; then
    log "backend ready: http://127.0.0.1:$SERVER_PORT"
  else
    log "WARN: backend not listening on :$SERVER_PORT, see $SERVER_LOG"
    ok=false
  fi

  if [ "$ok" = true ]; then
    return 0
  fi
  return 1
}

start_check_deps() {
  command_exists npm || { log "npm not found"; return 1; }
  command_exists uv || { log "uv not found"; return 1; }
}

start_all() {
  start_check_deps
  stop_services
  sleep 1
  start_services

  if wait_services_ready; then
    echo "Restart done."
  else
    echo "Restart started with warnings; check logs."
  fi

  echo "Frontend PID: $(cat "$APP_PID_FILE" 2>/dev/null || echo unknown)"
  echo "Backend  PID: $(cat "$SERVER_PID_FILE" 2>/dev/null || echo unknown)"
  echo "Frontend log: $APP_LOG"
  echo "Backend  log: $SERVER_LOG"
}

restart_all() {
  start_all
}

print_status() {
  status_service "frontend" "$APP_PORT" "$APP_PID_FILE"
  status_service "backend" "$SERVER_PORT" "$SERVER_PID_FILE"
}

usage() {
  cat <<EOF2
Usage: ./restart.sh [command]

Commands:
  restart   (default)  stop frontend + backend, then start both
  start                start frontend + backend
  stop                 stop frontend + backend
  status               show listening state + pids
  help                 show this help
EOF2
}

COMMAND="${1:-restart}"
case "$COMMAND" in
  restart)
    restart_all
    ;;
  start)
    start_all
    ;;
  stop)
    stop_services
    log "stopped"
    ;;
  status)
    print_status
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
