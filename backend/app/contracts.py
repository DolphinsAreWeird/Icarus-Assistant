"""Request and reply shapes for our API. This is the contract other parts build against."""
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ScreenContext(BaseModel):
    screen_id: str
    selected_asset: str | None = None
    chart_period: str | None = None   # the app's periods: 1D 1W 1M 3M 1Y ALL (any case)
    visible_elements: list[str] = Field(default_factory=list)
    focused_element: str | None = None
    entered_amount: float | None = None
    screen_revision: str | None = None
    display_version: str | None = None


    @model_validator(mode="after")
    def periods_in_app_case(self):
        if self.chart_period:
            self.chart_period = self.chart_period.upper()  # the bridge sends "1m"
        return self


class ChatRequest(BaseModel):
    """Accepts our shape, and the shape KP's voice server sends: {text, language, snapshot, userId}.
    snapshot is the app's own getContext(): screen, asset, period, chart, buy, portfolio, focus."""
    session_id: str = Field(default="default", pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    user_id: str = Field(default="demo-user", pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    text: str = Field(min_length=1, max_length=8000)
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
        if isinstance(d.get("text"), str):
            d["text"] = d["text"].strip()
        if "userId" in d:
            d.setdefault("user_id", d.pop("userId"))
        if "language" in d:
            language = d.pop("language")
            d.setdefault("lang", language if language in ("en", "th") else None)  # "auto" -> detect
        snap = d.get("snapshot")
        if isinstance(snap, dict) and not d.get("screen_context"):
            for key in ("asset", "buy"):
                if snap.get(key) is not None and not isinstance(snap[key], dict):
                    raise ValueError(f"snapshot.{key} must be an object or null")
            d["screen_context"] = {
                "screen_id": str(snap.get("screen") or "home"),
                "selected_asset": (snap.get("asset") or {}).get("id"),
                "chart_period": snap.get("period"),
                "focused_element": snap.get("focus"),
                "entered_amount": (snap.get("buy") or {}).get("amount_thb"),
                "screen_revision": snap.get("screen_revision"),
                "display_version": snap.get("display_version"),
            }
        return d


class NudgeRequest(BaseModel):
    """The app asks: this user has been idle on this screen, is there something useful to say?"""
    user_id: str = "demo-user"
    lang: Literal["en", "th"] | None = None
    snapshot: dict = Field(default_factory=dict)   # the app's getContext() (plus card_frozen)
    idle_s: float = 0


class EventRequest(BaseModel):
    """An event the app saw that the backend can't: a screen view, a help tap, a task started or abandoned."""
    user_id: str = Field(default="demo-user", pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    session_id: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,64}$")
    type: str = Field(min_length=1, max_length=40)
    screen: str | None = Field(default=None, max_length=40)
    topic: str | None = Field(default=None, max_length=60)
    lang: Literal["en", "th"] | None = None


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
    speech: str | None = None
    speech_exact: bool = False
    status: str = "ok"
    limitations: list[str] = Field(default_factory=list)
    disclaimer: str = ""
    numerical_summaries: list[dict] = Field(default_factory=list)
    evidence: list[dict] = Field(default_factory=list)
    emotion: str = "curious"
    suggestions: list[str] = Field(default_factory=list)


class ConfirmRequest(BaseModel):
    user_id: str


class PreviewRequest(BaseModel):
    user_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    asset_id: Literal["btc", "eth", "gold"]
    side: Literal["buy", "sell"] = "buy"
    amount_thb: float = Field(gt=0, le=1000000000, allow_inf_nan=False)

    @model_validator(mode="after")
    def cents_only(self):
        from decimal import Decimal
        value = Decimal(str(self.amount_thb))
        if value != value.quantize(Decimal("0.01")):
            raise ValueError("amount_thb requires at most two decimal places")
        return self


class ErrorBody(BaseModel):
    code: str
    message_en: str
    message_th: str
