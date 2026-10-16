# Backend demo summary

Updated: 16 October 2026. This summarizes the work completed in this chat, its verification, and the questions still open.

## Current state

The connected local demo is implemented on branch `backend`, in `D:\Uhackathon\.worktrees\backend`. It serves the newer model, reuses the existing frontend and voice stack, and connects the investment and simulated purchase flows to the same backend account.

**Nothing was merged into `main`.** Main stayed at `14401ceeee54b8fb117c98426f9e634611b7c8a3` during this work. The original model checkout and its unfinished edits were left untouched.

The model code included here is its committed state through `3dd2cc9`, imported into backend via `25ca2e7`. Later model work is not automatically included; it needs a deliberate update and regression check.

Before this summary was added, local Git tracking showed `backend` aligned with `origin/backend`. The assistant's earlier push attempt was blocked by automatic approval review; the user was given the push command. This summary is a subsequent local change and needs another push after its commit.

## What already existed on main

- A Python/FastAPI backend with the older assistant, market/history/portfolio endpoints, checked navigation tools, chart and steps cards, simulated trade previews, and idempotent confirmation.
- A Node/Express voice server serving the frontend, STT tokens, ElevenLabs TTS streams, audio caching, interruption handling, language routing, and U-Bot/glossary routing.
- A frontend prototype and bridges to both services.

The TTS system was already a backend service: **the Node voice server synthesizes speech; the Python backend supplies assistant replies and financial tool data.** A second TTS implementation was not added.

## Work completed

| Area | Result |
|---|---|
| Model serving | Connected `ConversationSession` and `SnapshotAdapter` to `/chat`; retained the old assistant through `ASSISTANT_ENGINE=legacy` |
| Conversation state | Bounded, isolated sessions per demo user and conversation; idle expiry, busy responses, rollback on failed turns, and reset coordination |
| Trusted data boundary | Fresh frozen server-owned snapshots for every turn; client money, chart points, and provenance are not accepted as trusted financial evidence |
| Account valuations | Decimal values including cash; fictional accounts are labeled synthetic; an unsupported holding makes model account data unavailable rather than understating its total |
| Demo commands | Focused navigation, chart comparison, guide, freeze/hide, cancel, and purchase-preview commands use existing checked tools without a model round trip |
| Shared frontend state | Connected investment screens read backend THB prices, cash, holdings, and transactions from `/demo/state/{user_id}`; unsupported stock assets are omitted |
| Manual and assistant purchases | Both use the same simulated backend account and preview/confirm endpoints; no balance change before an explicit confirmation tap |
| Fee consistency | Connected mode uses the same mock rule everywhere: 0.25% of total budget, minimum 5 THB, fee included; half-cent rounding was aligned |
| Cancellation and retries | Cancellation invalidates a preview server-side; a newer preview cancels the older one; repeated confirms do not purchase twice |
| Exact displayed charts | Frontend renders saved server points and sends screen/display versions; backend explains that exact series, rejects mismatches, and frontend drops late replies after navigation |
| Reply/voice contract | Preserved evidence, numerical summaries, limitations, status, emotion and suggestions; added short verified speech scripts and exact-number handling through the existing voice service |
| Operation | Added a Windows launcher, loopback binding, orderly market polling shutdown, configurable local CORS, and an importer for validated public model artifacts |
| Documentation | Added design notes, checkpoints, a runbook, and a detailed comparison with main |

The original design export was not edited. The connected frontend adapts it at runtime. Without `?backend`, the original standalone prototype behavior remains available.

## Verification completed

| Check | Result |
|---|---|
| Backend regression/integration tests | 135 passed |
| Model tests | 79 passed |
| Frontend tests | 75 passed |
| Voice tests | 386 passed |
| Frontend and voice TypeScript checks | Passed |
| Frontend and voice builds | Passed |
| Browser inspection | Verified backend THB prices, PAXG units and exact displayed-chart help |
| Live model smoke check | “What is slippage?” passed through Node `/api/ask` → Python `/chat` → configured gateway; HTTP 200, status ok, source included; about 11.72 seconds |
| Existing TTS pipeline | Verified a deterministic fee script through fake `/api/tts`; HTTP 200, PCM audio returned |

These are results from the completed checkpoint, not a claim that every later model change or a fresh machine has been tested. Two installed Python dependency deprecation warnings remain. A clean installation from the existing Python requirements pins was not verified. This machine's npm client failed; bundled pnpm installed frontend/voice dependencies successfully without changing the package manifests or npm lockfiles.

## Required before the actual demo

| Priority | Missing work or unanswered question | Completion condition |
|---|---|---|
| Required for real voice | Where is the private ElevenLabs configuration, and which English/Thai voice IDs should be used? No `voice/.env` was present in the original checkout when checked | Start with real credentials through an ignored environment file; never commit keys |
| Required for real voice | Does a real microphone work through STT → model/backend → TTS on the presentation machine? | Rehearse actual speech, Thai/English switching, interruption, cancellation and tap-only confirmation |
| Required review | Are Thai wording, financial explanations, fee descriptions and source meanings acceptable? | Luka/First review representative replies and read-backs; automated tests do not establish semantic quality |
| Required demo decision | Are saved prices, USDT=USD conversion, the PAXG gold proxy, and fictional accounts/fees acceptable for the presentation? | Approve the assumptions and keep their labels visible, or replace the relevant data/policy consistently |
| Required coordination | Which newer model checkpoint should be included before presentation? | Import the chosen committed model changes into backend and rerun the integration checks |
| Required rehearsal | Is general model latency acceptable, and what happens if the gateway is unavailable? | Agree a presentation script and offline fallback; the observed live concept answer took about 12 seconds |
| Required setup | Are dependencies, model artifacts and private configuration available on the demo machine? | Follow the runbook and launch from a fresh process; the ignored historical artifacts and credentials are not included by Git |

The implemented local demo has no remaining engineering blocker for its tested offline/fake-audio flows. Real voice and human review remain unfinished.

## Known demo limits

- Accounts and trades are simulated, in memory, and lost on restart. User IDs select fictional users; they are not authentication.
- Only the connected account/investment/purchase flow is synchronized. Decorative spending panels, payments/card balances, and the business dashboard remain prototype screens, not a real ledger.
- Portfolio return history is not reconstructed from current holdings. Its connected chart is flat and explicitly labeled as having no return history.
- Saved observations may be delayed. THB prices use the existing approximate USDT=USD conversion; gold is represented by PAXG. Reference prices are not executable market quotes.
- Model forecasts are experimental estimates at historical cutoffs, not validated trading signals or guaranteed predictions.
- Fast demo commands use narrow, explicit patterns. Broader or ambiguous requests remain with the model; arbitrary natural-language navigation is not comprehensively supported.
- The voice HTTP timeout is 60 seconds. One successful gateway request is not a broad availability, latency, or answer-quality evaluation.
- Real ElevenLabs speech, microphone behavior and a complete real voice turn were not verified. Fake audio proves the integration path, not voice quality.

## Decisions needed only beyond the local demo

These do not block the tested demo, but are required before real users or public deployment:

1. Authentication, authorization, real account provider, and binding user profiles/accounts to authenticated sessions.
2. Hosting, shared durable state, retention/deletion policy, backups, and support for multiple workers.
3. Production rate limits, abuse controls, monitoring, incident handling, and gateway cost/timeout policy.
4. Approved live market/FX sources, units, freshness guarantees, and any real execution integration.
5. Reviewed financial guidance, fee schedules, translations, and the intended scope of personalization.
6. Whether unsupported assets and the rest of the prototype screens should become real connected features.

No real trade or public deployment was performed.

## Run and continue

From the backend worktree root, after installing dependencies and building the frontend/voice assets:

```powershell
# Offline retrieval/model commands and fake audio
./scripts/run-demo.ps1

# Existing model gateway configuration, without copying credentials
./scripts/run-demo.ps1 -Gateway -ModelEnvPath D:/Uhackathon/model/.env

# Real speech, after obtaining the private voice configuration
./scripts/run-demo.ps1 -Gateway -ModelEnvPath D:/Uhackathon/model/.env -RealVoice -VoiceEnvPath C:/path/to/private-voice.env
```

The launcher prints its URL and process IDs. Earlier recorded PIDs and running-instance URLs are historical and should not be assumed active. Use the new launch output when stopping services.

For model history/forecast tools, the validated local public artifacts can be prepared from the original model checkout:

```powershell
cd backend
python -m scripts.prepare_demo_model D:/Uhackathon/model
```

This copies only six validated public market/forecast JSON artifacts. Credentials and private conversations are excluded. A fresh clone must generate or obtain these artifacts separately.

## Important commits

| Commit | Checkpoint |
|---|---|
| `42f9af4` | Initial backend design |
| `4f76ea7` | Model sessions and frozen server-owned snapshots |
| `a19d64d` | Initial integration tests and handoff |
| `25ca2e7` | Imported committed assistant-model work into backend |
| `9530035` | Connected demo tools, shared account screens and voice |
| `2bf1a45` | Chart-help fixes, consistent fees, tests and launcher |
| `6ae6f8c` | Final verification and review-instance documentation |

Further details: [demo runbook and comparison](backend/DEMO_HANDOFF.md), [backend setup](backend/README.md), [design](backend/DESIGN.md), and [earlier checkpoints](backend/CHECKPOINTS.md).
