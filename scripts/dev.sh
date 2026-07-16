#!/usr/bin/env bash
# Load env, ensure Postgres, then start Next.js (dev or start).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export DATABASE_URL="${DATABASE_URL:-postgresql://127.0.0.1:5432/meter}"

bash "$ROOT/scripts/ensure-db.sh"

MODE="${1:-dev}"
if [[ "$MODE" == "start" ]]; then
  exec npx next start
fi
exec npx next dev
