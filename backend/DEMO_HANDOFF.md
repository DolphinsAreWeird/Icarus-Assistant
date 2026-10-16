> **Historical note (as of 16 Oct 2026, the hackathon).** This handoff describes the `backend` branch and the `.worktrees/backend` checkout. It records the state at that time: worktree and branch names, commit hashes and test counts below are old, and those paths are not the current layout (main now holds the integrated code; `.worktrees/backend` is a separate older checkout). Windows runs use `scripts/run-demo.ps1` from the repo root. For the current state, read [`README.md`](../README.md), [`PLAN.md`](../PLAN.md) and [`SUMMARY.md`](../SUMMARY.md). The integrated code is on `main`.


# Connected demo handoff — 16 October 2026

All implementation work is on `backend` at `D:\Uhackathon\.worktrees\backend`. Main was inspected through Git; its frontend and voice code matched this worktree's starting point, so no main worktree or frontend merge was required. Main remains at `14401ceeee54b8fb117c98426f9e634611b7c8a3`.

The latest committed model improvements through `3dd2cc9` were merged **into backend** in `25ca2e7`. The original `assistant-model` checkout and its unfinished edits were left alone. Demo integration was committed at `9530035`; later verification fixes and this handoff form a separate checkpoint. Nothing has been merged into main or pushed.

## What main already had, and what this branch adds

| Area | Already on main | Added or connected on backend |
|---|---|---|
| Web/voice server | Node/Express on 8787 serves `/app`, STT tokens, streamed ElevenLabs TTS, caching, barge-in, language routing, U-Bot/glossary | Reused; preserved new model status/evidence and exact numerical scripts; configurable loopback binding; longer assistant timeout |
| Python assistant | FastAPI `/chat`, older tool-calling assistant, market/history/portfolio routes | New ConversationSession/SnapshotAdapter model with fresh server data and isolated bounded sessions; original engine still selectable |
| Navigation, guides, charts | Checked tools and frontend cards already existed | Focused English/Thai requests reach those tools in the new model engine without a gateway round trip |
| Purchases | Assistant card previews and tap-only, idempotent simulated confirms | Native manual purchase screens use the same preview/confirm endpoints; both paths update the visible backend account; cancellation is enforced server-side; newer previews invalidate older ones |
| Fees | Backend/model mock policy: 0.25%, minimum 5 THB, included in budget; native app: 1% added on top | Connected mode uses the backend policy for both flows, including matching half-cent rounding. Original unconnected prototype is preserved |
| Account and currency | Frontend John Doe fixtures in USD; backend separate THB demo users | Connected investment screens and balances use `/demo/state/{user_id}`: backend THB prices, selected demo holdings and cash. Unsupported stock assets are omitted in connected mode |
| Chart explanations | Prototype sent endpoints without exact series/revisions | Frontend renders the exact saved server points and sends screen/display versions; model resolves those against server history. Missing/mismatched versions fail; late replies after navigation are discarded |
| Demo operation | Separate setup commands and a stand-in assistant | Windows launcher, validation/importer for public historical model artifacts, integration tests, real gateway smoke check, and this runbook |

The Python backend does **not** synthesize speech. There are two existing routes to it:

1. App at `/app/?backend`: prototype → Python `/chat` → frontend renders/actions → voice server `/api/tts`.
2. Voice test page: voice server `/api/ask` → Python `/chat` → speech planning → `/api/tts`.

STT, audio streaming/cache, the English/Thai voices and U-Bot routing stay in the Node service. Financial action confirmation stays a tap.

## Start this checkout

Install backend requirements and the locked frontend/voice dependencies. Build with `node frontend/scripts/build.mjs` and, from `voice/`, `node scripts/build-client.mjs`. This machine's npm client failed before installation; bundled pnpm successfully installed the dependencies. The repository's package manifests and npm lockfiles were not changed.

From the worktree root:

```powershell
# Offline model/retrieval and fake audio: reproducible without credentials.
./scripts/run-demo.ps1

# Use the existing model setup without copying its credentials.
./scripts/run-demo.ps1 -Gateway -ModelEnvPath D:/Uhackathon/model/.env

# Nondefault ports / other fictional account:
./scripts/run-demo.ps1 -BackendPort 18000 -VoicePort 18787 -UserId u_small

# Real speech requires ElevenLabs key and both voice IDs in a private voice environment.
./scripts/run-demo.ps1 -Gateway -ModelEnvPath D:/Uhackathon/model/.env -RealVoice -VoiceEnvPath C:/path/to/private-voice.env
```

The launcher prints the URL and exact process IDs, keeps windows hidden, binds to loopback, records local logs under ignored `.demo-runtime/`, and restores its parent process's environment. It defaults to fake speech and saved market observations. `-Gateway` opts into the model; `-RealVoice` separately opts into real audio. The normal ignored backend/.env and voice/.env setup also works. Avoid running duplicate instances on the same ports.

Model historical calculations need ignored public artifacts. Those existed in the original model checkout and were validated/copied into this worktree:

```powershell
cd backend
python -m scripts.prepare_demo_model D:/Uhackathon/model
```

Only `data/market/{btc,eth,gold}.json` and `data/forecasts/{btc,eth,gold}.json` are copied, after all six validate. No environment file, session, key or private conversation is copied. A fresh clone can generate its own public artifacts using the model's documented data preparation workflow.

## Demo sequence

1. Open the printed `/app/?backend=...&user=u_new` URL. Confirm that the top balance is 5,000 THB and the investment list contains Bitcoin, Ethereum and PAX Gold with saved reference prices.
2. Ask **“Show me gold”**, then **“Switch to one year”**. Navigation runs through checked backend tools.
3. Tap the asset chart, then **Ask Icarus**. The reply should describe exactly the displayed series, with saved-data labels. Moving to another screen while waiting must prevent the old reply's actions.
4. Ask **“Compare bitcoin and gold over a year”** for the existing comparison card, or **“How do I buy?”** for the existing steps card. **“Walk me through buying gold step by step”** starts the guide; completing the guide does not buy anything.
5. Ask **“Put 1,000 baht in gold”**. The simulated preview shows 995 THB into the asset, 5 THB fee, 1,000 THB total. Balances stay unchanged until Confirm is tapped. Confirm updates the app account; a retry cannot buy twice. Cancel invalidates the preview on the server.
6. A manual buy through the asset's Buy screen uses the same policy and server preview. The stopwatch stops after confirmation for either route. Reset accounts with `POST /demo/reset`, then reload the app before another rehearsal.
7. Ask **“What is in my portfolio?”** to see the caller-bound synthetic account, including cash. **“What is slippage?”** uses the real gateway only when enabled.

Without `?backend`, the original prototype's standalone fixtures and behavior remain unchanged. Decorative spending panels, payment/card balances and the business dashboard are still prototype screens; they are not a real account ledger. Only the connected account/investment/purchase flow is synchronized. Portfolio history is not reconstructed from current holdings: its connected chart is flat and labeled “no portfolio return history.”

## Verification and practical limits

Final committed-code verification: **135 backend tests passed; 79 model tests passed; 75 frontend tests passed; 386 voice tests passed**. Both TypeScript typechecks and frontend/voice builds passed. Two existing installed Python dependency deprecation warnings remain. Backend tests cover demo commands, ambiguity/negation rejection, exact chart binding, fee consistency, half-cent rounding, cancellation, idempotency and account updates. Frontend tests run the actual unchanged design export with the new adapter. Voice tests exercise the existing stack and numerical-script/evidence handling.

A real **“What is slippage?”** request passed through Node `/api/ask` → Python `/chat` → the configured gateway: HTTP 200, status ok, one source, speech script prepared, about **11.72 seconds**. This is one connection smoke check, not broad semantic or latency evaluation. Explicit demo commands returned HTTP 200 in roughly 0–31 ms at the host clock's coarse resolution; these bypass the model and do not establish general model speed.

The same running services passed a fee-script → fake `/api/tts` check: HTTP 200, `pcm_s16le`, 380,160 bytes. Browser checks verified THB prices, exact chart help and PAXG units. Real ElevenLabs credentials were not present in the original voice folder, so live speech quality, microphone permission and a complete real STT→model→TTS turn remain unverified.

Keep the demo labels visible: accounts/fees are fictional, saved reference prices may be delayed, THB conversion assumes USDT=USD, and gold uses PAXG. The model's forecasts remain experimental historical-cutoff estimates. General gateway answers can take many seconds; the voice HTTP timeout is now 60 seconds. Thai phrasing and financial guidance still require Luka/First review.

Production authentication, shared durable storage, deployment, real execution and live feed policy are outside this local demo. No real purchase or public deployment occurred.

## Running review instance

The final code is running locally at `http://localhost:18787/app/?backend=http://127.0.0.1:18000&user=u_new`, using the existing model configuration and fake audio. Backend PID: `12156`; voice PID: `7608`. To stop these two processes: `Stop-Process -Id 12156,7608`. These IDs apply only to this launch. A browser-verified chart-help screenshot is saved in ignored `.demo-runtime/connected-demo.jpg`.
