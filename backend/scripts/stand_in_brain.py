"""Run the real API with a stand-in for the model: simple rules, no LLM, no Ollama, no API key.

For checking the app and the voice against the backend when no model is around. Everything else is real:
tools, prices, previews, confirms, errors. Run from backend/:

    OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain              # port 8000
    OFFLINE=1 .venv/bin/python -m scripts.stand_in_brain --port 8010

It understands two things: "<amount> baht ... gold / bitcoin / ethereum" (sets up the buy on the app's screens,
stops at Confirm purchase) and "show me gold / bitcoin / ethereum" (opens the asset). Nothing else.
Added by the voice side (KP) for integration tests. Not for the demo.
"""
import argparse
import json
import re

import uvicorn

from app.config import OFFLINE
from app.main import create_app

ASSETS = [("XAU", r"gold|ทอง"), ("BTC", r"bitcoin|btc|บิทคอยน์|บิตคอยน์"), ("ETH", r"ethereum|eth\b|อีเธอเรียม")]


class StandInModel:
    provider, model = "stand-in", "rules (no LLM)"

    def complete(self, messages, tools):
        last = messages[-1]
        if last["role"] == "tool":
            result = json.loads(last["content"])
            if result.get("ok"):
                return {"role": "assistant", "content": result.get("done") or "Done."}, "stop"
            return {"role": "assistant", "content": f"I couldn't do that: {result.get('message', 'unknown reason')}."}, "stop"
        text = next(m for m in reversed(messages) if m["role"] == "user")["content"]
        amount = re.search(r"(\d[\d,]*)\s*(?:baht|บาท)", text, re.I)
        asset = next((a for a, pattern in ASSETS if re.search(pattern, text, re.I)), None)
        if amount and asset:
            return self._call("prepare_buy", {"asset_id": asset, "amount_thb": float(amount.group(1).replace(",", ""))})
        if asset and re.search(r"show|open|take me|ดู|เปิด", text, re.I):
            return self._call("show_asset", {"asset_id": asset})
        return {"role": "assistant", "content": "I'm the stand-in brain. I can only set up a buy, like "
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
