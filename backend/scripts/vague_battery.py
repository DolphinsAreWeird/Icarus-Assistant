"""Ask the backend the vague, open and chatty things a stranger types, and show how each was answered.

    .venv/bin/python -m scripts.vague_battery --url http://localhost:8012
    .venv/bin/python -m scripts.vague_battery --url http://localhost:8012 --out before.json

Each question starts a fresh conversation, on the screen it names (the snapshot the app's getContext()
sends with ?backend), after the earlier question it names, if any. A vague question should get a
model answer about what is on screen, or one short question back, not a canned line. The clear
requests at the end must stay instant (prepared or fastpath, no model call).

Flags, on top of judge_battery's ADVICE NUMBER LONG EMPTY ERROR:
  CANNED    a vague question answered by a prepared answer
  SLOW      a clear request that needed the model
  UNBACKED  the backend's own check found a number no data backs
"""
import argparse
import json
import time
import urllib.request

from scripts.judge_battery import flags

USER = "u_new"

# (group, lang, question, screen, earlier question in the same conversation or None)
QUESTIONS = [
    # cold, on Home
    ("vague", "en", "help", "home", None),
    ("vague", "en", "I'm confused", "home", None),
    ("vague", "en", "what is this?", "home", None),
    ("vague", "en", "explain this", "home", None),
    ("vague", "en", "what am I looking at", "home", None),
    ("vague", "en", "what is it?", "home", None),
    ("vague", "en", "is it safe?", "home", None),
    ("vague", "en", "what can I do here", "home", None),
    ("vague", "en", "how does this app work", "home", None),
    ("vague", "en", "where do I start?", "home", None),
    ("vague", "en", "I want to start investing, where do I begin", "home", None),
    ("vague", "en", "what's going on with my money", "home", None),
    ("vague", "en", "what should I know about bitcoin", "home", None),
    ("vague", "en", "is bitcoin risky?", "home", None),
    ("vague", "en", "why did gold go down?", "home", None),
    ("vague", "en", "anything interesting today?", "home", None),
    ("vague", "en", "hmm", "home", None),
    ("vague", "en", "is this good?", "home", None),
    # follow-ups in a conversation
    ("vague", "en", "tell me more", "home", "How is gold doing?"),
    ("vague", "en", "ok and?", "home", "What is Bitcoin?"),
    ("vague", "en", "what do you mean", "home", "Should I buy Bitcoin now?"),
    ("vague", "en", "is that a lot?", "home", "What are the fees?"),
    # on the Gold page (1M chart)
    ("vague", "en", "what is this?", "gold", None),
    ("vague", "en", "explain this", "gold", None),
    ("vague", "en", "help", "gold", None),
    ("vague", "en", "is it safe?", "gold", None),
    ("vague", "en", "is this good?", "gold", None),
    ("vague", "en", "why did it go down?", "gold", None),
    ("vague", "en", "what does this mean?", "gold_24h", None),
    ("vague", "en", "what's this?", "buy", None),
    # Thai
    ("vague", "th", "ทำยังไงดี", "home", None),
    ("vague", "th", "งงมาก", "home", None),
    ("vague", "th", "อันนี้คืออะไร", "home", None),
    ("vague", "th", "ช่วยหน่อย", "home", None),
    ("vague", "th", "ปลอดภัยไหม", "home", None),
    ("vague", "th", "บิตคอยน์เสี่ยงไหม", "home", None),
    ("vague", "th", "อันนี้คืออะไร", "gold", None),
    ("vague", "th", "เริ่มยังไงดี", "home", None),
    # clear requests: must stay instant
    ("clear", "en", "Buy 500 baht of bitcoin", "home", None),
    ("clear", "en", "Show me gold", "home", None),
    ("clear", "en", "How is gold doing?", "home", None),
    ("clear", "en", "What's the price of bitcoin?", "home", None),
    ("clear", "en", "Freeze my card", "home", None),
    ("clear", "en", "What does this chart mean?", "gold", None),
    ("clear", "en", "Is my money safe?", "home", None),
    ("clear", "en", "What can you do?", "home", None),
    ("clear", "en", "What is volatility?", "home", None),
    ("clear", "th", "ซื้อทองคำ 1,000 บาท", "home", None),
    ("clear", "th", "ทองวันนี้เป็นยังไง", "home", None),
]


def post(url: str, path: str, body: dict | None = None, timeout: float = 60) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url.rstrip("/") + path, data, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def snapshots(url: str) -> dict:
    """What getContext() sends with ?backend (frontend/src/demo-data.ts), on four screens, with the
    server's own prices and chart, like the app would show them."""
    bundle = post(url, f"/demo/state/{USER}")
    gold = bundle["assets"].get("XAU", {})
    chart = (gold.get("charts") or {}).get("1M") or {}
    points = chart.get("points") or []
    base = {"language": "en", "currency": "THB", "data_source": "backend_demo",
            "asset": {"id": "XAU", "name": "Gold", "price_thb": gold.get("price_thb")}, "period": "1M",
            "chart": {"start": float(points[0]["price"]), "end": float(points[-1]["price"]), "currency": "THB"}
            if points else None, "buy": None,
            "portfolio": {"value_thb": 0, "cash_thb": bundle["cash_thb"]}, "display_version": chart.get("display_version")}
    fee = max(round(1000 * bundle["fees"]["trading_fee_pct"] / 100, 2), bundle["fees"]["min_fee_thb"])
    return {
        "home": base | {"screen": "home", "label": "Home", "screen_revision": "screen-1"},
        "gold": base | {"screen": "asset", "label": "Gold · 1M chart", "screen_revision": "screen-2"},
        "gold_24h": base | {"screen": "asset", "label": "Gold · 1M chart", "screen_revision": "screen-2",
                            "focus": "asset.change24h"},
        "buy": base | {"screen": "buy", "label": "Buy Gold · amount", "screen_revision": "screen-3",
                       "buy": {"amount_thb": 1000 - fee, "fee_thb": fee, "total_thb": 1000,
                               "est_qty": round((1000 - fee) / (gold.get("price_thb") or 1), 8), "wallet": "thb"}},
    }


def ask(url: str, text: str, lang: str, snap: dict, session: str) -> tuple[dict | None, str | None]:
    body = {"user_id": USER, "session_id": session, "text": text, "lang": lang, "input_mode": "text",
            "snapshot": snap | {"language": lang}}
    try:
        return post(url, "/chat", body), None
    except Exception as e:  # noqa: BLE001  an error is a result too
        return None, f"{type(e).__name__}: {e}"[:120]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8012")
    ap.add_argument("--out", help="write the results here as JSON")
    ap.add_argument("--only", help="ask only questions containing this text")
    args = ap.parse_args()
    snaps = snapshots(args.url)
    results, stamp = [], int(time.time())
    for i, (group, lang, q, screen, before) in enumerate(QUESTIONS):
        if args.only and args.only.lower() not in q.lower():
            continue
        session = f"vague{stamp}x{i}"
        if before:
            ask(args.url, before, lang, snaps[screen], session)
        t = time.perf_counter()
        reply, error = ask(args.url, q, lang, snaps[screen], session)
        secs = time.perf_counter() - t
        d = (reply or {}).get("debug") or {}
        f = ["ERROR"] if error else flags(q, reply)
        route = d.get("route", "?")
        if group == "vague" and route == "prepared":
            f.append("CANNED")
        if group == "clear" and route not in ("prepared", "fastpath"):
            f.append("SLOW")
        if d.get("unbacked_numbers"):
            f.append("UNBACKED")
        text = error or (reply.get("text") or "").replace("\n", " ")
        where = screen + (f" after {before!r}" if before else "")
        who = d.get("prepared") or d.get("intent") or (f"{d.get('model')} x{d.get('model_calls')}" if d.get("model") else "")
        print(f"{secs:5.1f}s {route:9} {str(who)[:18]:18} {' '.join(f):16} [{where}] {q!r} -> {text}", flush=True)
        results.append({"group": group, "lang": lang, "question": q, "screen": screen, "before": before,
                        "seconds": round(secs, 2), "route": route, "answer": d.get("prepared") or d.get("intent"),
                        "model_calls": d.get("model_calls"), "model": d.get("model"), "flags": f, "reply": text,
                        "unbacked": d.get("unbacked_numbers"), "ui_actions": (reply or {}).get("ui_actions")})
    vague = [r for r in results if r["group"] == "vague"]
    clear = [r for r in results if r["group"] == "clear"]
    if vague:
        secs = sorted(r["seconds"] for r in vague)
        print(f"\nvague: {len(vague)}, canned {sum('CANNED' in r['flags'] for r in vague)}, "
              f"model {sum(r['route'] == 'model' for r in vague)}, median {secs[len(secs) // 2]:.1f}s, "
              f"slowest {secs[-1]:.1f}s")
    if clear:
        print(f"clear: {len(clear)}, instant {sum(r['route'] in ('prepared', 'fastpath') for r in clear)}, "
              f"slowest {max(r['seconds'] for r in clear):.2f}s")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
