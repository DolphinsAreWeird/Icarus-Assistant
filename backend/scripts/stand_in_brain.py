"""Run the real API with a stand-in for the model: simple rules, no LLM, no Ollama, no API key.

For checking the app and the voice against the backend when no model is around. Everything else is real:
tools, prices, previews, confirms, errors. Run from backend/:

    OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain              # port 8000
    OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain --port 8010

It understands four things, enough to see every kind of reply on screen:
  "put 1,000 baht in gold"           prepare_trade: opens the asset, shows the trade card (confirm is a tap)
  "show me bitcoin"                  show_asset
  "how did bitcoin do this year?"    show_chart (two or three assets named: a comparison in %)
  "how do I buy?"                    show_steps (topics in data/howto.json)
Nothing else.
Added by the voice side (KP) for integration tests. Not for the demo.
"""
import argparse
import json
import re

import uvicorn

from app.config import OFFLINE
from app.main import create_app

PERIODS = [("1D", r"today|วันนี้"), ("1W", r"week|สัปดาห์"), ("1M", r"month|เดือน"), ("3M", r"3 months|three months"),
           ("ALL", r"all time|three years|3 years"), ("1Y", r"year|ปี")]
TOPICS = [("freeze_card", r"freeze|lock"), ("hide_balance", r"hide"), ("read_chart", r"chart"), ("swap", r"swap"),
          ("check_portfolio", r"portfolio|what i own|holdings"), ("buy", r"buy|ซื้อ")]
# Our data ids (backend/data/assets.json). The tools also take the app's ids (XAU, BTC, ETH).
ASSETS = [("gold", r"gold|ทอง"), ("btc", r"bitcoin|btc|บิทคอยน์|บิตคอยน์"), ("eth", r"ethereum|eth\b|อีเธอเรียม")]


class StandInModel:
    provider, model = "stand-in", "rules (no LLM)"

    def complete(self, messages, tools):
        last = messages[-1]
        if last["role"] == "tool":
            result = json.loads(last["content"])
            data = result.get("data", result)  # data tools wrap their result in an envelope
            if data.get("ok") and "fee_thb" in data:
                pay = data.get("you_pay_thb", data.get("amount_thb"))
                return {"role": "assistant", "content": f"Here's your preview. You pay {pay:,.0f} baht and the fee is "
                        f"{data['fee_thb']:,.2f} baht. Tap Confirm when you're ready."}, "stop"
            if data.get("ok") and isinstance(data.get("say"), dict) and data["say"]:
                first = next(iter(data["say"].values()))  # show_chart: {asset: {"change": "up about 30%", ...}}
                change = first.get("change") if isinstance(first, dict) else None
                return {"role": "assistant", "content": f"It went {change}." if change else "Here it is."}, "stop"
            if data.get("ok"):
                return {"role": "assistant", "content": data.get("done") or "Here it is."}, "stop"
            reason = data.get("message") or data.get("reason") or "unknown reason"
            return {"role": "assistant", "content": f"I couldn't do that: {reason}."}, "stop"
        text = next(m for m in reversed(messages) if m["role"] == "user")["content"]
        amount = re.search(r"(\d[\d,]*)\s*(?:baht|บาท)", text, re.I)
        asset = next((a for a, pattern in ASSETS if re.search(pattern, text, re.I)), None)
        if amount and asset:
            return self._call("prepare_trade", {"asset_id": asset, "side": "buy",
                                                "amount_thb": float(amount.group(1).replace(",", ""))})
        named = [a for a, pattern in ASSETS if re.search(pattern, text, re.I)]
        if named and re.search(r"how did|how has|perform|compare|vs\.?|versus|ผลตอบแทน|เทียบ", text, re.I):
            period = next((p for p, pattern in PERIODS if re.search(pattern, text, re.I)), "1Y")
            return self._call("show_chart", {"asset_ids": named[:3], "period": period})
        if re.search(r"how (do|can) i|step by step|ทำยังไง|ยังไง", text, re.I):
            topic = next((t for t, pattern in TOPICS if re.search(pattern, text, re.I)), "buy")
            return self._call("show_steps", {"topic": topic})
        if asset and re.search(r"show|open|take me|ดู|เปิด", text, re.I):
            return self._call("show_asset", {"asset_id": asset})
        return {"role": "assistant", "content": "I'm the stand-in brain. I can only prepare a buy, like "
                "\"put 1,000 baht in gold\", or open an asset, like \"show me gold\"."}, "stop"

    @staticmethod
    def _call(name, args):
        return {"role": "assistant", "content": "", "tool_calls": [
            {"id": "stand_in_1", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}, "tool_calls"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    port = parser.parse_args().port
    print(f"Icarus backend with the STAND-IN model (rules, no LLM) on http://localhost:{port}")
    uvicorn.run(create_app(llm=StandInModel(), offline=OFFLINE, poll=not OFFLINE),
                host="127.0.0.1", port=port, log_level="warning")
