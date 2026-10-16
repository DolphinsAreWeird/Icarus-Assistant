#!/usr/bin/env bash
# Live demo that answers the same way every time:   ./run-mock.sh
# Saved prices, no model, fixed wording for "Hey Icarus, I want to buy 1000 baht of gold" (backend/app/mock_demo.py).
# Open http://localhost:8787/app/ . Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")"
PIDS=(); trap 'for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done' EXIT INT TERM
for port in 8000 8787; do lsof -ti :$port | xargs kill 2>/dev/null || true; done
npm --prefix frontend run build >/dev/null
(cd backend && ICARUS_MOCK=1 LLM_PROVIDER=none .venv/bin/uvicorn app.main:app --port 8000 >../.mock-backend.log 2>&1) & PIDS+=($!)
for _ in $(seq 1 30); do curl -sf -m 2 localhost:8000/health >/dev/null && break; sleep 1; done
curl -sf -X POST localhost:8000/demo/reset >/dev/null   # a fresh account: 5,000 baht cash, nothing held
(cd voice && BACKEND_PROXY_URL=http://127.0.0.1:8000 npm start >../.mock-voice.log 2>&1) & PIDS+=($!)
for _ in $(seq 1 30); do curl -sf -m 2 localhost:8787/api/health >/dev/null && break; sleep 1; done
echo "Ready: http://localhost:8787/app/   (say: Hey Icarus, I want to buy 1000 baht of gold)"
wait
