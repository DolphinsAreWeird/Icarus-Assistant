# Risk register (pre-mortem, 16 Oct 2026)

Question asked: *it is after the awards and Icarus did not place top 3. Why?* Every answer we could think of is
below, scored **likelihood × damage** (1 to 5 each), with what we did about it. Judges get the repo, the hosted link
and the deck, and nobody from the team is there to explain.

| # | Risk | L | D | Score | What we did | Status |
|---|---|---|---|---|---|---|
| 1 | The deck link is private, so judges can't open it | 4 | 5 | 20 | The deck is private until shared from its Share menu, or exported to PDF and committed | **Needs the team**: share it, or export the PDF |
| 2 | Placeholders and loose ends on screen ("network logo", "brand logo", "photo", dollars in a baht app, John Doe vs Mint, "Demo prices · not live" with live prices, empty lists, a USDT balance the account doesn't have) | 5 | 4 | 20 | Fixed when the design loads (frontend/src/judge-copy.ts, demo-data.ts); a test checks none come back | Fixed |
| 3 | The hosted link is down, slow to wake or broken (first deploy, keys missing, cold start) | 3 | 5 | 15 | One container (Dockerfile, render.yaml), Starter plan so it never sleeps, health check, backend pre-warms its answers | **Needs the team**: create the Render service; then we test from a phone |
| 4 | A judge's vague question gets a canned or wrong answer | 4 | 4 | 16 | Prepared answers only for questions that clearly are them; vague ones go to the model with the screen context; 100-question battery read by a person | In progress |
| 5 | The README still says LIVE_DEMO_URL, or the deck says [live demo link] | 3 | 4 | 12 | Filled in as soon as the link exists | **Needs the link** |
| 6 | The AI is down or out of quota (free Gemini used up, a personal Orion key, no Groq key) and questions fail | 3 | 4 | 12 | Chain with hedging and cooldowns; plain requests need no AI at all; failure drill decides what the user sees | Drill pending |
| 7 | Icarus stops talking at every small noise | 4 | 3 | 12 | Interrupt only on sustained speech above the room's noise, with words heard | In progress |
| 8 | On an iPhone or Safari the voice or the tour doesn't play | 3 | 4 | 12 | Tour starts from a tap (browsers allow sound after a tap); captions always show; WebKit runs in the QA suite | QA running |
| 9 | The race confuses a stranger (where to start, when it stops, what the result means) | 3 | 4 | 12 | Race wording rewritten for visitors; QA path times both races | QA running |
| 10 | A judge on a phone can't find the race (the side panel is laptop only) | 3 | 3 | 9 | To check in the phone QA run | QA running |
| 11 | A deck claim the demo can't back (speed numbers measured before later changes, value estimates read as facts) | 3 | 3 | 9 | Claim ledger: every number traced to its source; estimates labelled as ours | Audit running |
| 12 | Thai answers sound wrong to a Thai judge | 3 | 3 | 9 | Thai answers flagged for a native speaker's read | **Needs KP** |
| 13 | U-Bot opens a sign-in page, so the handoff looks like a dead end | 5 | 2 | 10 | The card shows the written request and says "sign in, then paste"; the deck names the one-line change U-Bot needs | Mitigated |
| 14 | A messy repo root with planning notes (judge names, our guesses about judges) | 4 | 2 | 8 | Notes moved to docs/team-notes/ | Fixed |
| 15 | An API key in the public repo | 1 | 5 | 5 | Whole git history scanned; keys only in git-ignored .env files and the host's settings | Fixed |
| 16 | ElevenLabs credits run out and the voice turns robotic | 2 | 3 | 6 | The tour's lines ship as audio; per-visitor limits on speech | Mitigated |
| 17 | A judge clicks fast and gets "too many requests" | 2 | 3 | 6 | Limits per visitor per minute: 40 questions, 60 speech, 12 listening sessions | Mitigated |
| 18 | Market prices can't be fetched from the host's region | 2 | 3 | 6 | The backend falls back to its saved prices, labelled delayed | Check after deploy |
| 19 | The business numbers get questioned (U-topia's 130,000 users is their claim; value is our estimate) | 2 | 3 | 6 | Deck and plan say which numbers are estimates and where each comes from | Audit running |
| 20 | The tour is too long and judges skip the best parts | 3 | 2 | 6 | 55 s, skippable, replayable; the deck shows the same story | Accepted |

**Still carrying risk:** 1, 3 and 5 need the team (share or export the deck, create the hosted service, then fill in
the link). 12 needs a native Thai read.
