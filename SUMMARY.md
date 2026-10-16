# Icarus project review

Reviewed 16 October 2026, Bangkok time. Checkout: `main`, commit `b2b879fc79979ad95e5df0a3d8bae9de6deef566`.

The model team's own status summary is in [model/SUMMARY.md](model/SUMMARY.md).

## Overall assessment

Icarus has a substantial integrated demo: English/Thai voice, backend-driven navigation, deterministic financial tools, simulated purchases with tap confirmation, charts, guides, U-Bot handoff, a mascot tour and deployment configuration. It is beyond a collection of disconnected prototypes.

However, passing unit tests do not establish demo readiness. This review reproduced several gaps in financial-output handling and isolation, and found purchase-review inconsistencies in the frontend. Fix these before relying on arbitrary judge questions or opening the hosted demo to multiple visitors. A fresh browser run and real audio rehearsal are still needed.

The commit summary was read first, followed by project Markdown before implementation exploration. Three `gpt-6.1-sol` subagents with **high** reasoning reviewed backend/model, frontend/voice, and QA/deployment. Findings below combine their work with the primary review. This was a review task: application source was not changed, no deployment was performed, no live provider calls were made, and private credential values were not inspected.

## Project structure and actual runtime

| Area | Responsibility | Main entry points |
|---|---|---|
| `frontend/` | Runs Oasis's HTML prototypes through a small React runtime; connects account state, assistant actions, purchase screens, cards, tour and voice | [main.ts](frontend/src/main.ts), [dc-runtime.ts](frontend/src/dc-runtime.ts), [backend-bridge.ts](frontend/src/backend-bridge.ts), [demo-data.ts](frontend/src/demo-data.ts) |
| `voice/` | Node/Express server serving the app; ElevenLabs STT tokens/TTS, audio cache, interruption handling, U-topia glossary, U-Bot routing and optional backend proxy | [index.ts](voice/src/server/index.ts), [app.ts](voice/src/server/app.ts), `src/client/`, `src/shared/` |
| `backend/` | FastAPI HTTP boundary, market/FX cache, history, fictional accounts, checked UI tools, trade previews and confirmation; two assistant engines | [main.py](backend/app/main.py), [model_service.py](backend/app/model_service.py), [loop.py](backend/app/assistant/loop.py), [trades.py](backend/app/trades.py) |
| `model/` | Standalone bilingual conversation/retrieval system, validated data adapters, grounded calculation tools, historical data processing and experimental risk estimates | [START_HERE.md](model/START_HERE.md), [session.py](model/session.py), [assistant.py](model/assistant.py), [data_adapter.py](model/data_adapter.py) |
| `qa/` | Browser golden paths, failure drills, risk register and hallway-test kit | [README.md](qa/README.md), [run.cjs](qa/e2e/run.cjs) |
| `docs/` | Business plan, cost calculator, architecture, presentation figures/media and historical team notes | [business-plan.md](docs/business-plan.md), [cost_model.py](docs/cost_model.py), `media/`, `team-notes/` |
| Root / `scripts/` | Windows/Bash launchers and single-container hosting | [run-demo.ps1](scripts/run-demo.ps1), [demo.sh](demo.sh), [Dockerfile](Dockerfile), [render.yaml](render.yaml) |

Normal app flow: browser voice or typed text → U-topia/U-Bot router when relevant → Python `/chat` → checked actions/cards → frontend → Node TTS. A purchase changes only a simulated backend account after a confirmation request initiated by a tap. The model module itself has no execution endpoint.

### Two engines need separate verification

| Start path | Actual engine / behavior |
|---|---|
| Bare `app.main:app` | Defaults to `ASSISTANT_ENGINE=model`, with `ICARUS_MODEL_OFFLINE=1`: deterministic commands and labeled offline retrieval previews |
| `scripts/run-demo.ps1` | Explicitly selects `model`, saved market observations and fake voice; `-Gateway` and `-RealVoice` opt into those services separately |
| Docker / Render | Docker explicitly selects `legacy`: prepared answers, regex fast path, answer cache and provider hedging/failover |
| `demo.sh` | Detects older provider settings to decide whether a model exists, but its real-model branch starts bare uvicorn without explicitly selecting the corresponding engine |

Sources: [backend/app/main.py](backend/app/main.py), [scripts/run-demo.ps1](scripts/run-demo.ps1), [Dockerfile](Dockerfile), [demo.sh](demo.sh).

The newer model's input grounding and bounded sessions do not automatically protect the hosted legacy path. Likewise, the hosted path's prepared-answer speed and failover should not be claimed for the Windows model launcher without measuring it. Confirm the selected engine through backend `/health` before any test or demonstration.

## Prioritized engineering findings

These are agent-owned fixes. None requires you to operate the system manually.

### P1: Correctness and isolation

1. **Decimal buy amounts change during the animated input.** The bridge forwards the requested amount, but the prototype's `type_amount` action uses `String(Math.round(a.value))`. Direct evaluation reproduces `1000.49 → "1000"` and `1000.50 → "1001"`. The read-back can be calculated from the original amount while the review screen and subsequent confirmation use the rounded amount. Preserve cents throughout the action, review and confirmation chain. Add end-to-end checks for both values, including the spoken amount and final account debit. Evidence: `frontend/src/backend-bridge.ts:79–88,192–199`; `frontend/prototype/Icarus Prototype.dc.html:733`; `frontend/src/demo-data.ts:163–173`.

2. **Hosted legacy responses can display unsupported financial numbers.** A scripted provider response, “Bitcoin costs 999999 baht today,” returned `status="ok"`; the unsupported number appeared only in `debug.unbacked_numbers`. `_finish` reports the problem but does not reject or replace the text. Gate unsupported financial output before display, speech and caching; deterministic tool results should supply figures. Add a regression that requires rejection rather than merely checking a debug flag. Evidence: `backend/app/assistant/loop.py:247–266`; existing flag-only assertion in `backend/tests/test_brain.py:412–415`.

3. **Hosted legacy tool arguments are not bound to the user's purchase request.** In a scripted reproduction, the user asked “Explain what Bitcoin is,” but a model call to `prepare_trade(XAU, buy, 4000)` produced an actionable gold preview. Cash remained unchanged until a tap, so the tap boundary held, but the asset, amount and purchase intent were invented. Validate explicit intent, asset, side and amount before creating action-bearing previews. The model engine already has a monetary-argument validation boundary that the legacy engine lacks. Evidence: `backend/app/tools.py:274–299,416`; `model/assistant.py:387`.

4. **The hosted answer cache can cross user/conversation boundaries.** A scripted `u_new` conversation containing a private fictional goal generated an answer to “How does my financial situation look?” A different `u_small` conversation asking the same question received that cached answer with no second model call. Cache privacy is inferred from tools used; a model reply using conversation history and no tools is treated as globally reusable. Scope such replies to the user/session and relevant context, or decline to cache them. Add a two-user, different-history regression. Evidence: `backend/app/assistant/loop.py:208–226`; `backend/app/assistant/memo.py:23–40`.

5. **The reviewed preview is not consistently the preview executed.** When a buy card becomes native screen actions, the original preview identity is dropped and the UI calculates terms locally. Confirm can create a fresh preview and immediately execute it after checking only asset and budget. A changed market price can change quantity without another review; the same budget is insufficient proof that all reviewed terms match. Keep the server preview through review, display its exact terms, and require renewed review when it expires or changes. Add a price-change-between-review-and-confirm test. Evidence: `frontend/src/backend-bridge.ts:190–199`; `frontend/src/demo-data.ts:155–173`.

6. **A hosted visitor can reset everyone else's demo state.** The generic public `/brain/*` proxy exposes unauthenticated `POST /demo/reset`, which resets all accounts, previews and conversations. Restrict this administrative route or make reset visitor-specific. Test that one visitor cannot invalidate another visitor's pending purchase. Evidence: `voice/src/server/app.ts:284–291`; `backend/app/main.py:185–194`; `backend/app/state.py:62–67`.

### P2: Reliability, QA and claims

7. **Browser QA can report a failed consistency scan while exiting successfully.** High-severity scan findings make P8 fail in the report, but the runner's exit predicate uses path statuses that ignore those findings. An in-memory reproduction produced path `PASS` and a false failure predicate for a high-severity dollar-amount finding. A failed phone purchase confirmation is also only a soft warning. Make these hard failures before using the suite as a release gate. Evidence: `qa/e2e/lib/report.cjs:89–96`; `qa/e2e/lib/recorder.cjs:189–197`; `qa/e2e/run.cjs:131–132`; `qa/e2e/paths/phone.cjs:137`.

8. **Public limits are shared by IP and include account reads and confirmation.** The entire `/brain` proxy shares 40 requests/minute per IP. Judges on the same venue network can exhaust one bucket through ordinary reads and interactions. Test the public configuration with multiple visitor IDs behind one IP; separate expensive requests from account reads and confirmation. The existing browser runbook disables public limits, so it does not test this behavior. Evidence: `voice/src/server/app.ts:50–64,284`; `qa/README.md:21`.

9. **A long-open screen can keep calling an old price live.** Account/price bundles refresh at load and after trades, while display labels reuse the fetched `freshness` value. There is no periodic refresh or client-side aging. Add refresh/aging behavior and a test that advances time beyond the live threshold without a trade. Evidence: `frontend/src/demo-data.ts:36–42,115–120,188`; `frontend/src/main.ts:180–189`.

10. **Launch and health signals can overstate readiness.** Fix `demo.sh` to select and verify its intended engine instead of announcing a real model while the default can remain an offline preview. Render's `/api/health` reports Node configuration rather than Python readiness; the hosted startup script also proceeds after exhausting backend startup retries. Add backend-unavailable and backend-hung readiness tests. Evidence: `demo.sh:72–89`; `backend/app/main.py:59–65`; `render.yaml:11`; `voice/src/server/app.ts:102–116`; `scripts/start-hosted.sh:11–21`.

11. **A browser speech fallback error can leave a turn waiting indefinitely.** Browser synthesis errors resolve as `stopped`, but the controller's completion handler ignores that outcome without settling the outer speech promise or clearing playback. If provider TTS and browser synthesis both fail, action pacing can remain stuck. Test this double-failure path and settle every terminal outcome without treating an interrupted read-back as successfully completed. Evidence: `voice/src/client/fallback-voice.ts:24`; `voice/src/client/icarus-voice.ts:935–960`. This is a code-path finding; the browser scenario was not run here.

12. **Windows startup can silently skip rebuilding the app.** `voice/scripts/build-app.mjs:15–16` spawns `npm` without a shell and exits successfully when `status` is null, including spawn errors. Windows normally exposes `npm.cmd`; this can serve missing or stale assets. The `dev:fake` package script also uses Unix environment-assignment syntax. Add Windows-compatible invocation and fail on spawn errors.

## What is genuinely missing versus already implemented

**Implemented, despite older open-item lists:** connected THB prices/accounts, a shared backend fee policy (0.25%, minimum 5 THB, included in the budget), manual/assistant simulated purchases, reply emotion/suggestions, server-owned chart versions, provider failover in the legacy engine, public deployment configuration and failure fallback behavior. Do not spend time asking the team to decide those old integration questions again. The purchase issues above are remaining correctness gaps in that implementation.

**Still incomplete or limited:**

- `README.md:9` still contains `LIVE_DEMO_URL`. Hosting configuration exists, but an actual reachable deployment was not established by this local review.
- No complete presentation PDF/PPTX was found in `docs/`. Tour videos, architecture images and deck figures exist. The actual deck's visibility remains unknown.
- The business dashboard combines simulated metrics with a live panel reading this browser's local event history. It does not aggregate server friction logs across visitors. This is a demonstrated UI, not yet a partner-wide analytics service. Its reader also refreshes only when event count changes, so the live view stops updating when the app's 400-event ring is full. Add a rollover regression as well as any future aggregation work. Evidence: `frontend/prototype/Icarus Business Dashboard.dc.html:125–179`; `frontend/prototype/Icarus Prototype.dc.html:657`; `voice/src/server/friction.ts`.
- U-Bot is a prompt-and-link handoff requiring the user to sign in and paste. A real U-Bot API adapter cannot be validated without an actual API. This does not block the existing link-based demo.
- Human Thai/financial-language review and unfamiliar-user hallway results are not recorded as complete. [HUMAN_REVIEW.md](model/evaluation/HUMAN_REVIEW.md) is still pending.
- Accounts/trades remain fictional and in memory. Broader ledger/payment/card features, durable shared state and production authentication are outside the implemented demo. Historical risk experiments are not current trading signals.
- The business plan's personal-data locality claim needs qualification: full transcripts and identifiers are logged locally, and provider requests leave the app. Cost arithmetic can be checked locally; current external pricing, user-count claims and business uplift require separate evidence.

### Documentation drift

`INTEGRATION.md`, `backend/DEMO_HANDOFF.md`, `backend/CHECKPOINTS.md` and `docs/team-notes/SUMMARY.md` contain historical worktree/branch states and older test counts. Git now shows the integrated code on main; `.worktrees/backend` is a separate older checkout. Use this report's reviewed commit as the baseline.

Root README still broadly promises scripted fallback, while later failure drills describe honest unavailable responses. Frontend README says public hosting is not set up, although Docker/Render configuration now exists. Demo-audio metadata includes a Thai clip, while the named WAV set described in its README is English; neither establishes completed Thai audio review. These docs should become clearly dated history or be updated to the actual run paths.

A static audit of all 33 tracked Markdown files found **six missing relative link targets**: four backend links in `docs/team-notes/SUMMARY.md:135` and two model links in `model/PROJECT_OVERVIEW.md:5`. These are documentation fixes an agent can make.

## Verification performed in this review

| Check | Current result | Limits |
|---|---|---|
| Backend offline pytest suite | **265 passed**, two installed-dependency deprecation warnings; 9.70 s | Required approved execution outside the Windows socket sandbox; scripted providers, not live services |
| Model unittest suite | **79 passed**, no skips; about 1 s | Local behavior and fixtures |
| Retrieval regression | **28 cases passed** | Expected recall@5 passed in both languages; negatives empty |
| Retrieval challenge | **16 cases passed** | Retrieval correctness does not establish Thai naturalness or financial meaning |
| Focused legacy reproductions | Confirmed unsupported numbers, unrequested trade preview and cross-user cached reply | Scripted model, no API calls |
| Decimal action reproduction | Confirmed `1000.49 → 1000`, `1000.50 → 1001` | Evaluated exact rounding expression; no browser run |
| QA JavaScript syntax | All **15 `.cjs` files passed** `node --check`; runner help passed | Syntax only |
| Windows launcher parsing | **Passed** PowerShell AST parsing | Services were not launched |
| Cost-model/table consistency | All **seven generated table blocks matched** | Recomputes repository assumptions; does not verify external prices or commercial claims |
| Tracked Markdown links | 33 files checked; **six missing targets** | Local relative links only |
| Frontend/voice tests, typechecks, builds | **Not run successfully** | Dependencies absent; offline installation attempts failed |
| Browser E2E | **Not run** | Playwright package available, Chromium/WebKit executables absent; app bundle absent |
| Container build/runtime | **Not run** | Docker daemon unavailable |
| Live model, real microphone/TTS, deployed service | **Not verified in this review** | Separate hardware/account/provider checks required |

Frontend/voice setup attempts encountered a global npm `minizlib` failure and a pnpm Windows symlink `EPERM`. These are environment/setup blockers, not passing tests or demonstrated application failures. The old reported frontend/voice pass counts in the commit summary were not reproduced here.

Installed Python dependencies also differ from `backend/requirements.txt`: FastAPI 0.141.1 versus pinned 0.143.1, uvicorn 0.52.4 versus 0.54.0, and pytest 9.1.1 versus 8.3.4. A clean pinned installation needs its own verification.

Commands used for the successful Python checks:

```powershell
# From backend/, with a precreated writable basetemp parent:
$env:OFFLINE='1'
$env:ICARUS_MODEL_OFFLINE='1'
$env:QUESTION_LOG='0'
$env:PYTHONDONTWRITEBYTECODE='1'
python -m pytest -q -p no:cacheprovider --basetemp=D:/Uhackathon/.review-tmp/backend-model-tests-final

# From repository root:
python -m unittest discover -s model/tests -q
python model/evaluate_retrieval.py
python model/evaluate_retrieval.py --suite challenge
```

The temporary test output is not a deliverable; create its parent before rerunning, or use the existing ignored `.test-tmp/` convention.

## Next work, in order

1. **Fix the six P1 findings and add their behavioral regressions.** Preserve tap-only confirmation and exact user-entered money throughout. Do not treat passing existing tests as evidence these issues are resolved.
2. **Make QA fail reliably, align launcher engines, refresh/age prices and tighten hosted readiness/limits.** Cover speech-fallback failure, Windows build invocation and dashboard event rollover. Test model and legacy engines independently.
3. **Restore a reproducible setup.** Install frontend/voice locked dependencies using a working runtime, run `npm test`, `npm run typecheck` and the respective build commands in both directories; verify backend from pinned requirements in a fresh environment. Obtain Playwright Chromium/WebKit. This is agent work, not a manual checklist for you.
4. **Run browser QA on isolated fake-voice/offline services.** Start with race, questions and phone paths, then all four Chromium/WebKit laptop/phone profiles. Exercise both engines, actual prototype amount animation, changing quotes, stale screens, expired/cancelled previews and repeated taps. Keep reports outside Git.
5. **Test hosted behavior separately.** Run with `PUBLIC_DEMO=1`, several visitors sharing an IP, reset isolation, backend outage/hang, recovery and rate-limit bursts. Then build/run the real container and verify the deployed market-source behavior and restart recovery.
6. **Run a bounded live answer battery after the guards are fixed.** Use `backend/scripts/battery100.py` for the served assistant and model stress/numeric suites for the model engine. Inspect tool evidence, figures, advice refusals, Thai and latency. These make provider calls and are not substitutes for human semantic review.
7. **Finish submission assets.** Verify the real demo URL and public deck, update stale docs, label remaining simulated behavior consistently, and collect hallway evidence before making user-speed or business-uplift claims.

## The smallest set of things you need to do

No intervention is needed merely to accept this report or start the engineering fixes. Missing dependencies, browser installation, config preparation, regressions, builds, URL replacement and deployment verification can be handled by an agent.

| Your involvement | Why it needs a person | Minimum action |
|---|---|---|
| Private account access, only where unavailable | This checkout has no `voice/.env`; valid provider/hosting access cannot be invented | Put the ElevenLabs key in a private ignored config or identify an existing private file. `model/.env` and all six local market/forecast artifacts already exist; do not recreate or expose them unnecessarily. If a public demo is wanted, provide authorized hosting access or its existing URL. |
| One presentation-device voice rehearsal | Automated fake audio cannot establish mic permission, room noise, speaker echo or intelligibility | On the actual device, allow the mic and try English/Thai, an interruption, cancellation and a purchase stopped at a tap. An agent can prepare and observe the technical steps. |
| Native Thai/financial-language review and unfamiliar users | Tests cannot establish natural wording, meaning or unaided usability | Have a Thai speaker review representative answers/read-backs using the existing checklist, then 3–5 unfamiliar people try the hallway tasks. Record corrections and completion rather than blanket approval. |
| Deck access, only if private | The actual deck is not available in this checkout | Share an existing accessible link or export the presentation. An agent can audit its claims and replace submission placeholders once it is available. |

There is no need to approve the old fee/currency integration decisions again, obtain a new model key just for offline tests, or operate package/build commands yourself. Production authentication, custody and a real U-Bot API should not become blockers for this explicitly simulated hackathon demo.
