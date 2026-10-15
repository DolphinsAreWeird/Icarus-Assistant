"""Optional Binance public reference-price loader. No API key, FX, or account access."""
from datetime import datetime,timezone
import json
from pathlib import Path
import urllib.parse
import urllib.request
import uuid

from data_adapter import validate_snapshot
from icarus_core import ROOT

SYMBOLS = {"BTCUSDT":"btc","ETHUSDT":"eth","PAXGUSDT":"gold"}


def fetch_snapshot():
    query = urllib.parse.urlencode({"symbols":json.dumps(list(SYMBOLS),separators=(",",":"))})
    url = "https://data-api.binance.vision/api/v3/ticker/24hr?" + query
    with urllib.request.urlopen(url,timeout=20) as response:
        body = json.load(response)
    if not isinstance(body,list) or {row.get("symbol") for row in body}!=set(SYMBOLS):
        raise ValueError("UNEXPECTED_PROVIDER_ASSETS")
    prices = []
    for row in body:
        # Spot REST timestamps are milliseconds, distinct from archive timestamp units.
        observed = datetime.fromtimestamp(int(row["closeTime"])/1000,timezone.utc).isoformat()
        prices.append({"asset_id":SYMBOLS[row["symbol"]],"currency":"USDT","price":row["lastPrice"],
                       "change_24h_pct":row.get("priceChangePercent"),
                       "source":{"provider":"binance_spot_reference","origin":"market","delivery":"network",
                                 "observed_at":observed,"source_url":"https://data-api.binance.vision/api/v3/ticker/24hr"}})
    return validate_snapshot({"schema_version":1,"snapshot_id":"binance-"+uuid.uuid4().hex,
                              "prices":prices,"account":None,"screen":None})


if __name__ == "__main__":
    try:
        payload = fetch_snapshot()
        # This artifact is a saved observation; only direct loader calls are network delivery.
        for row in payload["prices"]:
            row["source"]["delivery"] = "snapshot"
        target = ROOT/"data"/"public_price_snapshot.json"
        temp = target.with_suffix(".tmp")
        temp.write_text(json.dumps(payload,indent=2),encoding="utf-8")
        temp.replace(target)
        print(json.dumps({"saved_to":str(target),"snapshot_id":payload["snapshot_id"],
                          "assets":[row["asset_id"] for row in payload["prices"]],"currency":"USDT",
                          "origin":"market","delivery":"snapshot"},indent=2))
    except (OSError,ValueError,KeyError,TypeError) as exc:
        raise SystemExit(f"Public fetch failed ({type(exc).__name__}). Existing snapshot was not replaced.") from None
