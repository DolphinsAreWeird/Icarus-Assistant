# Icarus app (frontend)

Oasis's Icarus prototype, running as a React app and **paired with our voice stack**: ElevenLabs text-to-speech and Scribe speech-to-text.

The prototype file (`prototype/Icarus Prototype.dc.html`) is Oasis's design, with one change: in voice mode, `say()` paces the screen actions to the spoken line so screens do not run ahead of the voice. It is a React component written as an HTML template plus a logic class, and it needs a small runtime that was missing. `src/dc-runtime.ts` is that runtime. So Oasis can keep editing the design in their tool and drop in the new export. Keep the `say()` pacing in the design file, or the screens will run ahead again.

## Run it

```bash
cd frontend && npm install && npm run build      # once, and after changing the prototype or src/
cd ../voice && npm run dev                       # the voice server (needs voice/.env for real voice)
# open http://localhost:8787/app/
```

`npm run dev` in `voice/` also rebuilds the app when `frontend/node_modules` exists. While working on the app, `cd frontend && npm run watch` rebuilds on every change (reload the page).

No ElevenLabs key? `cd voice && npm run dev:fake`. Same app, with beeps instead of speech.

## What is paired with what

| The prototype uses | We plug in |
|---|---|
| `Icarus.setTTS(fn, stop)` to speak a line | `voice.speak()`: ElevenLabs (English on Flash v2.5, Thai on v4 Turbo). If that fails, the browser voice. Numbers are spoken as words, so "1,015" is never misread |
| `window.SpeechRecognition` to listen | A look-alike backed by **Scribe v2 Realtime**. The prototype's own listening code runs unchanged. The browser's built-in recognition does not work in Brave, ours does |
| `Icarus.setBackend(fn)` for answers | Not replaced. The prototype's own demo assistant answers. Plug the real one in with `Icarus.setBackend` |
| `demoRespond(text, ctx)`, the one method every typed or spoken request goes through | Wrapped, to add **Ask U-topia** answers and **handoffs to U-Bot** (see below) |

Voice commands ("stop", "repeat that", "louder", "slower", "go back") are handled by the voice module, so the prototype never sees them as questions. You can interrupt Icarus by talking over it.

If the mic is blocked or the voice server is not running, the prototype falls back to its tap-a-phrase demo mode by itself. The pill under the phone says what the voice stack is doing and shows any problem. Click it to hide it.

## The real brain: Luka and First's backend

Open the app with `?backend` to send Icarus's questions to the backend instead of the prototype's demo answers:

```
http://localhost:8787/app/?backend                         backend at http://localhost:8000, user u_new
http://localhost:8787/app/?backend=http://127.0.0.1:8010&user=u_small
```

`src/backend-bridge.ts` plugs into the prototype's own hook (`Icarus.setBackend`), so the prototype file is not edited. Typed and spoken questions both go to `POST /chat`, with the prototype's own `getContext()` as the snapshot. The backend answers with screen actions the prototype runs as they are, and at most one card, which floats over the phone: a **trade preview** with the backend's numbers ("put 1,000 baht in gold"; confirming is a tap on the card, which calls `POST /trades/{id}/confirm`, and Icarus reads the card back exactly), a **chart** ("how did bitcoin do this year?", or two or three assets compared in %), or **steps** ("how do I buy?", with "Show me" on each step). "Ask U-topia" and the U-Bot handoffs still run first. What still has to be agreed between the parts is in [`../INTEGRATION.md`](../INTEGRATION.md).

## U-Bot: Ask U-topia and handoffs

`src/utopia-bridge.ts` wraps the prototype's `demoRespond` on the running instance (the prototype file is not edited). For each request it asks the voice server `/api/utopia/route`:

- **answer**: a question about U-topia ("What is U-Coin?"), answered from a mock glossary and labelled as a mock in the chat.
- **handoff**: something Icarus cannot do (travel, rides, groceries, drawing, writing...). Icarus says so, and `src/handoff-card.ts` shows a card over the phone with **Open U-Bot**, **Copy my question** and **Not now**. The chat thread cannot show links, so the card is separate DOM, and the design file stays untouched. Each handoff is also logged to the prototype's own event log, so the business dashboard can show "what Icarus could not do".
- **none**: a normal request. The prototype answers exactly as before. If it falls back to "I didn't catch that" on a real request, we offer U-Bot instead of a dead end.

If the voice server is down, all of this is skipped. Advice is never handed off. Details and the plan for when U-Bot has an API: `../voice/README.md`.

**The prompt for U-Bot.** A handoff card shows a prompt Icarus wrote from the user's request and the screen they are on (`scenarioOf` in `src/utopia-bridge.ts`, the prompt itself in `voice/src/shared/ubot-prompt.ts`). **Copy and open U-Bot** copies it and opens the real https://u.bot/. With the voice server's `UBOT_MODE=mock`, the button opens our U-Bot mock page (`src/ubot-mock.ts`) instead, marked MOCK, with sample options.

## Files

```
frontend/
  prototype/Icarus Prototype.dc.html   Oasis's design (voice pacing in say())
  src/dc-runtime.ts                    runs a .dc.html file: parses it, compiles the template to React
  src/voice-bridge.ts                  attaches our TTS and Scribe speech-in to the prototype
  src/backend-bridge.ts                ?backend: questions go to the real backend (POST /chat)
  src/trade-card.ts                    the backend's trade preview, confirmed by a tap
  src/chat-cards.ts                    the backend's chart and step-by-step cards
  src/ubot-mock.ts                     ?page=ubot: the U-Bot mock a handoff opens (sample data, says MOCK)
  src/utopia-bridge.ts                 Ask U-topia answers and handoffs, wrapped around the prototype's own answers
  src/handoff-card.ts                  the "U-Bot can help with this" card
  src/assets.ts                        draws placeholder mascots when the real images are missing
  src/main.ts                          loads the prototype, starts everything
  src/index.html                       the page
  scripts/build.mjs                    esbuild bundle into dist/
  test/                                44 tests, including the REAL prototype running with a fake voice
  public/mascot/bow/                   (optional) put the real mascot PNGs here
```

## Mascot images

The prototype refers to `mascot/bow/*.png` (hero, icon, star, curious, working, sleepy, happy, excited). Those images are **not inside the .dc.html file**, so the app draws simple placeholder mascots. To use the real ones, put the PNGs in `frontend/public/mascot/bow/`, rebuild, and they are used automatically.

## Runtime: what it supports

Only what the prototype uses (checked against the real file): `{{ name }}` and `{{ a.b.c }}` (plain paths, no expressions), `<sc-if value>`, `<sc-for list as>`, `ref`, the events `onClick onChange onKeyDown onPointerMove onPointerLeave onScroll` (and common others), inline styles with bindings, SVG, and `<helmet>`. If a future export uses more, `dc-runtime.ts` warns in the console. It is about 300 lines.

## Deploying

This runs on your laptop: the voice server serves the app at `/app/`, same origin as the voice API, so there is no CORS to configure and the microphone works on `localhost`.

Putting it on a public URL is **not set up**, on purpose. The voice server holds the ElevenLabs key and has **no login**, so anyone who can reach it can spend your credits. Before a public deploy, add authentication or a rate limit to the voice server. For a quick demo from another device, a tunnel to your laptop (Cloudflare Tunnel or ngrok) works, and you would be sharing that URL with whoever you give it to.

## Tests

`npm test` (44 tests). The main one mounts the real prototype in a simulated browser, starts voice mode and checks that the greeting goes to our text-to-speech, that a spoken question comes back through the Scribe look-alike and gets an answer, that Thai speaks Thai, and that it falls back to the demo mode when the mic is denied.
