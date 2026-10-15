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

No key or credits yet? `npm run dev:fake` gives fake tones instead of speech and a fake Scribe that "hears" scripted phrases. Tick "Synthetic mic" on the test page and hold the "speak" button. You can rehearse the whole flow, including the money confirmation, for free.

| Command | What it does |
|---|---|
| `npm run dev` | Server and test page (rebuilds the browser code first) |
| `npm run dev:fake` | Same, with fake ElevenLabs. No key needed |
| `npm run check` | Checks the key, models, Thai support, voice IDs, token minting against the live API. Add `-- --speak` to hear a test line |
| `npm run pregenerate` | Makes the demo audio files in `demo-audio/`. `-- --dry` shows the credit cost first |
| `npm run bench` | Measures the pipeline speed with no mic. Reports real numbers |
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

## Connect the real assistant

One config change in `.env`:

```
ASSISTANT_MODE=http
ASSISTANT_URL=http://localhost:3000/ask
```

The server POSTs `{ text, language, snapshot, userId }` and expects `{ text, speak, ui_actions, sources }` back (`context.md` section 8). Or write a class with `ask(req)` and return it from `src/server/assistant/index.ts`.

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

- `STT_VAD_SILENCE_SECS` (default 0.7): how long the user must be quiet before Icarus answers. Lower is faster, but cuts people off.
- `TTS_MODEL_EN` / `TTS_MODEL_TH`: English uses Flash v2.5 (about 75 ms, no Thai). Thai uses v4 Turbo (about 100 ms) and falls back to v4, then v3 if a model is rejected.
- `ASSISTANT_MODE`: `mock` or `http`.

Noise, confirmation and barge-in numbers are in `src/config/defaults.ts`. **They have not been tuned on a real microphone.** Expect to adjust them at the venue.

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

## What is mocked, and what I could not verify

Read this before you demo.

**Mocked**
- The assistant (`src/server/assistant/mock.ts`). Canned replies. Its fee (1.5%) and total are made up.
- The friction log (a file stub).
- `FAKE_ELEVENLABS=1` mode (tones and scripted fake transcripts). For development only.

**Not verified: no ElevenLabs API key was available when this was built**
- Nothing here has run against the live ElevenLabs API. Run `npm run check`, then `npm run bench`, first thing.
- The docs list `eleven_v4_turbo` as available "via the Text to Dialogue websocket". They do not say it works on the plain streaming endpoint we use. The fallback chain (v4, v3) and `npm run check` cover this. If Thai fails, check this first.
- Whether `languageCode: "th"` and the speed setting are accepted by the v4 models.
- Scribe's per-word `logprob`. The docs call it a "confidence score" without a scale. We assume log probabilities. The test page shows each confidence so you can tune `confirm.minConfidence` (0.85) and `filter.minConfidence` (0.5).
- Whether the timestamped transcript (the only one with confidence) always arrives promptly. If it is late, confidence is "unknown", and the confirm flow treats unknown as "not high".
- Push to talk: the docs say Scribe starts transcribing after about 2 seconds of audio. Short push-to-talk clips may be slow or empty. Test it.
- `filter_background_audio` and `no_verbatim` are switched on. Their effect on accuracy and latency is untested.
- Whether the speech engine reads "1,015" correctly. Flash v2.5 has text normalisation off by default (turning it on needs an Enterprise plan). The card on screen always shows the exact numbers.

**Not verified: the real microphone**
- The mic capture (`src/client/mic.ts`, an AudioWorklet) was built and bundled, but never run with a real microphone. It was tested with a synthetic mic in a real browser, and with fakes in unit tests.
- Echo: with open speakers Icarus can hear itself. Use headphones, or push to talk in a noisy room. The echo filter and the stricter loudness check while Icarus speaks are untuned.

**Not verified: Thai quality.** Thai strings, keyterms and wording are a first draft. Nobody has heard the Thai voice yet.

**Latency**
- No real numbers yet. Run `npm run bench` with a key. It reports the time to first audio on the server side.
- With fake services in a real browser, the app's own overhead was small (about 100 ms for the assistant call and the audio hop, plus the 700 ms silence setting). That says nothing about ElevenLabs.
- From the docs: Scribe about 150 ms, Flash about 75 ms, v4 Turbo about 100 ms, all "excluding network". With the 700 ms silence setting that is roughly 1 second before the assistant and the network. **The 1.5 second goal depends on how fast the real assistant is.** A real LLM that takes 1 second or more will break it, unless the assistant streams (the contract does not).
- Barge-in measured about 120 ms from the first loud sound to silence in a browser with the synthetic mic. A real mic and speakers add device delay (tens of milliseconds).

**Other choices to know about**
- ElevenLabs also has a hosted agent product with webhook tools, client tools, MCP and custom LLMs. I only checked the docs index. I kept the speech-to-text, assistant, text-to-speech pipeline so we control the money read-back and the confirm gate ourselves.
- Context rule 4 says confirmation is a tap. Your brief has a voice "confirm" with a countdown. I built it as a voice **intent** with `requiresTap: true`, so the frontend can keep the tap.

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
  src/
    config/               everything editable: strings, commands, keyterms, thresholds, demo lines
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
      pregenerate.ts      logic behind npm run pregenerate
      bench.ts            logic behind npm run bench
      fake-elevenlabs.ts  fake TTS, for dev and tests
      fake-stt.ts         fake Scribe, for dev and tests
  test/                   unit and integration tests
```
