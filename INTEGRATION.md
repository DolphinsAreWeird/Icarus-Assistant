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
  -> reply { text, speak, ui_actions, sources }
  -> chat bubble, highlight, trade card (backend numbers)
  -> text-to-speech (ElevenLabs via the voice server, Brittney in English, Malee in Thai)
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
   It needs a model (Ollama, or `LLM_PROVIDER=groq` / `gemini`, see `backend/README.md`). **No model on your laptop?** `OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain` runs the same API with simple rules instead of a model: it only understands "put 1,000 baht in gold", but everything after that (tools, previews, confirms) is the real code.
2. **Voice server** (KP): `cd voice && npm install && npm run dev` (needs `voice/.env` with the ElevenLabs key, see `voice/.env.example`). No key: `npm run dev:fake`.
3. **App** (Oasis): `cd frontend && npm install && npm run build`, then open **http://localhost:8787/app/?backend**
   - `?backend=http://127.0.0.1:8010` for another address, `&user=u_small` for the other demo user.
   - Without `?backend` the app uses the prototype's demo answers, as before.

The voice test page (http://localhost:8787) can use the backend too: in `voice/.env` set `ASSISTANT_MODE=http`, `ASSISTANT_URL=http://localhost:8000/chat`, `ASSISTANT_USER_ID=u_new`.

## Checked end to end (15 Oct, about 21:00)

With the real backend code and the stand-in model (no LLM was available on this laptop):

- Typed "Put 1,000 baht in gold" in the app: the backend made a preview, the card showed **its** numbers (995 into gold, fee 5, you pay 1,000), a tap on Confirm bought it (cash 5,000 to 4,000), and Icarus said so in the chat.
- A second tap on Confirm does not buy twice (the backend returns the first result).
- An expired price, a busy model or a missing backend: Icarus says the backend's own message (English or Thai) instead of failing silently.
- "Book me a ride to the airport" still hands off to U-Bot, "What is U-Coin?" still gets the glossary answer, with the backend switched on.
- The handoff opens the U-Bot mock with the question carried over: sample rides to the airport, then a mock "Review & pay in U-topia Pay" step.
- The voice server's read-back from a backend card: "nine hundred ninety-five baht into gold. Fee five baht. Total one thousand baht."
- Not checked: a real model's answers (Ollama or Groq), and a real microphone through the whole chain (the browser pane I tested in blocks the mic).

## To agree before the demo

These are real mismatches between the parts. Each one can make the demo look broken (the plan's rule 1: "the app screens and Icarus read the same prices, fees and account state").

1. **The fee rule. Three different answers today for "put 1,000 baht in gold":**

   | Part | Rule | Fee | Total charged |
   |---|---|---|---|
   | Prototype buy screen | 1.5% on top | 15 | 1,015 |
   | Voice demo lines and mock (made to match the prototype) | on top | 15 | 1,015 |
   | Backend `data/fees.json` | 0.25%, at least 5 baht, **included** | 5 | 1,000 |

   Pick one rule and one meaning of "1,000 baht" (is that what the user pays, or what goes into gold?). Our suggestion: the backend is the source of truth, the prototype's buy screen shows the backend's preview, and then the voice side regenerates the demo read-back (`npm run pregenerate -- --clean --verify`). Until then, with `?backend` the app shows the backend's numbers on its own card and does **not** drive the prototype's buy screen, so the user never sees two different totals.
2. **Assets.** Prototype: Bitcoin, Ethereum, Gold (XAU), Apple, Tesla. Backend: Bitcoin, Ethereum, tokenized gold (PAX Gold), USDT. Apple and Tesla have no data in the backend. USDT has no screen. Gold is tokenized gold in the backend: say so on stage.
3. **Currency and prices on screen.** The prototype shows dollars from its own demo numbers (Bitcoin $67,420). The backend has live baht prices (Binance times the day's exchange rate). Icarus will say baht prices that are not on the screen. The prototype should read `GET /prices`, `/history/{id}` and `/portfolio/{user_id}`.
4. **The demo user.** Prototype: John Doe with $28,399.67. Backend: `u_new` (5,000 baht, new) and `u_small` (small portfolio). Pick who the volunteer is, and make the screens and the backend agree.
5. **Screen actions.** The prototype can move the screen: `open_asset`, `start_buy`, `type_amount`, `review`, `set_period`, `navigate`, `start_guide`. The backend only sends `highlight` and `card`. So with `?backend`, "take me to gold" answers but does not move the screen. Suggestion: a backend tool that returns a `navigate` or `open_asset` action.
6. **UI element ids.** Both use `asset.chart`, `asset.change24h`, `asset.buy_button`, `buy.amount_input`, `buy.fee_line`, `buy.confirm_button`, `home.balance`, `portfolio.allocation`, `swap.from_asset`, `swap.to_asset`. Only in the prototype: `invest.chart`, `invest.portfolio_value`, `buy.review_button`, `card.balance`. Only in the backend: `home.verify_banner`, `home.deposit_button`, `home.buy_button`, `home.portfolio_tab`, `asset.price`. `backend/data/ui_elements.json` says to replace it with Oasis's real list.
7. **Screen names.** Prototype `asset` and `invest` are the backend's `asset_detail` and `portfolio` (mapped in `frontend/src/backend-bridge.ts`).
8. **Reply fields.** The prototype also understands `speech` (a separate line for the voice), `emotion` (the mascot's face) and `suggestions` (chips). The backend could send them; the bridge already passes `speech` through when the reply is a trade preview.
9. **U-Bot.** The `handoff` action and the "Ask U-topia" glossary live in the voice server and run before the backend. Fine for the demo. If the backend wants them as tools, the shapes are in `voice/README.md` (U-Bot section).
10. **Thai.** Lines marked `THAI REVIEW` (voice strings, the trade card) and the Thai voice (Malee) need a Thai speaker.

## For the backend: what the voice needs from a reply

- **Short `text`.** One or two sentences. It is spoken. No markdown, lists or emoji.
- **Numbers from tools only**, as the backend already does. The voice speaks English money as words on purpose (the English voice misread "1,015" as "1,215" in our tests), and says every amount exactly.
- **Speed.** Time to the first sound is about 0.9 s for the speech-to-text to finish, plus the backend's time, plus about 0.2 s for the first audio. Keep `/chat` under about 1.5 s for voice if you can.
- `input_mode: "voice"` is sent for spoken questions, `"text"` for typed ones.

## Files that connect the parts

| File | What it does |
|---|---|
| `frontend/src/backend-bridge.ts` | `?backend`: the prototype's questions go to `POST /chat`; the context and the reply are translated both ways |
| `frontend/src/trade-card.ts` | The backend's trade preview on a card. Confirm is a tap that calls `POST /trades/{id}/confirm` |
| `frontend/src/utopia-bridge.ts` | "Ask U-topia" and the U-Bot handoff, around the demo answers and around the backend |
| `voice/src/server/assistant/http.ts` | The voice server's adapter for `POST /chat` (`ASSISTANT_MODE=http`) |
| `voice/src/shared/backend-card.ts` | Makes the backend's trade card readable for the exact money read-back (used by both of the above) |
| `backend/scripts/stand_in_brain.py` | The backend API with a rule-based stand-in for the model, for integration tests |
| `voice/src/server/ubot-mock/`, `frontend/src/ubot-mock.ts` | The U-Bot mock: handoff sessions, sample replies, the mock page, and our proposed "Ask U-topia" API |
