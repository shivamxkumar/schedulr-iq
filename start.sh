#!/usr/bin/env bash
# Starts SCHEDULR IQ: FastAPI backend on :8010 and Vite frontend on :5180.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
if [ ! -d "$ROOT/backend/.venv" ]; then
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && npm install)
(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --port 8010) &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT
cd "$ROOT/frontend" && npx vite
