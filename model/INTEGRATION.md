# App/backend to assistant contract

The model team owns validation and consumption of data. The app/backend owner supplies authenticated account data, reference-price feeds, and exact displayed-chart values. No web server is required to develop this interface.

## Snapshot v1

Use `fixtures/app_snapshot.json` as a complete synthetic example. Its prices and chart values are fictional, not current market facts. Runtime validation is implemented in `data_adapter.py`; unknown fields are rejected.

| Field | Meaning |
|---|---|
| `schema_version` | Integer `1` |
| `snapshot_id` | Stable identifier for one frozen data bundle |
| `prices` | List of asset/currency reference prices; empty is allowed |
| `account` | Account valuation supplied by the trusted caller, or null |
| `screen` | Bound screen revision and chart data, or null |

Every price has `asset_id`, `currency`, decimal-string `price`, decimal-string-or-null `change_24h_pct`, and `source`. Supported IDs: `btc`, `eth`, `gold`. Currencies: THB, USDT, USD. The adapter never converts between them.

Every source has `provider`, `origin`, `delivery`, timezone-aware ISO `observed_at`, and HTTPS `source_url` or null. Origins: `synthetic`, `market`, `account_backend`. Delivery: `fixture`, `network`, `cache`, `snapshot`. The schema's origin labels are assertions from the data owner, not cryptographic verification.

Freshness is recomputed from provider observation time: at most two minutes is fresh, later is delayed, and materially future prices are rejected. A fresh synthetic fixture or saved snapshot is never labeled live. Reference prices are never executable quotes.

Account: `account_ref`, `currency`, `positions`, `source`. Each position is `asset_id` plus decimal-string `value` in the account currency, at most two decimal places; `cash` is allowed. These are values, not quantities. Portfolio calculations use one account currency and include cash in the denominator. The authenticated backend chooses the account; the LLM cannot supply a user/account ID. This prototype does not implement that authentication.

Returned account data preserves `account_ref`, observation time, delivery mode, and recomputed freshness. Prices, portfolios, and displayed charts are dynamic evidence: prior-turn results are invalidated and must be refreshed, even if a snapshot ID repeats. Fictional seed holdings are removed from model context when an app adapter is configured.

Screen: `screen_id`, `screen_revision`, `selected_asset`, `focused_element`, `chart`. A chart contains `asset_id`, `currency`, `period`, `display_version`, ordered `points`, and `source`. Each point has timezone-aware ISO `at` and positive decimal-string `price`. Period is `1d`, `1w`, `1m`, or `1y`. The chart's asset must match the selected asset.

Pass this screen context from the frontend when asking about a chart:

```json
{
  "screen_id":"asset_detail",
  "screen_revision":"rev-demo-1",
  "selected_asset":"gold",
  "focused_element":"asset.chart",
  "chart_period":"1m",
  "display_version":"chart-demo-1"
}
```

A mismatch returns `SCREEN_OR_CHART_VERSION_CHANGED`; it does not silently explain another chart. The frontend must still discard a late response if the user changes screens after the request. This module cannot observe later frontend navigation.

## Python adapter usage

```python
from data_adapter import SnapshotAdapter
from session import ConversationSession

# get_backend_snapshot is a function supplied by the backend owner.
adapter = SnapshotAdapter.from_loader(get_backend_snapshot)
session = ConversationSession(language="en")
reply = session.ask(
    "What does this chart mean?",
    data_adapter=adapter,
    screen_context=frontend_screen_context,
)
```

Create a fresh frozen adapter per new app request. It loads once; tool calls share the same bundle. Never place credentials, seed phrases, or authentication headers inside the snapshot. Bind the user profile to the same authenticated session before any production use; the shipped profiles remain fictional seeds.

`SnapshotAdapter.from_file(path)` loads a fixture or saved bundle. Stored network/cache components are relabeled snapshot so a disk file cannot pretend to be a newly fetched network response.

Configured adapter tools:
- `get_prices(asset_ids, currency)` uses only explicitly available pairs.
- `get_portfolio()` uses the caller-bound account. If absent, it returns unavailable rather than falling back to fictional seed holdings.
- `explain_displayed_chart()` uses the exact supplied chart points and matched screen context.

Existing archive tools remain historical USDT calculations; they are not replacements for current price or displayed-chart tools.

## Local fixture demo, no backend

```powershell
python model/assistant.py /chart --lang th --snapshot model/fixtures/app_snapshot.json
python model/assistant.py '/prices THB btc gold' --snapshot model/fixtures/app_snapshot.json
python model/assistant.py --interactive --snapshot model/fixtures/app_snapshot.json
```

## Optional real public reference feed

```powershell
python model/fetch_public_snapshot.py
python model/assistant.py '/prices USDT btc eth gold' --snapshot model/data/public_price_snapshot.json
```

This fetches one public Binance reference snapshot without any key. It supplies USDT prices only, no account or screen. The saved file is labeled snapshot and ignored by Git. No THB conversion or polling service is implied. For a direct network read, a backend adapter can use `SnapshotAdapter.from_loader(fetch_public_snapshot.fetch_snapshot)`.

Sources: Binance's public market-data endpoint documentation is at https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md . Keep provider limits and venue connectivity in the data owner's operating configuration.

## Responses and voice

Render `text`, `numerical_summaries`, `sources`, `limitations`, `disclaimer`, and `status` together. Figures in summaries come from validated named fields rather than model prose. Show origin, currency, observation time, and delivery/freshness labels. TTS can read the deterministic summary when exact financial numbers must be spoken. Preserve the source metadata for debugging.

Model interpretation and Thai phrasing still require evaluation. Snapshot validation proves shape and internal consistency, not the truth of an external feed or the suitability of advice. No tool executes trades.
