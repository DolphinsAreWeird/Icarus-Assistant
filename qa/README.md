# QA

Checks that the judges' golden paths work when nobody is there to explain the demo.

| File | What it is |
|---|---|
| [`e2e/run.cjs`](e2e/run.cjs) | The automated golden-path suite (this page) |
| [`risk-register.md`](risk-register.md) | Pre-mortem: why we might not place, and what we did about it |
| [`hallway-test.md`](hallway-test.md) | The test only people can run: 3 to 5 strangers, no explanation |
| [`failure-drills.md`](failure-drills.md) | What a visitor sees when the AI, the backend or the voice is down |

## The golden-path suite

It opens the app in real browsers, does what a first-time judge would do, and writes a report with a pass/fail grid,
screenshots of every step, a video of every run, grouped console errors, timings, and every placeholder or
inconsistency it saw on screen. It never changes the app: it only clicks, types and reads.

### Run it

1. Start the backend (port 8001) as usual.
2. Start a voice server **without** `PUBLIC_DEMO`, so the per-visitor rate limits don't fail the typed questions.
   Use a free port, so the hosted-mode servers keep running:

   ```bash
   cd voice && PORT=8789 BACKEND_PROXY_URL=http://127.0.0.1:8001 npx tsx src/server/index.ts
   ```

   It reads `voice/.env` for the ElevenLabs key. The tour's lines come from the audio cache, so the tour costs no
   credits.
3. Run the suite (from the repo root):

   ```bash
   node qa/e2e/run.cjs --base http://localhost:8789/app/ --out /tmp/icarus-qa/$(date +%Y%m%d-%H%M%S)
   ```

   About 9 minutes (16 runs, one at a time; the four tours are most of it). It prints the grid at the end and exits 1
   if any path failed. Then stop the voice server.

Needs Playwright with Chromium and WebKit. The runner finds it in `node_modules`, in `$PLAYWRIGHT_PATH`, or in the
npx cache (`~/.npm/_npx/*/node_modules/playwright`, newest with installed browsers first). To install it:
`npm i -D playwright && npx playwright install chromium webkit`, or pass `--playwright <dir>`.

Keep `--out` outside the repo: videos are large. (`qa/.gitignore` ignores `runs/` and `*.webm` in case.)

### Options

| Option | Default | |
|---|---|---|
| `--base <url>` | `http://localhost:8789/app/` | The app. Any server that serves `/app/` and `/brain/` works, including the hosted demo (but its rate limits apply) |
| `--out <dir>` | `<tmp>/icarus-qa-runs/<timestamp>` | Results folder |
| `--envs <list>` | all four | `chromium-laptop`, `chromium-phone`, `webkit-laptop`, `webkit-phone` |
| `--paths <list>` | all | `tour`, `race`, `questions`, `dashboard`, `phone`, `screens` |
| `--questions-envs <list>` | `chromium-laptop,webkit-phone` | Where the typed questions run (each may cost a model call) |
| `--workers <n>` | 1 | Jobs at once. One at a time keeps the timings clean |
| `--headed` | off | Show the browsers |
| `--no-video` | videos on | |

Re-run one thing, for example after a fix: `node qa/e2e/run.cjs --paths race --envs chromium-laptop --out /tmp/icarus-qa/race-fix`.

### Environments

| Id | Browser | Screen |
|---|---|---|
| `chromium-laptop` | Chromium | 1440 x 900 |
| `chromium-phone` | Chromium | Pixel 7 (touch, mobile) |
| `webkit-laptop` | WebKit (Safari's engine) | 1440 x 900 |
| `webkit-phone` | WebKit | iPhone 14 (touch, mobile) |

Every run starts with a fresh browser profile: empty localStorage, so it is a first visit, and a new demo account on
the backend. No microphone permission is given; Race 2 uses the "No mic? Let Icarus hear it" button.

### The paths

| Grid row | Path id | Where | What it does, and what must hold |
|---|---|---|---|
| P1 | `tour` | all | First visit: the "Meet Icarus" card appears; "Watch the 1-minute tour" plays to the end (the "Tour" pill comes back, about 55 s); the chat is then open with starter chips. Also checks every voice line's audio arrived in full |
| P2 | `race` | laptops | Race 1 by hand: Start, then Invest tab > Gold > Buy > type 1000 > THB wallet if needed > Review purchase > Confirm purchase. The stopwatch must stop and show a time. Counts the taps |
| P3 | `race` | laptops | Race 2 in the same page: Start, "No mic? Let Icarus hear it" (Say), Icarus fills the buy screen to Review, Confirm purchase. Stopwatch B and the comparison line. Then the Business dashboard should list both times |
| P4 | `questions` | Chromium laptop, WebKit phone | Opens Icarus with the mascot button and types 8 questions: "How is gold doing?", "Put 1,000 baht in gold", "What is Bitcoin?", "Should I buy Bitcoin?", "what is this?", "I'm confused", "ทองวันนี้เป็นยังไง", "Book me a ride to Siam Paragon". Records the time to the answer bubble, the answer, any card, errors |
| P5 | `questions` | same | From the ride question: the "U-Bot can help with this" card with the written prompt and a "Copy and open U-Bot" link to https://u.bot/ (never followed) |
| P6 | `dashboard` | all | `/app/?page=dashboard` loads with no errors; on a laptop also through the side console's "Open" and back |
| P7 | `phone` | phones | The tour starts at phone size; one typed question works; a buy set up by Icarus can be confirmed; and what a phone visitor can and can't reach (sideways scrolling, the Icarus button, the race console, the stopwatch) |
| P8 | scan (+ `screens`) | all | The placeholder and consistency scan runs on every screenshot of every path. `screens` also visits every screen (Home, Wallets, Invest and its filters, each asset, Buy, Portfolio, Payments, Card, the chat) and, on a laptop, the other console buttons |

The scan flags, on any visible text: design placeholders ("photo", "logo", lorem, TODO), broken values (undefined,
NaN, `[object`, `{{`), dollar amounts in a baht app, the placeholder name John vs the backend's demo user, "demo /
not live / saved" price wording while the backend reports live prices, fee wording that doesn't match the backend's
fee rule, scripted fallback answers, presenter wording ("Scenario A"), developer notes, USD where the account is baht
only, and lists that render empty.

PASS means every check passed. WARN means the path worked but something soft failed (slow, wording, layout) or the
page threw an error. FAIL means the path broke or a must-have check failed. P8 is FAIL when a high-severity finding is
on screen.

### What you get

```
<out>/
  summary.md            the report: grid, failed checks, per-path notes, typed answers, timings, errors, findings
  results.json          everything, machine-readable
  build.json            what was tested: git commit and changed files, the built app's hash, server health
  logs/<env>__<path>.json
  screenshots/<env>/<path>/NN-step.png
  videos/<env>__<path>.webm
```

The app is built from `frontend/` into `frontend/dist/` and served by the voice server, so a rebuild during a run
changes what is tested. `build.json` and the top of `summary.md` record the commit and the hash of
`frontend/dist/app.js` for that reason.

### Adding a check

Each path is one file in `e2e/paths/`. A path is a list of `run.step(page, name, fn)`; inside, `run.check(name, ok,
detail, level)` records a check (`hard` fails the path, `soft` warns). Selectors and readers for the app live in
`e2e/lib/app.cjs` (they use the design's own `data-ui-id` and `data-screen-label` attributes, titles and visible
words), the scan rules in `e2e/lib/scan.cjs`, the report in `e2e/lib/report.cjs`.
