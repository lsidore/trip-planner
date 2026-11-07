"""days.py: one entry per day of the trip (stage, sun times in the stage's time zone, dated events, legs)."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import days  # noqa: E402
from tripctx import load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")


def quiet(fn, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **k)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def copy_sample(self, edit=None, research=True):
        d = os.path.join(self.tmp, "trip")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        if not research:
            shutil.rmtree(os.path.join(d, "research"))
        if edit:
            p = os.path.join(d, "trip.json")
            with open(p, encoding="utf-8") as f:
                data = json.load(f)
            edit(data)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f)
        return d


class SampleDays(Base):
    @classmethod
    def setUpClass(cls):
        cls.tmpc = tempfile.mkdtemp()
        d = os.path.join(cls.tmpc, "trip")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        cls.trip = load(d)
        cls.days = quiet(days.build, cls.trip)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmpc, True)

    def day(self, iso):
        return next(j for j in self.days if j["date"] == iso)

    def test_days_cover_trip(self):
        self.assertEqual(self.days[0]["date"], "2027-06-15")
        self.assertEqual(self.days[-1]["date"], "2027-06-24")
        self.assertEqual(len(self.days), 10)

    def test_day_stage(self):
        self.assertEqual(self.day("2027-06-15")["etape"], "lisbon")
        self.assertEqual(self.day("2027-06-18")["etape"], "comporta")
        self.assertEqual(self.day("2027-06-24")["etape"], "porto")

    def test_sunrise_local(self):
        j = self.day("2027-06-16")
        self.assertTrue("05:00" <= j["lever"] <= "07:00", j["lever"])
        self.assertTrue("20:00" <= j["coucher"] <= "22:00", j["coucher"])

    def test_sun_times_follow_the_stage_time_zone(self):
        # Same place, same day: UTC+0 vs UTC+9 differ by nine hours
        import datetime as dt
        a = days.sun_times(dt.date(2027, 6, 16), 38.7, -9.1, "UTC")
        b = days.sun_times(dt.date(2027, 6, 16), 38.7, -9.1, "Asia/Tokyo")
        self.assertEqual(int(b[0][:2]) - int(a[0][:2]), 9)

    def test_dst_is_handled(self):
        import datetime as dt
        summer = days.sun_times(dt.date(2027, 6, 16), 38.72, -9.14, "Europe/Lisbon")
        winter = days.sun_times(dt.date(2027, 12, 16), 38.72, -9.14, "Europe/Lisbon")
        self.assertLess(summer[0], "06:30")      # UTC+1 in summer
        self.assertGreater(winter[0], "07:00")   # UTC+0 in winter

    def test_dated_events_and_info(self):
        self.assertIn("porto-sao-joao-party", self.day("2027-06-23")["evenements"])
        self.assertTrue(self.day("2027-06-19")["infos"] or self.day("2027-06-19")["evenements"])

    def test_legs_by_date(self):
        legs = self.day("2027-06-18")["trajets"]
        self.assertEqual([t["id"] for t in legs], ["lisbon-comporta"])
        self.assertEqual(len(legs[0]["options"]), 2)

    def test_entry_shape(self):
        self.assertEqual(sorted(self.day("2027-06-18")),
                         ["coucher", "date", "etape", "evenements", "infos", "lever", "lune", "lune_f", "trajets"])

    def test_writes_jours_json(self):
        with open(os.path.join(self.trip.media, "jours.json"), encoding="utf-8") as f:
            self.assertEqual(json.load(f), self.days)


class OtherTrips(Base):
    def test_trip_json_only(self):
        d = self.copy_sample(research=False)
        j = quiet(days.build, load(d))
        self.assertEqual(len(j), 10)
        self.assertTrue(all(x["evenements"] == [] and x["infos"] == [] and x["trajets"] == [] for x in j))

    def test_single_stage_other_time_zone(self):
        def edit(t):
            t["stages"] = [dict(t["stages"][0], to="2027-06-18", tz="Asia/Tokyo", ref=[35.68, 139.69])]
            t["specials"] = []
        j = quiet(days.build, load(self.copy_sample(edit, research=False)))
        self.assertEqual([x["date"] for x in j][-1], "2027-06-18")
        self.assertTrue("03:30" <= j[0]["lever"] <= "05:30", j[0]["lever"])   # Tokyo in June

    def test_cli_writes_next_to_the_trip(self):
        d = self.copy_sample(research=False)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(days.main(["--trip", d]), 0)
        self.assertTrue(os.path.isfile(os.path.join(d, "site", "media", "jours.json")))

    def test_cli_bad_trip_reports_without_traceback(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(days.main(["--trip", os.path.join(self.tmp, "nope")]), 1)
        self.assertIn("trip.json", err.getvalue())

    def test_norm_keeps_the_place_contract(self):
        p = days.norm({"id": "x-1", "nom": "N", "categorie": "restaurant", "lat": "38.7", "lng": -9.1,
                       "dates": ["2027-06-16"], "photo_urls": ["https://e/a.jpg", "ftp://no"]}, "lisbon")
        self.assertEqual((p["etape"], p["groupe"], p["lat"], p["_photos"]), ("lisbon", "manger", 38.7, ["https://e/a.jpg"]))


if __name__ == "__main__":
    unittest.main()
