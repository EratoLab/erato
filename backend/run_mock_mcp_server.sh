#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
cd "$SCRIPT_DIR"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-44321}"
LOG_DIR="${SCRIPT_DIR}/target/mock-mcp-server"
LOG_FILE="${LOG_DIR}/mock-mcp-server.log"
PID_FILE="${LOG_DIR}/mock-mcp-server.pid"
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-120}"

mkdir -p "$LOG_DIR"

is_pid_running() {
    local pid="$1"
    kill -0 "$pid" 2>/dev/null
}

is_port_listening() {
    lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
}

if [[ -f "$PID_FILE" ]]; then
    EXISTING_PID=$(cat "$PID_FILE")
    if [[ -n "$EXISTING_PID" ]] && is_pid_running "$EXISTING_PID"; then
        echo "mock-mcp-server is already running."
        echo "  PID: $EXISTING_PID"
        echo "  Host: $HOST"
        echo "  Port: $PORT"
        echo "  Log: $LOG_FILE"
        exit 0
    fi
    rm -f "$PID_FILE"
fi

if is_port_listening; then
    echo "Error: Port $PORT is already in use. Please stop the existing service first."
    exit 1
fi

rm -f "$LOG_FILE"

echo "Starting mock-mcp-server..."
nohup env HOST="$HOST" PORT="$PORT" cargo run --bin mock-mcp-server >"$LOG_FILE" 2>&1 </dev/null &
SERVER_PID=$!
echo "$SERVER_PID" >"$PID_FILE"

SECONDS_WAITED=0
until grep -q "Listening on" "$LOG_FILE" 2>/dev/null; do
    if ! is_pid_running "$SERVER_PID"; then
        echo "mock-mcp-server exited before becoming ready."
        echo "Recent log output:"
        tail -n 50 "$LOG_FILE" 2>/dev/null || true
        rm -f "$PID_FILE"
        exit 1
    fi

    if (( SECONDS_WAITED >= STARTUP_TIMEOUT_SECONDS )); then
        echo "Timed out waiting for mock-mcp-server to become ready."
        echo "Recent log output:"
        tail -n 50 "$LOG_FILE" 2>/dev/null || true
        rm -f "$PID_FILE"
        exit 1
    fi

    sleep 1
    SECONDS_WAITED=$((SECONDS_WAITED + 1))
done

echo "mock-mcp-server is running."
echo "  PID: $SERVER_PID"
echo "  Host: $HOST"
echo "  Port: $PORT"
echo "  Base URL: http://$HOST:$PORT"
echo "  Log: $LOG_FILE"
