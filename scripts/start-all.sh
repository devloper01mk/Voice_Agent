#!/usr/bin/env bash
# Start local stack: API (3001), web (5174), agent-v2, optional ngrok.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export TMPDIR="${ROOT}/.tmp"
mkdir -p "$TMPDIR"
cd "$ROOT"

# Postgres role/db expected by .env (Enterprise PG / Docker Compose both fine)
# DATABASE_URL=postgresql://vsa:vsa@localhost:5432/voice_sales_agent

if ! command -v npx >/dev/null; then
  echo "node/npm required" >&2
  exit 1
fi

echo "==> migrate"
(cd apps/api && npx prisma migrate deploy)

kill_port() {
  local p="$1"
  local pids
  pids="$(lsof -tiTCP:"$p" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "freeing :$p ($pids)"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}
kill_port 3001
kill_port 5174

set -a
# shellcheck disable=SC1091
source "${ROOT}/.env"
# shellcheck disable=SC1091
[[ -f "${ROOT}/apps/agent-v2/.env" ]] && source "${ROOT}/apps/agent-v2/.env"
# shellcheck disable=SC1091
[[ -f "${ROOT}/apps/api/.env" ]] && source "${ROOT}/apps/api/.env"
set +a
export API_AUTH_TOKEN="${API_AUTH_TOKEN:-dev-local-token}"
export API_URL="${API_URL_LOCAL:-http://127.0.0.1:3001}"

echo "==> api"
node --import tsx apps/api/src/index.ts &
API_PID=$!

echo "==> web"
(cd apps/web && npx vite --host 127.0.0.1 --port 5174) &
WEB_PID=$!

echo "==> agent-v2"
API_AUTH_TOKEN="$API_AUTH_TOKEN" API_URL="http://127.0.0.1:3001" \
  node --import tsx apps/agent-v2/src/main.ts dev &
AGENT_PID=$!

if command -v ngrok >/dev/null && [[ "${START_NGROK:-1}" == "1" ]]; then
  NGROK_DOMAIN="${NGROK_DOMAIN:-unrated-smuggler-styling.ngrok-free.dev}"
  echo "==> ngrok ($NGROK_DOMAIN -> :3001)"
  ngrok http --url="$NGROK_DOMAIN" 3001 &
  NGROK_PID=$!
fi

cleanup() {
  echo "stopping..."
  kill "$API_PID" "$WEB_PID" "$AGENT_PID" ${NGROK_PID:-} 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 2
echo "API  http://127.0.0.1:3001  (Bearer ${API_AUTH_TOKEN})"
echo "Web  http://127.0.0.1:5174/"
echo "PIDs api=$API_PID web=$WEB_PID agent=$AGENT_PID ${NGROK_PID:+ngrok=$NGROK_PID}"
wait
