#!/usr/bin/env bash
# The hosted demo's start command (see Dockerfile): the backend inside the container on 127.0.0.1:8001, then the voice
# server on the public port. If either one stops, stop both, so the host restarts the container.
# If the backend dies or never becomes ready, exit nonzero without starting the voice server.
# Test hooks: HOSTED_BACKEND_CMD, HOSTED_BACKEND_WAIT_S, HOSTED_BACKEND_READY_URL, HOSTED_VOICE_CMD.
set -uo pipefail
cd "$(dirname "$0")/.."

(cd backend && exec ${HOSTED_BACKEND_CMD:-python -m uvicorn app.main:app --host 127.0.0.1 --port 8001}) &
BACKEND=$!

# Bash runs as PID 1 in the container: without a trap it ignores the host's SIGTERM. Stop both servers on it.
VOICE=
stop_all() {
  local p
  for p in "$BACKEND" ${VOICE:+"$VOICE"}; do kill "$p" 2>/dev/null; done
  for _ in $(seq 1 20); do
    if ! kill -0 "$BACKEND" 2>/dev/null && { [ -z "$VOICE" ] || ! kill -0 "$VOICE" 2>/dev/null; }; then break; fi
    sleep 0.25
  done
  for p in "$BACKEND" ${VOICE:+"$VOICE"}; do kill -9 "$p" 2>/dev/null; done  # a hung server ignores SIGTERM
}
trap 'stop_all; exit 143' TERM INT

# Wait until the backend answers /ready (engine up, prices loaded), so the first visitor never gets a dead brain.
# Give up early if the backend process exits.
READY_URL="${HOSTED_BACKEND_READY_URL:-http://127.0.0.1:8001/ready}"
deadline=$((SECONDS + ${HOSTED_BACKEND_WAIT_S:-60}))
ready=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if ! kill -0 "$BACKEND" 2>/dev/null; then echo "The backend exited during startup." >&2; break; fi
  if READY_URL="$READY_URL" python -c 'import os, sys, urllib.request
try: sys.exit(0 if urllib.request.urlopen(os.environ["READY_URL"], timeout=2).status == 200 else 1)
except Exception: sys.exit(1)' 2>/dev/null; then ready=1; break; fi
  sleep 0.5
done
if [ "$ready" != 1 ]; then
  echo "The backend never became ready; stopping so the container restarts." >&2
  stop_all
  exit 1
fi

(cd voice && exec ${HOSTED_VOICE_CMD:-npx tsx src/server/index.ts}) &
VOICE=$!

wait -n "$BACKEND" "$VOICE"
echo "A server stopped; stopping the other so the container restarts."
stop_all
exit 1
