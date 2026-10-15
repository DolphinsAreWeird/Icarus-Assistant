#!/usr/bin/env bash
# Start the whole Icarus demo with one command:   ./demo.sh
#
#   Builds the app, starts the voice server (ElevenLabs voices) and the backend (the brain), then opens the app.
#   - With a model the real brain answers everything. A model means backend/.env has LLM_PROVIDER=groq and
#     GROQ_API_KEY (or gemini and GEMINI_API_KEY), or Ollama is running with the "icarus" model.
#   - Without a model the backend runs its stand-in brain: buys, charts and how-to steps come from the real backend
#     (live prices); anything else gets the prototype's own scripted demo answers. Nothing dead-ends either way.
#
#   ./demo.sh --app-only    the prototype's scripted answers only, no backend (the safest mode)
#   ./demo.sh --no-open     do not open the browser
#   BACKEND_PORT=8001 VOICE_PORT=8787 ./demo.sh
#
# Ctrl+C stops what this script started. Logs: .demo-voice.log, .demo-backend.log
set -euo pipefail
cd "$(dirname "$0")"
ROOT=$(pwd)
VOICE_PORT=${VOICE_PORT:-8787}
BACKEND_PORT=${BACKEND_PORT:-8001}
APP_ONLY=0
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --app-only) APP_ONLY=1 ;;
    --no-open) OPEN=0 ;;
    *) echo "Unknown option: $arg"; exit 2 ;;
  esac
done

PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
up() { curl -sf -m 2 "$1" >/dev/null 2>&1; }
wait_for() { for _ in $(seq 1 90); do up "$1" && return 0; sleep 1; done; return 1; }

# 1. Packages
for d in voice frontend; do
  if [ ! -d "$d/node_modules" ]; then say "Installing $d packages..."; npm --prefix "$d" install --no-audit --no-fund; fi
done

# 2. The app
say "Building the app..."
npm --prefix frontend run build >/dev/null

# 3. The voice server
if up "http://localhost:$VOICE_PORT/api/health"; then
  say "Voice server already running on port $VOICE_PORT."
else
  [ -f voice/.env ] || echo "  Note: voice/.env is missing. Copy voice/.env.example and add the ElevenLabs key; without it the browser's own voice is used."
  say "Starting the voice server on port $VOICE_PORT..."
  (cd voice && PORT="$VOICE_PORT" npm start >"$ROOT/.demo-voice.log" 2>&1) &
  PIDS+=($!)
  wait_for "http://localhost:$VOICE_PORT/api/health" || { echo "The voice server did not start. See .demo-voice.log"; exit 1; }
fi

APP_URL="http://localhost:$VOICE_PORT/app/"
URL="$APP_URL"

# 4. The backend
if [ "$APP_ONLY" = 0 ]; then
  if [ ! -x backend/.venv/bin/python ]; then
    say "Setting up the backend (first time only)..."
    if command -v uv >/dev/null 2>&1; then
      (cd backend && uv venv -q .venv && uv pip install -q -p .venv/bin/python -r requirements.txt)
    else
      (cd backend && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt)
    fi
  fi
  provider=$( (grep -E '^LLM_PROVIDER=' backend/.env 2>/dev/null || true) | tail -1 | cut -d= -f2 | tr -d '"'"'"' ')
  MODEL=stand-in
  if [ "$provider" = groq ] && grep -Eq '^GROQ_API_KEY=.+' backend/.env 2>/dev/null; then MODEL=real; fi
  if [ "$provider" = gemini ] && grep -Eq '^GEMINI_API_KEY=.+' backend/.env 2>/dev/null; then MODEL=real; fi
  if { [ -z "$provider" ] || [ "$provider" = ollama ]; } && curl -s -m 2 http://localhost:11434/api/tags 2>/dev/null | grep -q '"icarus'; then MODEL=real; fi

  if up "http://localhost:$BACKEND_PORT/health"; then
    say "Backend already running on port $BACKEND_PORT."
  else
    if [ "$MODEL" = real ]; then
      say "Starting the backend with the real model on port $BACKEND_PORT..."
      (cd backend && .venv/bin/uvicorn app.main:app --port "$BACKEND_PORT" >"$ROOT/.demo-backend.log" 2>&1) &
    else
      say "No model on this machine: starting the backend with its stand-in brain on port $BACKEND_PORT..."
      echo "  Buys, charts and how-to steps come from the backend; other questions get the prototype's scripted answers."
      (cd backend && .venv/bin/python -m scripts.stand_in_brain --port "$BACKEND_PORT" >"$ROOT/.demo-backend.log" 2>&1) &
    fi
    PIDS+=($!)
    wait_for "http://localhost:$BACKEND_PORT/health" || { echo "The backend did not start. See .demo-backend.log"; exit 1; }
  fi
  echo "  Brain: $(curl -s -m 2 "http://localhost:$BACKEND_PORT/health" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("assistant"))' 2>/dev/null || echo unknown)"
  URL="$APP_URL?backend=http://localhost:$BACKEND_PORT"
fi

# 5. Ready
say "Icarus is ready."
echo "  The app:        $URL"
echo "  Safe mode:      $APP_URL   (the prototype's scripted answers only)"
echo "  Dashboard:      ${APP_URL}?page=dashboard"
echo "  Voice test:     http://localhost:$VOICE_PORT/"
if [ "$OPEN" = 1 ] && command -v open >/dev/null 2>&1; then open "$URL"; fi
if [ "${#PIDS[@]}" -gt 0 ]; then
  say "Press Ctrl+C to stop."
  wait
fi
