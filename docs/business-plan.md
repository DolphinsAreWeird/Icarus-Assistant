# Icarus business plan

Draft, night of 15 Oct 2026. Every table below comes from [`cost_model.py`](cost_model.py): change an assumption there and run `python3 docs/cost_model.py --update` to rewrite the tables here. [`pricing-calculator.html`](pricing-calculator.html) is the same model with sliders. Assumptions that are ours (not a price list) are marked as ours. Prices were checked on 15 Oct 2026; sources are at the end.

## 1. The short version

- **Who pays:** finance apps. Users never pay. First partner: U-topia.
- **What it costs us to run Icarus for one partner app:** the team (150,000 THB a month), servers (about 15,000 THB), plus usage. Usage is small: about **0.19 THB per question** (the model about 0.10, voice about 0.09 on average). Most of the cost is the team: 88% of it for a 10,000-user app, 62% at 130,000 users, 44% at 300,000.
- **How many machines:** **no GPU of our own.** The model, **Qwen3.8-27B** (the current 27B Qwen, released 14 Aug 2026), runs on a pay-per-token API, plus two small app servers. Two dedicated H100 GPUs would cost about 196,000 THB a month, and at these prices they never beat the API: a GPU sized for the evening peak sits idle most of the day. We rent GPUs only for a partner that needs its data kept in Thailand. Section 3.
- **The price you asked for** (our full cost plus a 20% margin, all charged to U-topia): **214,000 to 424,000 THB a month**, depending on how many people use the app. At U-topia's claimed size (130,000 monthly users, not verified) it is **300,733 THB a month** (about US$9,000).
- **Is that viable?** Only if U-topia has at least about **61,000 monthly active users**. Then Icarus is worth more to them than it costs (about 1.8 times at 130,000 users). Below that, the team cost is too big for one app to carry. U-topia's real size is unknown (its site says "Join thousands" and the app relaunches this week), so betting the business on one price for one partner is risky.
- **What we recommend instead:** sell the same product to several finance apps at **2 THB per active user per month** (1.5 THB above 200,000 users, minimum 49,000 THB, 4 questions per user included). The partner gets back about 2 times what it pays. **A 20% margin needs about 162,000 paying users across all partners**: U-topia's claimed size plus one 30,000-user app is 19%, plus three such apps is 33%. Section 6.

## 2. Who pays and why

Icarus is sold to the business. Its users never pay (context.md). The business buys three things it can measure:

1. **Fewer support contacts.** "What does this mean?" is answered on the spot, in Thai or English, by text or voice.
2. **More new users reach a first deposit.** 68% of people have abandoned a finance app during onboarding (Signicat 2022). Fintech activation sits near 5% (Agile Growth Labs 2025). 70% of financial institutions lost clients to slow onboarding (Fenergo 2025).
3. **The friction map.** Every question is logged as a signal of where users get stuck. No competitor in our list sells this.

The value side is in section 5. All three are measured by the friction map itself, so the pilot can prove them with the partner's own numbers.

## 3. What it costs to run

### The parts

| Part | What we use | Price basis |
|---|---|---|
| Team | 4 people building and running Icarus | **150,000 THB a month** (given). That is 4 x 37,500 THB, the Thai median software-engineer salary (JobsDB, Oct 2026) |
| The model | **Qwen3.8-27B**, dense, Apache-2.0, tool calling, Thai supported. "Thinking" switched off (it is on by default and multiplies cost and delay). The laptop demo runs Qwen3-Coder-30B-A3B in Ollama | API: US$0.50 per million tokens in, 0.10 cached, 3.00 out (Alibaba Model Studio, Singapore, the model's maker) |
| Speech in | ElevenLabs Scribe v2 Realtime | US$0.47 an hour of audio (with keyterms) |
| Speech out | ElevenLabs Flash v2.5 (English), v4 Turbo (Thai) | US$0.04 per 1,000 characters |
| Servers | voice server, backend, database, logs | about 15,000 THB a month (our estimate) |

### How much people use it (our assumptions, per partner)

- 25% of the app's monthly active users ask Icarus something.
- Each of them asks about 12 questions a month (3 sessions of 4).
- 30% of questions are spoken. Each spoken question streams about 15 s of audio and gets about 180 characters back.
- One question is one turn of the backend's tool loop: about 2.5 model calls, 8,750 tokens in (most of it the same prompt every time, so 60% of it is cached) and 250 out.

That is **3 questions per monthly active user per month**.

### How many machines

<!-- model:instances -->
| | Pilot (10,000 MAU) | Launch (50,000 MAU) | Claimed size (130,000 MAU) | Scale (300,000 MAU) |
|---|---|---|---|---|
| Questions a month | 30,000 | 150,000 | 390,000 | 900,000 |
| Busiest-hour questions a second | 0.03 | 0.14 | 0.38 | 0.87 |
| On the API: our GPUs | 0 | 0 | 0 | 0 |
| On the API: model cost, THB/month | 3,047 | 15,235 | 39,610 | 91,408 |
| Dedicated: H100 80GB (FP8) GPUs | 2 | 2 | 2 | 2 |
| Dedicated: model cost, THB/month | 195,588 | 195,588 | 195,588 | 195,588 |
| App servers (voice server, backend) | 2 small | 2 small | 2 small | 2 small |

One H100 80GB (FP8) at 60% load in the busiest hour carries about 622,080 questions a month (about 207,360 active users). Below that, the second GPU is only a spare. At these prices **dedicated GPUs never cost less than the API**: traffic peaks in the evening, so a GPU sized for the busiest hour sits mostly idle, while the API charges only for what is used.
<!-- /model:instances -->

Where the GPUs would come from, if a partner needs them:

- **Fit:** one H100 80GB runs the official FP8 weights (31 GB) with room for about 130 requests at once. At our prompt size that is about 1 question a second with the first word in half a second or less. This is an estimate scaled from H200 benchmarks: nobody has published an H100 load test of this model yet. Run one before signing anything.
- **Price:** we plan at US$3.99 an hour (RunPod's current H100 list price). Specialist clouds charge US$2.20 to 4.50, and prices rose through 2026. The big clouds near Thailand charge US$6 to 9.50 (AWS Jakarta, Azure Singapore, on a 1-year term or on demand).
- **In Thailand:** AWS's Thailand region and Google Cloud Bangkok have **no GPUs**. Siam AI Cloud and GreenNode list H100s at about US$2.69 an hour in Thailand (older pages, ask for a quote). That is where a partner's data would stay in the country.
- **A cheaper spare:** one GPU plus the API as the fallback, instead of two GPUs.

## 4. The price you asked for: full cost plus 20%, charged to U-topia

"150,000 THB for the team, the token cost on top, and a 20% profit margin." The margin is on the price (price = cost / 0.8). As a 20% markup on cost instead, each price below would be 4% lower.

**With the model on the pay-per-token API (our recommendation at these sizes):**

<!-- model:api -->
| | Pilot (10,000 MAU) | Launch (50,000 MAU) | Claimed size (130,000 MAU) | Scale (300,000 MAU) |
|---|---|---|---|---|
| Questions to Icarus per month | 30,000 | 150,000 | 390,000 | 900,000 |
| of which by voice | 9,000 | 45,000 | 117,000 | 270,000 |
| Model runs on | API (Alibaba, Singapore) | API (Alibaba, Singapore) | API (Alibaba, Singapore) | API (Alibaba, Singapore) |
| Team (operations), THB | 150,000 | 150,000 | 150,000 | 150,000 |
| Model (tokens or GPUs), THB | 3,047 | 15,235 | 39,610 | 91,408 |
| Voice (speech in and out), THB | 2,767 | 13,837 | 35,976 | 83,023 |
| Servers and tools, THB | 15,000 | 15,000 | 15,000 | 15,000 |
| **Total cost, THB/month** | 170,814 | 194,072 | 240,587 | 339,431 |
| **Price at 20% margin, THB/month** | 213,518 | 242,590 | 300,733 | 424,288 |
| Profit, THB/month | 42,704 | 48,518 | 60,147 | 84,858 |
| Price per monthly active user, THB | 21.35 | 4.85 | 2.31 | 1.41 |
| Price per conversation, THB | 28.47 | 6.47 | 3.08 | 1.89 |
<!-- /model:api -->

**With two dedicated GPUs (only if the partner needs its own machines):**

<!-- model:gpu -->
| | Pilot (10,000 MAU) | Launch (50,000 MAU) | Claimed size (130,000 MAU) | Scale (300,000 MAU) |
|---|---|---|---|---|
| Questions to Icarus per month | 30,000 | 150,000 | 390,000 | 900,000 |
| of which by voice | 9,000 | 45,000 | 117,000 | 270,000 |
| Model runs on | 2 x H100 80GB (FP8) | 2 x H100 80GB (FP8) | 2 x H100 80GB (FP8) | 2 x H100 80GB (FP8) |
| Team (operations), THB | 150,000 | 150,000 | 150,000 | 150,000 |
| Model (tokens or GPUs), THB | 195,588 | 195,588 | 195,588 | 195,588 |
| Voice (speech in and out), THB | 2,767 | 13,837 | 35,976 | 83,023 |
| Servers and tools, THB | 15,000 | 15,000 | 15,000 | 15,000 |
| **Total cost, THB/month** | 363,355 | 374,425 | 396,564 | 443,610 |
| **Price at 20% margin, THB/month** | 454,194 | 468,031 | 495,705 | 554,513 |
| Profit, THB/month | 90,839 | 93,606 | 99,141 | 110,903 |
| Price per monthly active user, THB | 45.42 | 9.36 | 3.81 | 1.85 |
| Price per conversation, THB | 60.56 | 12.48 | 5.08 | 2.46 |
<!-- /model:gpu -->

What the numbers say:

- **The team cost dominates.** At 130,000 users, usage (model and voice) is about 76,000 THB of the 241,000 THB cost.
- **Per user it is cheap at scale.** 2.31 THB (about US$0.07) per active user per month at 130,000 users. A digital adoption tool like Userpilot costs about US$0.15 per active user on its Starter plan; Pendo's median contract is US$48,500 a year.
- **Per conversation it is very cheap.** 3.08 THB (about US$0.09). AI support agents charge US$0.99 per resolution (Intercom Fin), US$1.50 to 2.00 (Zendesk) or US$2 per conversation (Salesforce Agentforce).
- **For a small app it is expensive.** At 10,000 users the same formula asks 21 THB per user per month, because the whole team cost lands on one small partner.

## 5. Is it viable for U-topia?

What Icarus is worth to the partner each month, against the price above (our assumptions, to be measured in the pilot):

- **Support:** 1 in 10 Icarus conversations would otherwise have become a support contact, at 43 THB each (a Thai call-centre operator's median pay of 21,500 THB a month, about 800 contacts a month, times 1.6 for supervision and tools; Gartner's global figure is far higher, US$13.50 a contact).
- **Activation:** new sign-ups each month equal 15% of active users, and Icarus moves 1 more in 100 of them to a first deposit, worth 600 THB of first-year profit each.

<!-- model:value -->
| | Pilot | Launch | Claimed size | Scale |
|---|---|---|---|---|
| Support contacts avoided, THB | 32,250 | 161,250 | 419,250 | 967,500 |
| Extra first deposits, THB | 9,000 | 45,000 | 117,000 | 270,000 |
| **Value to the partner, THB/month** | 41,250 | 206,250 | 536,250 | 1,237,500 |
| Full-cost price (API), THB/month | 213,518 | 242,590 | 300,733 | 424,288 |
| **Value / price** | **0.2x** | **0.9x** | **1.8x** | **2.9x** |

Break-even: the full-cost price pays for itself for an app with at least **61,000 monthly active users** (model on the API), or 120,000 with two dedicated GPUs.
<!-- /model:value -->

**Verdict.** The price you asked for is fair and competitive **if U-topia has at least about 61,000 active users**: it then pays for itself, and at 130,000 users it returns about 1.8 times its cost. It is **not viable at pilot size**, and U-topia's size is not confirmed. Charging one partner the whole team cost also means the business ends the day that partner leaves. So we keep the formula as the most U-topia would ever pay, and sell per user to several apps.

## 6. The pricing we recommend

### Per active user, with fair use

**2 THB per monthly active user per month**, 1.5 THB for users above 200,000, minimum 49,000 THB. It includes 4 questions per active user per month on average across the app (we expect 3); each extra question costs 0.30 THB. At our value estimate (about 4.1 THB per user a month) the partner keeps about half the value, so it still wins if we are wrong by half.

<!-- model:listprice -->
| | Pilot (10,000 MAU) | Launch (50,000 MAU) | Claimed size (130,000 MAU) | Scale (300,000 MAU) |
|---|---|---|---|---|
| **Our list price, THB/month** | **49,000** | **100,000** | **260,000** | **550,000** |
| Per active user, THB | 4.90 | 2.00 | 2.00 | 1.83 |
| Worth to the partner, THB/month | 41,250 | 206,250 | 536,250 | 1,237,500 |
| **Partner gets back** | **0.8x** | **2.1x** | **2.1x** | **2.2x** |
| Our usage cost (model and voice), THB/month | 5,814 | 29,072 | 75,587 | 174,431 |
| Left for the team and profit, THB/month | 43,186 | 70,928 | 184,413 | 375,569 |
<!-- /model:listprice -->

How many partners we need (team and servers counted once):

<!-- model:portfolios -->
| Partner apps | Revenue, THB/month | Cost, THB/month | Profit, THB/month | Margin |
|---|---|---|---|---|
| U-topia alone (130,000) | 260,000 | 240,587 | 19,413 | 7% |
| U-topia + one 30,000-user app | 320,000 | 258,030 | 61,970 | 19% |
| U-topia + three 30,000-user apps | 440,000 | 292,916 | 147,084 | 33% |
| Five 50,000-user apps, no U-topia | 500,000 | 310,359 | 189,641 | 38% |

A 20% margin needs about **162,000 paying active users across all partners** (team and servers, 165,000 THB a month, counted once).
<!-- /model:portfolios -->

### What if we are wrong?

Each row changes one assumption from the base case.

<!-- model:sensitivity -->
| If... | Partner gets back at our list price (130,000 users) | Paying users we need for a 20% margin | Full-cost price for 130,000 users, THB | Full cost pays for itself from |
|---|---|---|---|---|
| Base case | 2.1x | 162,000 | 300,733 | 61,000 users |
| Icarus is worth half what we think | 1.0x | 162,000 | 300,733 | 155,000 users |
| Twice the questions per user | 2.8x | 180,000 | 395,216 | 35,000 users |
| Twice as many spoken questions | 2.1x | 249,000 | 345,704 | 68,000 users |
| Token prices double | 2.1x | 271,000 | 350,246 | 69,000 users |
| The team is paid market rates (280,000 THB) | 2.1x | 348,000 | 463,233 | 109,000 users |
<!-- /model:sensitivity -->

What to watch: voice and token prices move the number of paying users we need more than anything except our own salaries. The levers in section 7 answer the first two; the third is a growth question.

### On top of the per-user price

1. **Setup fee, 150,000 to 300,000 THB once.** Mapping the partner's screens and buttons (like `backend/data/app_ui.json`), their glossary and fees, the Thai review of every fixed line, and connecting their data.
2. **Launch-partner pilot for U-topia.** Three months at half price (1 THB per active user, minimum 49,000 THB) plus the setup fee, in return for a case study and permission to use anonymous friction numbers. At 130,000 users that is 130,000 THB a month against our cost of about 241,000: about 110,000 THB a month is what the first partner costs us, partly paid back by the setup fee. After three months, the full per-user price, never above the full-cost formula in section 4.
3. **Outcome option: 25 THB for each new user who makes a first deposit within 7 days of talking to Icarus**, at a lower per-user rate, with a monthly cap. It lowers the partner's risk and pays us when they win. Measured by the friction map, and **never** tied to trading volume (see below).
4. **Friction map on its own: 30,000 THB a month** for apps that want the analytics before the assistant.

### What we will never charge for

- **Users.** Icarus is free for them (context.md).
- **Trading volume or commissions.** A fee per trade would give the assistant a reason to push trades. That breaks hard rule 1 (no advice) and would look like an inducement to a regulator.
- **Selling user data.** The friction map is the partner's own data, shown to the partner only.

## 7. Cutting the cost

- **A cheaper API host for the same model.** DeepInfra charges US$0.20 in, 0.05 cached, 2.50 out for Qwen3.8-27B, against the 0.50 / 0.10 / 3.00 we planned with. Same weights, about half the model line (US$0.0016 a question against 0.0030).
- **A smaller model for simple turns.** Qwen3.6-35B-A3B (a mixture of experts, 3 billion parameters active per token) serves 2 to 3 times more per GPU, and costs US$0.10 in and 0.95 out on DeepInfra. Send "what does this mean?" turns there and keep the 27B for buys and comparisons.
- **Pay per token until a partner needs its own machines** (section 3).
- **Voice:** the ElevenLabs Startup Grant gives 12 months free and 33 million characters to companies under 25 people, enough for about 180,000 spoken answers. After that, Azure's Thai neural voices cost US$15 per million characters against ElevenLabs' US$40.
- **Cache the fixed lines.** Greetings, read-back phrases and refusals are pre-generated once (`voice/demo-audio`).
- **Voice is opt-in.** Text answers cost no speech.
- **Later, Thai speech we host ourselves:** typhoon-asr-realtime (speech to text, runs on an ordinary CPU, CC-BY-4.0), Pathumma-F5-TTS (text to speech, MIT licence). To test, not to promise.
- **Cloud credits** for startups (AWS Activate, Google for Startups, NVIDIA Inception): amounts vary, apply anyway.

## 8. Questions a judge will ask

| Question | Our answer |
|---|---|
| "What if U-topia is small?" | Then the full-cost price does not pay for itself (section 5), so U-topia starts on the pilot and the per-user price. The business is sized for about 162,000 paying users across several apps, not one partner. |
| "Why would they pay when U-Bot exists?" | U-Bot is a general assistant for payments and shopping. Icarus lives on the app's own screens for first-week users, sets up buys on those screens with an exact read-back, and gives the business the friction map. We hand U-Bot what it does best (travel, rides, groceries). |
| "Can it recommend investments?" | No, on purpose. It explains, compares on facts and calculates. A licensed partner can show its own approved picks. |
| "Isn't the model a cost risk?" | The model is about 0.10 THB a question. If token prices doubled we would need about 271,000 paying users instead of 162,000 for a 20% margin, or we move to the cheaper host or the smaller model (section 7). |
| "Why not your own GPUs?" | A GPU sized for the busiest hour sits idle most of the day; the API charges only for what is used. We rent GPUs, in Thailand, when a partner needs its data kept there. |
| "What about Thai?" | Thai voice is on ElevenLabs v4 Turbo (Flash does not speak Thai). iApp measured Qwen3.8-27B at 0.82 on OpenThaiEval. Every Thai line is marked for review by a Thai speaker. Scribe's Thai accuracy is rated "Good" (10 to 20% word error), so typing stays available. |
| "Where does the data go?" | U-topia's own policy says it processes data in the US. For Thai-regulated partners we can run the model on GPUs in Thailand. Under the PDPA, keeping data on an overseas server no third party can access is not a transfer. |

## 9. Rules we already follow

- **Bank of Thailand AI risk guidelines (Sep 2025):** tell users they are talking to AI, give a way to reach staff, ground answers in the firm's own data. Icarus labels itself, hands off to people or U-Bot, and every number comes from a tool or the screen.
- **SEC Thailand:** paid advice on digital assets is a licensed activity. Icarus gives no advice (hard rule 1).
- **PDPA:** personal data stays with the partner's systems. The friction map shows patterns, not people.
- **Voice is never approval.** Every purchase is confirmed by a tap (hard rule 4).

## 10. The next 12 months

| When | What | Money |
|---|---|---|
| Month 0 to 3 | U-topia pilot. Measure contacts avoided and first deposits with the friction map. | Half price plus setup. The pilot is our customer-acquisition cost |
| Month 3 to 6 | One or two more Thai finance or crypto apps (3.13 million crypto investor accounts in Thailand, SEC, July 2026). | About 162,000 paying users across partners for a 20% margin |
| Month 6 to 12 | Five partners. GPUs in Thailand only if a partner needs them. | 33 to 38% margin with four or five partners (section 6) |

## Sources

Checked on 15 Oct 2026. "Article" means a news, benchmark or vendor-comparison page, not the company's own.

**Model and GPUs**

- Qwen3.8-27B: [release](https://github.com/QwenLM/Qwen3.8) (14 Aug 2026), [model card and config](https://huggingface.co/Qwen/Qwen3.8-27B) (dense, 27.8B, Apache-2.0, thinking on by default), [FP8 weights](https://huggingface.co/Qwen/Qwen3.8-27B-FP8), [vLLM recipe](https://recipes.vllm.ai/Qwen/Qwen3.8-27B). Thai scores: [iApp OpenThai2.0](https://huggingface.co/iapp/openthai2.0-qwen3.8-27b) (their own figures).
- Throughput: [SGLang benchmarks on H200](https://github.com/sgl-project/sglang/issues/41938) (article, Oct 2026), [Millstone inference benchmarks](https://www.millstoneai.com/inference-benchmark/qwen3-5-27b-fp8-1x-h100-sxm) for the 27B and 35B-A3B on H100 (article). Our "about 1 question a second per H100" is scaled from these.
- GPUs in the region: [AWS GPU regions](https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html) and price lists, [Google Cloud GPU regions](https://docs.cloud.google.com/compute/docs/gpus/gpu-regions-zones), [Azure retail prices](https://prices.azure.com/api/retail/prices).
- GPU rental: [RunPod](https://www.runpod.io/pricing), [Lambda](https://lambda.ai/pricing), [Nebius](https://nebius.com/prices), [CoreWeave](https://www.coreweave.com/pricing), [DeepInfra](https://deepinfra.com/pricing), [Siam AI Cloud](https://siam.ai/nvidia-hseries/) (older page). Price rises in 2026: [Spheron on Nebius](https://www.spheron.network/blog/nebius-gpu-price-hike-2026-h100-to-b300-rates-rise-up-to-21/) (article).
- API prices: [Alibaba Model Studio](https://www.alibabacloud.com/help/en/model-studio/model-pricing), [DeepInfra Qwen3.8-27B](https://deepinfra.com/Qwen/Qwen3.8-27B), [OpenRouter providers](https://openrouter.ai/api/v1/models/qwen/qwen3.8-27b/endpoints).

**Voice**

- ElevenLabs prices: [pricing](https://elevenlabs.io/pricing), [API pricing](https://elevenlabs.io/pricing/api) (Flash v2.5 and v4 Turbo US$0.04 per 1,000 characters; Scribe v2 Realtime US$0.39 an hour, US$0.47 with keyterms).
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models): Flash v2.5 does not support Thai. [Speech-to-text languages](https://elevenlabs.io/docs/overview/capabilities/speech-to-text): Thai rated "Good" (10 to 20% word error rate).
- [ElevenLabs Startup Grants](https://elevenlabs.io/startup-grants): 12 months, 33 million characters, under 25 employees.
- [Azure Speech prices](https://prices.azure.com/api/retail/prices) (neural voices US$15 per million characters).
- Thai speech to host ourselves: [typhoon-asr-realtime](https://huggingface.co/typhoon-ai/typhoon-asr-realtime) (CC-BY-4.0). Pathumma-F5-TTS (NECTEC, MIT).

**Money and market**

- USD to THB 33.575: European Central Bank reference rate, 14 Oct 2026, via [Frankfurter](https://api.frankfurter.app/latest?from=USD&to=THB).
- Thai salaries (live job ads): [software engineer, median 37,500 THB](https://th.jobsdb.com/career-advice/role/software-engineer/salary), [call-centre operator, median 21,500 THB](https://th.jobsdb.com/career-advice/role/call-centre-operator/salary) (JobsDB).
- Cost per support contact, global median US$13.50 handled by a person, US$1.84 self-service: Gartner, Feb 2024, via [Kustomer](https://kustomer.com/glossary/cost-per-contact/) (article, older than a year).
- AI agent prices: [Intercom Fin](https://www.intercom.com/pricing), [Zendesk AI agents](https://www.zendesk.com/pricing/), [Salesforce Agentforce](https://www.salesforce.com/agentforce/pricing/). Adoption tools: [Userpilot](https://userpilot.com/pricing/), [Pendo median contract](https://www.vendr.com/marketplace/pendo) (Vendr, article).
- Thai crypto accounts, July 2026 (3.13 million investor accounts, 121,000 active): Thai SEC figures via [Thansettakij](https://www.thansettakij.com/finance/wealth-tech/666474) (article).
- U-topia: [privacy policy](https://u-topia.com/privacy-policy) (U-TOPIA CORP, United States; data processed in the US), [site](https://u-topia.com/) ("Join thousands"; app launch at FLOW Summit, 15 to 16 Oct 2026). The 130,000 monthly users figure is a backer's claim from Aug 2025 ([The Block](https://the-block.com/blog/2025/08/21/u-topia/), article, not verified).
- Onboarding: Signicat 2022 (68% abandoned), Agile Growth Labs 2025 (about 5% activation), Mixpanel 2025 (76% convert in 7 days), all as cited in context.md. [Fenergo, Oct 2025](https://resources.fenergo.com/newsroom/global-financial-institutions-struggle-with-rising-client-losses-and-compliance-costs-as-ai-adoption-increases-fenergo) (70% lost clients to slow onboarding).

**Rules** (summaries, not legal advice)

- Bank of Thailand AI risk management guidelines, Sep 2025: via [Tilleke & Gibbins](https://www.tilleke.com/insights/thailand-issues-ai-risk-management-guidelines-for-financial-service-providers/25/).
- SEC Thailand, digital-asset advisory services: via [Tilleke & Gibbins, 2021](https://www.tilleke.com/insights/new-digital-asset-business-requirements-for-businesses-in-thailand/21/) (older than a year).
- PDPA cross-border transfer rules, in force since Mar 2024: via [Tilleke & Gibbins](https://www.tilleke.com/insights/thailand-unveils-regulations-for-cross-border-personal-data-transfer/2/).
