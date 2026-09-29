#!/bin/bash
cd "$(dirname "$0")"
export TMPDIR="$PWD/.tmp"
mkdir -p "$TMPDIR"
set -a
source .env
source apps/agent-v2/.env
set +a
export API_AUTH_TOKEN=dev-local-token
export API_URL=http://127.0.0.1:3001
echo "Starting agent-v2 (Ctrl+C to stop)..."
exec node --import tsx apps/agent-v2/src/main.ts dev
