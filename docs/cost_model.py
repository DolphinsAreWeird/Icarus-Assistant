"""Icarus cost model: what it costs to run Icarus for one finance-app partner, and what to charge.

Run:  python3 docs/cost_model.py            (prints the tables used in docs/business-plan.md)
      python3 docs/cost_model.py --json     (the same numbers as JSON)

Every number in the business plan comes from this file. Change an assumption here, run it again, and paste the
tables. Each assumption says where it comes from. "ASSUMPTION" means our own estimate: check it with the partner.
No external packages. Python 3.10+.
"""
import json
import math
import sys

THB_PER_USD = 33.575  # ECB reference rate, 14 Oct 2026 (Frankfurter). Same rate as backend/data/snapshots.
HOURS_PER_MONTH = 730

# ---------------------------------------------------------------- fixed costs (THB per month)
OPS_THB = 150_000  # The team's budget to run and keep building Icarus (given). = 4 engineers at the Thai median
#                    software-engineer salary of 37,500 THB (JobsDB, Oct 2026). Excludes employer costs and office.
PLATFORM_THB = 15_000  # ASSUMPTION: app servers for the voice server and backend, database, logs, monitoring, domain.

# ---------------------------------------------------------------- how people use it (per partner)
ICARUS_USERS_SHARE = 0.25  # ASSUMPTION: share of the app's monthly active users who ask Icarus something
TURNS_PER_ICARUS_USER = 12  # ASSUMPTION: questions per Icarus user per month (about 3 sessions of 4)
VOICE_SHARE = 0.30  # ASSUMPTION: share of questions asked by voice
TURNS_PER_CONVERSATION = 4  # ASSUMPTION: for per-conversation comparisons only

# One turn of the backend's tool loop (backend/app/assistant/loop.py): about 2.5 model calls of ~3,500 tokens each
# (system prompt and tool schemas ~2,500, plus context and history). Thinking OFF: Qwen3.8 thinks by default,
# which multiplies output tokens and delay.
INPUT_TOKENS_PER_TURN = 8_750
OUTPUT_TOKENS_PER_TURN = 250  # tool calls plus a short spoken answer
CACHED_INPUT_SHARE = 0.6  # ASSUMPTION: share of input tokens that are a repeated prefix (prompt caching)

# ---------------------------------------------------------------- voice (ElevenLabs list prices, Oct 2026)
STT_USD_PER_HOUR = 0.47  # Scribe v2 Realtime with keyterms (0.39 without)
STT_SECONDS_PER_VOICE_TURN = 15  # ASSUMPTION: the mic stream is open about 15 s per spoken question
TTS_USD_PER_1K_CHARS = 0.04  # Flash v2.5 (English) and v4 Turbo (Thai), same price
TTS_CHARS_PER_VOICE_TURN = 180  # ASSUMPTION: Icarus answers in 1 or 2 short sentences

# ---------------------------------------------------------------- the model: Qwen3.8-27B (dense, Aug 2026)
# Sources in docs/business-plan.md. Replace both with a quote and your own load test before signing anything.
# One H100 runs the official FP8 weights. About 2 to 3 model calls a second at our prompt size with a first token
# in 0.5 s or less, so about 1 question a second (2.5 calls each). ESTIMATE: scaled from H200 benchmarks, no H100
# load test of Qwen3.8-27B is published. Price: RunPod's current H100 list price (Thai providers list ~2.69, stale).
GPU = {"name": "H100 80GB (FP8)", "usd_per_hour": 3.99, "turns_per_second": 1.0}
GPU_TARGET_UTILISATION = 0.6  # keep headroom so voice answers stay fast at the busiest hour
PEAK_TO_AVERAGE = 2.5  # ASSUMPTION: busiest hour vs the average hour (Thai daytime and evening use)
MIN_GPUS_FOR_UPTIME = 2  # one spare, so a GPU failure does not take Icarus down
# Alibaba Cloud Model Studio, international (Singapore): the model's maker, and the dearest of the main providers
# (DeepInfra: 0.20 / 0.05 / 2.50). Cached input 0.05 to 0.10: we use 0.10.
API = {"name": "API (Alibaba, Singapore)", "usd_per_m_input": 0.50, "usd_per_m_cached_input": 0.10, "usd_per_m_output": 3.00}

MARGIN = 0.20  # profit margin on the price (price = cost / (1 - margin))

# ---------------------------------------------------------------- what Icarus is worth to the partner (per month)
# Two measurable effects. Both are ASSUMPTIONS to test in the pilot with the friction map's own data.
TICKET_SHARE = 0.10  # ASSUMPTION: 1 in 10 Icarus conversations would otherwise have become a support contact
COST_PER_CONTACT_THB = 43  # Thai call-centre operator median 21,500 THB/month (JobsDB) / ~800 contacts a month,
#                           x1.6 for supervision, tools and space. (Gartner's global median is US$13.50, far higher.)
SIGNUPS_SHARE = 0.15  # ASSUMPTION: new sign-ups per month as a share of monthly active users
ACTIVATION_UPLIFT = 0.01  # ASSUMPTION: +1 percentage point of new users reach a first deposit (base ~5%, Agile Growth Labs)
VALUE_PER_ACTIVATED_THB = 600  # ASSUMPTION: first-year gross profit from one more activated user

# Our list price (the context file: "businesses pay, per active user or by tier"): per monthly active user of the
# partner app, usage included, with a minimum. About half of what Icarus is worth per user (partner_value_thb), so
# the partner keeps roughly 2x its money even if our value estimate is too high.
PRICE_BANDS = [(200_000, 2.0), (None, 1.5)]  # 2 THB per active user up to 200,000 users, 1.5 THB for the rest
MIN_MONTHLY_FEE = 49_000
# Fair use: the per-user price includes this many questions per active user per month, on average across the app.
# Above that, each extra question costs OVERAGE_THB_PER_TURN (our cost is about 0.19 THB). Protects us if people
# use Icarus far more than we assume.
INCLUDED_TURNS_PER_MAU = 4
OVERAGE_THB_PER_TURN = 0.30

SCENARIOS = [  # monthly active users of the partner app
    ("Pilot", 10_000),
    ("Launch", 50_000),
    ("Claimed size", 130_000),  # a U-topia backer's 2025 claim (The Block, Aug 2025). Not verified.
    ("Scale", 300_000),
]


def usage(mau: int) -> dict:
    turns = mau * ICARUS_USERS_SHARE * TURNS_PER_ICARUS_USER
    voice_turns = turns * VOICE_SHARE
    return {"mau": mau, "icarus_users": mau * ICARUS_USERS_SHARE, "turns": turns, "voice_turns": voice_turns,
            "conversations": turns / TURNS_PER_CONVERSATION}


def gpus_needed(turns: float) -> int:
    average_tps = turns / (30 * 24 * 3600)
    peak_tps = average_tps * PEAK_TO_AVERAGE
    for_load = math.ceil(peak_tps / (GPU["turns_per_second"] * GPU_TARGET_UTILISATION))
    return max(MIN_GPUS_FOR_UPTIME, for_load)


def llm_cost_thb(u: dict, how: str) -> tuple[float, str]:
    if how == "gpu":
        n = gpus_needed(u["turns"])
        return n * GPU["usd_per_hour"] * HOURS_PER_MONTH * THB_PER_USD, f"{n} x {GPU['name']}"
    inp = u["turns"] * INPUT_TOKENS_PER_TURN / 1e6
    out = u["turns"] * OUTPUT_TOKENS_PER_TURN / 1e6
    usd = inp * (1 - CACHED_INPUT_SHARE) * API["usd_per_m_input"] + inp * CACHED_INPUT_SHARE * API["usd_per_m_cached_input"] \
        + out * API["usd_per_m_output"]
    return usd * THB_PER_USD, API["name"]


def voice_cost_thb(u: dict) -> float:
    stt = u["voice_turns"] * STT_SECONDS_PER_VOICE_TURN / 3600 * STT_USD_PER_HOUR
    tts = u["voice_turns"] * TTS_CHARS_PER_VOICE_TURN / 1000 * TTS_USD_PER_1K_CHARS
    return (stt + tts) * THB_PER_USD


def monthly(mau: int, how: str) -> dict:
    u = usage(mau)
    llm, llm_label = llm_cost_thb(u, how)
    voice = voice_cost_thb(u)
    cost = OPS_THB + PLATFORM_THB + llm + voice
    price = cost / (1 - MARGIN)
    return {**u, "llm_thb": llm, "llm_label": llm_label, "voice_thb": voice, "ops_thb": OPS_THB,
            "platform_thb": PLATFORM_THB, "cost_thb": cost, "price_thb": price, "profit_thb": price - cost,
            "price_per_mau_thb": price / mau, "price_per_conversation_thb": price / u["conversations"],
            "usage_cost_per_turn_thb": (llm + voice) / u["turns"]}


def partner_value_thb(mau: int) -> dict:
    u = usage(mau)
    support = u["conversations"] * TICKET_SHARE * COST_PER_CONTACT_THB
    activation = mau * SIGNUPS_SHARE * ACTIVATION_UPLIFT * VALUE_PER_ACTIVATED_THB
    return {"support_thb": support, "activation_thb": activation, "total_thb": support + activation}


def break_even_mau(how: str = "api") -> int:
    """Smallest app (monthly active users) where our cost-plus price is no more than what Icarus is worth to it."""
    mau = 1_000
    while mau < 5_000_000:
        if partner_value_thb(mau)["total_thb"] >= monthly(mau, how)["price_thb"]:
            return mau
        mau += 1_000
    return -1


def gpu_crossover_turns() -> int:
    """Questions a month above which 2 dedicated GPUs cost less than the serverless API."""
    turns = 10_000
    while turns < 50_000_000:
        u = {"turns": turns, "voice_turns": 0, "conversations": 1, "mau": 1}
        if llm_cost_thb(u, "gpu")[0] <= llm_cost_thb(u, "api")[0]:
            return turns
        turns += 10_000
    return -1


def list_price_thb(mau: int) -> float:
    """Our per-active-user price for one partner app: the bands, the minimum, and fair-use overage."""
    price, counted = 0.0, 0
    for cap, rate in PRICE_BANDS:
        users = mau - counted if cap is None else max(0, min(mau, cap) - counted)
        price += users * rate
        counted += users
    extra_turns = max(0.0, usage(mau)["turns"] - INCLUDED_TURNS_PER_MAU * mau)
    return max(MIN_MONTHLY_FEE, price) + extra_turns * OVERAGE_THB_PER_TURN


def usage_cost_thb(mau: int, how: str = "api") -> float:
    u = usage(mau)
    return llm_cost_thb(u, how)[0] + voice_cost_thb(u)


PORTFOLIOS = [  # partner apps by monthly active users. Model on the API. Team and servers counted once.
    ("U-topia alone (130,000)", [130_000]),
    ("U-topia + one 30,000-user app", [130_000, 30_000]),
    ("U-topia + three 30,000-user apps", [130_000, 30_000, 30_000, 30_000]),
    ("Five 50,000-user apps, no U-topia", [50_000] * 5),
]


def portfolio(maus: list[int]) -> dict:
    revenue = sum(list_price_thb(m) for m in maus)
    cost = OPS_THB + PLATFORM_THB + sum(usage_cost_thb(m) for m in maus)
    return {"revenue": revenue, "cost": cost, "profit": revenue - cost, "margin": (revenue - cost) / revenue}


def paying_users_for_margin(margin: float = MARGIN) -> int:
    """Active users across all partners (counted as one app, so the 1.5 THB band applies above 200,000) for the margin."""
    users = 1_000
    while users < 10_000_000:
        if portfolio([users])["margin"] >= margin:
            return users
        users += 1_000
    return -1


def fmt(n: float, digits: int = 0) -> str:
    return f"{n:,.{digits}f}"


def table(how: str) -> str:
    rows = [monthly(m, how) for _, m in SCENARIOS]
    head = "| | " + " | ".join(f"{name} ({fmt(m)} MAU)" for name, m in SCENARIOS) + " |"
    sep = "|---|" + "---|" * len(SCENARIOS)
    lines = [head, sep]
    def row(label, key, digits=0, unit=""):
        lines.append(f"| {label} | " + " | ".join(f"{fmt(r[key], digits)}{unit}" for r in rows) + " |")
    row("Questions to Icarus per month", "turns")
    row("of which by voice", "voice_turns")
    lines.append("| Model runs on | " + " | ".join(r["llm_label"] for r in rows) + " |")
    row("Team (operations), THB", "ops_thb")
    row("Model (tokens or GPUs), THB", "llm_thb")
    row("Voice (speech in and out), THB", "voice_thb")
    row("Servers and tools, THB", "platform_thb")
    row("**Total cost, THB/month**", "cost_thb")
    row("**Price at 20% margin, THB/month**", "price_thb")
    row("Profit, THB/month", "profit_thb")
    row("Price per monthly active user, THB", "price_per_mau_thb", 2)
    row("Price per conversation, THB", "price_per_conversation_thb", 2)
    return "\n".join(lines)


def break_even_partners(platform_fee_thb: float, how: str = "api") -> int:
    """How many partners paying `platform_fee_thb` cover the team and servers (usage billed on top)."""
    return math.ceil((OPS_THB + PLATFORM_THB) / platform_fee_thb)


def instances_table() -> str:
    lines = ["| | " + " | ".join(f"{name} ({fmt(m)} MAU)" for name, m in SCENARIOS) + " |", "|---|" + "---|" * len(SCENARIOS)]
    rows = [usage(m) for _, m in SCENARIOS]
    lines.append("| Questions a month | " + " | ".join(fmt(u["turns"]) for u in rows) + " |")
    lines.append("| Busiest-hour questions a second | " + " | ".join(fmt(u["turns"] / (30 * 24 * 3600) * PEAK_TO_AVERAGE, 2) for u in rows) + " |")
    lines.append("| On the API: our GPUs | " + " | ".join("0" for _ in rows) + " |")
    lines.append("| On the API: model cost, THB/month | " + " | ".join(fmt(llm_cost_thb(u, "api")[0]) for u in rows) + " |")
    lines.append(f"| Dedicated: {GPU['name']} GPUs | " + " | ".join(str(gpus_needed(u["turns"])) for u in rows) + " |")
    lines.append("| Dedicated: model cost, THB/month | " + " | ".join(fmt(llm_cost_thb(u, "gpu")[0]) for u in rows) + " |")
    lines.append("| App servers (voice server, backend) | " + " | ".join("2 small" for _ in rows) + " |")
    one_gpu = GPU["turns_per_second"] * GPU_TARGET_UTILISATION / PEAK_TO_AVERAGE * 30 * 24 * 3600
    lines.append("")
    crossover = gpu_crossover_turns()
    lines.append(f"One {GPU['name']} at {GPU_TARGET_UTILISATION:.0%} load in the busiest hour carries about {fmt(one_gpu)} questions a month "
                 f"(about {fmt(one_gpu / (ICARUS_USERS_SHARE * TURNS_PER_ICARUS_USER))} active users). Below that, the second GPU is only a spare. "
                 + (f"Dedicated GPUs cost less than the API above about **{fmt(crossover)} questions a month**." if crossover > 0 else
                    "At these prices **dedicated GPUs never cost less than the API**: traffic peaks in the evening, so a GPU sized for the "
                    "busiest hour sits mostly idle, while the API charges only for what is used."))
    return "\n".join(lines)


def value_table() -> str:
    lines = ["| | " + " | ".join(name for name, _ in SCENARIOS) + " |", "|---|" + "---|" * len(SCENARIOS)]
    vals = [partner_value_thb(m) for _, m in SCENARIOS]
    for label, key in (("Support contacts avoided, THB", "support_thb"), ("Extra first deposits, THB", "activation_thb"), ("**Value to the partner, THB/month**", "total_thb")):
        lines.append(f"| {label} | " + " | ".join(fmt(v[key]) for v in vals) + " |")
    lines.append("| Full-cost price (API), THB/month | " + " | ".join(fmt(monthly(m, 'api')['price_thb']) for _, m in SCENARIOS) + " |")
    lines.append("| **Value / price** | " + " | ".join(f"**{partner_value_thb(m)['total_thb'] / monthly(m, 'api')['price_thb']:.1f}x**" for _, m in SCENARIOS) + " |")
    lines.append("")
    lines.append(f"Break-even: the full-cost price pays for itself for an app with at least **{fmt(break_even_mau('api'))} monthly active users** "
                 f"(model on the API), or {fmt(break_even_mau('gpu'))} with two dedicated GPUs.")
    return "\n".join(lines)


def list_price_table() -> str:
    lines = ["| | " + " | ".join(f"{name} ({fmt(m)} MAU)" for name, m in SCENARIOS) + " |", "|---|" + "---|" * len(SCENARIOS)]
    lines.append("| **Our list price, THB/month** | " + " | ".join(f"**{fmt(list_price_thb(m))}**" for _, m in SCENARIOS) + " |")
    lines.append("| Per active user, THB | " + " | ".join(fmt(list_price_thb(m) / m, 2) for _, m in SCENARIOS) + " |")
    lines.append("| Worth to the partner, THB/month | " + " | ".join(fmt(partner_value_thb(m)["total_thb"]) for _, m in SCENARIOS) + " |")
    lines.append("| **Partner gets back** | " + " | ".join(f"**{partner_value_thb(m)['total_thb'] / list_price_thb(m):.1f}x**" for _, m in SCENARIOS) + " |")
    lines.append("| Our usage cost (model and voice), THB/month | " + " | ".join(fmt(usage_cost_thb(m)) for _, m in SCENARIOS) + " |")
    lines.append("| Left for the team and profit, THB/month | " + " | ".join(fmt(list_price_thb(m) - usage_cost_thb(m)) for _, m in SCENARIOS) + " |")
    return "\n".join(lines)


def portfolio_table() -> str:
    lines = ["| Partner apps | Revenue, THB/month | Cost, THB/month | Profit, THB/month | Margin |", "|---|---|---|---|---|"]
    for label, maus in PORTFOLIOS:
        p = portfolio(maus)
        lines.append(f"| {label} | {fmt(p['revenue'])} | {fmt(p['cost'])} | {fmt(p['profit'])} | {p['margin']:.0%} |")
    lines.append("")
    lines.append(f"A 20% margin needs about **{fmt(paying_users_for_margin())} paying active users across all partners** "
                 f"(team and servers, {fmt(OPS_THB + PLATFORM_THB)} THB a month, counted once).")
    return "\n".join(lines)


from contextlib import contextmanager


@contextmanager
def changed(**values):
    """Run the model with some assumptions changed, then put them back."""
    old = {k: globals()[k] for k in values}
    globals().update(values)
    try:
        yield
    finally:
        globals().update(old)


SENSITIVITY = [  # what if we are wrong? Each row changes one thing from the base case.
    ("Base case", {}),
    ("Icarus is worth half what we think", {"TICKET_SHARE": TICKET_SHARE / 2, "ACTIVATION_UPLIFT": ACTIVATION_UPLIFT / 2}),
    ("Twice the questions per user", {"TURNS_PER_ICARUS_USER": TURNS_PER_ICARUS_USER * 2}),
    ("Twice as many spoken questions", {"VOICE_SHARE": min(1.0, VOICE_SHARE * 2)}),
    ("Token prices double", {"API": {**API, "usd_per_m_input": API["usd_per_m_input"] * 2, "usd_per_m_cached_input": API["usd_per_m_cached_input"] * 2, "usd_per_m_output": API["usd_per_m_output"] * 2}}),
    ("The team is paid market rates (280,000 THB)", {"OPS_THB": 280_000}),
]


def sensitivity_table() -> str:
    lines = ["| If... | Partner gets back at our list price (130,000 users) | Paying users we need for a 20% margin | Full-cost price for 130,000 users, THB | Full cost pays for itself from |",
             "|---|---|---|---|---|"]
    for label, values in SENSITIVITY:
        with changed(**values):
            back = partner_value_thb(130_000)["total_thb"] / list_price_thb(130_000)
            need = paying_users_for_margin()
            full = monthly(130_000, "api")["price_thb"]
            be = break_even_mau("api")
        lines.append(f"| {label} | {back:.1f}x | {fmt(need) if need > 0 else 'never'} | {fmt(full)} | "
                     f"{fmt(be) + ' users' if be > 0 else 'never'} |")
    return "\n".join(lines)


BLOCKS = {"instances": instances_table, "api": lambda: table("api"), "gpu": lambda: table("gpu"), "value": value_table,
          "listprice": list_price_table, "portfolios": portfolio_table, "sensitivity": sensitivity_table}


def update(path: str) -> None:
    """Rewrite every <!-- model:NAME --> ... <!-- /model:NAME --> block in the plan with fresh numbers."""
    import re
    with open(path, encoding="utf-8") as f:
        text = f.read()
    for name, render in BLOCKS.items():
        text, n = re.subn(rf"<!-- model:{name} -->.*?<!-- /model:{name} -->", lambda _m: f"<!-- model:{name} -->\n{render()}\n<!-- /model:{name} -->", text, flags=re.S)
        if n == 0:
            print(f"warning: no block model:{name} in {path}")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"Updated {path}")


def assumptions() -> dict:
    """Every input, for the interactive calculator (docs/pricing-calculator.html embeds this)."""
    return {"thbPerUsd": THB_PER_USD, "hoursPerMonth": HOURS_PER_MONTH, "opsThb": OPS_THB, "platformThb": PLATFORM_THB,
            "icarusUsersShare": ICARUS_USERS_SHARE, "turnsPerIcarusUser": TURNS_PER_ICARUS_USER, "voiceShare": VOICE_SHARE,
            "turnsPerConversation": TURNS_PER_CONVERSATION, "inputTokensPerTurn": INPUT_TOKENS_PER_TURN,
            "outputTokensPerTurn": OUTPUT_TOKENS_PER_TURN, "cachedInputShare": CACHED_INPUT_SHARE,
            "sttUsdPerHour": STT_USD_PER_HOUR, "sttSecondsPerVoiceTurn": STT_SECONDS_PER_VOICE_TURN,
            "ttsUsdPer1kChars": TTS_USD_PER_1K_CHARS, "ttsCharsPerVoiceTurn": TTS_CHARS_PER_VOICE_TURN,
            "gpu": GPU, "gpuTargetUtilisation": GPU_TARGET_UTILISATION, "peakToAverage": PEAK_TO_AVERAGE,
            "minGpusForUptime": MIN_GPUS_FOR_UPTIME, "api": API, "margin": MARGIN, "ticketShare": TICKET_SHARE,
            "costPerContactThb": COST_PER_CONTACT_THB, "signupsShare": SIGNUPS_SHARE, "activationUplift": ACTIVATION_UPLIFT,
            "valuePerActivatedThb": VALUE_PER_ACTIVATED_THB, "priceBands": PRICE_BANDS, "minMonthlyFee": MIN_MONTHLY_FEE,
            "includedTurnsPerMau": INCLUDED_TURNS_PER_MAU, "overageThbPerTurn": OVERAGE_THB_PER_TURN,
            "scenarios": SCENARIOS}


def build_calculator(fragment_path: str | None = None) -> None:
    """docs/pricing-calculator.html (opens in any browser) from the template, with today's assumptions inside.
    With a fragment path, also write the page without the document wrapper (for publishing as an artifact)."""
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "pricing-calculator.template.html"), encoding="utf-8") as f:
        page = f.read().replace("__ASSUMPTIONS__", json.dumps(assumptions()).replace("</", "<\\/"))
    with open(os.path.join(here, "pricing-calculator.html"), "w", encoding="utf-8") as f:
        f.write('<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
                '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + page + "</html>\n")
    if fragment_path:
        with open(fragment_path, "w", encoding="utf-8") as f:
            f.write(page)
    print("Wrote docs/pricing-calculator.html" + (f" and {fragment_path}" if fragment_path else ""))


if __name__ == "__main__":
    if "--assumptions" in sys.argv:
        print(json.dumps(assumptions()))
    elif "--calculator" in sys.argv:
        i = sys.argv.index("--calculator")
        build_calculator(sys.argv[i + 1] if len(sys.argv) > i + 1 else None)
    elif "--json" in sys.argv:
        print(json.dumps({how: {name: monthly(m, how) for name, m in SCENARIOS} for how in ("gpu", "api")}, indent=2))
    elif "--update" in sys.argv:
        import os
        update(os.path.join(os.path.dirname(os.path.abspath(__file__)), "business-plan.md"))
    else:
        for name, render in BLOCKS.items():
            print(f"\n## {name}\n")
            print(render())
