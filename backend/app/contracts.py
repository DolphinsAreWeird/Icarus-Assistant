"""Request and reply shapes for our API. This is the contract other parts build against."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ScreenContext(BaseModel):
    screen_id: str
    selected_asset: str | None = None
    chart_period: str | None = None   # the app's periods: 1D 1W 1M 3M 1Y ALL
    visible_elements: list[str] = Field(default_factory=list)
    focused_element: str | None = None
    entered_amount: float | None = None


class ChatRequest(BaseModel):
    """Accepts our shape, and the shape KP's voice server sends: {text, language, snapshot, userId}.
    snapshot is the app's own getContext(): screen, asset, period, chart, buy, portfolio, focus."""
    session_id: str = "default"
    user_id: str = "demo-user"
    text: str
    lang: Literal["en", "th"] | None = None  # None: detect from the text
    input_mode: Literal["text", "voice"] = "text"
    screen_context: ScreenContext | None = None
    snapshot: dict | None = None

    @model_validator(mode="before")
    @classmethod
    def from_app_shape(cls, data):
        if not isinstance(data, dict):
            return data
        d = dict(data)
        if "userId" in d:
            d.setdefault("user_id", d.pop("userId"))
        if "language" in d:
            language = d.pop("language")
            d.setdefault("lang", language if language in ("en", "th") else None)  # "auto" -> detect
        snap = d.get("snapshot")
        if isinstance(snap, dict) and not d.get("screen_context"):
            d["screen_context"] = {
                "screen_id": str(snap.get("screen") or "home"),
                "selected_asset": (snap.get("asset") or {}).get("id"),
                "chart_period": snap.get("period"),
                "focused_element": snap.get("focus"),
                "entered_amount": (snap.get("buy") or {}).get("amount_thb"),
            }
        return d


class SourceRef(BaseModel):
    result_id: str
    tool: str
    provider: str
    as_of: str | None = None
    freshness: str


class ChatReply(BaseModel):
    text: str
    speak: bool
    ui_actions: list[dict]   # app actions, run in order. Closed set: see app/ui.py ACTIONS
    sources: list[SourceRef]
    debug: dict = Field(default_factory=dict)


class ConfirmRequest(BaseModel):
    user_id: str


class ErrorBody(BaseModel):
    code: str
    message_en: str
    message_th: str
