"""Talk to Icarus in the terminal, with a real model (free: Ollama, Groq or Gemini, see app/assistant/llm.py).

Run from backend/:
  python -m scripts.chat --user u_new --screen asset_detail --asset gold --period 1m --focus asset.chart
Type a message. "confirm" taps Confirm on the last preview card. "quit" exits.
"""
import argparse
import json

from app import knowledge
from app.assistant.llm import ChatModel
from app.assistant.loop import Assistant
from app.contracts import ChatRequest, ScreenContext
from app.market.cache import PriceCache
from app.state import DemoState
from app.trades import TradeError, confirm_trade


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--user", default="u_new")
    p.add_argument("--screen", default="home")
    p.add_argument("--asset")
    p.add_argument("--period")
    p.add_argument("--focus")
    p.add_argument("--lang", choices=["en", "th"])
    args = p.parse_args()

    cache = PriceCache(knowledge.assets())
    print("price refresh:", cache.refresh() or "ok")
    state = DemoState()
    llm = ChatModel.from_env()
    print(f"model: {llm.provider}/{llm.model}")
    bot = Assistant(llm, state, cache)
    screen = ScreenContext(screen_id=args.screen, selected_asset=args.asset,
                           chart_period=args.period, focused_element=args.focus)
    last_preview = None

    while True:
        text = input("\nyou> ").strip()
        if text in ("quit", "exit"):
            return
        if text == "confirm":
            try:
                print(json.dumps(confirm_trade(state, args.user, last_preview), indent=2))
            except TradeError as e:
                print("confirm failed:", e.code)
            continue
        reply = bot.chat(ChatRequest(session_id="cli", user_id=args.user, text=text,
                                     lang=args.lang, screen_context=screen))
        print(f"icarus> {reply.text}")
        for action in reply.ui_actions:
            print("  ui:", action.model_dump(exclude_none=True))
            if action.card_type == "trade_preview":
                last_preview = action.data["preview_id"]
        print("  sources:", [f"{s.tool}({s.freshness})" for s in reply.sources])
        print("  debug:", reply.debug)


if __name__ == "__main__":
    main()
