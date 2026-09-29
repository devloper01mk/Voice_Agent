#!/usr/bin/env bash
# Start Docker Desktop + project Postgres, then smoke-test.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! docker info >/dev/null 2>&1; then
  echo "==> starting Docker Desktop..."
  open -a Docker || open /Applications/Docker.app
  for i in $(seq 1 60); do
    if docker info >/dev/null 2>&1; then
      echo "Docker ready (${i}s)"
      break
    fi
    sleep 1
    if [[ "$i" -eq 60 ]]; then
      echo "Docker daemon not ready. Open Docker Desktop manually and re-run." >&2
      exit 1
    fi
  done
fi

echo "==> docker compose up -d (host port 5433)"
docker compose up -d
sleep 3
docker compose ps

echo "==> postgres probe via docker exec"
CID=$(docker compose ps -q postgres)
for i in $(seq 1 20); do
  if docker exec -e PGPASSWORD=vsa "$CID" psql -U vsa -d voice_sales_agent -c 'select 1 as ok;' 2>/dev/null; then
    break
  fi
  sleep 1
done

echo "==> postgres probe from host :5433"
PGPASSWORD=vsa psql -h localhost -p 5433 -U vsa -d voice_sales_agent -c 'select current_user, current_database();'

echo "==> prisma migrate (uses DATABASE_URL — point at :5433 for compose)"
echo "    DATABASE_URL=postgresql://vsa:vsa@localhost:5433/voice_sales_agent"
DATABASE_URL=postgresql://vsa:vsa@localhost:5433/voice_sales_agent \
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
echo "done."
