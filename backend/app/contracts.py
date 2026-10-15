"""Request and reply shapes for our API. This is the contract other parts build against."""
from typing import Literal

from pydantic import BaseModel, Field


class ScreenContext(BaseModel):
    screen_id: str
    selected_asset: str | None = None
    chart_period: Literal["1d", "1w", "1m", "1y"] | None = None
    visible_elements: list[str] = Field(default_factory=list)
    focused_element: str | None = None
    entered_amount: float | None = None


class ChatRequest(BaseModel):
    session_id: str
    user_id: str
    text: str
    lang: Literal["en", "th"] | None = None  # None: detect from the text
    input_mode: Literal["text", "voice"] = "text"
    screen_context: ScreenContext | None = None


class UiAction(BaseModel):
    type: Literal["highlight", "card"]
    element_id: str | None = None   # highlight
    message: str | None = None      # highlight
    card_type: str | None = None    # card
    data: dict | None = None        # card: copied from a tool result, never from LLM text


class SourceRef(BaseModel):
    result_id: str
    tool: str
    provider: str
    as_of: str | None = None
    freshness: str


class ChatReply(BaseModel):
    text: str
    speak: bool
    ui_actions: list[UiAction]
    sources: list[SourceRef]
    debug: dict = Field(default_factory=dict)


class ConfirmRequest(BaseModel):
    user_id: str


class ErrorBody(BaseModel):
    code: str
    message_en: str
    message_th: str
