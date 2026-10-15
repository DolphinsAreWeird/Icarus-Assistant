# Icarus

**Icarus: fly without falling.**

An AI assistant that lives inside a finance app. It explains the screens, numbers and charts in plain words, and it can prepare actions like a trade, by text or by voice, in English or Thai.

> Robinhood built an AI for Robinhood. Icarus is the AI for every other finance app. It walks new users through the app in their own words, and tells the business where they got stuck.

Built for U-Hackathon 2026 (FLOW Summit, Bangkok, 15 to 16 Oct 2026), AI track. The demo app is a U-topia style crypto and investing app.

## The problem

When people open a finance app, the screens, charts and terms are hard to get into. That friction makes platforms lose users before they do anything.

- 68% of consumers have abandoned a financial services application mid-onboarding (Signicat, 2022).
- Fintech activation rates sit at about 5% (Agile Growth Labs 2025 benchmark).
- 76% of fintech users who convert do so within the first 7 days (Mixpanel 2025).

The first week decides everything, and most users quit before they understand the app.

## What the user gets

1. **Ask about anything on screen.** "What does this red number mean?" Icarus answers with the user's live data.
2. **Show me.** Icarus highlights the next button or field on the real screen.
3. **Say it instead of tapping through it.** "Put 1,000 baht in gold." Icarus turns a multi-step trade screen into one sentence and a preview card with one confirm button.
4. **Voice or text**, English or Thai.
5. **A companion, not a teacher.** Icarus remembers where the user is in their journey (signed up, deposited, first purchase) and helps with the next step.

Plus: portfolio facts, fact-based comparisons, what-if math, goal math and plain-words risk.

## What the business gets

Businesses pay. Users never do. They get more users reaching a first deposit, fewer "what does this mean?" support tickets, and a **friction map**: a dashboard of what users ask and where they get stuck. Every question is a bug report.

## Hard rules

These apply to every line of code in this repo.

1. **No personal investment advice.** Icarus explains, compares on facts, calculates and alerts. It never tells a user to buy or sell a specific asset.
2. **Confirm before every action.** Icarus prepares. The user confirms. It shows exactly what will happen: asset, amount, fees, final total.
3. **Numbers come from data, never from the LLM.** Every price, balance and percentage comes from a tool call.
4. **Voice is never login or approval.** Voice cloning makes voice unsafe for authentication. Confirmation is a tap.
5. **Be honest about the demo.** Say what is live, what is mocked and what is simulated.
6. **Event rules.** Humans only on the team, and everyone can explain their own code.

Style for anything we write: plain English, short sentences, no em dashes. Icarus talks the same way: short, calm, no jargon.

## Who builds what

| Part | Owner | Where |
|---|---|---|
| Data pipeline, user journey, the assistant (the "brain") | Luka and First | _coming_ |
| **Voice in and out, and how Icarus talks (this repo's `voice/`)** | KP | [`voice/`](voice/) |
| App mockup, frontend, friction dashboard | Oasis | _coming_ |

The parts connect through one reply format. The assistant returns `text`, `speak`, `ui_actions` and `sources`. Voice input becomes text for the same assistant, and the assistant's `text` goes to text-to-speech when `speak` is true. One pipeline for voice and text, so they behave the same.

## The demo (about 3 minutes)

A volunteer who has never used a crypto app is asked to buy 1,000 baht of gold, once with the normal screens and once with Icarus, with a stopwatch on screen. Then they tap the chart and ask what it means, by voice. Last, the friction dashboard shows what people asked and where they got stuck.

## Voice

The voice pipeline is in [`voice/`](voice/). It has its own README with setup, the module the frontend drops in, and what is mocked. Start here:

```bash
cd voice
npm install
npm run dev:fake     # works with no API key: http://localhost:8787
```
