#!/usr/bin/env bash
# Ensure something is listening on 127.0.0.1:5432 before Next.js starts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
  echo "Postgres already accepting connections on 127.0.0.1:5432"
  exit 0
fi

# Prefer Docker if available (stable TCP for Next.js)
if command -v docker >/dev/null 2>&1; then
  echo "Starting Postgres via docker compose…"
  docker compose up -d postgres
  for i in $(seq 1 40); do
    if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      echo "Postgres is ready"
      exit 0
    fi
    sleep 0.5
  done
fi

# Fallback: Homebrew postgresql@16
if command -v brew >/dev/null 2>&1; then
  echo "Starting Homebrew postgresql@16…"
  brew services start postgresql@16 >/dev/null 2>&1 || true
  for i in $(seq 1 40); do
    if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      echo "Postgres is ready"
      exit 0
    fi
    sleep 0.5
  done
fi

echo "Could not start Postgres on 127.0.0.1:5432" >&2
echo "Install Docker Desktop or: brew install postgresql@16 && brew services start postgresql@16" >&2
exit 1
