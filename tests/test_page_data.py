import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import days  # noqa: E402
import flights  # noqa: E402
import i18n  # noqa: E402
import page_data  # noqa: E402
import stays  # noqa: E402
from tripctx import load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "sample-built")


def quiet(fn, *a, **k):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **k)


def drop_verifie(o):
    if isinstance(o, dict):
        return {k: drop_verifie(v) for k, v in o.items() if k != "verifie"}
    if isinstance(o, list):
        return [drop_verifie(x) for x in o]
    return o


def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def copy_sample(self, edit=None):
        d = os.path.join(tempfile.mkdtemp(dir=self.tmp), "trip")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        if edit:
            p = os.path.join(d, "trip.json")
            data = read(p)
            edit(data)
            with open(p, "w", encoding="utf-8") as f:
                json.dump(data, f)
        return d

    def run_build(self, trip_dir):
        out = tempfile.mkdtemp(dir=self.tmp)
        trip = load(trip_dir)
        quiet(page_data.build, trip, out)
        return trip, out


class SampleBuildTests(Base):
    @classmethod
    def setUpClass(cls):
        cls.tmpc = tempfile.mkdtemp()
        d = os.path.join(cls.tmpc, "trip")
        shutil.copytree(SAMPLE, d, ignore=shutil.ignore_patterns("site", "state.json"))
        cls.trip = load(d)
        cls.out = os.path.join(cls.tmpc, "out")
        quiet(days.build, cls.trip)
        quiet(page_data.build, cls.trip, cls.out)
        cls.P = read(os.path.join(cls.out, "parcours.json"))
        cls.porto = read(os.path.join(cls.out, "parcours-porto.json"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmpc, True)

    def test_one_file_per_stage(self):
        self.assertEqual(sorted(os.listdir(self.out)),
                         ["parcours-comporta.json", "parcours-lisbon.json", "parcours-porto.json", "parcours.json"])

    def test_top_level_keys(self):
        self.assertEqual(sorted(self.P), ["bases", "defaut", "formalites", "jours", "logos", "trip", "verifie", "vols"])
        for old in ("etapes", "dates", "plafond", "taux_thb"):
            self.assertNotIn(old, self.P)

    def test_trip_block(self):
        t = self.P["trip"]
        self.assertEqual(t["currency"], {"home": "USD", "local": "EUR", "rate": 0.92, "rate_date": "2026-11-07"})
        self.assertEqual((t["slug"], t["language"], t["start"], t["end"], t["budget_cap"]),
                         ("sample-portugal", "en", "2027-06-15", "2027-06-24", 6000))
        self.assertEqual(t["stages"][1], {"key": "comporta", "title": "Comporta", "from": "2027-06-18", "to": "2027-06-21",
                                          "nights": 3, "tone": 2, "file": "parcours-comporta.json"})
        self.assertEqual([l["key"] for l in t["legs"]],
                         ["arrive-a", "arrive-b", "lisbon-comporta", "comporta-porto", "return-a", "return-b"])
        self.assertEqual(t["specials"][0]["key"], "sao-joao")

    def test_ground_leg_options(self):
        v = self.P["vols"]["lisbon-comporta"]
        self.assertEqual(v["mode"], "ground")
        o = v["options"][0]
        self.assertEqual(o["id"], "lisbon-comporta-1")
        self.assertEqual(o["lignes"][0]["poste"], "trajets")
        self.assertEqual((o["lignes"][0]["n"], o["lignes"][0]["u"]), (1, 96))

    def test_flight_legs(self):
        v = self.P["vols"]["comporta-porto"]
        self.assertEqual(v["mode"], "flight")
        self.assertTrue(v["options"] and "grille" in v)
        self.assertTrue(all(o["lignes"] for o in v["options"]))

    def test_defaults_respect_rules(self):
        d, vols = self.P["defaut"], self.P["vols"]
        access = {}
        for st in self.trip.stages:
            lg = next(x for x in read(os.path.join(self.out, f"parcours-{st['key']}.json"))["logements"] if x["id"] == d[st["key"]])
            access[st["key"]] = lg["acces"]
        for leg in self.trip.legs:
            ids = [o["id"] for o in vols[leg["key"]]["options"]]
            self.assertIn(d[leg["key"]], ids)
            if leg["mode"] == "flight" and leg["key"] != "return-b":   # return-b: no option passes (own test)
                o = next(o for o in vols[leg["key"]]["options"] if o["id"] == d[leg["key"]])
                self.assertTrue(flights.respecte_regle(o, self.trip.rules, access.get(leg["from_stage"]), access.get(leg["to_stage"])), leg["key"])
        self.assertEqual(d["sorties"], {})
        self.assertEqual(d["inclure"], {l["key"]: True for l in self.trip.legs})
        self.assertEqual(d["lisbon"], "lisbon-01")

    def test_cheapest_flight_is_the_default(self):
        opts = self.P["vols"]["return-a"]["options"]
        cheapest = min(opts, key=lambda o: o["prix_home"])
        self.assertEqual(self.P["defaut"]["return-a"], cheapest["id"])

    def test_lodging_lines_sum_to_fiche(self):
        fiche = next(f for f in read(os.path.join(SAMPLE, "research", "resorts-fiches-sample.json")) if f["id"] == "porto-01")
        expected = fiche["prix"]["total_home"] + sum(v for k, v in fiche["cout_reel"].items() if k not in ("chambre", "hypotheses"))
        lg = next(x for x in self.porto["logements"] if x["id"] == "porto-01")
        self.assertAlmostEqual(sum(l["n"] * l["u"] for l in lg["lignes"]), expected, delta=1.5)

    def test_special_and_gala(self):
        lg = next(x for x in self.porto["logements"] if x["id"] == "porto-01")
        gala = [l for l in lg["lignes"] if l["cle"] == "gala"]
        self.assertEqual([l["speciale"] for l in gala], ["sao-joao"])
        self.assertEqual(self.P["defaut"]["speciales"], {"sao-joao": None})
        specials = {s["id"]: s["speciale"] for s in self.porto["sorties"]}
        self.assertEqual(specials["porto-fireworks-dinner"], "sao-joao")
        self.assertIsNone(specials["porto-cellar-tasting"])
        for l in lg["lignes"]:
            if l["cle"] != "gala":
                self.assertNotIn("speciale", l)

    def test_bases_one_line_per_paid_formality(self):
        b = {l["cle"]: l for l in self.P["bases"]}
        self.assertEqual(sorted(b), ["entry-a", "esim", "insurance"])   # passport-b costs 0
        self.assertEqual((b["insurance"]["n"], b["insurance"]["u"]), (2, 96))
        self.assertEqual((b["entry-a"]["n"], b["entry-a"]["u"]), (1, 12))
        self.assertTrue(all(l["poste"] == "formalites" and l["quand"] == "avant" for l in b.values()))

    def test_no_example_markers_or_old_fields(self):
        text = json.dumps([self.P, self.porto])
        self.assertNotIn("_example", text)
        for s in self.porto["sorties"]:
            self.assertNotIn("reveillon", s)

    def test_sample_has_days(self):
        self.assertEqual(len(self.P["jours"]), 10)
        self.assertEqual(self.P["jours"][0]["date"], "2027-06-15")

    def test_sample_built_is_fresh(self):
        self.assertEqual(sorted(os.listdir(FIXTURE)), sorted(os.listdir(self.out)))
        for name in os.listdir(self.out):
            self.assertEqual(drop_verifie(read(os.path.join(self.out, name))), drop_verifie(read(os.path.join(FIXTURE, name))), name)


class OtherTripTests(Base):
    def default_access(self, out, stage):
        P = read(os.path.join(out, "parcours.json"))
        lgs = read(os.path.join(out, f"parcours-{stage}.json"))["logements"]
        return P, next(x for x in lgs if x["id"] == P["defaut"][stage])["acces"]

    def test_arrival_default_skips_option_landing_too_late(self):
        base_trip, base_out = self.run_build(self.copy_sample())
        P0, _ = self.default_access(base_out, "lisbon")
        opts = P0["vols"]["arrive-a"]["options"]
        cheapest = min(opts, key=lambda o: o["prix_home"])
        arr = cheapest["segments"][-1]["arr_local"][11:16]
        h, m = int(arr[:2]), int(arr[3:])
        # latest_arrival just before the cheapest option reaches the stay (arrival + 60 min + 25 min transfer)
        limit = h * 60 + m + 60 + 25 - 1
        d = self.copy_sample(lambda t: t.update(rules={"latest_arrival": f"{limit // 60:02d}:{limit % 60:02d}"}))
        trip, out = self.run_build(d)
        P, acc = self.default_access(out, "lisbon")
        chosen = next(o for o in P["vols"]["arrive-a"]["options"] if o["id"] == P["defaut"]["arrive-a"])
        self.assertNotEqual(chosen["id"], cheapest["id"])
        self.assertTrue(flights.respecte_regle(chosen, trip.rules, None, acc))
        self.assertFalse(flights.respecte_regle(cheapest, trip.rules, None, acc))

    def test_return_default_falls_back_to_cheapest_when_none_passes(self):
        trip, out = self.run_build(self.copy_sample())
        P, acc = self.default_access(out, "porto")
        opts = P["vols"]["return-b"]["options"]
        self.assertFalse(any(flights.respecte_regle(o, trip.rules, acc, None) for o in opts))
        self.assertEqual(P["defaut"]["return-b"], min(opts, key=lambda o: o["prix_home"])["id"])

    def test_no_research_yet(self):
        d = os.path.join(self.tmp, "bare")
        os.makedirs(d)
        shutil.copy(os.path.join(SAMPLE, "trip.json"), d)
        trip, out = self.run_build(d)
        self.assertEqual(len(os.listdir(out)), 4)
        for st in trip.stages:
            b = read(os.path.join(out, f"parcours-{st['key']}.json"))
            self.assertEqual(b, {"logements": [], "sorties": [], "autres": []})
        P = read(os.path.join(out, "parcours.json"))
        self.assertTrue(all(v["options"] == [] for v in P["vols"].values()))
        self.assertIsNone(P["defaut"]["porto"])
        self.assertIsNone(P["defaut"]["comporta-porto"])
        self.assertEqual(P["trip"]["currency"]["rate"], None)
        self.assertEqual((P["bases"], P["formalites"], P["jours"], P["logos"]), ([], [], [], {}))

    def test_prebuilt_flights_are_reused(self):
        d = self.copy_sample()
        trip = load(d)
        built = quiet(flights.build, trip)
        out = tempfile.mkdtemp(dir=self.tmp)
        with mock.patch.object(page_data.flights, "build", side_effect=AssertionError("flights built twice")):
            quiet(page_data.build, trip, out, built=built)
        self.assertTrue(os.path.isfile(os.path.join(out, "parcours.json")))

    def test_home_equals_local(self):
        def edit(d):
            d["currency"] = {"home": "USD", "local": "USD"}
        _, out = self.run_build(self.copy_sample(edit))
        cur = read(os.path.join(out, "parcours.json"))["trip"]["currency"]
        self.assertEqual(cur, {"home": "USD", "local": None, "rate": None, "rate_date": None})

    def test_labels_follow_language(self):
        d = self.copy_sample(lambda t: t.update(language="fr"))
        os.remove(os.path.join(d, "research", "couts-unites.json"))   # fall back to one estimated line per item
        _, out = self.run_build(d)
        lg = read(os.path.join(out, "parcours-lisbon.json"))["logements"][0]
        libs = [l["lib"] for l in lg["lignes"]]
        self.assertIn(i18n.T("breakfasts", "fr"), " ".join(libs))
        self.assertEqual(i18n.T("breakfasts", "fr"), "petits-déjeuners")
        self.assertTrue(libs[0].startswith("nuits · "))

    def test_defaults_from_trip_json(self):
        def edit(d):
            d["defaults"] = {"lisbon": "lisbon-02", "lisbon-comporta": "lisbon-comporta-2"}
        _, out = self.run_build(self.copy_sample(edit))
        dflt = read(os.path.join(out, "parcours.json"))["defaut"]
        self.assertEqual((dflt["lisbon"], dflt["lisbon-comporta"]), ("lisbon-02", "lisbon-comporta-2"))

    def test_base_lines_are_appended(self):
        line = {"lib": "Airport parking", "n": 1, "u": 40, "quand": "place", "poste": "trajets"}
        _, out = self.run_build(self.copy_sample(lambda d: d.update(base_lines=[line])))
        last = read(os.path.join(out, "parcours.json"))["bases"][-1]
        self.assertEqual({k: last[k] for k in line}, line)

    def test_single_stage_single_traveler(self):
        d = os.path.join(self.tmp, "weekend")
        os.makedirs(d)
        with open(os.path.join(d, "trip.json"), "w") as f:
            json.dump({"slug": "weekend", "title": "Weekend", "language": "en", "currency": {"home": "USD"}, "budget_cap": 1500,
                       "travelers": [{"id": "a", "label": "Alex", "adults": 1, "home_airport": "JFK"}],
                       "stages": [{"key": "lisbon", "title": "Lisbon", "from": "2027-06-15", "to": "2027-06-18",
                                   "tz": "Europe/Lisbon", "ref": [38.7, -9.1], "airports": ["LIS"], "country": "PT"}]}, f)
        _, out = self.run_build(d)
        P = read(os.path.join(out, "parcours.json"))
        self.assertEqual(sorted(P["vols"]), ["arrive-a", "return-a"])
        self.assertEqual(P["defaut"]["speciales"], {})

    def test_gallery_lists_only_files_on_disk(self):
        d = self.copy_sample()
        photos = os.path.join(d, "site", "media", "photos", "lisbon-01")
        os.makedirs(photos)
        for n in ("01.jpg", "01-s.jpg", "02.jpg"):   # 02-s.jpg is missing
            open(os.path.join(photos, n), "wb").close()
        with open(os.path.join(d, "site", "media", "photos", "index.json"), "w") as f:
            json.dump({"lisbon-01": {"n": 2, "source": "x", "credits": "y", "vue_en_tete": True}}, f)
        _, out = self.run_build(d)
        g = read(os.path.join(out, "parcours-lisbon.json"))["logements"][0]["galerie"]
        self.assertEqual((g["n"], g["grandes"], g["petites"]), (1, ["media/photos/lisbon-01/01.jpg"], ["media/photos/lisbon-01/01-s.jpg"]))
        self.assertTrue(g["vue_en_tete"])

    def test_jours_and_logos_come_from_the_trip_media_dir(self):
        d = self.copy_sample()
        media = os.path.join(d, "site", "media")
        os.makedirs(media)
        with open(os.path.join(media, "jours.json"), "w") as f:
            json.dump([{"date": "2027-06-15"}], f)
        with open(os.path.join(media, "logos.json"), "w") as f:
            json.dump({"TP": "data:image/png;base64,AA"}, f)
        _, out = self.run_build(d)   # out is another folder
        P = read(os.path.join(out, "parcours.json"))
        self.assertEqual(P["jours"], [{"date": "2027-06-15"}])
        self.assertEqual(P["logos"], {"TP": "data:image/png;base64,AA"})


class HelperTests(unittest.TestCase):
    def test_quand_chambre(self):
        self.assertEqual(page_data.quand_chambre("pay at the hotel"), "place")
        self.assertEqual(page_data.quand_chambre("sur place"), "place")
        self.assertEqual(page_data.quand_chambre("prepaid online"), "avant")
        self.assertEqual(page_data.quand_chambre(None), "avant")

    def test_hors_and_src_group_tables(self):
        self.assertTrue(page_data.hors({"hors_budget": True}))
        self.assertFalse(page_data.hors({"n": 1}))
        self.assertEqual(page_data.SRC["carte"], "releve")
        self.assertEqual(page_data.GROUPE["gala"], "repas")

    def test_dates_in_text(self):
        self.assertEqual(page_data.annulation_date("free cancellation until 2027-05-01"), "2027-05-01")
        self.assertEqual(page_data.annulation_date("gratuite avant le 1 mai 2027"), "2027-05-01")
        self.assertEqual(page_data.annulation_date("free until Nov 17, 2026"), "2026-11-17")
        self.assertIsNone(page_data.annulation_date("free cancellation until 7 days before"))
        self.assertIsNone(page_data.annulation_date("non-refundable until 2027-05-01"))
        self.assertEqual(page_data.prelevement_date("nothing before 15 Nov 2026"), "2026-11-15")
        self.assertIsNone(page_data.prelevement_date("prepaid online"))

    def test_stays_signature_takes_a_trip(self):
        trip = load(SAMPLE)
        groups = [g for g, _, _ in stays.sources(trip, "porto")]
        self.assertEqual(len(groups), 3)


class I18nTests(unittest.TestCase):
    def test_languages(self):
        self.assertEqual(i18n.T("overnight", "en"), "overnight")
        self.assertEqual(i18n.T("overnight", "fr"), "de nuit")
        self.assertEqual(i18n.T("overnight", "de"), "overnight")   # unknown language: English

    def test_unknown_key_warns_once(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(i18n.T("no_such_label_xyz", "en"), "no_such_label_xyz")
            i18n.T("no_such_label_xyz", "fr")
        self.assertEqual(err.getvalue().count("no_such_label_xyz"), 1)

    def test_both_tables_have_the_same_keys(self):
        self.assertEqual(set(i18n.EN), set(i18n.FR))


if __name__ == "__main__":
    unittest.main()
