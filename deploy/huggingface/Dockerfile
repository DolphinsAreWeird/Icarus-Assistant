# The hosted demo on a free Hugging Face Space (Docker). The Space holds only this file and README.md: it builds
# the public GitHub repo, so nothing else is pushed to Hugging Face. Keys go in the Space's Settings > Secrets.
FROM node:24-bookworm-slim AS node

FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# A new commit on main changes this file, so a rebuild fetches the latest code instead of a cached copy.
ADD https://api.github.com/repos/DolphinsAreWeird/Icarus-Assistant/git/refs/heads/main /tmp/main.json
RUN git clone --depth 1 https://github.com/DolphinsAreWeird/Icarus-Assistant.git /srv
WORKDIR /srv
RUN pip install --no-cache-dir -r backend/requirements.txt \
 && npm --prefix frontend ci --no-audit --no-fund && npm --prefix voice ci --no-audit --no-fund \
 && npm --prefix frontend run build && npm --prefix voice run build:client \
 && chmod -R a+rwX /srv
# Spaces run as user 1000: everything above is writable for the caches and the question log.

ENV PUBLIC_DEMO=1 \
    BACKEND_PROXY_URL=http://127.0.0.1:8001 \
    VOICE_HOST=0.0.0.0 \
    PORT=7860 \
    ASSISTANT_ENGINE=legacy \
    UBOT_MODE=link \
    PYTHONUNBUFFERED=1 \
    VOICE_ID_EN=XiPS9cXxAVbaIWtGDHDh \
    VOICE_ID_TH=mYcpTKg1oj1H5CtzUZNO \
    LLM_CHAIN="orion:Qwen 3.8-27B,orion:Mango 1.5-9B,gemini:gemini-3.1-flash-lite,gemini:gemini-3-flash-preview" \
    LLM_HEDGE_MS=2500 \
    LLM_COOLDOWN_S=60 \
    LLM_TIMEOUT_S=8 \
    ANSWER_CACHE_TTL_S=300 \
    FASTPATH=1
EXPOSE 7860
CMD ["bash", "scripts/start-hosted.sh"]
