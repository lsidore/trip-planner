import copy
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import tripctx  # noqa: E402
from tripctx import TripError, load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")


def sample_data():
    with open(os.path.join(SAMPLE, "trip.json"), encoding="utf-8") as f:
        return json.load(f)


def make_trip(data, tmp):
    d = tempfile.mkdtemp(dir=tmp)
    with open(os.path.join(d, "trip.json"), "w", encoding="utf-8") as f:
        json.dump(data, f)
    return d


def leg(trip_dir, key):
    return next(l for l in load(trip_dir).legs if l["key"] == key)


class TripctxTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def test_loads_sample(self):
        t = load(SAMPLE)
        self.assertEqual([s["key"] for s in t.stages], ["lisbon", "comporta", "porto"])
        self.assertEqual([s["nights"] for s in t.stages], [3, 3, 3])
        self.assertEqual((t.slug, t.home_currency, t.local_currency, t.budget_cap),
                         ("sample-portugal", "USD", "EUR", 6000))
        self.assertEqual((t.start, t.end), ("2027-06-15", "2027-06-24"))
        self.assertEqual(t.state_file, os.path.join(t.dir, "state.json"))
        self.assertEqual(t.rules["checkin_min"], 90)
        self.assertEqual(t.rules["latest_arrival"], "21:00")

    def test_legs_of_sample(self):
        self.assertEqual([l["key"] for l in load(SAMPLE).legs],
                         ["arrive-a", "arrive-b", "lisbon-comporta", "comporta-porto",
                          "return-a", "return-b"])

    def test_arrival_and_return_legs(self):
        l = leg(SAMPLE, "arrive-b")
        self.assertEqual((l["kind"], l["mode"], l["from_airports"], l["to_airports"], l["date"]),
                         ("arrival", "flight", ["YUL"], ["LIS"], "2027-06-15"))
        r = leg(SAMPLE, "return-a")
        self.assertEqual((r["kind"], r["from_airports"], r["to_airports"], r["date"]),
                         ("return", ["OPO"], ["JFK"], "2027-06-24"))

    def test_stage_without_airport_gives_ground_leg(self):
        self.assertEqual(leg(SAMPLE, "lisbon-comporta")["mode"], "ground")

    def test_depart_airports_and_arrive_by(self):
        l = leg(SAMPLE, "comporta-porto")
        self.assertEqual((l["mode"], l["from_airports"], l["to_airports"]),
                         ("flight", ["LIS"], ["OPO"]))

    def test_same_home_airport_shares_leg(self):
        data = sample_data()
        data["travelers"][1]["home_airport"] = "JFK"
        d = make_trip(data, self.tmp)
        keys = [l["key"] for l in load(d).legs]
        self.assertEqual(keys[0], "arrive-a+b")
        self.assertIn("return-a+b", keys)
        self.assertEqual(leg(d, "arrive-a+b")["adults"], 2)

    def test_single_stage_single_traveler(self):
        data = sample_data()
        data["travelers"] = data["travelers"][:1]
        data["stages"] = data["stages"][:1]
        data["specials"] = []
        d = make_trip(data, self.tmp)
        self.assertEqual([l["key"] for l in load(d).legs], ["arrive-a", "return-a"])

    def test_stage_of(self):
        t = load(SAMPLE)
        self.assertEqual((t.stage_of("2027-06-16"), t.stage_of("2027-06-18"), t.stage_of("2027-07-01")),
                         ("lisbon", "comporta", None))
        self.assertEqual(t.stage_of("2027-06-24"), "porto")
        self.assertIsNone(t.stage_of("2027-06-14"))

    def test_bad_dates_error(self):
        data = sample_data()
        data["stages"][1]["from"], data["stages"][1]["to"] = "2027-06-21", "2027-06-18"
        with self.assertRaises(TripError) as cm:
            load(make_trip(data, self.tmp))
        self.assertIn("comporta", str(cm.exception))

    def test_missing_field_named(self):
        data = sample_data()
        del data["budget_cap"]
        with self.assertRaises(TripError) as cm:
            load(make_trip(data, self.tmp))
        self.assertIn("budget_cap", str(cm.exception))
        data = sample_data()
        del data["stages"][2]["tz"]
        with self.assertRaises(TripError) as cm:
            load(make_trip(data, self.tmp))
        self.assertIn("stages[2].tz", str(cm.exception))
        self.assertIn("porto", str(cm.exception))

    def test_stage_keys_and_traveler_ids_must_be_ascii_slugs(self):
        # the page saves picks under choix.<stage key> and leg keys made of traveler ids: anything else fails to save
        for field, i, bad, hint in (("stages", 1, "são-paulo", "sao-paulo"), ("stages", 0, "Lisbon", "lisbon"),
                                    ("stages", 2, "por.to", "por-to"), ("stages", 2, "-porto", "porto"),
                                    ("stages", 2, "x" * 41, None), ("travelers", 1, "zoé", "zoe"),
                                    ("travelers", 0, "a b", "a-b"), ("travelers", 0, "A", "a"),
                                    ("stages", 2, "porto\n", "porto"), ("travelers", 0, "ana\n", "ana")):  # a trailing newline is not a slug
            data = sample_data()
            name = "key" if field == "stages" else "id"
            data[field][i][name] = bad
            if field == "stages" and i == 1:
                data["specials"] = []
            with self.assertRaises(TripError, msg=bad) as cm:
                load(make_trip(data, self.tmp))
            msg = str(cm.exception)
            self.assertIn(f"{field}[{i}].{name}", msg)
            self.assertIn("ASCII slug", msg)
            self.assertIn("title or label", msg)
            if hint:
                self.assertIn(repr(hint), msg)

    def test_valid_slugs_are_accepted(self):
        data = sample_data()
        data["stages"][1]["key"], data["stages"][1]["title"] = "sao-paulo-2", "São Paulo"
        data["travelers"][1]["id"], data["travelers"][1]["label"] = "zoe", "Zoé"
        t = load(make_trip(data, self.tmp))
        self.assertEqual([s["key"] for s in t.stages][1], "sao-paulo-2")
        self.assertIn("arrive-zoe", [l["key"] for l in t.legs])
        self.assertEqual(tripctx.suggest_slug("São Paulo"), "sao-paulo")

    def test_missing_file(self):
        with self.assertRaises(TripError):
            load(self.tmp)

    def test_arrival_needs_airport(self):
        data = sample_data()
        data["stages"][0]["airports"] = []
        with self.assertRaises(TripError) as cm:
            load(make_trip(data, self.tmp))
        self.assertIn("lisbon", str(cm.exception))

    def test_rules_override_and_same_currency(self):
        data = sample_data()
        data["rules"] = {"checkin_min": 120}
        data["currency"] = {"home": "EUR", "local": "EUR"}
        t = load(make_trip(data, self.tmp))
        self.assertEqual(t.rules["checkin_min"], 120)
        self.assertEqual(t.rules["airport_exit_min"], 60)
        self.assertIsNone(t.local_currency)

    def test_active_trip_order(self):
        root = os.path.join(self.tmp, "repo")
        os.makedirs(os.path.join(root, "trips", "mine"))
        shutil.copy(os.path.join(SAMPLE, "trip.json"), os.path.join(root, "trips", "mine", "trip.json"))
        old = os.environ.pop("TRIP_DIR", None)
        self.addCleanup(lambda: os.environ.__setitem__("TRIP_DIR", old) if old
                        else os.environ.pop("TRIP_DIR", None))
        with self.assertRaises(TripError) as cm:
            tripctx.active_trip_dir(root)
        self.assertIn("no active trip", str(cm.exception))
        with open(os.path.join(root, "trips", ".current"), "w") as f:
            f.write("mine\n")
        self.assertEqual(tripctx.active_trip_dir(root), os.path.join(root, "trips", "mine"))
        os.environ["TRIP_DIR"] = SAMPLE
        self.assertEqual(tripctx.active_trip_dir(root), SAMPLE)
        os.environ["TRIP_DIR"] = "trips/mine"
        self.assertEqual(tripctx.active_trip_dir(root), os.path.join(root, "trips", "mine"))

    def test_flights_in_budget_false(self):
        data = sample_data()
        data["travelers"][0]["flights_in_budget"] = False
        d = make_trip(data, self.tmp)
        self.assertFalse(leg(d, "arrive-a")["in_budget"])
        self.assertFalse(leg(d, "return-a")["in_budget"])
        self.assertTrue(leg(d, "arrive-b")["in_budget"])
        self.assertTrue(leg(d, "comporta-porto")["in_budget"])


class TripctxCliTests(unittest.TestCase):
    """`python3 scripts/tripctx.py [--trip DIR]`: validates trip.json and prints what Claude shows back to the person."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_cli(self, argv):
        import contextlib
        import io
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = tripctx.main(argv)
        return code, out.getvalue(), err.getvalue()

    def test_summary_of_the_sample(self):
        code, out, err = self.run_cli(["--trip", SAMPLE])
        self.assertEqual(code, 0, err)
        self.assertIn("Lisbon, Comporta & Porto (example)", out)
        self.assertIn("2027-06-15 -> 2027-06-24", out)
        self.assertIn("comporta: Comporta, 2027-06-18 -> 2027-06-21, 3 nights", out)
        self.assertIn("lisbon-comporta: ground", out)
        self.assertIn("comporta-porto: flight LIS -> OPO, 2027-06-21", out)
        self.assertIn("arrive-b: flight YUL -> LIS, 2027-06-15, Sam", out)
        self.assertIn("sao-joao", out)

    def test_invalid_trip_exits_1_with_the_field(self):
        data = sample_data()
        del data["stages"][1]["tz"]
        code, out, err = self.run_cli(["--trip", make_trip(data, self.tmp)])
        self.assertEqual(code, 1)
        self.assertIn("stages[1].tz", err)
        self.assertEqual(out, "")

    def test_unknown_airport_is_named(self):
        data = sample_data()
        data["travelers"][0]["home_airport"] = "QQX"
        code, _, err = self.run_cli(["--trip", make_trip(data, self.tmp)])
        self.assertEqual(code, 1)
        self.assertIn("unknown airport 'QQX'", err)
        self.assertIn("data/airports.json", err)

    def test_outside_budget_leg_is_marked(self):
        data = sample_data()
        data["travelers"][0]["flights_in_budget"] = False
        code, out, _ = self.run_cli(["--trip", make_trip(data, self.tmp)])
        self.assertEqual(code, 0)
        line = next(l for l in out.splitlines() if l.strip().startswith("arrive-a:"))
        self.assertIn("outside the budget", line)


if __name__ == "__main__":
    unittest.main()
