"""Download checksum-verified public daily candles; no API key required."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile
from calendar import monthrange
from market_validation import atomic_json, validate_daily_series

ROOT = Path(__file__).resolve().parent
SYMBOLS = {"btc": "BTCUSDT", "eth": "ETHUSDT", "gold": "PAXGUSDT"}


def normalize_row(row):
    raw = int(row[0])
    # Binance spot archives changed from milliseconds to microseconds in 2025.
    seconds = raw / (1_000_000 if raw >= 100_000_000_000_000 else 1000)
    day = datetime.fromtimestamp(seconds, timezone.utc)
    opened, high, low, close, volume = map(float, row[1:6])
    if not all(__import__("math").isfinite(v) for v in (opened, high, low, close, volume)):
        raise ValueError("Non-finite candle")
    if min(opened, high, low, close) <= 0 or volume < 0 or not low <= min(opened, close) <= max(opened, close) <= high:
        raise ValueError("Invalid OHLC values")
    if (day.hour, day.minute, day.second, day.microsecond) != (0, 0, 0, 0):
        raise ValueError("Expected UTC daily candle")
    return {"date": day.date().isoformat(), "open": row[1], "high": row[2],
            "low": row[3], "close": row[4], "volume": row[5]}


def months(start, end):
    year, month = map(int, start.split("-"))
    while f"{year:04d}-{month:02d}" <= end:
        yield f"{year:04d}-{month:02d}"
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def download(url):
    if not url.startswith("https://data.binance.vision/"):
        raise ValueError("Unexpected archive host")
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def build_series(asset, rows, start, end, retrieved_at):
    points = sorted(rows.values(), key=lambda row:row["date"])
    year, month = map(int, end.split("-"))
    expected_end = f"{end}-{monthrange(year, month)[1]:02d}"
    if not points or points[0]["date"] != start+"-01" or points[-1]["date"] != expected_end:
        raise ValueError("REQUESTED_COVERAGE_INCOMPLETE")
    result = {"asset_id":asset,"currency":"USDT","origin":"real_historical",
              "source":"binance_public_archive","source_url":"https://data.binance.vision/",
              "coverage_start":points[0]["date"],"coverage_end":points[-1]["date"],
              "retrieved_at":retrieved_at,"gaps":[],"points":points}
    return validate_daily_series(result, expected_asset=asset)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", nargs="+", choices=SYMBOLS, default=list(SYMBOLS))
    parser.add_argument("--start", default="2024-01")
    parser.add_argument("--end", default="2026-09")
    args = parser.parse_args()
    for value in (args.start, args.end):
        try:
            if datetime.strptime(value, "%Y-%m").strftime("%Y-%m") != value:
                raise ValueError()
        except ValueError:
            parser.error("Months must use YYYY-MM")
    if args.start > args.end:
        parser.error("Start must precede end")
    manifest = {"provider":"binance_public_archive", "quote_currency":"USDT",
                "retrieved_at":datetime.now(timezone.utc).isoformat(), "files":[], "failures":[]}
    for asset in args.assets:
        rows = {}
        for month in months(args.start, args.end):
            name = f"{SYMBOLS[asset]}-1d-{month}.zip"
            url = f"https://data.binance.vision/data/spot/monthly/klines/{SYMBOLS[asset]}/1d/{name}"
            raw_path = ROOT / "data" / "raw" / name
            try:
                if raw_path.exists() and raw_path.with_suffix(".checksum").exists():
                    data, expected = raw_path.read_bytes(), raw_path.with_suffix(".checksum").read_text().strip()
                else:
                    data = download(url)
                    expected = download(url + ".CHECKSUM").decode().split()[0]
                actual = hashlib.sha256(data).hexdigest()
                if actual != expected:
                    raise ValueError("Archive checksum mismatch")
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    entries = [entry for entry in archive.namelist() if entry.endswith(".csv")]
                    if len(entries) != 1:
                        raise ValueError("Expected one CSV")
                    parsed = [normalize_row(row) for row in csv.reader(io.StringIO(archive.read(entries[0]).decode())) if row]
                if not parsed or any(not row["date"].startswith(month) for row in parsed):
                    raise ValueError("Archive dates do not match requested month")
                if len({row["date"] for row in parsed}) != len(parsed):
                    raise ValueError("Duplicate daily candle")
                for row in parsed:
                    if row["date"] in rows and rows[row["date"]] != row:
                        raise ValueError("Conflicting duplicate date")
                    rows[row["date"]] = row
                raw_path.parent.mkdir(parents=True, exist_ok=True)
                raw_path.write_bytes(data)
                raw_path.with_suffix(".checksum").write_text(expected, encoding="utf-8")
                manifest["files"].append({"asset":asset,"url":url,"sha256":actual,"rows":len(parsed)})
                print(f"Verified {asset} {month}: {len(parsed)} daily rows", flush=True)
            except (OSError, ValueError, zipfile.BadZipFile) as exc:
                manifest["failures"].append({"asset":asset,"month":month,"error_type":type(exc).__name__})
                print(f"Unavailable {asset} {month}: {type(exc).__name__}", flush=True)
        if rows and not any(failure["asset"] == asset for failure in manifest["failures"]):
            try:
                result = build_series(asset, rows, args.start, args.end, manifest["retrieved_at"])
                result["archives"] = [entry for entry in manifest["files"] if entry["asset"] == asset]
                atomic_json(ROOT / "data" / "market" / f"{asset}.json", result)
            except (OSError, ValueError) as exc:
                manifest["failures"].append({"asset":asset,"month":"requested_range","error_type":type(exc).__name__})
                print(f"Incomplete {asset}: existing market series preserved", flush=True)
    atomic_json(ROOT / "data" / "market_manifest.json", manifest)
    if manifest["failures"]:
        raise SystemExit("Refresh incomplete. Failed assets' existing series preserved; inspect the manifest.")
    if not manifest["files"]:
        raise SystemExit("No verified data obtained. No market series fabricated.")


if __name__ == "__main__":
    main()
