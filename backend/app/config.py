"""Paths and settings shared by the whole backend."""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
SEED_DIR = DATA_DIR / "seed"
SNAPSHOT_DIR = DATA_DIR / "snapshots"
HISTORY_DIR = SNAPSHOT_DIR / "history"

# OFFLINE=1 means: never call outside APIs, serve only the snapshot files.
OFFLINE = os.getenv("OFFLINE") == "1"

HTTP_TIMEOUT_S = 8
POLL_INTERVAL_S = 15

# A price older than this is "delayed" instead of "live".
LIVE_MAX_AGE_S = 120

# Reject a new price that moved more than this from the last accepted one.
MAX_JUMP_PCT = 20
# ...but only compare against a last price younger than this.
JUMP_CHECK_MAX_AGE_S = 3600

# How much history to keep, per candle interval.
HISTORY_DAYS = {"1d": 3 * 365, "1h": 7}
