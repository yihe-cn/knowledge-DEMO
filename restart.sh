#!/usr/bin/env bash
set -euo pipefail

# SIMUGO unified restart script
# Usage:
#   ./restart.sh            # restart app + admin + server (default)
#   ./restart.sh admin      # restart admin only
#   ./restart.sh start      # start app + admin + server
#   ./restart.sh stop       # stop app + admin + server
#   ./restart.sh status     # show ports and pids
#   ./restart.sh help       # usage
#
# Optional env vars:
#   APP_PORT=5173 ADMIN_PORT=5174 SERVER_PORT=8000
#   APP_LOG=/tmp/simugo-app.log ADMIN_LOG=/tmp/simugo-admin.log SERVER_LOG=/tmp/simugo-server.log

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT_DIR/app"
ADMIN_DIR="$ROOT_DIR/admin"
SERVER_DIR="$ROOT_DIR/server"

APP_PORT="${APP_PORT:-5173}"
ADMIN_PORT="${ADMIN_PORT:-5174}"
SERVER_PORT="${SERVER_PORT:-8000}"
APP_LOG="${APP_LOG:-/tmp/simugo-app.log}"
ADMIN_LOG="${ADMIN_LOG:-/tmp/simugo-admin.log}"
SERVER_LOG="${SERVER_LOG:-/tmp/simugo-server.log}"

APP_PID_FILE="/tmp/simugo-app.pid"
ADMIN_PID_FILE="/tmp/simugo-admin.pid"
SERVER_PID_FILE="/tmp/simugo-server.pid"

APP_PATTERN="vite --host 0.0.0.0 --port $APP_PORT"
ADMIN_PATTERN="vite --host 0.0.0.0 --port $ADMIN_PORT"
SERVER_PATTERN="uv run uvicorn app.main:app --reload --port $SERVER_PORT"
ALL_SERVICES=(app admin server)

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
  listener_pids="$({ lsof -t -i TCP:"$port" -sTCP:LISTEN 2>/dev/null || true; } | tr '\n' ' ' | sed 's/[[:space:]]*$//')"

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

service_label() {
  case "$1" in
    app) echo "frontend" ;;
    admin) echo "admin" ;;
    server) echo "backend" ;;
    *) echo "$1" ;;
  esac
}

normalize_service() {
  case "$1" in
    all) echo "all" ;;
    app|frontend|student|learner) echo "app" ;;
    admin|management|console) echo "admin" ;;
    server|backend|api) echo "server" ;;
    *)
      log "unknown service: $1"
      usage
      exit 1
      ;;
  esac
}

resolve_services() {
  if [ "$#" -eq 0 ]; then
    printf '%s\n' "${ALL_SERVICES[@]}"
    return
  fi

  local arg service seen_all=false
  for arg in "$@"; do
    service="$(normalize_service "$arg")"
    if [ "$service" = "all" ]; then
      seen_all=true
      break
    fi
    printf '%s\n' "$service"
  done

  if [ "$seen_all" = true ]; then
    printf '%s\n' "${ALL_SERVICES[@]}"
  fi
}

port_for() {
  case "$1" in
    app) echo "$APP_PORT" ;;
    admin) echo "$ADMIN_PORT" ;;
    server) echo "$SERVER_PORT" ;;
  esac
}

pid_file_for() {
  case "$1" in
    app) echo "$APP_PID_FILE" ;;
    admin) echo "$ADMIN_PID_FILE" ;;
    server) echo "$SERVER_PID_FILE" ;;
  esac
}

log_file_for() {
  case "$1" in
    app) echo "$APP_LOG" ;;
    admin) echo "$ADMIN_LOG" ;;
    server) echo "$SERVER_LOG" ;;
  esac
}

pattern_for() {
  case "$1" in
    app) echo "$APP_PATTERN" ;;
    admin) echo "$ADMIN_PATTERN" ;;
    server) echo "$SERVER_PATTERN" ;;
  esac
}

stop_service() {
  local service="$1"
  local label port pid_file pattern
  label="$(service_label "$service")"
  port="$(port_for "$service")"
  pid_file="$(pid_file_for "$service")"
  pattern="$(pattern_for "$service")"

  log "stop: terminating $label"
  kill_pid_file "$pid_file" "$label"
  kill_pattern "$pattern"
  kill_by_port "$port"

  wait_for_port "$port" off 8 || true
  hard_kill_leftovers "$port"
}

stop_services() {
  local service
  for service in "$@"; do
    stop_service "$service"
  done
}

start_service() {
  local service="$1"
  case "$service" in
    app)
      log "start: launching frontend on :$APP_PORT"
      (
        cd "$APP_DIR"
        nohup npm run dev -- --host 0.0.0.0 --port "$APP_PORT" >"$APP_LOG" 2>&1 </dev/null &
        echo $! >"$APP_PID_FILE"
        disown 2>/dev/null || true
      )
      ;;
    admin)
      log "start: launching admin on :$ADMIN_PORT"
      (
        cd "$ADMIN_DIR"
        nohup npm run dev -- --host 0.0.0.0 --port "$ADMIN_PORT" >"$ADMIN_LOG" 2>&1 </dev/null &
        echo $! >"$ADMIN_PID_FILE"
        disown 2>/dev/null || true
      )
      ;;
    server)
      log "start: launching backend on :$SERVER_PORT"
      (
        cd "$SERVER_DIR"
        nohup uv run uvicorn app.main:app --reload --port "$SERVER_PORT" >"$SERVER_LOG" 2>&1 </dev/null &
        echo $! >"$SERVER_PID_FILE"
        disown 2>/dev/null || true
      )
      ;;
  esac
}

start_services() {
  local service
  for service in "$@"; do
    start_service "$service"
  done
}

wait_services_ready() {
  local ok=true
  local service label port log_file url

  for service in "$@"; do
    label="$(service_label "$service")"
    port="$(port_for "$service")"
    log_file="$(log_file_for "$service")"
    if [ "$service" = "server" ]; then
      url="http://127.0.0.1:$port"
    else
      url="http://localhost:$port"
    fi

    if wait_for_port "$port" on 12; then
      log "$label ready: $url"
    else
      log "WARN: $label not listening on :$port, see $log_file"
      ok=false
    fi
  done

  if [ "$ok" = true ]; then
    return 0
  fi
  return 1
}

start_check_deps() {
  local need_npm=false
  local need_uv=false
  local service

  for service in "$@"; do
    case "$service" in
      app|admin) need_npm=true ;;
      server) need_uv=true ;;
    esac
  done

  if [ "$need_npm" = true ]; then
    command_exists npm || { log "npm not found"; return 1; }
  fi
  if [ "$need_uv" = true ]; then
    command_exists uv || { log "uv not found"; return 1; }
  fi
}

print_run_summary() {
  local service label pid_file log_file

  for service in "$@"; do
    label="$(service_label "$service")"
    pid_file="$(pid_file_for "$service")"
    log_file="$(log_file_for "$service")"
    printf "%-8s PID: %s\n" "$label" "$(cat "$pid_file" 2>/dev/null || echo unknown)"
    printf "%-8s log: %s\n" "$label" "$log_file"
  done
}

start_all() {
  start_check_deps "$@"
  stop_services "$@"
  sleep 1
  start_services "$@"

  if wait_services_ready "$@"; then
    echo "Restart done."
  else
    echo "Restart started with warnings; check logs."
  fi

  print_run_summary "$@"
}

restart_all() {
  start_all "$@"
}

print_status() {
  local service
  for service in "$@"; do
    status_service "$(service_label "$service")" "$(port_for "$service")" "$(pid_file_for "$service")"
  done
}

usage() {
  cat <<EOF2
Usage: ./restart.sh [command] [service...]

Commands:
  restart   (default)  stop selected services, then start them
  start                start selected services
  stop                 stop selected services
  status               show listening state + pids
  help                 show this help

Services:
  all       (default)  app + admin + server
  app                 learner frontend on APP_PORT (default 5173)
  admin               admin frontend on ADMIN_PORT (default 5174)
  server              FastAPI backend on SERVER_PORT (default 8000)

Examples:
  ./restart.sh
  ./restart.sh admin
  ./restart.sh restart admin
  ./restart.sh start app admin
  ./restart.sh status all
EOF2
}

COMMAND="${1:-restart}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$COMMAND" in
  restart)
    SERVICES=($(resolve_services "$@"))
    restart_all "${SERVICES[@]}"
    ;;
  start)
    SERVICES=($(resolve_services "$@"))
    start_all "${SERVICES[@]}"
    ;;
  stop)
    SERVICES=($(resolve_services "$@"))
    stop_services "${SERVICES[@]}"
    log "stopped"
    ;;
  status)
    SERVICES=($(resolve_services "$@"))
    print_status "${SERVICES[@]}"
    ;;
  help|--help|-h)
    usage
    ;;
  all|app|frontend|student|learner|admin|management|console|server|backend|api)
    SERVICES=($(resolve_services "$COMMAND" "$@"))
    restart_all "${SERVICES[@]}"
    ;;
  *)
    usage
    exit 1
    ;;
esac
