# The hosted demo in one container: the voice server (Node) serves the app and passes /brain/* to the backend
# (Python), which listens only inside the container. One public address, no setup for visitors.
#
#   docker build -t icarus .
#   docker run -p 8787:8787 --env-file voice/.env --env-file backend/.env icarus
#
# Keys come from the host's environment settings (ELEVENLABS_API_KEY, GEMINI_API_KEY, GROQ_API_KEY). Never baked in.

FROM node:24-bookworm-slim AS node

FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /srv
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY frontend/package.json frontend/package-lock.json frontend/
COPY voice/package.json voice/package-lock.json voice/
RUN npm --prefix frontend ci --no-audit --no-fund && npm --prefix voice ci --no-audit --no-fund

COPY . .
RUN npm --prefix frontend run build && npm --prefix voice run build:client

ENV PUBLIC_DEMO=1 \
    BACKEND_PROXY_URL=http://127.0.0.1:8001 \
    VOICE_HOST=0.0.0.0 \
    PORT=8787 \
    ASSISTANT_ENGINE=legacy \
    UBOT_MODE=link \
    PYTHONUNBUFFERED=1
EXPOSE 8787
CMD ["bash", "scripts/start-hosted.sh"]
