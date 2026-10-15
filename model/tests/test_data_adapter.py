from copy import deepcopy
from datetime import datetime,timezone,timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock,patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from icarus_core import ROOT,read_json
from data_adapter import SnapshotAdapter,validate_snapshot
from assistant import answer


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.payload = read_json(ROOT/"fixtures"/"app_snapshot.json")
        self.now = datetime(2026,10,15,tzinfo=timezone.utc)

    def test_fixture_origin_cannot_claim_live_even_when_fresh(self):
        row = SnapshotAdapter(self.payload).get_prices(["btc"],"THB",self.now)["prices"][0]
        self.assertEqual(row["freshness"],"fresh")
        self.assertFalse(row["usable_as_live"])
        self.assertEqual(row["source"]["origin"],"synthetic")

    def test_market_price_freshness_and_future(self):
        source = self.payload["prices"][0]["source"]
        source.update(origin="market",delivery="network")
        adapter = SnapshotAdapter(self.payload)
        self.assertTrue(adapter.get_prices(["btc"],"THB",self.now)["prices"][0]["usable_as_live"])
        self.assertFalse(adapter.get_prices(["btc"],"THB",self.now+timedelta(seconds=121))["prices"][0]["usable_as_live"])
        with self.assertRaises(ValueError):
            adapter.get_prices(["btc"],"THB",self.now-timedelta(minutes=1))

    def test_no_implicit_currency_conversion_or_missing_asset(self):
        adapter = SnapshotAdapter(self.payload)
        for assets,currency in ((["btc"],"USD"),(["eth"],"THB"),(["btc","btc"],"THB")):
            with self.assertRaises(ValueError):
                adapter.get_prices(assets,currency,self.now)

    def test_frozen_payload_and_loader_called_once(self):
        loader = Mock(return_value=self.payload)
        adapter = SnapshotAdapter.from_loader(loader)
        self.payload["prices"][0]["price"]="1"
        adapter.get_prices(["btc"],"THB",self.now)
        self.assertEqual(adapter.get_prices(["btc"],"THB",self.now)["prices"][0]["price"],"1000000.00")
        loader.assert_called_once()

    def test_exact_chart_values_and_stale_screen(self):
        adapter = SnapshotAdapter(self.payload)
        context = adapter.screen_context()
        result = adapter.explain_chart(context)
        self.assertEqual(result["first_displayed_price"],"100000.00")
        self.assertEqual(result["last_displayed_price"],"99500.00")
        self.assertEqual(result["displayed_change_pct"],"-0.50")
        context["screen_revision"]="different"
        with self.assertRaises(ValueError):
            adapter.explain_chart(context)

    def test_invalid_inputs_rejected(self):
        for bad_price in ("NaN","Infinity","0","-1",100):
            payload = deepcopy(self.payload)
            payload["prices"][0]["price"]=bad_price
            with self.assertRaises(ValueError):
                validate_snapshot(payload)
        payload = deepcopy(self.payload)
        payload["screen"]["chart"]["points"].reverse()
        with self.assertRaises(ValueError):
            validate_snapshot(payload)
        payload = deepcopy(self.payload)
        payload["prices"][0]["source"]["observed_at"]="2026-10-15T00:00:00"
        with self.assertRaises(ValueError):
            validate_snapshot(payload)

    def test_configured_account_overrides_seed_and_no_missing_account_fallback(self):
        adapter = SnapshotAdapter(self.payload)
        result = answer("/portfolio",profile_id="new",data_adapter=adapter)
        self.assertEqual(result["status"],"ok")
        self.assertIn("80.00%",result["numerical_summaries"][0]["text"])
        self.payload["account"]=None
        unavailable = answer("/portfolio",profile_id="concentrated",data_adapter=SnapshotAdapter(self.payload))
        self.assertEqual(unavailable["status"],"data_unavailable")
        self.assertNotIn("80.00%",unavailable["numerical_summaries"][0]["text"])

    def test_account_identity_and_observation_labels_preserved(self):
        adapter = SnapshotAdapter(self.payload)
        result = answer("/portfolio",data_adapter=adapter)
        data = next(iter(result["tool_results"].values()))
        self.assertEqual(data["account_ref"],"fictional-account")
        self.assertIn("2026-10-15T00:00:00Z",result["numerical_summaries"][0]["text"])
        self.assertIn("fixture",result["numerical_summaries"][0]["text"])

    def test_previous_chart_or_account_evidence_is_not_current(self):
        adapter = SnapshotAdapter(self.payload)
        for command in ("/chart","/portfolio"):
            previous = answer(command,data_adapter=adapter,screen_context=adapter.screen_context())
            old_id = previous["sources"][0]["id"]
            memory = [{"user":command,"assistant":previous["text"],"sources":previous["sources"],"tool_results":previous["tool_results"]}]
            changed = deepcopy(self.payload)
            changed["snapshot_id"]="new-snapshot"
            changed["account"]=None
            changed["screen"]["screen_revision"]="new-revision"
            changed["screen"]["chart"]["display_version"]="new-chart"
            changed["screen"]["chart"]["points"][-1]["price"]="200000.00"
            new_adapter = SnapshotAdapter(changed)
            response = {"content":json.dumps({"text":"An old observation.","source_ids":[old_id],"limitation_codes":[]})}
            with patch("assistant.completion",return_value=response):
                result = answer("What does the current data show?",data_adapter=new_adapter,
                                screen_context=new_adapter.screen_context(),memory=memory,model="fixture")
            self.assertEqual(result["status"],"needs_review")
            self.assertEqual(result["numerical_summaries"],[])

    def test_deterministic_chart_and_price_commands(self):
        adapter = SnapshotAdapter(self.payload)
        result = answer("/chart",language="th",data_adapter=adapter,screen_context=adapter.screen_context())
        self.assertEqual(result["model_calls"],[])
        self.assertEqual(result["status"],"ok")
        self.assertIn("-0.50%",result["numerical_summaries"][0]["text"])
        self.assertEqual(answer("/prices THB btc gold",data_adapter=adapter)["status"],"ok")
        self.assertEqual(answer("/prices USD btc",data_adapter=adapter)["status"],"data_unavailable")

    def test_model_can_call_exact_displayed_chart(self):
        adapter = SnapshotAdapter(self.payload)
        count = 0
        def fake_completion(model,messages,timings,**options):
            nonlocal count
            count += 1
            if count==1:
                return {"tool_calls":[{"id":"chart-call","type":"function","function":{"name":"explain_displayed_chart","arguments":"{}"}}],"content":None}
            result_id = json.loads(next(message["content"] for message in messages if message["role"]=="tool"))["result_id"]
            return {"content":json.dumps({"text":"The supplied displayed chart ends below its starting point.","source_ids":[result_id],"limitation_codes":["historical_only"]})}
        with patch("assistant.completion",side_effect=fake_completion):
            result = answer("Explain this chart.",data_adapter=adapter,screen_context=adapter.screen_context(),model="fixture")
        self.assertEqual(result["status"],"ok")
        self.assertIn("99500.00",result["numerical_summaries"][0]["text"])
        self.assertFalse(any("USDT" in item for item in result["limitations"]))
        self.assertTrue(any("synthetic" in item for item in result["limitations"]))

    def test_saved_network_observation_cannot_claim_network_delivery(self):
        self.payload["prices"][0]["source"].update(origin="market",delivery="network")
        target_root = ROOT/"results"
        target_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=target_root) as tmp:
            self.assertTrue(Path(tmp).resolve().is_relative_to(target_root.resolve()))
            path = Path(tmp)/"snapshot.json"
            path.write_text(json.dumps(self.payload),encoding="utf-8")
            adapter = SnapshotAdapter.from_file(path)
            row = adapter.get_prices(["btc"],"THB",self.now)["prices"][0]
            self.assertEqual(row["source"]["delivery"],"snapshot")
            self.assertFalse(row["usable_as_live"])


if __name__=="__main__":
    unittest.main()
