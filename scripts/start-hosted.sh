#!/usr/bin/env bash
# The hosted demo's start command (see Dockerfile): the backend inside the container on 127.0.0.1:8001, then the voice
# server on the public port. If either one stops, stop both, so the host restarts the container.
set -uo pipefail
cd "$(dirname "$0")/.."

(cd backend && exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8001) &
BACKEND=$!

# Give the backend a moment, so the first visitor doesn't get the scripted answers while it starts.
python - <<'EOF'
import time, urllib.request
for _ in range(60):
    try:
        urllib.request.urlopen("http://127.0.0.1:8001/health", timeout=1)
        break
    except Exception:
        time.sleep(0.5)
EOF

(cd voice && exec npx tsx src/server/index.ts) &
VOICE=$!

wait -n "$BACKEND" "$VOICE"
echo "A server stopped; stopping the other so the container restarts."
kill "$BACKEND" "$VOICE" 2>/dev/null
exit 1
