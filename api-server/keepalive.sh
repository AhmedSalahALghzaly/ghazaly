#!/bin/sh
# keepalive.sh v6 — fixed port detection
# Root cause of v5 failure: fuser 8080/tcp doesn't work in Replit's container.
# Fix: use curl health-check instead.
cd "$(dirname "$0")"

check_server() {
  curl -sf http://localhost:8080/api/healthz >/dev/null 2>&1
}

start_server() {
  echo "[keepalive] Starting server..."
  PORT=8080 NODE_ENV=development setsid node dist/index.cjs >> /tmp/api-stable.log 2>&1 &
  # Wait up to 15s for the server to respond
  local i=0
  while [ $i -lt 15 ]; do
    sleep 1
    if check_server; then
      echo "[keepalive] Server is up"
      return 0
    fi
    i=$((i + 1))
  done
  echo "[keepalive] Warning: server did not respond within 15s"
  return 1
}

# Only start if not already responding
if check_server; then
  echo "[keepalive] Server already running — monitoring only"
else
  start_server
fi

# Monitor loop
while true; do
  sleep 20
  if ! check_server; then
    echo "[keepalive] Server not responding — restarting"
    start_server
  fi
done
