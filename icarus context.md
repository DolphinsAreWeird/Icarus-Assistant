# context.md: Team Icarus at U-Hackathon 2026

> **For any LLM or coding agent reading this:** this is the shared source of truth for our team. Use it to understand the project, who owns what, and what's been decided. If something here conflicts with a general assumption, trust this file. Things marked "unknown", "guess" or "check" are not confirmed; don't present them as fact. If you're helping one teammate, check section 7 for what they own and section 8 for how their part connects to everyone else's.
>
> Last updated: 15 Oct 2026, day 1 of the hackathon.

---

## 1. The project in 30 seconds

- **Name:** Icarus
- **Track:** AI track (registered)
- **One-liner:** "Robinhood built an AI for Robinhood. Icarus is the AI for every other finance app: it walks new users through the app in their own words, and tells the business where they got stuck."
- **What it is:** an AI assistant that lives inside a finance app (in the corner, and attached to the app's own screens). It reads the app's live data, explains assets and charts in plain words, and does things for the user (like preparing a trade) through text or voice. Not a teacher: a companion through the user's journey.
- **Who pays:** businesses (finance apps). Users never pay.
- **Tagline:** "Icarus: fly without falling."

---

## 2. Team and roles (summary)

| Person | Owns |
|---|---|
| **Luka** and **First** | Data pipeline, user journey, and the assistant itself (the "brain") |
| **KP** | Text-to-speech (TTS) and the conversation (voice in and out, how Icarus talks) |
| **Oasis** | The app mockup for the demo, and the frontend |

Full task lists per person: section 7. How the parts connect: section 8.

---

## 3. The problem

**When people open an app like U-topia, the screens, charts and mechanics are hard to get into. That friction makes platforms lose users before they ever do anything.**

Numbers to quote:
- 68% of consumers have abandoned a financial services application mid-onboarding (Signicat, Battle to Onboard, 7,600 consumers, 14 European markets; the study is from 2022).
- 70% of financial institutions lost prospective clients due to slow or complex onboarding, up from 48% in 2023 (Fenergo, 2025).
- Fintech activation rates sit at about 5% (Agile Growth Labs 2025 benchmark, via Lorikeet).
- 76% of fintech users who convert do so within the first 7 days (Mixpanel 2025, via Lorikeet).

What this means: the first week decides everything, and most users quit before they understand the app.

---

## 4. The solution

### What the user experiences

1. **Ask about anything on screen.** Tap a chart, number or term, or just ask: "What does this line mean?" Icarus answers using the user's live data, in plain words.
2. **"Show me" mode.** Icarus highlights the next button or field on the real screen and says what to do.
3. **Say it instead of tapping through it.** "Put 1,000 baht in gold." Icarus turns a multi-step trade screen into one sentence and a preview card with one confirm button.
4. **Voice or text.** Talk or type, in English or Thai.
5. **Stays with you.** Icarus remembers where the user is in their journey (signed up, deposited, first purchase) and helps with the next step.

### What the business gets

- More users who reach their first deposit and first purchase.
- Fewer support tickets ("what does this mean?").
- **A friction map:** a dashboard of what users ask and where they get stuck. "34% of new users asked what yield means." "Most drop-offs happen at the swap screen." Every question is a bug report.

### Features we build (all on safe regulatory ground; see section 5)

| Feature | What it does |
|---|---|
| **Explain anything** | Explains any chart, number, asset or term with the user's live data |
| **Show me** | Highlights the right UI element and guides the next step |
| **Say-to-act** | Turns a request into a trade or deposit preview; the user confirms |
| **Portfolio X-ray** | Facts about the user's own holdings: "80% of your money is in one coin", "you paid 120 baht in fees this month" |
| **Compare on facts** | User names two assets; Icarus compares fees, past ups and downs, how easy they are to sell. No "better" verdict |
| **What-if** | "If I'd put 1,000 baht in gold a year ago..." plus forward ranges based on the past, clearly hypothetical |
| **Goal math** | "To save 50,000 baht by June, that's about 6,250 a month" |
| **Risk in plain words** | "In its worst month in recent years, this dropped about 30%" |
| **Heads-up alerts** | Factual event alerts, e.g. "a big batch of this token unlocks next week, which often adds selling pressure" (sponsor Tokenomist's unlock data; check API access at the event) |
| **Business's own picks** | If the client app is licensed and has approved portfolios, Icarus presents those with the client's disclaimers |
| **Friction dashboard** | Business-facing: top questions, confusion points, drop-off steps, by language |

---

## 5. Hard rules (non-negotiable)

1. **No personal investment advice.** Icarus never tells a specific user to buy or sell a specific asset. Rewording doesn't change this: regulators judge what a feature does, not what it's called. Icarus explains, compares on facts, calculates, and alerts. Recommendations only come from the client business's own licensed, approved content.
2. **Confirm before every action.** Icarus prepares; the user taps to confirm. It shows exactly what will happen (asset, amount, fees, final total). No silent actions, ever.
3. **Numbers come from data, never from the LLM.** Every price, balance, percentage or range Icarus says must come from a tool call. The LLM phrases; it doesn't invent figures.
4. **Never use voice as login or approval.** Voice cloning makes voice unsafe for authentication. Confirmation is always a tap.
5. **Honest about the demo.** Say on stage what's live, what's mocked, and what's simulated.
6. **Event rules:** no code written before the start; humans only on the team; every member can explain their own code.

Style for anything we write (pitch, UI text, docs): plain, non-formal English, short sentences, no em dashes, no AI filler words (delve, leverage, seamless, robust, crucial). Icarus itself talks the same way: short, calm, no jargon.

---

## 6. Competition and why we're different

### Who already does this

| Who | What | Gap Icarus fills |
|---|---|---|
| **Robinhood Cortex** | In-app assistant that researches, explains portfolios, and executes trades in plain English; Gold subscribers; rolled out Q1 2026 | Only exists inside Robinhood. Built for active traders, not first-timers |
| **Robinhood Agents** | Announced 29 Sep 2026: in-app agents that research, build strategies, place trades | Same: Robinhood-only, for active traders. Users "assume all risk" |
| **Public (Alpha), Schwab, Fidelity, Webull** | In-app research assistants | Each built in-house for their own app |
| **Haia (by agency Innowise)** | White-label AI finance assistant for banks and wallets | A custom-build project, not a plug-in; no friction map found |
| **TradingView extensions (e.g. TradePilot)** | Chart control by chat | For traders on TradingView, not onboarding in a finance app |
| **U-topia's own Topi AI** | Telegram-based AI trading assistant with real-time insights and signals, "architected for mass onboarding" (from their docs, 6 to 10 months old) | Lives in Telegram, not inside the app's screens. Built for traders. No voice or friction map found. **Check at the venue** |

### Our five differences

1. **For every other app.** Robinhood can't sell Cortex. Icarus plugs into any finance app.
2. **First week, not active traders.** We target activation, where apps lose 68% of people.
3. **Lives on the screen.** Points at real UI elements, highlights next steps, shrinks screens into one sentence and one button.
4. **Friction map for the business.** Nobody else in the list sells "where your users get stuck."
5. **Voice in local languages.** Thai and English first, built for Southeast Asian apps.

### How we position against Topi AI

"Topi gives traders signals in Telegram. Icarus lives inside your new app, guides first-time users through it in their own voice, and shows you where they get stuck." Partner, not rival.

---

## 7. Roles in detail

### Luka and First: data pipeline, journey, assistant

**Goal:** the brain. Icarus understands the user's question, calls the right tools for real data, and returns an answer plus UI instructions.

Tasks:
1. **Live market data.** Real prices for crypto, gold and a few stocks from public APIs (pick at kickoff; check free-tier rate limits). Cache to survive rate limits on stage.
2. **Demo user data.** A synthetic user: balances, holdings, past transactions, journey stage. Make 2 profiles: brand-new user, and user with a small portfolio.
3. **Tools for the agent** (contract in section 8): get prices, history, portfolio, asset info, compare, what-if, goal math, prepare trade, highlight element, show card, log friction.
4. **Journey state.** Track where the user is: signed up, verified, deposited, first purchase. Icarus uses it to suggest the next step.
5. **Guardrails.** Enforce section 5: no advice, numbers only from tools, confirm-before-act. Refuse "what should I buy?" politely and offer safe features instead ("I can't pick for you, but I can compare gold and Bitcoin on fees and past swings").
6. **Friction log.** Log every question, confusion signal ("what does X mean"), and abandoned step. Feed Oasis's dashboard.
7. **Optional:** Tokenomist unlock alerts if their API is available.

Model choice: a strong hosted LLM with tool calling. Keep system prompt short and strict. Test the "what should I buy" refusal early.

### KP: TTS and conversation

**Goal:** Icarus sounds human, calm and clear, and the conversation feels natural by voice and text.

Tasks:
1. **Voice pipeline.** ElevenLabs for speech in and out (sponsor). Check whether ElevenLabs' conversational agent product can call our tools directly; if not, run speech-to-text, our assistant, then text-to-speech.
2. **Voice choice.** One English voice and one Thai voice. Thai quality must be checked by a Thai speaker.
3. **Conversation design.** Short answers (1 to 3 sentences by voice), plain words, one idea at a time. Spoken numbers rounded sensibly ("about 1,000 baht").
4. **Turn-taking.** Handle interruptions, "wait", "go back", switching between voice and text mid-conversation.
5. **Confirm flow by voice.** Voice can prepare an action, but confirmation is always a tap on the preview card.
6. **Credits.** Track ElevenLabs credit use; cache demo audio. Free tier is about 10 minutes a month and has no commercial rights; Starter is about US$5.
7. **Demo voice script.** Write and rehearse the exact demo lines with Oasis and the pitch.

### Oasis: app mockup and frontend

**Goal:** a believable U-topia-style app the audience recognizes, with Icarus visibly living inside it.

Tasks:
1. **App mockup.** Phone-style web app: home/balance, asset list, asset detail with chart, buy/swap screen (intentionally multi-step, like a real app), portfolio.
2. **UI element registry.** Give every important element a stable ID (section 8) so Icarus can highlight and explain it.
3. **Icarus panel.** Corner button that opens chat and voice. Text box, mic button, message list.
4. **In-place features.** Tap-to-explain on charts and numbers; "show me" highlights and arrows; preview cards with one confirm button.
5. **Live data on screen.** Prices update from Luka and First's feed.
6. **Friction dashboard.** A simple business view: top questions, confusion points, drop-off steps, language split.
7. **Demo polish.** Smooth on a phone screen and on the projector. Add a stopwatch view for the friction test.

---

## 8. How the parts connect (contracts)

Agree these names at kickoff and keep them stable.

### Agent tools (owned by Luka and First)

| Tool | Input | Output |
|---|---|---|
| `get_prices` | asset IDs | live price, 24h change |
| `get_history` | asset ID, period | price series |
| `get_portfolio` | user ID | holdings, values, fees paid |
| `get_asset_info` | asset ID | plain description, fees, how to sell, risk stats from history |
| `compare_assets` | two asset IDs | facts side by side, no verdict |
| `what_if` | asset, amount, period | historical result plus low/middle/high range |
| `goal_math` | target, date, current savings | monthly amount needed |
| `prepare_trade` | asset, amount, side | preview object (never executes) |
| `execute_trade` | preview ID | only callable after the user taps confirm in the UI |
| `highlight_element` | UI element ID, message | tells the frontend what to highlight |
| `show_card` | card type, data | tells the frontend to render a card (preview, comparison, x-ray) |
| `log_friction` | event type, screen, text | stored for the dashboard |

### Assistant reply format (to frontend and voice)

Each reply contains:
- `text`: what Icarus says (short)
- `speak`: whether to read it aloud
- `ui_actions`: list of highlight or card instructions
- `sources`: which tool calls the numbers came from (for debugging and honesty)

### UI element IDs (owned by Oasis)

Examples: `home.balance`, `asset.chart`, `asset.change24h`, `buy.amount_input`, `buy.fee_line`, `buy.confirm_button`, `swap.from_asset`, `swap.to_asset`, `portfolio.allocation`.

### Voice (owned by KP)

Voice input becomes text into the same assistant. Assistant `text` goes out to TTS when `speak` is true. One pipeline for voice and text, so behavior is identical.

---

## 9. The demo (about 3 minutes)

**The friction test is the heart of the demo: it proves the problem statement live.**

1. **Hook (15 s):** "68% of people quit a finance app before they finish signing up. Robinhood built an AI to fix that, for Robinhood. What about everyone else?"
2. **Without Icarus (40 s):** a volunteer who's never used a crypto app gets one task: "Buy 1,000 baht of gold." Stopwatch on screen. They tap through the normal multi-step screens.
3. **With Icarus (60 s):** same task. They say "I want to put 1,000 baht in gold." Icarus explains in one sentence what gold in the app is, shows the fee, renders a preview card. One tap. Stopwatch comparison on screen.
4. **Explain anything (25 s):** volunteer taps the chart: "What does this mean?" Icarus highlights the line and explains with live data, by voice.
5. **The business view (25 s):** the friction dashboard: what people asked during the hackathon, where they got stuck.
6. **Close (15 s):** "Icarus walks your users through your app in their own words, and tells you where they get stuck. Fly without falling."

Backup: a recorded video of the full flow. If the volunteer freezes, a teammate runs it.

---

## 10. Timeline (about 24 hours; adjust to the real start)

| Hours | Luka and First | KP | Oasis |
|---|---|---|---|
| 0 to 2 | Agree tool contract; pick data APIs; synthetic users | Set up ElevenLabs; pick voices | Agree element IDs; app skeleton |
| 2 to 8 | Live prices; portfolio; explain and prepare_trade tools; strict system prompt | Voice in and out working with a stub assistant | Home, asset, buy screens with live prices |
| 8 to 14 | Journey state; compare, what-if, goal math; friction log; guardrail tests | Connect voice to real assistant; turn-taking; Thai check | Icarus panel; highlights; preview card; tap-to-explain |
| 14 to 18 | Bug fixes; test refusals | Tune voice lines; record fallback audio | Friction dashboard; stopwatch view; projector check |
| 18 to 22 | Everyone: run the friction test on 5 to 10 outsiders; fix confusion; two full rehearsals; Q&A drill | | |
| 22 to 24 | Buffer. No new features. | | |

---

## 11. Risks and fallbacks

| Risk | Fallback |
|---|---|
| U-topia's Topi AI already does this inside the app | Ask early (section 13). Reposition as Topi's in-app companion if needed |
| A judge says "this is just Robinhood Cortex" | Cortex is Robinhood-only and for active traders; Icarus is for every other app, first-week users, and gives a friction map |
| LLM gives advice or invents numbers | Strict prompt, tool-only numbers, tested refusals |
| Market API rate limits on stage | Cache; fall back to last known prices labeled "delayed" |
| Venue wifi | Local cached data plus the backup video |
| Thai voice sounds off | Demo in English; Thai as a short second example |
| ElevenLabs credits run out | Cache demo audio; consider Starter or Creator plan |
| Volunteer freezes on stage | Teammate runs the task |

---

## 12. Q&A answers to rehearse

- **"Isn't this Robinhood Cortex?"** Cortex is only for Robinhood users and built for active traders. Icarus plugs into any finance app, targets the first week where apps lose most users, lives on the app's own screens, and gives the business a friction map.
- **"U-topia already has Topi AI."** Topi gives traders signals in Telegram. Icarus lives inside the app itself, for first-time users, with voice and a friction map for the business. They work together.
- **"Can it recommend investments?"** No, on purpose. It explains, compares on facts, and calculates. If the business is licensed, Icarus can present the business's own approved picks.
- **"What if the AI gets a number wrong?"** Every number comes from a data tool, not the AI's memory, and every action needs a tap to confirm.
- **"How do you make money?"** Businesses pay, per active user or by tier. Their return: more users reaching first deposit, fewer support tickets, and the friction map.
- **"Why voice?"** New users on phones would rather ask than search menus, and local-language voice reaches users English-first tools miss.
- **"Did the agent write your code?"** Agents helped; each of us walks through our part.

---

## 13. Open questions (ask U-topia's team and organizers early)

- Is Topi AI part of the new app? What doesn't it do yet?
- What do the actual trading and investing screens look like? Can we see the app or a demo account?
- Is there a U-topia API, SDK or sandbox? Can we use their branding?
- Final team size and start time? (Sources disagree: 3 vs 4 teammates, 10:00 vs 12:00.)
- What do partner bounties require (ElevenLabs, Tokenomist, others)?
- Judging criteria, and who judges?
- How is the 1M THB split between cash and ecosystem rewards? Who owns submitted code?

---

## 14. The hackathon (reference)

- **Event:** U-Hackathon 2026, inside FLOW Summit (U-topia's official app launch), Avani Sukhumvit Bangkok, 2089 Sukhumvit Rd (BTS Punnawithi), 15 to 16 Oct 2026.
- **Schedule:** Luma says Thu 10:00 to 18:00 and Fri 10:00 to 21:00. The Thai listing says the 24-hour hack runs 12:00 Thu to 12:00 Fri, demos Friday afternoon, awards 17:00. Organizers' word wins.
- **Tracks:** AI (ours) and Web3.
- **Rules:** AI tools allowed; humans only on teams; no existing projects (pre-research fine); explain your own code.
- **Judging:** judges pick 6 finalists on merit; finalists demo; U-Center DAO members vote live for the grand prize.
- **Prizes:** pool "worth" 1,000,000 THB (cash plus ecosystem rewards, split unknown); trophies for top 3 per track; surprise partner bounty.
- **Sponsors:** DTC Group (Web3 incubator), ElevenLabs (voice AI), Tokenomist (token unlock data). Partners: Avalanche, Team1 Thailand, Contribution DAO, Yellow, HooRay!.
- **Likely in the room:** Emmanuel Quezada (U-topia founder and CEO), Kyle Kemper (President), Maya Nicks (Chief AI Officer), Sean Walsh. Maya Nicks is the key person for an AI project.
- **What judges and voters likely want (our guess):** U-topia wants a loud launch and builds that improve its app. Judges want a working demo and real depth. DAO voters want something they get in 30 seconds and feel personally.

---

## 15. U-topia (reference)

- Dubai-based; started around 2021 as a Web3 entertainment and metaverse company; now an all-in-one finance app.
- Site claims: accounts, cards and tokenized assets in one app; crypto wallet and spending wallet side by side; swap, send, receive; investing, saving and earning across digital and traditional finance; yield; non-custodial control; Visa card; multi-currency; 24/7 multi-language support.
- Other products: **Topi AI** (Telegram AI trading assistant), **U-Coin** (native token), **U-Wallet** (gasless wallet), **U-center** membership with DAO "Flow" shares (packages from US$40).
- Backers on its site: Yellow, ATS Group, Fireblocks, The Block.
- Pre-launch: no independent reviews; exact trading screens unknown.

---

## 16. How we got here (decision log)

1. Started with voice and scam-protection ideas (Brake, Say-before-you-sign); killed because banks, wallets and Whoscall already do them.
2. Explored Me at 60 (aged-voice future self plus savings); strong wow, but built on MIT's Future You.
3. Briefly planned the Web3 track; then confirmed we're registered for AI.
4. Icarus v1: live audience scam drill plus Claim Back (refund claims under Thailand's 12 Aug 2026 rule). Dropped: small scope, hard to monetize (commission on refunds looks like a recovery scam), and in-app scam detection can't see LINE or calls.
5. **Icarus v2 (current):** in-app AI guide for complex finance apps, paid by businesses.

Parked ideas (don't revive without new evidence): Me at 60, Claim Back, Eyes-free wallet, Ask a Helper, Future Us, Promise Vault, Proving Ground.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| Activation | A new user doing the first meaningful thing (first deposit, first purchase) |
| Friction | Anything that slows or confuses a user |
| Friction map | Our business dashboard of where users get stuck |
| Tool call | The assistant fetching real data or triggering an action through a defined function |
| Tokenized asset | A digital token representing a real asset like gold or a stock |
| Yield | Earning interest or rewards on what you hold |
| Swap | Exchanging one crypto asset for another |
| Non-custodial | The user holds their own keys and money, not the company |
| Token unlock | When locked tokens become sellable; can add selling pressure |
| DAO | A group that votes using tokens or shares |
| TTS / STT | Text-to-speech / speech-to-text |

---

## 18. Key sources

- Onboarding abandonment and activation stats: https://lorikeetcx.ai/articles/ai-onboarding-fintech
- Signicat 68% abandonment: https://thefintechtimes.com/?p=80907
- Robinhood Cortex review: https://algoalpha.co/blog/robinhood-cortex-review
- Robinhood Agents (Sep 2026): https://www.coindesk.com/markets/2026/09/30/robinhood-is-giving-customers-an-ai-agent-that-trades-for-them-plus-10x-crypto-bets
- Brokers with AI assistants: https://walnutinvest.com/resources/which-brokers-have-an-ai-assistant
- Haia white-label assistant: https://innowise.com/case/finance-ai-assistant/
- TradePilot chart copilot: https://chromewebstore.google.com/detail/tradepilot-ai-copilot-pin/gaclolmdghcoccildldlihilgemihgin
- U-topia: https://u-topia.com/
- Topi AI docs: https://u-topia.gitbook.io/u-topia-overview/topi-ai-your-web3-trading-assistant
- U-topia on The Block: https://the-block.com/u-topia/
- FLOW Summit: https://flowsummitbangkok.com/ | Luma: https://luma.com/lqrbtu27
- ElevenLabs voices: https://elevenlabs.io/docs/product/voices/overview
