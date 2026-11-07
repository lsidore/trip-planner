import json
import os
import re
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import flights  # noqa: E402
from flights import FlightsError, build, requests_for  # noqa: E402
from tripctx import load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")
FLIGHT_LEGS = {"arrive-a", "arrive-b", "comporta-porto", "return-a", "return-b"}


class FlightsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def copy_sample(self, edit=None):
        d = tempfile.mkdtemp(dir=self.tmp)
        d = os.path.join(d, "trip")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        if edit:
            p = os.path.join(d, "trip.json")
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            edit(data)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f)
        return d

    def t(self):
        return load(self.copy_sample())

    def test_requests_cover_flight_legs_only(self):
        self.assertEqual({r["leg"] for r in requests_for(load(SAMPLE))}, FLIGHT_LEGS)

    def test_one_request_per_leg_and_date_by_default(self):
        self.assertEqual(len(requests_for(load(SAMPLE))), 5)

    def test_flex_days_widen_the_dates(self):
        t = load(self.copy_sample(lambda d: d.update(flex_days=1)))
        dates = {r["date"] for r in requests_for(t) if r["leg"] == "comporta-porto"}
        self.assertEqual(dates, {"2027-06-20", "2027-06-21", "2027-06-22"})

    def test_currency_from_trip(self):
        r = requests_for(load(SAMPLE))[0]
        self.assertEqual(r["currency"], "USD")
        self.assertEqual(r["args"]["currency"], "USD")
        self.assertEqual(r["args"]["flyFrom"], "JFK")
        self.assertEqual(r["args"]["departureDate"], "15/06/2027")

    def test_bag_requests_ask_for_hold_bags(self):
        rs = [r for r in requests_for(load(SAMPLE), bags=True) if r["leg"] == "comporta-porto"]
        bag = next(r for r in rs if r["valise"])
        self.assertEqual(bag["args"]["adults_hold_bags"], [1, 1])
        self.assertTrue(bag["file"].endswith("comporta-porto-20270621-valise.json"))

    def test_build_sample(self):
        o = build(self.t())
        for k in ("arrive-a", "comporta-porto", "return-b"):
            self.assertTrue(o["legs"][k]["options"], k)
        self.assertEqual(set(o["legs"]), FLIGHT_LEGS)
        self.assertEqual(o["verifie"], "2026-11-07")

    def test_build_writes_file(self):
        t = self.t()
        o = build(t)
        with open(os.path.join(t.research, "vols-options.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), o)

    def test_option_ids_and_adults(self):
        o = build(self.t())
        for opt in o["legs"]["arrive-a"]["options"]:
            self.assertRegex(opt["id"], r"^arrive-a-2027\d{4}-")
            self.assertEqual(opt["lignes"][0]["n"], 1)
        for opt in o["legs"]["comporta-porto"]["options"]:
            self.assertEqual(opt["lignes"][0]["n"], 2)
        self.assertIn("arrive-a-20270615-TP9001", {x["id"] for x in o["legs"]["arrive-a"]["options"]})

    def test_bag_line_only_when_not_included_and_known(self):
        o = build(self.t())
        for opt in o["legs"]["comporta-porto"]["options"] + o["legs"]["arrive-a"]["options"]:
            has_line = any(l["cle"] == "valise" for l in opt["lignes"])
            ajout = opt["valise"]["ajout_home"]
            self.assertEqual(has_line, not opt["valise"]["comprise"] and bool(ajout))

    def test_lines_use_home_currency_field_names(self):
        o = build(self.t())
        opt = o["legs"]["arrive-a"]["options"][0]
        self.assertIn("prix_home", opt)
        self.assertFalse([k for k in opt if k.endswith("_eur")])
        self.assertNotIn("hors_budget", opt["lignes"][0])

    def test_lines_out_of_budget(self):
        def edit(d):
            d["travelers"][0]["flights_in_budget"] = False
        o = build(load(self.copy_sample(edit)))
        self.assertTrue(all(l.get("hors_budget") for x in o["legs"]["arrive-a"]["options"] for l in x["lignes"]))
        self.assertFalse(any(l.get("hors_budget") for x in o["legs"]["arrive-b"]["options"] for l in x["lignes"]))

    def test_unknown_airport_message(self):
        def edit(d):
            d["travelers"][0]["home_airport"] = "ZZZ"
        t = load(self.copy_sample(edit))
        for fn in (requests_for, build):
            with self.assertRaises(FlightsError) as cm:
                fn(t)
            self.assertIn("ZZZ", str(cm.exception))
            self.assertIn("data/airports.json", str(cm.exception))

    def test_currency_mismatch_in_raw_file(self):
        d = self.copy_sample(lambda x: x["currency"].update(home="EUR"))
        with self.assertRaises(FlightsError) as cm:
            build(load(d))
        self.assertIn("USD", str(cm.exception))

    def test_all_sample_airports_known(self):
        known = flights.load_airports()
        for code in ("JFK", "YUL", "LIS", "OPO", "MAD", "CDG", "BKK", "CNX", "DMK", "HKT", "KBV", "HDY", "SJO"):
            self.assertIn(code, known)
            self.assertEqual(set(known[code]), {"city", "country", "tz"})

    def test_formalities_from_transit_rules(self):
        vol = {"escales": [{"iata": "JFK", "billet_separe": False}, {"iata": "DEL", "billet_separe": False}]}
        self.assertEqual(flights.formalites_de(vol), ["esta-usa"])
        vol["escales"][1]["billet_separe"] = True
        self.assertEqual(flights.formalites_de(vol), ["esta-usa", "evisa-inde"])

    def test_respecte_regle_uses_trip_rules(self):
        rules = {"checkin_min": 90, "airport_exit_min": 60, "earliest_leave": "07:00", "latest_arrival": "21:00"}
        vol = {"segments": [{"dep_local": "2027-06-21T09:00", "arr_local": "2027-06-21T10:00"}]}
        self.assertTrue(flights.respecte_regle(vol, rules, {"duree_min": 30}, {"duree_min": 30}))
        # leaving the stay at 09:00 - 90 - 90 = 05:60 -> before earliest_leave
        self.assertFalse(flights.respecte_regle(vol, rules, {"duree_min": 90}))
        self.assertTrue(flights.respecte_regle(vol, dict(rules, earliest_leave="05:00"), {"duree_min": 90}))
        late = {"segments": [{"dep_local": "2027-06-21T18:00", "arr_local": "2027-06-21T20:00"}]}
        self.assertFalse(flights.respecte_regle(late, rules, None, {"duree_min": 30}))
        self.assertTrue(flights.respecte_regle(late, dict(rules, latest_arrival="22:00"), None, {"duree_min": 30}))
        self.assertFalse(flights.respecte_regle(vol, rules, None, {"duree_min": 30, "dernier_public": "10:30"}))

    def test_no_trip_specific_text_left(self):
        with open(os.path.join(ROOT, "scripts", "flights.py"), encoding="utf-8") as f:
            src = f.read()
        for word in ("Bang Rong", "TRAJETS", "JOURS_ALLER", "2026-10-28", "Koh Yao"):
            self.assertNotIn(word, src)
        self.assertFalse(re.search(r"_eur\b", src))

    def test_comparators_file_has_no_date(self):
        self.assertEqual(os.path.basename(flights.comparators_path(load(SAMPLE))), "vols-comparateurs.json")

    def test_warns_once_when_a_raw_file_is_priced_for_another_party(self):
        import contextlib
        import io
        d = self.copy_sample()
        raw = os.path.join(d, "research", "vols-brut", "comporta-porto-20270621.json")
        with open(raw, encoding="utf-8") as f:
            data = json.load(f)
        data["passengers"]["adults"] = 1
        with open(raw, "w", encoding="utf-8") as f:
            json.dump(data, f)
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            build(load(d))
        warnings = [l for l in err.getvalue().splitlines() if "comporta-porto-20270621.json" in l]
        self.assertEqual(len(warnings), 1, err.getvalue())
        self.assertIn("1 adult", warnings[0])
        self.assertIn("2", warnings[0])
        # building again after the file is fixed: no warning; the sample itself is consistent
        err2 = io.StringIO()
        with contextlib.redirect_stderr(err2), contextlib.redirect_stdout(io.StringIO()):
            build(load(self.copy_sample()))
        self.assertEqual(err2.getvalue(), "")

    def test_sample_flight_prices_are_for_the_legs_party(self):
        t = load(SAMPLE)
        for leg in t.legs:
            if leg["mode"] != "flight":
                continue
            for _, files in flights.raw_files_of(t, leg["key"]).items():
                for path in files.values():
                    if path:
                        with open(path, encoding="utf-8") as f:
                            self.assertEqual(json.load(f)["passengers"]["adults"], leg["adults"], path)

if __name__ == "__main__":
    unittest.main()
