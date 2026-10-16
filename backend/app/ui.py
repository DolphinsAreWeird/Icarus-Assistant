"""How Icarus drives the app's screens.

Two layers:
1. ACTIONS: the closed set of UI actions we send. validate() rejects anything else.
   Most are actions Oasis's prototype runs (its doAction switch). Two follow the team
   contract (context.md section 8, frontend/src/backend-bridge.ts): highlight uses
   element_id, and card carries our trade preview. There is no "confirm" action, on
   purpose: the user taps Confirm on the card.
   We don't send the prototype's buy-screen actions (start_buy, type_amount, review):
   its buy screen adds its own fee, so purchases go on our card with our numbers
   (INTEGRATION.md, point 1).
2. The planner: one function per intent the model can choose ("show an asset",
   "change the chart"...). Each one turns the intent into the exact action sequence,
   starting from the screen the user is on. The model picks the intent and its
   values; code builds the sequence.
"""
from dataclasses import dataclass

from app import knowledge

MAX_ACTIONS_PER_TURN = 8
CARD_TYPES = ("trade_preview", "chart", "steps")  # in order of priority when a reply has more than one


class UIError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class UIState:
    """Where the user is. Starts from the app's snapshot and moves as we plan actions."""
    screen: str = "home"   # home wallets payments card invest portfolio asset buy buy_review
    asset: str = "XAU"     # app asset id (BTC, ETH, XAU, AAPL, TSLA)


def app() -> dict:
    return knowledge.app_ui()


# ---------- 1. the closed set of actions ----------

def in_app(asset: str) -> bool:
    """True for assets that have their own page in the app. The others (more stocks and funds) we can show prices and
    charts for, but the app has no screen for them, so we never ask it to open one."""
    return asset in app()["assets"] and app()["assets"][asset].get("in_app", True)


def _one_of(values):
    return lambda v: v in values


ACTIONS = {
    # type: {param: check}
    "navigate": {"to": lambda v: v in [s["to"] for s in app()["screens"].values()]},
    "back": {},
    "open_asset": {"asset": lambda v: in_app(v)},
    "set_period": {"period": lambda v: v in app()["periods"]},
    "set_filter": {"filter": lambda v: v in app()["filters"]},
    "toggle_freeze": {"value": lambda v: isinstance(v, bool)},
    "hide_balance": {"value": lambda v: isinstance(v, bool)},
    "highlight": {"element_id": lambda v: v in app()["elements"]},
    "start_guide": {"asset": lambda v: in_app(v)},
    "card": {"card_type": lambda v: v in CARD_TYPES, "data": lambda v: isinstance(v, dict)},
}


def finalize(actions: list[dict]) -> list[dict]:
    """A guide takes over the screens, so it runs alone. At most one card per reply:
    the most important one (a trade preview beats a chart beats steps)."""
    guides = [a for a in actions if a["type"] == "start_guide"]
    if guides:
        return guides[:1]
    cards = [a for a in actions if a["type"] == "card"]
    keep = min(cards, key=lambda a: CARD_TYPES.index(a["card_type"]), default=None)
    return [a for a in actions if a["type"] != "card" or a is keep]


def describe(actions: list[dict]) -> str:
    """What the actions do, in plain words, so the model reports exactly that and nothing more."""
    names = {k: v["name"] for k, v in app()["assets"].items()}
    screens = {json_key(s["to"]): name for name, s in app()["screens"].items()}
    say = {
        "navigate": lambda a: f"Opened the {screens.get(json_key(a['to']), 'requested')} screen.",
        "back": lambda a: "Went back one screen.",
        "open_asset": lambda a: f"Opened the {names[a['asset']]} page.",
        "set_period": lambda a: f"Switched the chart to {a['period']}.",
        "set_filter": lambda a: f"The asset list now shows {a['filter']}.",
        "toggle_freeze": lambda a: "Froze the card." if a["value"] else "Unfroze the card.",
        "hide_balance": lambda a: "Hid the balances." if a["value"] else "Showed the balances.",
        "highlight": lambda a: f"Highlighted {app()['elements'][a['element_id']]['shows'].lower()}.",
        "start_guide": lambda a: f"Started a step-by-step guide to buying {names[a['asset']]}.",
        "card": lambda a: "Showed a preview card. The user checks it and taps Confirm on the card; nothing is bought yet.",
    }
    return " ".join(say[a["type"]](a) for a in actions)


def json_key(d: dict) -> str:
    return ",".join(f"{k}={v}" for k, v in sorted(d.items()))


def validate(action: dict) -> None:
    """Raise UIError unless the action is in the closed set with exactly the right params."""
    spec = ACTIONS.get(action.get("type"))
    if spec is None:
        raise UIError("unknown_action", f"unknown action {action.get('type')!r}")
    params = {k: v for k, v in action.items() if k != "type"}
    if set(params) != set(spec):
        raise UIError("bad_params", f"{action['type']} takes {sorted(spec)}, got {sorted(params)}")
    for name, check in spec.items():
        if not check(params[name]):
            raise UIError("bad_value", f"{action['type']}: bad {name} {params[name]!r}")


# ---------- reading where the user is ----------

OLD_SCREEN_NAMES = {"asset_detail": "asset"}  # the bridge's name for the asset page


def to_app_asset(asset_id: str | None) -> str | None:
    """'gold', 'XAU' or 'xau' -> 'XAU'. Our data ids and the app's ids both work."""
    if not asset_id:
        return None
    assets = app()["assets"]
    if asset_id.upper() in assets:
        return asset_id.upper()
    for app_id, a in assets.items():
        if a["data_id"] == asset_id:
            return app_id
    return None


def state_from_snapshot(snapshot: dict | None, screen_id: str | None = None,
                        asset: str | None = None) -> UIState:
    """Build the starting state from the app's snapshot (or our ScreenContext fields)."""
    snap = snapshot if isinstance(snapshot, dict) else {}  # it comes from a browser: never trust its shape
    screen = snap.get("screen") or screen_id or "home"
    if not isinstance(screen, str):
        screen = "home"
    screen = OLD_SCREEN_NAMES.get(screen, screen)
    if screen == "buy" and "review" in str(snap.get("label", "")).lower():
        screen = "buy_review"
    snap_asset = snap.get("asset")
    asset_id = (snap_asset.get("id") if isinstance(snap_asset, dict) else None) or asset
    app_asset = to_app_asset(asset_id if isinstance(asset_id, str) else None) or "XAU"
    return UIState(screen=screen, asset=app_asset)


# ---------- 2. the planner: one function per intent ----------

def _navigate(state: UIState, screen: str) -> list[dict]:
    if screen not in app()["screens"]:
        raise UIError("unknown_screen", f"no screen called {screen!r}")
    if state.screen == screen:
        return []
    state.screen = screen
    return [{"type": "navigate", "to": app()["screens"][screen]["to"]}]


def _open_asset(state: UIState, asset: str) -> list[dict]:
    if asset in app()["assets"] and not in_app(asset):
        raise UIError("not_in_app", f"{app()['assets'].get(asset, {}).get('name', asset)} has no page in the app; "
                                    "show its chart or tell its price instead")
    if state.screen == "asset" and state.asset == asset:
        return []
    state.screen, state.asset = "asset", asset
    return [{"type": "open_asset", "asset": asset}]


def go_to_screen(state: UIState, screen: str) -> list[dict]:
    return _navigate(state, screen)


def go_back(state: UIState) -> list[dict]:
    state.screen = {"asset": "invest", "portfolio": "invest", "buy": "asset",
                    "buy_review": "buy"}.get(state.screen, state.screen)
    return [{"type": "back"}]


def show_asset(state: UIState, asset: str, period: str | None = None) -> list[dict]:
    acts = _open_asset(state, asset)
    if period:
        acts.append({"type": "set_period", "period": period})
    return acts


def change_chart_period(state: UIState, period: str) -> list[dict]:
    acts = []
    if state.screen in ("buy", "buy_review"):
        acts += _open_asset(state, state.asset)          # the chart lives on the asset screen
    elif state.screen not in ("asset", "invest", "portfolio"):
        acts += _navigate(state, "invest")               # the portfolio chart
    return acts + [{"type": "set_period", "period": period}]


def filter_assets(state: UIState, filter: str) -> list[dict]:
    state.screen = "invest"                              # set_filter opens the asset list itself
    return [{"type": "set_filter", "filter": filter}]


def guide_me(state: UIState, asset: str) -> list[dict]:
    return [{"type": "start_guide", "asset": asset}]


def set_card_frozen(state: UIState, frozen: bool) -> list[dict]:
    state.screen = "card"                                # toggle_freeze opens the card tab itself
    return [{"type": "toggle_freeze", "value": frozen}]


def set_balances_hidden(state: UIState, hidden: bool) -> list[dict]:
    return _navigate(state, "home") + [{"type": "hide_balance", "value": hidden}]


def point_at(state: UIState, element_id: str) -> list[dict]:
    """Highlight an element, going to its screen first if the user isn't there."""
    element = app()["elements"].get(element_id)
    if element is None:
        raise UIError("unknown_element", f"no element called {element_id!r}")
    screen, acts = element["screen"], []
    if screen in ("buy", "buy_review") and state.screen not in ("buy", "buy_review"):
        raise UIError("not_on_buy_screen", "that is only on the app's buy screen, which isn't open")
    if screen == "buy_review" and state.screen != "buy_review":
        raise UIError("not_on_review", "the Confirm button only appears on the review screen")
    if screen == "asset":
        acts += _open_asset(state, state.asset)
    elif screen not in ("buy", "buy_review"):
        acts += _navigate(state, screen)
    return acts + [{"type": "highlight", "element_id": element_id}]
