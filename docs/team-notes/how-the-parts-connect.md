> **Historical note (as of 16 Oct 2026, the hackathon).** This file was written on the night of 15 Oct. It records the state at that time: worktree and branch names, commit hashes and test counts below are old, and some run steps have changed (for example, `./demo.sh` and `scripts/run-demo.ps1` now check `/health` and choose the engine explicitly). For the current state, read [`README.md`](README.md), [`PLAN.md`](remediation-plan.md) and [`SUMMARY.md`](SUMMARY.md). The integrated code is on `main`.


# How the parts connect

Written on the night of 15 Oct by the voice side (KP), after connecting the app, the voice stack and the backend. It says what works end to end, how to run it, and **what the team still has to agree** before the demo.

## The chain

```
microphone
  -> Scribe v2 Realtime (ElevenLabs, straight from the browser, token from the voice server)
  -> Oasis's prototype (frontend/, running in our React runtime)
  -> "Ask U-topia" / U-Bot router (voice server, POST /api/utopia/route)
        answer  -> glossary answer (mock)
        handoff -> "U-Bot can help with this" card with a prompt Icarus wrote from the user's request and screen
                   -> "Copy and open U-Bot" copies it and opens the real u.bot (UBOT_MODE=mock: our mock page instead)
        none    -> on to the brain
  -> the brain: Luka and First's backend (backend/, POST /chat), tools + model
       it gets the app's own getContext() as `snapshot`
  -> reply { text, speak, ui_actions, sources }
       ui_actions: the app's own screen actions (open_asset, set_period, navigate, highlight...)
       plus at most one card: a trade preview, a chart, or step-by-step instructions
  -> the app runs the screen actions; the card shows over the phone (frontend/src/trade-card.ts, chat-cards.ts)
  -> Icarus says the reply; for a trade preview, the exact read-back from the card's numbers
  -> text-to-speech (ElevenLabs via the voice server, one voice for both languages: "Icarus Soft", designed for the mascot)
  -> speaker

tap Confirm on the trade card -> backend POST /trades/{preview_id}/confirm  (the only way a trade happens)
```

## Run all of it (three terminals)

1. **Backend** (Luka and First):
   ```bash
   cd backend
   uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt
   .venv/bin/uvicorn app.main:app --port 8000
   ```
   It needs a model (Ollama, or `LLM_PROVIDER=groq` / `gemini`, see `backend/README.md` and `backend/.env.example`). **No model on your laptop?** `OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain` runs the same API with simple rules instead of a model. It understands "put 1,000 baht in gold", "show me bitcoin", "how did bitcoin do this year?" (or "compare bitcoin and gold") and "how do I buy?", so every kind of reply can be seen on screen; everything after the model (the tools, the cards, the checks) is the real code.
2. **Voice server** (KP): `cd voice && npm install && npm run dev` (needs `voice/.env` with the ElevenLabs key, see `voice/.env.example`). No key: `npm run dev:fake`.
3. **App** (Oasis): `cd frontend && npm install && npm run build`, then open **http://localhost:8787/app/?backend**
   - `?backend=http://127.0.0.1:8010` for another address, `&user=u_small` for the other demo user.
   - Without `?backend` the app uses the prototype's demo answers, as before.

The voice test page (http://localhost:8787) can use the backend too: in `voice/.env` set `ASSISTANT_MODE=http`, `ASSISTANT_URL=http://localhost:8000/chat`, `ASSISTANT_USER_ID=u_new`.

## Checked end to end (15 Oct, about 22:35, after First's 22:16 update)

With the real backend code and the stand-in model (no LLM was available on this laptop):

- "Put 1,000 baht in gold": the app opened gold and showed the trade card with the backend's numbers (995 into gold, fee 5, you pay 1,000). Icarus's line: "nine hundred ninety-five baht into gold. Fee five baht. Total one thousand baht. Tap Confirm on the card when you are ready." Tapping Confirm calls the backend; a second tap does not buy twice.
- "Compare bitcoin and gold over a year": a chart card with both lines in % from the start, and the backend's own words for each ("down about 24% over the past year").
- "How do I buy?": a steps card from `backend/data/howto.json`; "Show me" on a step opens the right screen and points at the button.
- A new question takes the old card down. A busy model or a missing backend: Icarus says the backend's own message (English or Thai).
- "Book me a ride to the airport tomorrow at 8" hands off to the real U-Bot with a ready prompt ("Book me a ride to the airport. Show me a few options with the price and pickup time, then let me review and pay in U-topia Pay." plus the user's own words). "What is U-Coin?" still gets the glossary answer. "How is the S&P 500 doing?" gets an honest "I don't have data for that in this app" instead of a dead end.
- Tests: backend 83 (including First's checks that the bridge passes on every action and card he sends), voice 382, app 70.
- Not checked: a real model's answers (Ollama or Groq), and a real microphone through the whole chain (the browser pane I tested in blocks the mic).

## To agree before the demo

The backend now uses the app's own asset ids, screens, periods and element ids (`backend/data/app_ui.json`), and shows buys, charts and how-to steps on cards. What is left:

1. **Two fees for the same buy.** A buy through Icarus uses the backend's rule (`backend/data/fees.json`: 0.25%, at least 5 baht, included: you pay 1,000, the fee is 5). A buy on the app's own buy screen uses the prototype's rule (`FEE=0.01`: 1% on top, 1,000 + 10 = 1,010). A judge who tries both sees two fees. Pick one rule and use it in both places.
2. **Dollars on the screens, baht in Icarus.** The prototype's screens show its own demo prices in US dollars. Icarus's cards and charts are in baht. First added `GET /market` (live baht prices and period changes, keyed by the app's asset ids) so the screens can show the same numbers. The prototype would need to read it (Oasis).
3. **Buying through the card changes the backend's demo account, not the screens.** Confirm on the trade card updates the backend's user (`u_new`), while the prototype's John Doe balances stay the same. Say so on stage, or have the screens read `GET /portfolio/{user_id}`.
4. **Reply fields.** The app also uses `emotion` (the mascot's face) and `suggestions` (chips). The backend could send them.
5. **U-Bot.** The `handoff` action and the "Ask U-topia" glossary live in the voice server and run before the backend. Fine for the demo. If the backend wants them as tools, the shapes are in `voice/README.md` (U-Bot section).
6. **Thai.** Lines marked `THAI REVIEW` (voice strings, the read-back, the cards, the U-Bot mock) and the Thai voice need a Thai speaker.

## For the backend: what the voice needs from a reply

- **Short `text`.** One or two sentences. It is spoken. No markdown, lists or emoji.
- **Numbers from tools only**, as the backend already does. The voice speaks English money as words on purpose (the English voice misread "1,015" as "1,215" in our tests), and says every amount exactly.
- **Speed.** Time to the first sound is about 0.9 s for the speech-to-text to finish, plus the backend's time, plus about 0.2 s for the first audio. Keep `/chat` under about 1.5 s for voice if you can.
- `input_mode: "voice"` is sent for spoken questions, `"text"` for typed ones.

## Files that connect the parts

| File | What it does |
|---|---|
| `frontend/src/backend-bridge.ts` | `?backend`: the prototype's questions go to `POST /chat` with its own context as the snapshot; the screen actions the prototype runs (`SCREEN_ACTIONS`) pass through; cards go to the overlays; a trade card gets the exact read-back |
| `frontend/src/trade-card.ts` | The trade preview card with the backend's numbers. Confirm is a tap that calls `POST /trades/{id}/confirm` |
| `frontend/src/chat-cards.ts` | The chart card (one asset in baht, two or three compared in %) and the steps card ("Show me" runs the backend's pointing actions) |
| `frontend/src/utopia-bridge.ts` | "Ask U-topia" and the U-Bot handoff, around the demo answers and around the backend |
| `voice/src/server/assistant/http.ts` | The voice server's adapter for `POST /chat` (`ASSISTANT_MODE=http`): sends the snapshot as it is, turns cards into `show_card` |
| `voice/src/shared/backend-card.ts` | Reads the backend's trade card for the exact money read-back (used by the app and the voice server) |
| `backend/scripts/stand_in_brain.py` | The backend API with a rule-based stand-in for the model, for integration tests |
| `voice/src/server/ubot-mock/`, `frontend/src/ubot-mock.ts` | The U-Bot mock: handoff sessions, sample replies, the mock page, and our proposed "Ask U-topia" API |
