"""Run the real API with a stand-in for the model: simple rules, no LLM, no Ollama, no API key.

For checking the app and the voice against the backend when no model is around. Everything else is real:
tools, prices, previews, confirms, errors. Run from backend/:

    OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain              # port 8000
    OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain --port 8010

It understands "<amount> baht ... gold / bitcoin / ethereum" (a buy preview) and nothing else.
Added by the voice side (KP) for integration tests. Not for the demo.
"""
import argparse
import json
import re

import uvicorn

from app.config import OFFLINE
from app.main import create_app

ASSETS = [("gold", r"gold|ทอง"), ("btc", r"bitcoin|btc|บิทคอยน์"), ("eth", r"ethereum|eth\b|อีเธอเรียม")]


class StandInModel:
    provider, model = "stand-in", "rules (no LLM)"

    def complete(self, messages, tools):
        last = messages[-1]
        if last["role"] == "tool":
            data = json.loads(last["content"]).get("data", {})
            if data.get("ok") and "fee_thb" in data:
                pay = data.get("you_pay_thb", data.get("amount_thb"))
                return {"role": "assistant", "content": f"Here's your preview. You pay {pay:,.0f} baht and the fee is "
                        f"{data['fee_thb']:,.2f} baht. Tap Confirm when you're ready."}, "stop"
            return {"role": "assistant", "content": f"I couldn't prepare that: {data.get('reason', 'unknown reason')}."}, "stop"
        text = next(m for m in reversed(messages) if m["role"] == "user")["content"]
        amount = re.search(r"(\d[\d,]*)\s*(?:baht|บาท)", text, re.I)
        asset = next((a for a, pattern in ASSETS if re.search(pattern, text, re.I)), None)
        if amount and asset:
            args = {"asset_id": asset, "side": "buy", "amount_thb": float(amount.group(1).replace(",", ""))}
            return {"role": "assistant", "content": "", "tool_calls": [
                {"id": "stand_in_1", "type": "function",
                 "function": {"name": "prepare_trade", "arguments": json.dumps(args)}}]}, "tool_calls"
        return {"role": "assistant", "content": "I'm the stand-in brain. I can only prepare a buy, like "
                "\"put 1,000 baht in gold\"."}, "stop"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    port = parser.parse_args().port
    print(f"Icarus backend with the STAND-IN model (rules, no LLM) on http://localhost:{port}")
    uvicorn.run(create_app(llm=StandInModel(), offline=OFFLINE, poll=not OFFLINE),
                host="127.0.0.1", port=port, log_level="warning")
