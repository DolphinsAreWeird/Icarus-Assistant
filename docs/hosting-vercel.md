# Hosting the web app on Vercel

Status: configuration and build are prepared and tested locally. **No Vercel deploy has been performed**, there is no deployed URL, and the live behavior of Vercel's proxy (streaming, timeouts, client IP headers) has not been verified.

## Shape

```
browser ──> Vercel (static)   /app/*            the built app (frontend/dist), no server code
        └─> Vercel rewrites   /api/*  /brain/*  /mock/*   ──> your ONE Icarus service (Render/Docker)
                                                              Node voice server + Python backend
```

Vercel hosts only static files. It proxies the three same-origin path families the app uses to the existing container, so the app needs no code change and has no CORS to set up:

| Path | What it is |
| --- | --- |
| `/api/*` | voice server: `health`, `ready`, `scribe-token`, `ask`, `tts`, `usage`, `friction`, `turn-metrics`, `utopia/route` |
| `/brain/*` | voice server proxy to the Python backend (the app learns this from `/api/health`) |
| `/mock/*` | U-Bot mock (`UBOT_MODE=mock`) |

Speech-to-text does not go through Vercel: the browser asks `/api/scribe-token` for a single-use token and connects to ElevenLabs directly over a websocket. `/` and `/app` redirect to `/app/` (the app uses relative URLs such as `app.js` and `prototype/...`, so the trailing slash matters). The voice test page (`voice/public`) is not part of the Vercel output.

## Why not serverless functions

The Python backend keeps accounts, previews and caches in memory, and the Node voice server holds the request budgets (rate limits), TTS caches and the ElevenLabs/LLM keys. Both must stay a **single long-lived instance**. Splitting them into independently scaling functions would give each invocation its own empty state. This repo does not contain, and this document does not claim, a serverless migration.

Requirements for the service you point Vercel at:

- exactly one instance, no autoscaling (the Render Blueprint in `render.yaml` is one service);
- in-memory accounts and previews are lost on every restart or redeploy;
- keep `PUBLIC_DEMO=1` so global demo reset stays disabled and request budgets stay on.

## Setup

1. Deploy the service first (Render Blueprint or the Dockerfile; see the README). Note its public origin, for example `https://my-service.example.com`.
2. In `vercel.json`, replace `https://YOUR-ICARUS-SERVICE.onrender.com` with that origin in all three rewrites. Vercel does not expand environment variables in `rewrites`, so this is an edit, not a setting. The build refuses to run on Vercel while the placeholder is still there (override for a static-only preview: `ICARUS_ALLOW_PLACEHOLDER_ORIGIN=1`).
3. In Vercel: Add New > Project > import the repo. Root Directory: repository root. The settings come from `vercel.json` (Install `npm --prefix frontend ci`, Build `node scripts/build-vercel.mjs`, Output `vercel-dist`, no framework). Environment variables are not needed on Vercel; keys stay on the service.
4. Deploy and open `/app/`. Check `/api/ready` returns 200.

Local check of the static output: `node scripts/build-vercel.mjs`, then serve `vercel-dist` with any static server.

## Request budgets behind the proxy

The voice server's budgets (`makeLimiter`) key on the socket IP and deliberately ignore `X-Forwarded-For` (trust proxy is off). Behind Vercel, every request reaches the service from Vercel's egress addresses, so:

- all visitors share a few socket IPs, and the per-IP aggregate ceilings (for example chat: 600/min) are shared across everyone. Per-visitor windows (user and session IDs) still apply within them;
- under heavy traffic, visitors can be throttled together (429 `slow_down`), which is the safe direction.

This is not new with Vercel: on Render the socket may already be Render's own proxy (see the budget notes in `voice/README.md`). Vercel adds another shared hop in front of it.

Do **not** enable trust proxy to fix this until you have verified, on your own deployment, which forwarding header Vercel sets and that a client cannot spoof it. That verification has not been done here.

## Tested vs not tested

Tested (`voice/test/vercel-config.test.ts`, run `cd voice && npm test -- vercel-config`):

- `vercel.json` is valid JSON, one https origin, prefixes preserved, only the placeholder origin;
- every `/api`, `/brain`, `/mock` path literal in `frontend/src` and `voice/src/client` is covered by a rewrite, and rewrites do not shadow `/app/`;
- `scripts/build-vercel.mjs` builds into a scratch dir with `app/index.html`, `app/app.js`, both prototype pages and mascots, and refuses the placeholder origin on Vercel.

Not tested: an actual Vercel deploy; Vercel's rewrite behavior with streamed TTS audio, long (up to 45 s) assistant calls, query-string forwarding on the `/` redirect, or its proxy timeouts and header handling. Check these on a preview deployment and the current Vercel limits page before relying on it.

## Cost and limits

- The Vercel side is static files plus proxied bandwidth; plan limits and pricing are Vercel's and change, so check their current pricing page. Proxied responses (TTS audio) count against Vercel transfer as well as the service's.
- The service (Render Starter in `render.yaml`) is the always-on cost; Vercel does not replace it.
- Rewrites add one network hop to every API and TTS request compared with the single-address Render deployment, which is the simpler path if Vercel is not required.
