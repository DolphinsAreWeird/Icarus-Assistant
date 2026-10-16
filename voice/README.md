# Icarus voice

Speech in, speech out, and turn-taking for Icarus. Owner: KP.

You talk, Icarus listens (ElevenLabs Scribe v2 Realtime), asks the assistant, and answers out loud (ElevenLabs text-to-speech, streamed). It handles interruptions, a few spoken commands, and the voice side of the money confirmation.

It does **not** contain the assistant (Luka and First) or the app UI (Oasis). The assistant here is a mock until theirs is ready.

```
mic -> Scribe (browser, direct) -> filter -> local commands? -> assistant -> speech text -> TTS (server) -> speaker
                                                                   |
                                                       money preview -> read-back -> confirm / cancel
```

## Quick start

```bash
cd voice
npm install
cp .env.example .env      # add ELEVENLABS_API_KEY, VOICE_ID_EN, VOICE_ID_TH
npm run check             # tests your key, the models, Thai support and the voice IDs
npm run dev               # test page at http://localhost:8787
```

**Keep that terminal open.** The test page only works while the server is running. If the browser says the site cannot be reached, the server is not running (or you used `https`). Start it again and open `http://localhost:8787`.

No key or credits yet? `npm run dev:fake` gives fake tones instead of speech and a fake Scribe that "hears" scripted phrases. Tick "Synthetic mic" on the test page and hold the "speak" button. You can rehearse the whole flow, including the money confirmation, for free.

| Command | What it does |
|---|---|
| `npm run dev` | Server and test page (rebuilds the browser code first) |
| `npm run dev:fake` | Same, with fake ElevenLabs. No key needed |
| `npm run check` | Checks the key, models, Thai support, voice IDs, token minting against the live API. Add `-- --speak` to hear a test line |
| `npm run pregenerate` | Makes the demo audio files in `demo-audio/`. `-- --dry` shows the credit cost first. `-- --verify` checks every clip with the live Scribe, amounts included |
| `npm run bench` | Measures the pipeline speed with no mic. Reports real numbers |
| `npm run voices` | Lists voices and measures their pitch from the free samples (no credits). `-- --library --lang th` searches the Voice Library |
| `npm run audition` | Makes the finalist voices say our lines, then measures pitch, speed, and whether Scribe understood them and the amounts |
| `npm run build:client` | Builds `dist/icarus-voice.js` for the frontend |
| `npm test` | Unit and integration tests |

## Use it in the app (for Oasis)

Two ways to import it. Pick one.

- **Same repo, TypeScript:** `import { IcarusVoice } from '../voice/src/client'`
- **Plain JS:** run `npm run build:client`, then import `voice/dist/icarus-voice.js` (ES module).

The voice server must be running. Pass its address as `serverUrl` (default is the same origin as the page).

```ts
import { IcarusVoice } from '../voice/src/client';

const voice = new IcarusVoice({ serverUrl: 'http://localhost:8787', userId: 'demo-user', language: 'en' });

voice.on('stateChange', ({ to, confirmPhase }) => setBadge(to, confirmPhase)); // idle | listening | thinking | speaking | confirming
voice.on('partialTranscript', ({ text }) => showLive(text));
voice.on('finalTranscript', ({ text, language }) => addToChat('user', text));
voice.on('assistantReply', ({ reply }) => {
  addToChat('icarus', reply.text);          // full text always goes on screen
  for (const action of reply.ui_actions) run(action); // highlight / show_card / navigate
});

// Must be called from a click or tap. Browsers need a gesture for the mic and for audio.
micButton.onclick = () => (running ? voice.stop() : voice.start());

// Keep this fresh. It is passed to the assistant with every question, untouched.
voice.setSnapshot({ screen: 'asset.gold', visible: ['asset.chart', 'asset.change24h'] });
```

### Methods

| Method | What it does |
|---|---|
| `start()` | Mic on. Call from a click. In hands-free mode it stays on until `stop()` |
| `stop()` | Mic off, playback stopped, any pending voice confirmation cancelled |
| `setMode('hands-free' \| 'push-to-talk')` | Hands-free keeps the mic open. Push to talk uses the two methods below |
| `pushToTalkStart()` / `pushToTalkEnd()` | Hold-to-talk. Call on button down and up. Stops Icarus if it is talking |
| `setLanguage('en' \| 'th' \| 'auto')` | `auto` lets Scribe detect the language each time |
| `setSnapshot(snapshot)` | The latest screen snapshot. We pass it on and never read it |
| `sendText(text)` | Typed input, through the same pipeline as speech. Switching between voice and text mid-conversation just works |
| `speak(text)` | Say a line, for example `"Confirmed. Your gold purchase is on its way."` Numbers are kept exact |
| `cancelConfirm()` | The user tapped Cancel on the preview or the countdown |
| `confirmResolved()` | The UI dealt with the preview (executed or cancelled by tap). Ends the voice side quietly |
| `unlock()` | Prepare audio from any click (for example before `speak()` with the mic off) |
| `on(event, handler)` | Returns an unsubscribe function |

Constructor options: `serverUrl`, `userId`, `language`, `mode`, `config` (any number in `src/config/defaults.ts`), `fallbackToBrowserVoice` (default true).

### Events

| Event | Payload | When |
|---|---|---|
| `partialTranscript` | `{ text }` | Live words while the user talks |
| `finalTranscript` | `{ text, confidence, language, source }` | The user finished a sentence (after the noise filter) |
| `stateChange` | `{ from, to, reason, confirmPhase }` | Any state change. `confirmPhase` is `readback`, `awaiting`, `countdown` or null |
| `speakingStart` / `speakingEnd` | `{ text, kind }` / `{ reason }` | Audio started or ended. Reason: `finished`, `interrupted`, `stopped`, `error` |
| `assistantReply` | `{ reply, speech, preview, assistantMs }` | The assistant answered. `reply` has `text`, `speak`, `ui_actions`, `sources` |
| `confirmIntent` | `{ previewId, source: 'voice', requiresTap }` | The user said confirm and did not cancel in 3 seconds. **An intent only** |
| `countdown` | `{ phase, secondsLeft, remainingMs, cancelledBy?, wasCounting? }` | `start`, `tick`, `done` or `cancelled`. Show it. See below |
| `command` | `{ name, text }` | A local voice command ran. For `back`, **the UI must navigate back** |
| `bargeIn` | `{ source, ms }` | The user talked over Icarus. `ms` is from the first loud sound to silence |
| `transcriptIgnored` | `{ text, reason }` | A fragment was dropped as noise, echo or low confidence |
| `turnMetrics` | `{ sttFinalMs, assistantMs, ttsFirstByteMs, timeToFirstAudioMs, ttsCache }` | Per-turn timing |
| `usage` | `{ sttSeconds, ttsCharacters, ttsCharactersFromCache }` | Running credit use |
| `error` | `{ code, message, fatal }` | Fatal means the voice session stopped |

### Money confirmation: what the frontend must do

The voice layer **never executes anything**. It reads the preview aloud, listens for "confirm" or "cancel", and reports events. Your code decides.

1. The assistant reply contains a `show_card` action with `card_type: "preview"` (see the shape below). The voice layer reads **the numbers on that card** aloud: `"1,000 baht into gold. Fee 15 baht. Total 1,015 baht. Say confirm or cancel."` It never uses the assistant's own sentence for money.
2. "Confirm" is **ignored until that read-back has finished playing**. Saying it early makes Icarus start the read-back again. It also needs high transcript confidence, and the user must have started speaking after the read-back ended. "Yes" and "OK" never confirm.
3. When the user confirms, you get `countdown` events: `start` (3), `tick` (2, 1), `done`. **Show them.** The user can cancel by voice ("cancel", "stop", "wait") or by tapping. Call `voice.cancelConfirm()` on the tap.
4. After a full countdown you get **one** `confirmIntent`. It has `requiresTap: true`.
5. **Hard rule 4 in `context.md` says voice is never approval and confirmation is a tap.** So on `confirmIntent`, highlight the card's confirm button and wait for the tap. Only then call `execute_trade`.
6. When you are done (tapped, executed or cancelled), call `voice.confirmResolved()`, and optionally `voice.speak('Confirmed. Your gold purchase is on its way.')`.
7. On `countdown` with `phase: 'cancelled'`, drop the preview card. This also fires when the user says "cancel" before any countdown (`wasCounting: false`).

If you decide to proceed on a voice confirm without a tap, that is a product decision, not a voice-layer one. Set `config: { confirm: { requiresTap: false } }` so the intent says so. Talk to the team first, it goes against the written rule.

The test page (`public/`) plays the frontend, so you can see all of this working. Read `public/test-page.ts`.

### Preview card shape (agree this with Luka and First)

`prepare_trade` output is not defined in `context.md`, so this is our assumption. The voice layer needs **all** of these. If any is missing, nothing is read back, voice confirm is not offered, and Icarus says "please check the card on your screen".

```json
{ "type": "show_card", "card_type": "preview",
  "data": { "preview_id": "p-123", "side": "buy", "asset": "gold",
            "amount": 1000, "fee": 15, "total": 1015, "currency": "THB" } }
```

`side` is `buy`, `sell` or `deposit`. `card_type` can also be `trade_preview`, `deposit_preview` or `order_preview`. A few alternative field names are accepted (see `src/shared/readback.ts`).

### React hook

```tsx
import { useEffect, useRef, useState } from 'react';
import { IcarusVoice, type VoiceState } from '../voice/src/client';

export function useIcarusVoice(serverUrl: string) {
  const ref = useRef<IcarusVoice>();
  const [state, setState] = useState<VoiceState>('idle');
  useEffect(() => {
    const voice = (ref.current = new IcarusVoice({ serverUrl }));
    const off = voice.on('stateChange', (c) => setState(c.to));
    return () => { off(); voice.stop(); };
  }, [serverUrl]);
  return { voice: ref, state };
}
```

## Getting text-to-speech working

**Status (15 Oct): it works.** Voices are set in `.env`. The first key we tried was refused by ElevenLabs at the account level (*"Unusual activity has been detected on your account, so Free Tier access has been disabled..."*). A second key from another account works for everything. If it happens again, it is **not a code problem**. Your options:

1. **Upgrade the account** to a paid plan (Starter is about US$5 a month). Turn off any VPN or proxy first.
2. **Use another key**: a teammate's account, or hackathon credits (ElevenLabs is a sponsor, ask their team at the venue). Put it in `voice/.env`.
3. **Ask ElevenLabs support** to lift the block.

Notes:

- **Voices.** English is **Brittney** (`XiPS9cXxAVbaIWtGDHDh`) and Thai is **Malee** (`mYcpTKg1oj1H5CtzUZNO`), both from the ElevenLabs Voice Library, picked on 15 Oct for the cute theme after an audition (see [Choosing the voices](#choosing-the-voices)). Before that, Sarah (a premade voice) was a stand-in. **A Thai speaker still has to listen to Malee.**
- **Key permissions.** A restricted key works for the app if it has **Text to Speech** and **Speech to Text**. `npm run check` also wants **Models: read** and **Voices: read**, and explains if they are missing.
- If ElevenLabs text-to-speech fails, the module falls back to the browser's own voice (macOS has an English voice and a Thai one called Kanya). It sounds different, but everything keeps working.

## The Icarus app (Oasis's prototype, already paired)

Oasis's prototype runs as an app and is **already paired** with this voice stack: ElevenLabs text-to-speech and Scribe speech-to-text. Build it once, then open `http://localhost:8787/app/` while the voice server runs:

```bash
cd ../frontend && npm install && npm run build
```

See [`../frontend/README.md`](../frontend/README.md) for how it works. The short version: the prototype has hooks for an external voice (`Icarus.setTTS`, `window.SpeechRecognition`), and `frontend/src/voice-bridge.ts` plugs this module into them in `assistant: 'external'` mode (we listen and speak, the prototype does the thinking). The prototype file itself is unchanged.

For a different frontend that has its own assistant, use the same idea:

```js
const voice = new IcarusVoice({ serverUrl: 'http://localhost:8787', assistant: 'external' });
voice.on('finalTranscript', ({ text }) => myAssistant.ask(text).then((reply) => voice.speak(reply.speech ?? reply.text)));
await voice.start(); // inside a click
```

If a reply has a separate `speech` field, our server speaks that instead of `text`. `emotion` is passed through on the `assistantReply` event.

## U-Bot: "Ask U-topia" and handoffs

[U-Bot](https://u.bot/) is U-topia's own AI assistant (its page calls it "agentic payments"). It is behind a login and we found **no public API**. The organizers want us to use it, so we do two things now, with a mock where the real thing is missing:

1. **Ask U-topia (mocked).** A question like "What is U-Coin?" is answered from a small glossary (`src/config/utopia-glossary.ts`). Every answer is built only from what U-topia says publicly and from our context file, is marked **unverified**, and the app labels it: *"Based on: Mock answer, not checked by U-topia yet"*. The glossary only **defines** things. "How do I...", fees or "my payment failed" go to U-Bot instead of getting a guess.
2. **Handoff (real link, no API needed).** Things Icarus cannot do are handed to U-Bot with a card and an **Open U-Bot** button: travel, rides and groceries (U-Bot's own screens say "Review & pay in U-topia Pay" for these), non-finance tasks (drawing, writing, building apps, translating, weather), U-topia questions the glossary cannot answer, and a request the prototype does not understand (a real request, not a misheard word).

**Never handed off: advice.** "What should I buy?" and "Should I buy U-Coin?" are refused by Icarus itself (hard rule 1). A test checks this for 8 phrasings in English and Thai.

How it flows: `POST /api/utopia/route { text, language, fallback? }` answers `{ kind: 'answer' | 'handoff' | 'none' }`. The app asks before every request. `none` means a normal in-app request and Icarus answers as always. If the voice server is down, nothing changes. The mock assistant in `voice/` uses the same service, and its handoff reply carries a new UI action:

```json
{ "type": "handoff", "target": "u-bot", "reason": "commerce", "label": "Open U-Bot", "url": "https://u.bot/", "question": "book me a flight to Phuket" }
```

`handoff` is **not in the context.md contract**. Agree it with Luka, First and Oasis. We also propose two agent tools: `ask_utopia(question, language)` and `handoff_to_ubot(reason, question, language)`. Both are covered by `UtopiaService.route()` in `src/server/utopia/service.ts`.

**A prompt for the real U-Bot (`UBOT_MODE=link`, the default).** U-Bot has no API and no deep link, so the most useful thing Icarus can do is write the request for it. Every handoff carries a `prompt` built from what the user said and where they are in the app (the screen and the asset, never balances or anything personal; `src/shared/ubot-prompt.ts`). A ride becomes "Book me a ride to the airport. Show me a few options with the price and pickup time, then let me review and pay in U-topia Pay.", followed by the user's own words so dates and times survive. A question about U-topia starts the way U-Bot's own "Ask U-Topia" mode does: "[Context: question is about U-Topia] How do I reset my U-Pay PIN? I'm on the Card screen in the U-topia app." The app's card shows the prompt and one button, **Copy and open U-Bot**: it copies the prompt and opens https://u.bot/, where the user signs in and pastes it.

**The U-Bot mock (`UBOT_MODE=mock`).** For a demo with no internet or no U-Bot login: "Open U-Bot" opens our U-Bot mock (`/app/?page=ubot&session=...`), clearly marked MOCK, with the question carried over, sample options and a "Review & pay in U-topia Pay" step. Nothing is booked and no money moves. Sample data is in `src/config/ubot-mock.ts`.

The mock also serves the "Ask U-topia" API we propose (`POST /mock/ubot/ask`). Set `UTOPIA_MODE=http` and `UTOPIA_URL=http://localhost:8787/mock/ubot/ask` to run the whole HTTP path; answers from the mock are labelled mock, never "U-Bot". A test does exactly this.

**When U-Bot has an API:** set `UTOPIA_MODE=http` and `UTOPIA_URL` (and `UTOPIA_API_KEY` if needed). The request we propose is in `src/server/utopia/knowledge.ts` (`HttpUtopiaKnowledge`). It is **our proposal, not their contract, and untested against a real U-Bot**. It mirrors what U-Bot's own app does: its "Ask U-Topia" mode puts `[Context: question is about U-Topia]` in front of the question. Whatever a real LLM answers is screened before Icarus says it (`src/server/utopia/safety.ts`): **no digits, currency signs or "percent"** (hard rule 3), **no advice or guarantees** (hard rule 1). An answer that fails is not shown, and the user is handed to U-Bot instead. A failing, slow or empty U-Bot also becomes a handoff.

**Until then, the best upgrade is manual.** Ask U-Bot the glossary questions yourself, check its answers, paste them into `utopia-glossary.ts` and set `verified: true` with `checkedBy` and `checkedOn`. A test fails if an entry claims to be verified without those, or if any answer contains a number.

Limits to know:
- The **Copy and open U-Bot** button goes to U-Bot's front door and the user must sign in. U-Bot has **no public deep link** (we looked), so the prompt is copied for them to paste. Ask U-topia for a link that takes a prefilled question: then the prompt could go straight in.
- What we know about U-Bot comes from its public page and its static code, not from a logged-in session. We never called its private endpoints.
- Say on stage that this is a mock plus a handoff (hard rule 5). The mock page says MOCK and "sample" on screen.
- Ask Maya Nicks (U-topia's head of AI, who designed U-Bot): what counts as "using U-Bot", whether there is an API or test account, whether a deep link or prefilled question is possible, and whether we may build our glossary from its answers.

## Choosing the voices

`npm run voices` lists every voice on the account and measures its **real pitch** from the free sample ElevenLabs publishes (no credits used). Add `--library --lang th` to search the public Voice Library, and filters like `--gender female --age young --descriptive cute`. It prints the pitch in Hz, a band (low, mid-low, mid, HIGH, VERY HIGH), whether a free plan may use the voice, and a link to listen. Pitch is a guide, not a verdict: a person has to listen.

Library voices **do not need to be added** to the account: on a paid plan, text-to-speech takes a library voice ID directly (we checked). Adding one to "My Voices" is optional and needs a key with the **Voices: write** permission (ours does not have it). Put the ID in `VOICE_ID_EN` or `VOICE_ID_TH` and run `npm run check -- --speak`. English and Thai can be two different voices. A free-plan key cannot use most library voices.

### The audition (15 Oct): how we picked Brittney and Malee

`npm run audition` makes every finalist (in `src/config/voice-candidates.ts`) say **our** lines: the greeting, the red-number explanation, the money read-back and the U-Bot handoff. It saves WAV files to `auditions/` (not committed) so people can listen, and measures each voice: the real pitch of what it said, the time to the first audio, how well the live Scribe understood it, and whether every **amount** came back right (1,000 / 15 / 1,015, whether Scribe writes digits or words). About 2,500 characters for all seven.

| Voice | Language | Pitch (sample / saying our lines) | First audio (first / later) | Scribe understood (worst / average) | Amounts | Library tags |
|---|---|---|---|---|---|---|
| **Brittney** (picked) | EN | 308 / 276 Hz | 224 / 159 ms | 96% / 99% | all right | young, cute, social media, explainers |
| Callie | EN | 254 / 222 to 258 Hz | 337 / 173 ms | 96% / 99% | all right | young, cute, conversational |
| Emma | EN | 296 / 276 Hz | 148 / 168 ms | 96% / 99% | all right | young, cute, **animation characters** |
| Jessica (premade) | EN | 219 / 216 Hz | 152 / 188 ms | 95% / 99% | all right | playful, warm |
| **Malee** (picked) | TH | 281 / 271 Hz | 232 / 184 ms | 91% / 98% | all right | bright, cheerful, social media |
| Aom | TH | 250 / 242 Hz | 129 / 183 ms | 91% / 98% | all right | smooth, calm, advertising |
| Nueng | TH | 314 / 276 Hz | 130 / 171 ms | 91% / 97% | all right | **fast and loud**, social media |

Every voice was understood and said every amount right, so the choice came down to pitch and style:

- **Brittney**: the theme asks for a high voice, and she stays high (about 276 Hz) while explaining, which is Icarus's job. Callie wanders between 222 and 258 Hz, close to an ordinary voice. Emma is made for cartoons, which is wrong for reading money back.
- **Malee**: the same pitch as Brittney (271 against 276 Hz), so Icarus sounds like one character in both languages. Nueng is described as fast and loud (Icarus should be calm). Aom is calm but lower.
- The worst scores (91 to 96%) are all the U-Bot line: Scribe writes "U-Bot" as "YouBot" and "You topia Pay" as "Utopia Pay". It is the same for every voice.

**Alternates, one line in `.env` each:** if Brittney sounds too peppy for money, use Callie (`7YaUDeaStRuoYg3FKsmU`). If Malee is too quick on the Thai read-back, use Aom (`nealpwJT5tCyJFKDzEq8`). Then run `npm run pregenerate -- --clean --verify` and commit `demo-audio/`.

Things to know:

- **Listen before the demo.** Numbers cannot tell you whether a voice sounds nice, and a Thai speaker has to check Malee. Thai lines leave out ค่ะ and ครับ: add ค่ะ to match Malee if the Thai reviewer wants it.
- **First use is slow.** In one run, a library voice that had not spoken yet took 2 to 3 s to its first audio, then about 150 ms. The server now says one short word in each voice at start and every 20 minutes (`TTS_WARMUP_MINUTES`, a few characters each time).
- **A library voice can disappear** if its owner removes it. Then text-to-speech fails with a clear "bad voice" error, the app falls back to the browser's voice, and the committed demo audio still plays.
- `npm run pregenerate -- --verify` plays every demo clip into the live Scribe and fails if an amount is wrong. The committed demo audio (Brittney) passed: every line understood, every amount right.

## Connect the real assistant

Luka and First's backend (`../backend`, FastAPI) is the real brain. Start it, then three lines in `.env`:

```
ASSISTANT_MODE=http
ASSISTANT_URL=http://localhost:8000/chat
ASSISTANT_USER_ID=u_new
```

The adapter (`src/server/assistant/http.ts`) speaks their contract (`backend/app/contracts.py`): it sends `{ session_id, user_id, text, lang, input_mode: "voice", snapshot }`, with the app's context as the snapshot, untouched. The reply's `ui_actions` are the app's own screen actions (`open_asset`, `start_buy`, `type_amount`, `review`, `highlight`...) and pass straight through. `ASSISTANT_USER_ID` picks the backend's demo user (`u_new` or `u_small`); `demo-user` maps to `u_new` there anyway. The backend's own error messages (busy, not set up) are spoken in English or Thai instead of a generic failure.

**Money.** A buy comes back as a trade card with the backend's numbers: what the user pays **with the fee included** (`you_pay_thb`). The read-back is built from it so the numbers add up: "nine hundred ninety-five baht into gold. Fee five baht. Total one thousand baht." (`src/shared/backend-card.ts`). For a sale the last part is "You get ...". If a number is missing, there is no read-back and no voice confirm: the user taps the card. Chart and steps cards pass through as `show_card` for the app to draw.

The reply is not streamed. Whatever time the real assistant takes is added to the wait before Icarus speaks.

`ui_actions` types we handle: `highlight`, `show_card`, and **`navigate`**. `navigate` is not in the contract. We added it for "take me to gold". Agree it with Oasis, or tell us the real way.

The friction log is a stub: `logFriction()` in `src/server/friction.ts`. It prints and writes `logs/friction.jsonl`. Replace the body with the real log. It is called for every final transcript and reads `snapshot.screen` for the screen name (also an assumption).

## Thai: where to edit

Search for `THAI REVIEW`.

| File | What is in it |
|---|---|
| `src/config/strings.ts` | Every fixed line, the money read-back words, months, currency and asset names, pronunciations |
| `src/config/voice-commands.ts` | The command phrases for stop, repeat, back, louder, slower, confirm, cancel (English and Thai) |
| `src/config/keyterms.ts` | Words Scribe should listen for (max 20 characters each) |
| `src/config/mock-replies.ts` | The Thai replies of the mock assistant |
| `src/config/demo-lines.ts` | Add the Thai demo lines here once approved, then `npm run pregenerate -- --lang th` |

Gender particles (ครับ, ค่ะ) are left out on purpose. Add them to match the voice you pick. Thai dates are said in Buddhist Era. Numbers in Thai are read as digits.

## Settings

All in `.env` (see `.env.example`, every line is explained). The ones you will touch:

- `STT_VAD_SILENCE_SECS` (default 0.5): how long the user must be quiet before Icarus answers. **Measured on the live Scribe:** 0.7 s gives about 1150 ms to the final transcript, while 0.5 s and 0.3 s both give about 920 ms. Scribe has a floor, so going below 0.5 buys nothing and may cut people off.
- `TTS_MODEL_EN` / `TTS_MODEL_TH`: English uses Flash v2.5 (about 75 ms, no Thai). Thai uses v4 Turbo (about 100 ms) and falls back to v4, then v3 if a model is rejected. A wrong voice ID is reported clearly (`bad_voice`) and does not trigger the fallback.
- `ASSISTANT_MODE`: `mock` or `http`.

Noise, confirmation and barge-in numbers are in `src/config/defaults.ts`.

**Confidence.** Scribe's per-word confidence is low even for perfect speech (about 0.49 in English, 0.36 in Thai, measured live). We divide by a per-language reference so clean speech is about 1.0. That is `confidenceReference` in `defaults.ts`. It was measured with **macOS voices, not human voices**. The test page shows both numbers for every sentence (`confidence 0.93 (raw 0.44)`). Say a few sentences into a real mic and adjust the references if clean speech does not reach about 1.0.

The loudness and echo numbers for barge-in have **not** been tuned on a real microphone. Expect to adjust them at the venue.

## Credits

- Text-to-speech is cached by a hash of voice, model, speed, format and text. Repeat lines cost nothing.
- `npm run pregenerate` makes the demo lines once. Commit `demo-audio/`. With those files the server plays the demo lines even with no network.
- If ElevenLabs fails, Icarus falls back to the browser's own voice. It sounds different, and the text is always on screen.
- Hands-free streams audio to Scribe the whole time the mic is on. It stops itself after 120 seconds of quiet (`idleStopAfterSec`).
- Keyterm prompting costs extra (ElevenLabs docs). The list is short on purpose.
- The server prints a running total (`[usage] ...`) and the test page shows it.

## Security

- The API key is read only from `.env` on the server. It is never sent to the browser and never logged. Errors are scrubbed of it.
- Browser speech-to-text uses a **single-use token** the server mints (valid 15 minutes). The browser connects to Scribe directly with it.
- Text-to-speech and the assistant go through our server.
- There is **no login on the voice server**. Anyone who can reach it can use your credits. Run it on localhost or a private network. Set `ALLOWED_ORIGINS` to the real frontend origin if you deploy it.

## What is mocked, and what is verified

Read this before you demo.

**Mocked**
- The assistant in `voice/` (`src/server/assistant/mock.ts`): canned replies, with a made-up fee. The *app* has its own demo assistant, from the prototype.
- The friction log (a file stub).
- `FAKE_ELEVENLABS=1` mode (beeps and scripted fake transcripts). For development only.

**Verified against the live ElevenLabs API (15 Oct)**
- **Models.** The API itself lists `eleven_flash_v2_5` as supporting English, and `eleven_v4_turbo`, `eleven_v4`, `eleven_v3` as supporting Thai. `languageCode: "th"` is accepted.
- **Speech-to-text.** Scribe v2 Realtime accepts our connection (language, keyterms, VAD, timestamps, `no_verbatim`). English and Thai come back exactly right, from both macOS voices and our own TTS audio.
- **Text-to-speech.** Streams through the SDK, English on Flash, Thai on v4 Turbo, first byte about 230 to 360 ms when warm (the very first call of a session can take 0.4 to 1.8 s while the connection opens).
- **Time to first audio, server side** (`npm run bench`, 4 runs per language, mock assistant at 120 ms, silence 0.5 s):

  | | English | Thai |
  |---|---|---|
  | Speech-to-text final, after the user stops | 839 ms median | 912 ms |
  | Assistant (mock) | about 125 ms | about 125 ms |
  | Text-to-speech first byte | 264 ms | 266 ms |
  | **Total to first audio** | **1231 ms** (1118 to 1309) | **1296 ms** (1236 to 1321) |

  The 1.5 s goal is met with 200 to 380 ms to spare, **before** the browser adds about 40 ms of audio start and the device delay, and **only with a fast assistant**. A real LLM that takes 1 second or more breaks it, unless the assistant streams (the contract does not).
- **Speech-to-text latency has a floor.** Silence 0.7 s gives about 1150 ms to the final transcript, while 0.5 s and 0.3 s both give about 920 ms. The first partial transcript takes about 0.95 s (English) and 0.9 to 1.9 s (Thai), too slow for barge-in on its own. Barge-in therefore uses mic loudness (about 120 ms in a browser test).
- **Confidence scale.** Scribe's per-word confidence is low even for clean speech (about 0.47 to 0.49 in English, 0.35 in Thai). It does fall with noise. We normalise against those references (see Settings).
- **A money-safety bug, found and fixed.** With digits, the English voice said **"1,215"** for 1,015 (and "10.15" for 1015). English amounts are now **spoken as words** ("one thousand fifteen"), which came back right every time. The card keeps digits. Thai digits are read correctly by v4 Turbo.
- Bugs the live API found: `filter_background_audio` cannot be combined with `include_timestamps`, and `commit_strategy=turn_prediction` is refused by `scribe_v2_realtime`. Both fixed.

**Not verified**
- **Thai voice quality.** Scribe understands our Thai speech, but nobody who speaks Thai has listened to it yet. Strings, keyterms and wording are a first draft.
- **A real microphone, by me.** The mic capture (`src/client/mic.ts`) was tested with a synthetic mic in a real browser and with fakes. Echo handling and the loudness thresholds are untuned. Use headphones, or push to talk in a noisy room.
- **Confidence with human voices.** The references were measured with synthetic voices. Say a few sentences into a real mic: the test page shows `confidence 0.93 (raw 0.44)`, and clean speech should reach about 1.0.
- **Push to talk:** the docs say Scribe starts transcribing after about 2 seconds of audio, so short clips may be slow or empty.
- **The speed setting** ("slower") on the v4 models, and `no_verbatim`'s effect on accuracy.
- **The app in Brave itself.** It was tested in the built-in Chromium browser and in a simulated browser.

**Other choices to know about**
- ElevenLabs also has a hosted agent product with webhook tools, client tools, MCP and custom LLMs. I only checked the docs index. I kept the speech-to-text, assistant, text-to-speech pipeline so we control the money read-back and the confirm gate ourselves.
- Context rule 4 says confirmation is a tap. Your brief has a voice "confirm" with a countdown. I built it as a voice **intent** with `requiresTap: true`, so the frontend can keep the tap. (The prototype has no voice confirm: it stops at a Confirm button.)

## Files

```
voice/
  .env.example            every setting, explained
  demo-audio/             pre-generated demo lines (commit this)
  public/
    index.html            the test page
    test-page.ts          test page logic. Also shows how a frontend uses the module
  scripts/
    build-client.mjs      bundles the browser code with esbuild
    elevenlabs-check.ts   npm run check
    pregenerate.ts        npm run pregenerate
    bench.ts              npm run bench
    voice-scout.ts        npm run voices (pitch from the free samples)
    voice-audition.ts     npm run audition (finalists say our lines, then get measured)
  src/
    config/               everything editable: strings, commands, keyterms, thresholds, demo lines,
                          the U-topia glossary, handoff rules, voice finalists
    shared/               code used by both the server and the browser
      types.ts            the contracts and event types
      speech-format.ts    text to speakable text (markdown, money, percent, dates, short version)
      readback.ts         the exact money read-back, built from the card
      commands.ts         matches what was said against the command lists
      transcript.ts       confidence, noise filter, echo check
      stt-protocol.ts     Scribe URL and message format
      lang.ts             Thai or English
    client/               the browser module
      icarus-voice.ts     the one class the frontend uses
      confirm-flow.ts     the money confirmation rules (small, pure, heavily tested)
      state-machine.ts    the five states
      stt-client.ts       the Scribe socket
      mic.ts              mic capture (AudioWorklet)
      player.ts           streams audio out, stops it instantly
      vad.ts              local "is the user loud" detector
      api.ts              talks to our server
      fallback-voice.ts   browser voice if ElevenLabs fails
      synthetic-mic.ts    fake mic for the test page
      emitter.ts          tiny event emitter
    server/
      index.ts            starts the server
      app.ts              the HTTP endpoints
      env.ts              reads settings
      elevenlabs.ts       the only file that uses the ElevenLabs SDK
      tts.ts              voice and model choice, cache, streaming
      tts-cache.ts        the audio cache
      speech-plan.ts      decides what is spoken for a reply
      usage.ts            credit counting
      friction.ts         the friction log stub
      assistant/          mock, HTTP adapter, and the one switch
      utopia/             "Ask U-topia" (mock glossary or HTTP) and handoffs to U-Bot, with the safety screen
      warmup.ts           says one word in each voice at start, so the first real reply is fast
      transcribe.ts       plays a clip into the live Scribe and checks words and amounts (scripts only)
      pregenerate.ts      logic behind npm run pregenerate
      bench.ts            logic behind npm run bench
      fake-elevenlabs.ts  fake TTS, for dev and tests
      fake-stt.ts         fake Scribe, for dev and tests
  test/                   unit and integration tests
```
