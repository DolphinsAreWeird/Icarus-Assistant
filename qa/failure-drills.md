# Failure drills (16 Oct 2026)

Each outside service cut off in turn, on separate ports, looking at what a visitor sees in the app (Playwright,
Chromium 1440×900). Scripts: the commands below; results as found, then after the fix.

| Drill | How | What a visitor saw first | Fix | After the fix |
|---|---|---|---|---|
| Cold start | Fresh backend process | Healthy in **1.0 s**; answers prepared at start | — | — |
| The AI down | Backend with invalid AI keys (`ICARUS_LLM_API_KEY`, `GEMINI_API_KEY`) | Plain requests still instant ("Put 1,000 baht in gold", "How is gold doing?"); vague ones fell back to the prototype's scripted answer: *"your balance is $28,399.67"* next to a ฿5,000 screen, or *"I didn't catch that"* | Only a plain screen move may stand in; anything else gets an honest reply with three suggestions that still work; the reason goes to the console | *"Sorry, I can't answer that one right now. I can still show prices, open an asset or set up a buy for you."* + chips "How is gold doing?", "Show me gold", "Put 1,000 baht in gold" |
| The backend down | Voice server pointing at a dead backend | Home showed the design's sample balance **$28,399.67**; every question: "Wait for the demo account to load", forever (the account loaded once) | Keep retrying the account; show ฿ … until it loads | Home shows **฿ …**; with the backend back, it **recovered by itself in 3 s** (฿5,000.00) |
| ElevenLabs down | Voice server with an invalid ElevenLabs key | Tour: still talks (its lines ship as audio, cache hit); a new answer: speech 502, the browser's own voice speaks it; the mic: token 502, the voice window falls back to tap-a-phrase chips | — (already graceful); errors only in the console | — |

Not drilled here: the hosting platform itself (needs the deployed service) and the market price feed from the host's
region (the backend falls back to saved prices, labelled delayed).
