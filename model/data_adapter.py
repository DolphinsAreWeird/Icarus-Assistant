"""Validated, frozen app-data snapshot boundary. No HTTP server or credentials."""
from copy import deepcopy
from datetime import datetime,timezone
from decimal import Decimal,InvalidOperation
import json
from pathlib import Path
import re
from typing import Callable,Protocol

from icarus_core import ASSETS,formatted


def fields(value,required):
    if not isinstance(value,dict) or set(value)!=set(required):
        raise ValueError("INVALID_SNAPSHOT_FIELDS")


def text(value):
    if not isinstance(value,str) or not value.strip() or len(value)>200:
        raise ValueError("INVALID_SNAPSHOT_TEXT")
    return value


def decimal(value,positive=False):
    if not isinstance(value,str) or len(value)>50 or not re.fullmatch(r"-?\d+(?:\.\d{1,18})?",value):
        raise ValueError("DECIMAL_STRING_REQUIRED")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise ValueError("INVALID_DECIMAL") from None
    if not number.is_finite() or abs(number)>Decimal("1e15") or (positive and number<=0):
        raise ValueError("INVALID_DECIMAL")
    return number


def timestamp(value):
    if not isinstance(value,str):
        raise ValueError("ISO_TIMESTAMP_REQUIRED")
    try:
        result = datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError:
        raise ValueError("INVALID_TIMESTAMP") from None
    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("TIMEZONE_REQUIRED")
    return result.astimezone(timezone.utc)


def asset(value):
    if not isinstance(value,str) or value not in ASSETS:
        raise ValueError("UNKNOWN_ASSET")


def validate_currency(value):
    if value not in ("THB","USDT","USD"):
        raise ValueError("UNKNOWN_CURRENCY")


def source(value):
    fields(value,{"provider","origin","delivery","observed_at","source_url"})
    text(value["provider"])
    if value["origin"] not in ("synthetic","market","account_backend"):
        raise ValueError("INVALID_DATA_ORIGIN")
    if value["delivery"] not in ("fixture","network","cache","snapshot"):
        raise ValueError("INVALID_DELIVERY_MODE")
    timestamp(value["observed_at"])
    url = value["source_url"]
    if url is not None and (not isinstance(url,str) or not url.startswith("https://") or len(url)>500):
        raise ValueError("INVALID_SOURCE_URL")
    if value["origin"]=="synthetic" and value["delivery"]=="network":
        raise ValueError("SYNTHETIC_DATA_CANNOT_BE_LABELED_NETWORK_MARKET")


def validate_snapshot(payload):
    fields(payload,{"schema_version","snapshot_id","prices","account","screen"})
    if type(payload["schema_version"]) is not int or payload["schema_version"]!=1:
        raise ValueError("UNSUPPORTED_SNAPSHOT_VERSION")
    text(payload["snapshot_id"])
    if not isinstance(payload["prices"],list) or len(payload["prices"])>50:
        raise ValueError("INVALID_PRICE_LIST")
    seen = set()
    for row in payload["prices"]:
        fields(row,{"asset_id","currency","price","change_24h_pct","source"})
        asset(row["asset_id"]); validate_currency(row["currency"]); decimal(row["price"],positive=True); source(row["source"])
        pair = (row["asset_id"],row["currency"])
        if pair in seen:
            raise ValueError("DUPLICATE_PRICE")
        seen.add(pair)
        if row["change_24h_pct"] is not None:
            if decimal(row["change_24h_pct"]) < -100:
                raise ValueError("INVALID_NEGATIVE_PRICE_CHANGE")
        if row["source"]["origin"] not in ("market","synthetic"):
            raise ValueError("INVALID_PRICE_ORIGIN")
    account = payload["account"]
    if account is not None:
        fields(account,{"account_ref","currency","positions","source"})
        text(account["account_ref"]); validate_currency(account["currency"]); source(account["source"])
        if account["source"]["origin"] not in ("account_backend","synthetic"):
            raise ValueError("INVALID_ACCOUNT_ORIGIN")
        if not isinstance(account["positions"],list) or len(account["positions"])>50:
            raise ValueError("INVALID_POSITIONS")
        seen = set()
        for row in account["positions"]:
            fields(row,{"asset_id","value"})
            if row["asset_id"]!="cash":
                asset(row["asset_id"])
            if row["asset_id"] in seen or decimal(row["value"])<0:
                raise ValueError("INVALID_POSITION_VALUE_OR_DUPLICATE")
            if decimal(row["value"]) != decimal(row["value"]).quantize(Decimal("0.01")):
                raise ValueError("ACCOUNT_VALUE_REQUIRES_CENTS")
            seen.add(row["asset_id"])
    screen = payload["screen"]
    if screen is not None:
        fields(screen,{"screen_id","screen_revision","selected_asset","focused_element","chart"})
        for key in ("screen_id","screen_revision","focused_element"):
            text(screen[key])
        asset(screen["selected_asset"])
        chart = screen["chart"]
        if chart is not None:
            fields(chart,{"asset_id","currency","period","display_version","points","source"})
            asset(chart["asset_id"]); validate_currency(chart["currency"]); text(chart["display_version"]); source(chart["source"])
            if chart["asset_id"]!=screen["selected_asset"] or chart["period"] not in ("1d","1w","1m","1y"):
                raise ValueError("CHART_ASSET_OR_PERIOD_MISMATCH")
            if chart["source"]["origin"] not in ("market","synthetic"):
                raise ValueError("INVALID_CHART_ORIGIN")
            if not isinstance(chart["points"],list) or not 2<=len(chart["points"])<=2000:
                raise ValueError("INVALID_CHART_POINTS")
            previous = None
            for point in chart["points"]:
                fields(point,{"at","price"})
                current = timestamp(point["at"]); decimal(point["price"],positive=True)
                if previous is not None and current<=previous:
                    raise ValueError("CHART_POINTS_NOT_STRICTLY_ORDERED")
                previous = current
            if timestamp(chart["source"]["observed_at"])<previous:
                raise ValueError("CHART_OBSERVATION_PRECEDES_LAST_POINT")
    return deepcopy(payload)


class AssistantData(Protocol):
    def get_prices(self,asset_ids:list[str],currency:str,now:datetime|None=None)->dict: ...
    def get_portfolio(self)->dict: ...
    def explain_chart(self,screen_context:dict|None)->dict: ...


class SnapshotAdapter:
    """Freeze once per assistant turn; frontend/backend owns account authentication."""
    def __init__(self,payload):
        self._data = validate_snapshot(payload)

    @classmethod
    def from_loader(cls,loader:Callable[[],dict]):
        return cls(loader())  # Fetch once, not once per tool call.

    @classmethod
    def from_file(cls,path):
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        payload = validate_snapshot(payload)
        sources = [row["source"] for row in payload["prices"]]
        if payload["account"]:
            sources.append(payload["account"]["source"])
        if payload["screen"] and payload["screen"]["chart"]:
            sources.append(payload["screen"]["chart"]["source"])
        for item in sources:
            if item["delivery"] in ("network","cache"):
                item["delivery"] = "snapshot"
        return cls(payload)

    def screen_context(self):
        screen = self._data["screen"]
        if screen is None:
            return None
        chart = screen["chart"]
        return {"screen_id":screen["screen_id"],"screen_revision":screen["screen_revision"],
                "selected_asset":screen["selected_asset"],"focused_element":screen["focused_element"],
                "chart_period":chart["period"] if chart else None,
                "display_version":chart["display_version"] if chart else None}

    def get_prices(self,asset_ids,currency="THB",now=None):
        if not isinstance(asset_ids,list) or not 1<=len(asset_ids)<=10:
            raise ValueError("INVALID_ASSET_LIST")
        for name in asset_ids:
            asset(name)
        validate_currency(currency)
        if len(set(asset_ids))!=len(asset_ids):
            raise ValueError("DUPLICATE_ASSET_REQUEST")
        now = now or datetime.now(timezone.utc)
        if now.tzinfo is None:
            raise ValueError("TIMEZONE_REQUIRED")
        result = []
        for name in asset_ids:
            found = next((row for row in self._data["prices"] if row["asset_id"]==name and row["currency"]==currency),None)
            if found is None:
                raise ValueError("PRICE_OR_CURRENCY_UNAVAILABLE_NO_CONVERSION")
            row = deepcopy(found)
            age = (now-timestamp(row["source"]["observed_at"])).total_seconds()
            if age < -30:
                raise ValueError("PRICE_TIMESTAMP_IN_FUTURE")
            row["freshness"] = "fresh" if age<=120 else "delayed"
            row["usable_as_live"] = (row["source"]["origin"]=="market" and row["freshness"]=="fresh"
                                     and row["source"]["delivery"] not in ("fixture","snapshot"))
            result.append(row)
        return {"snapshot_id":self._data["snapshot_id"],"prices":result,
                "limit":"Reference prices only; not executable quotes. No currency conversion is performed."}

    def get_portfolio(self):
        account = self._data["account"]
        if account is None:
            raise ValueError("ACCOUNT_DATA_UNAVAILABLE")
        total = sum((decimal(row["value"]) for row in account["positions"]),Decimal(0))
        age = (datetime.now(timezone.utc)-timestamp(account["source"]["observed_at"])).total_seconds()
        if age < -30:
            raise ValueError("ACCOUNT_TIMESTAMP_IN_FUTURE")
        return {"snapshot_id":self._data["snapshot_id"],"account_ref":account["account_ref"],
                "origin":account["source"]["origin"],"freshness":"fresh" if age<=120 else "delayed",
                "currency":account["currency"],"source":deepcopy(account["source"]),
                "total_including_cash":formatted(total),
                "positions":[{"asset":row["asset_id"],"value":row["value"],
                              "share_pct":formatted(decimal(row["value"])/total*100) if total else "0.00"}
                             for row in account["positions"]],
                "scope":"Caller-bound visible account, including cash. Values supplied by data owner; no hidden FX or external holdings inferred."}

    def explain_chart(self,screen_context):
        expected = self.screen_context()
        if expected is None or self._data["screen"]["chart"] is None:
            raise ValueError("DISPLAYED_CHART_UNAVAILABLE")
        if not isinstance(screen_context,dict) or any(screen_context.get(key)!=value for key,value in expected.items()):
            raise ValueError("SCREEN_OR_CHART_VERSION_CHANGED")
        chart = self._data["screen"]["chart"]
        first,last = chart["points"][0],chart["points"][-1]
        change = (decimal(last["price"])/decimal(first["price"])-1)*100
        return {"snapshot_id":self._data["snapshot_id"],"asset_id":chart["asset_id"],"currency":chart["currency"],
                "period":chart["period"],"display_version":chart["display_version"],
                "screen_revision":self._data["screen"]["screen_revision"],
                "start":first["at"],"end":last["at"],"first_displayed_price":first["price"],
                "last_displayed_price":last["price"],"displayed_change_pct":formatted(change),
                "source":deepcopy(chart["source"]),
                "limit":"Uses exactly the supplied displayed points, not another history series or a live execution quote."}


def adapter_tools():
    return [
        {"type":"function","function":{"name":"get_prices","description":"Read timestamped reference prices in an explicitly available currency; no FX conversion. Inspect source origin/freshness.",
         "parameters":{"type":"object","properties":{"asset_ids":{"type":"array","items":{"type":"string","enum":list(ASSETS)},"minItems":1,"maxItems":10},
                       "currency":{"type":"string","enum":["THB","USD","USDT"]}},"required":["asset_ids","currency"],"additionalProperties":False}}},
        {"type":"function","function":{"name":"explain_displayed_chart","description":"Explain exact supplied displayed chart endpoints. Requires matching screen revision and display version; do not substitute another chart.",
         "parameters":{"type":"object","properties":{},"required":[],"additionalProperties":False}}}
    ]
