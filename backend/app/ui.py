"""How Icarus drives the app's screens.

Two layers:
1. ACTIONS: the closed set of UI actions Oasis's prototype can run (its doAction switch).
   validate() rejects anything else. There is no "confirm" action, on purpose: the
   user taps Confirm purchase themselves.
2. The planner: one function per intent the model can choose ("show an asset",
   "prepare a buy"...). Each one turns the intent into the exact action sequence,
   starting from the screen the user is on. The model picks the intent and its
   values; code builds the sequence.
"""
from dataclasses import dataclass

from app import knowledge

MAX_ACTIONS_PER_TURN = 8


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

def _one_of(values):
    return lambda v: v in values


ACTIONS = {
    # type: {param: check}
    "navigate": {"to": lambda v: v in [s["to"] for s in app()["screens"].values()]},
    "back": {},
    "open_asset": {"asset": lambda v: v in app()["assets"]},
    "set_period": {"period": lambda v: v in app()["periods"]},
    "set_filter": {"filter": lambda v: v in app()["filters"]},
    "start_buy": {"asset": lambda v: v in app()["assets"]},
    "type_amount": {"value": lambda v: isinstance(v, (int, float)) and v >= app()["min_buy_thb"]},
    "select_wallet": {"wallet": lambda v: v in app()["wallets"]},
    "review": {},
    "cancel_buy": {},
    "toggle_freeze": {"value": lambda v: isinstance(v, bool)},
    "hide_balance": {"value": lambda v: isinstance(v, bool)},
    "highlight": {"target": lambda v: v in app()["elements"]},
    "start_guide": {"asset": lambda v: v in app()["assets"]},
}


def finalize(actions: list[dict]) -> list[dict]:
    """A guide takes over the screens, so it runs alone."""
    guides = [a for a in actions if a["type"] == "start_guide"]
    return guides[:1] if guides else actions


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
        "start_buy": lambda a: f"Opened the buy screen for {names[a['asset']]}.",
        "type_amount": lambda a: f"Typed {a['value']:g} baht.",
        "select_wallet": lambda a: f"Picked the {app()['wallets'][a['wallet']]}.",
        "review": lambda a: "Opened the review screen. The user must tap Confirm purchase; nothing is bought yet.",
        "cancel_buy": lambda a: "Cancelled the purchase. Nothing was bought.",
        "toggle_freeze": lambda a: "Froze the card." if a["value"] else "Unfroze the card.",
        "hide_balance": lambda a: "Hid the balances." if a["value"] else "Showed the balances.",
        "highlight": lambda a: f"Highlighted {app()['elements'][a['target']]['shows'].lower()}.",
        "start_guide": lambda a: f"Started a step-by-step guide to buying {names[a['asset']]}.",
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

OLD_SCREEN_NAMES = {"asset_detail": "asset"}


def to_app_asset(asset_id: str | None) -> str | None:
    """'gold' or 'XAU' -> 'XAU'. Our data ids and the app's ids both work."""
    if not asset_id:
        return None
    assets = app()["assets"]
    if asset_id in assets:
        return asset_id
    for app_id, a in assets.items():
        if a["data_id"] == asset_id:
            return app_id
    return None


def state_from_snapshot(snapshot: dict | None, screen_id: str | None = None,
                        asset: str | None = None) -> UIState:
    """Build the starting state from the app's snapshot (or our ScreenContext fields)."""
    snap = snapshot or {}
    screen = snap.get("screen") or screen_id or "home"
    screen = OLD_SCREEN_NAMES.get(screen, screen)
    if screen == "buy" and "review" in str(snap.get("label", "")):
        screen = "buy_review"
    app_asset = to_app_asset((snap.get("asset") or {}).get("id") or asset) or "XAU"
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


def prepare_buy(state: UIState, asset: str, amount_thb: float, wallet: str = "thb") -> list[dict]:
    """Fill in the app's own buy screens and stop on the review screen, at Confirm."""
    if amount_thb < app()["min_buy_thb"]:
        raise UIError("below_minimum", f"the minimum buy is {app()['min_buy_thb']} baht")
    if wallet not in app()["wallets"]:
        raise UIError("unknown_wallet", f"no wallet called {wallet!r}")
    acts = []
    if not (state.screen in ("buy", "buy_review") and state.asset == asset):
        acts += _open_asset(state, asset)
        acts.append({"type": "start_buy", "asset": asset})
    acts += [{"type": "type_amount", "value": amount_thb},
             {"type": "select_wallet", "wallet": wallet},
             {"type": "review"}]
    state.screen, state.asset = "buy_review", asset
    return acts


def cancel_buy(state: UIState) -> list[dict]:
    if state.screen not in ("buy", "buy_review"):
        raise UIError("no_buy_open", "there is no purchase open to cancel")
    state.screen = "asset"
    return [{"type": "cancel_buy"}]


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
    if screen == "buy_review" and state.screen != "buy_review":
        raise UIError("not_on_review", "the Confirm button only appears after a purchase is set up")
    if screen == "buy" and state.screen not in ("buy", "buy_review"):
        acts += _open_asset(state, state.asset) + [{"type": "start_buy", "asset": state.asset}]
        state.screen = "buy"
    elif screen == "asset":
        acts += _open_asset(state, state.asset)
    elif screen not in ("buy", "buy_review"):
        acts += _navigate(state, screen)
    return acts + [{"type": "highlight", "target": element_id}]
