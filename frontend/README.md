# Icarus app (frontend)

Oasis's Icarus prototype, running as a React app and **paired with our voice stack**: ElevenLabs text-to-speech and Scribe speech-to-text.

The prototype file (`prototype/Icarus Prototype.dc.html`) is Oasis's design, **unchanged**. It is a React component written as an HTML template plus a logic class, and it needs a small runtime that was missing. `src/dc-runtime.ts` is that runtime. So Oasis can keep editing the design in their tool and drop in the new export: nothing here needs porting.

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

Voice commands ("stop", "repeat that", "louder", "slower", "go back") are handled by the voice module, so the prototype never sees them as questions. You can interrupt Icarus by talking over it.

If the mic is blocked or the voice server is not running, the prototype falls back to its tap-a-phrase demo mode by itself. The pill under the phone says what the voice stack is doing and shows any problem. Click it to hide it.

## Files

```
frontend/
  prototype/Icarus Prototype.dc.html   Oasis's design, unchanged
  src/dc-runtime.ts                    runs a .dc.html file: parses it, compiles the template to React
  src/voice-bridge.ts                  attaches our TTS and Scribe speech-in to the prototype
  src/assets.ts                        draws placeholder mascots when the real images are missing
  src/main.ts                          loads the prototype, starts everything
  src/index.html                       the page
  scripts/build.mjs                    esbuild bundle into dist/
  test/                                30 tests, including the REAL prototype running with a fake voice
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

`npm test` (30 tests). The main one mounts the real prototype in a simulated browser, starts voice mode and checks that the greeting goes to our text-to-speech, that a spoken question comes back through the Scribe look-alike and gets an answer, that Thai speaks Thai, and that it falls back to the demo mode when the mic is denied.
