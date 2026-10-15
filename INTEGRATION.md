# How the parts connect

Written on the night of 15 Oct by the voice side (KP), after connecting the app, the voice stack and the backend. It says what works end to end, how to run it, and **what the team still has to agree** before the demo.

## The chain

```
microphone
  -> Scribe v2 Realtime (ElevenLabs, straight from the browser, token from the voice server)
  -> Oasis's prototype (frontend/, running in our React runtime)
  -> "Ask U-topia" / U-Bot router (voice server, POST /api/utopia/route)
        answer  -> glossary answer (mock)
        handoff -> "U-Bot can help with this" card -> U-Bot MOCK page with the question
                   (UBOT_MODE=mock, sample data, says MOCK; UBOT_MODE=link opens the real u.bot)
        none    -> on to the brain
  -> the brain: Luka and First's backend (backend/, POST /chat), tools + model
       it gets the app's own getContext() as `snapshot`
  -> reply { text, speak, ui_actions, sources }
       ui_actions are the app's own screen actions (open_asset, start_buy, type_amount, review, highlight...)
  -> the app runs them on Oasis's own screens; a buy stops on the Review purchase screen
  -> Icarus says the exact read-back, from the numbers that screen shows (the app's own calc)
  -> text-to-speech (ElevenLabs via the voice server, Brittney in English, Malee in Thai)
  -> speaker

the user taps "Confirm purchase" on the app's review screen  (no confirm action exists, by design)
```

## Run all of it (three terminals)

1. **Backend** (Luka and First):
   ```bash
   cd backend
   uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt
   .venv/bin/uvicorn app.main:app --port 8000
   ```
   It needs a model (Ollama, or `LLM_PROVIDER=groq` / `gemini`, see `backend/README.md` and `backend/.env.example`). **No model on your laptop?** `OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain` runs the same API with simple rules instead of a model: it only understands "put 1,000 baht in gold" and "show me gold", but everything after that (the tools, the screen actions, the checks) is the real code.
2. **Voice server** (KP): `cd voice && npm install && npm run dev` (needs `voice/.env` with the ElevenLabs key, see `voice/.env.example`). No key: `npm run dev:fake`.
3. **App** (Oasis): `cd frontend && npm install && npm run build`, then open **http://localhost:8787/app/?backend**
   - `?backend=http://127.0.0.1:8010` for another address, `&user=u_small` for the other demo user.
   - Without `?backend` the app uses the prototype's demo answers, as before.

The voice test page (http://localhost:8787) can use the backend too: in `voice/.env` set `ASSISTANT_MODE=http`, `ASSISTANT_URL=http://localhost:8000/chat`, `ASSISTANT_USER_ID=u_new`.

## Checked end to end (15 Oct, about 21:15, after First's 21:08 update)

With the real backend code and the stand-in model (no LLM was available on this laptop):

- Typed "Put 1,000 baht in gold" in the app: the backend sent `open_asset, start_buy, type_amount, select_wallet, review`, the app opened gold, typed 1,000 and stopped on **Review purchase: fee (1%) 10, total 1,010**, and Icarus's line was "one thousand baht into gold. Fee ten baht. Total one thousand ten baht. Tap Confirm purchase when you are ready." The numbers come from the app's own `calc()`, so the voice always matches the screen. A test runs this inside the real prototype (`frontend/test/backend-bridge.test.ts`).
- "Show me bitcoin" opens the Bitcoin page. The voice server's old request shape (`text, language, snapshot, userId`) is accepted too.
- A busy model or a missing backend: Icarus says the backend's own message (English or Thai) instead of failing silently.
- "Book me a ride to the airport" still hands off to U-Bot (now the U-Bot mock), "What is U-Coin?" still gets the glossary answer, with the backend switched on.
- Backend tests: 69 passing. Voice: 382. App: 63.
- Not checked: a real model's answers (Ollama or Groq), and a real microphone through the whole chain (the browser pane I tested in blocks the mic).

## To agree before the demo

First's update (21:08) settled most of the earlier list: the backend now uses the app's own asset ids, screens, periods and element ids (`backend/data/app_ui.json`), drives the app's own screens, and answers about the numbers the screen shows. What is left:

1. **The fee in `backend/data/fees.json`.** The app's buy screen charges **1% on top** (1,000 + 10 = 1,010; `FEE=0.01` in the prototype). That is what users see and what Icarus now reads back. The voice side's mock and demo audio were changed to match (they said 15 and 1,015 before; that was our mistake). `fees.json` still says 0.25%, at least 5 baht, included. It is only used when there is no screen (the voice test page, or explaining the fee line with no snapshot), but an answer from it would contradict the screen. Suggest: set it to the app's rule.
2. **Buying does not reach the backend.** "Confirm purchase" runs the prototype's own demo purchase. The backend's `/trades/{id}/confirm` and its demo users' balances are not used by this flow. Fine for the demo, since the screens show the prototype's data. Say so on stage.
3. **Prices on screen are the prototype's dollars**, live baht prices are in the backend. The backend now answers about what the screen shows and labels the currency, so nothing contradicts. Live prices on the screens would need the prototype to read `GET /prices`.
4. **Reply fields.** The app also uses `speech` (a separate line for the voice), `emotion` (the mascot's face) and `suggestions` (chips). The bridge fills `speech` for a buy (the exact read-back); the backend could send the others.
5. **U-Bot.** The `handoff` action and the "Ask U-topia" glossary live in the voice server and run before the backend. Fine for the demo. If the backend wants them as tools, the shapes are in `voice/README.md` (U-Bot section).
6. **Thai.** Lines marked `THAI REVIEW` (voice strings, the read-back, the U-Bot mock) and the Thai voice (Malee) need a Thai speaker.

## For the backend: what the voice needs from a reply

- **Short `text`.** One or two sentences. It is spoken. No markdown, lists or emoji.
- **Numbers from tools only**, as the backend already does. The voice speaks English money as words on purpose (the English voice misread "1,015" as "1,215" in our tests), and says every amount exactly.
- **Speed.** Time to the first sound is about 0.9 s for the speech-to-text to finish, plus the backend's time, plus about 0.2 s for the first audio. Keep `/chat` under about 1.5 s for voice if you can.
- `input_mode: "voice"` is sent for spoken questions, `"text"` for typed ones.

## Files that connect the parts

| File | What it does |
|---|---|
| `frontend/src/backend-bridge.ts` | `?backend`: the prototype's questions go to `POST /chat` with its own context as the snapshot; the backend's screen actions run on the app; a buy gets the exact read-back from the app's own `calc()` |
| `frontend/src/trade-card.ts` | Only for an older backend that sends trade cards: the card, confirmed by a tap that calls `POST /trades/{id}/confirm` |
| `frontend/src/utopia-bridge.ts` | "Ask U-topia" and the U-Bot handoff, around the demo answers and around the backend |
| `voice/src/server/assistant/http.ts` | The voice server's adapter for `POST /chat` (`ASSISTANT_MODE=http`): sends the snapshot as it is, passes the screen actions through |
| `voice/src/shared/backend-card.ts` | Reads an older backend's trade card for the exact money read-back |
| `backend/scripts/stand_in_brain.py` | The backend API with a rule-based stand-in for the model, for integration tests |
| `voice/src/server/ubot-mock/`, `frontend/src/ubot-mock.ts` | The U-Bot mock: handoff sessions, sample replies, the mock page, and our proposed "Ask U-topia" API |
