"""check_research.check(trip): structure of access, outing and formality files, driven by the trip's stages."""
import contextlib
import copy
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import check_research as S  # noqa: E402
from tripctx import load  # noqa: E402

SAMPLE = os.path.join(ROOT, "examples", "sample-trip")


def rd(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.dir = os.path.join(self.tmp, "trip")
        shutil.copytree(SAMPLE, self.dir, ignore=shutil.ignore_patterns("site", "state.json"))
        self.res = os.path.join(self.dir, "research")

    def edit(self, name, fn):
        p = os.path.join(self.res, name)
        data = rd(p)
        fn(data)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def edit_trip(self, fn):
        p = os.path.join(self.dir, "trip.json")
        data = rd(p)
        fn(data)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def problems(self):
        return S.check(load(self.dir))

    def assertProblem(self, problems, *words):
        self.assertTrue(any(all(w in p for w in words) for p in problems), f"{words} not in {problems}")


class SampleTrip(Base):
    def test_sample_passes_check(self):
        self.assertEqual(S.check(load(SAMPLE)), [])

    def test_bad_prefix_reported(self):
        def rename(d):
            d["paris-01"] = d.pop("lisbon-01")
        self.edit("acces-logements.json", rename)
        p = self.problems()
        self.assertProblem(p, "paris-01", "lisbon-", "comporta-", "porto-")

    def test_bad_prefix_in_outings(self):
        def rename(d):
            d["paris-01"] = d.pop("lisbon-alfama-walk")
        self.edit("sorties-lisbon.json", rename)
        self.assertProblem(self.problems(), "paris-01", "prefix", "lisbon-")

    def test_no_research_at_all(self):
        shutil.rmtree(self.res)
        self.assertEqual(self.problems(), [])

    def test_example_marker_is_ignored_but_unknown_fields_are_not(self):
        def add(d):
            d["lisbon-alfama-walk"]["fantaisie"] = 1
        self.edit("sorties-lisbon.json", add)
        self.assertProblem(self.problems(), "lisbon-alfama-walk", "fantaisie")
        self.assertFalse(any("_example" in p for p in self.problems()))


class Access(Base):
    def test_airport_must_belong_to_the_stage(self):
        self.edit("acces-logements.json", lambda d: d["porto-01"].update(aeroport="LIS"))
        self.assertProblem(self.problems(), "porto-01", "LIS", "OPO")

    def test_depart_airport_counts_for_a_stage_without_airport(self):
        self.edit("acces-logements.json", lambda d: d["comporta-01"].update(aeroport="LIS"))
        self.assertEqual(self.problems(), [])

    def test_airport_code_shape(self):
        self.edit("acces-logements.json", lambda d: d["porto-01"].update(aeroport="opo"))
        self.assertProblem(self.problems(), "porto-01", "airport code")

    def test_missing_field_and_bad_time(self):
        def f(d):
            del d["porto-01"]["verifie"]
            d["lisbon-01"]["dernier_public"] = "8pm"
        self.edit("acces-logements.json", f)
        p = self.problems()
        self.assertProblem(p, "porto-01", "verifie")
        self.assertProblem(p, "lisbon-01", "dernier_public")

    def test_access_modes_beyond_car_and_boat(self):
        def f(d):
            d["lisbon-01"]["mode"] = "train"
            d["comporta-01"]["mode"] = "voiture+ferry+walk"
            d["porto-01"]["mode"] = "metro+pied"
        self.edit("acces-logements.json", f)
        self.assertEqual(self.problems(), [])
        self.edit("acces-logements.json", lambda d: d["lisbon-01"].update(mode="hoverboard"))
        self.assertProblem(self.problems(), "lisbon-01", "mode", "hoverboard")
        self.edit("acces-logements.json", lambda d: d["lisbon-01"].update(mode="train+"))
        self.assertProblem(self.problems(), "lisbon-01", "mode")

    def test_non_https_source(self):
        self.edit("acces-logements.json", lambda d: d["porto-01"].update(source="http://x.example/t"))
        self.assertProblem(self.problems(), "porto-01", "https")

    def test_fiche_without_access(self):
        self.edit("resorts-fiches-sample.json", lambda d: d.append({"id": "porto-99"}))
        self.assertProblem(self.problems(), "porto-99", "access")


class Outings(Base):
    def test_unknown_special(self):
        self.edit("sorties-porto.json", lambda d: d["porto-fireworks-dinner"].update(speciale="midsummer"))
        self.assertProblem(self.problems(), "porto-fireworks-dinner", "midsummer", "sao-joao")

    def test_date_outside_the_trip(self):
        self.edit("sorties-porto.json", lambda d: d["porto-cellar-tasting"].update(date_fixe="2027-07-01"))
        self.assertProblem(self.problems(), "porto-cellar-tasting", "outside the trip")

    def test_price_without_source(self):
        def f(d):
            d["lisbon-alfama-walk"]["liens"] = []
        self.edit("sorties-lisbon.json", f)
        self.assertProblem(self.problems(), "lisbon-alfama-walk", "prix_estime")

    def test_unknown_place_and_missing_outing(self):
        def f(d):
            d["lisbon-ghost"] = copy.deepcopy(d["lisbon-alfama-walk"])
            del d["lisbon-rooftop-tejo"]
        self.edit("sorties-lisbon.json", f)
        p = self.problems()
        self.assertProblem(p, "lisbon-ghost", "unknown place")
        self.assertProblem(p, "lisbon-rooftop-tejo", "without an outing")

    def test_file_of_an_unknown_stage(self):
        shutil.copy(os.path.join(self.res, "sorties-lisbon.json"), os.path.join(self.res, "sorties-paris.json"))
        self.assertProblem(self.problems(), "sorties-paris.json", "paris", "lisbon")

    def test_unreadable_json(self):
        with open(os.path.join(self.res, "sorties-lisbon.json"), "w") as f:
            f.write("{nope")
        self.assertProblem(self.problems(), "sorties-lisbon.json", "JSON")


class Formalities(Base):
    def test_who_is_a_traveler_id_or_all(self):
        self.edit("formalites.json", lambda d: d[2].update(qui="c"))
        self.assertProblem(self.problems(), "entry-a", "qui", "'c'")
        self.edit("formalites.json", lambda d: d[2].update(qui="all"))
        self.assertEqual(self.problems(), [])

    def test_nothing_required_by_default(self):
        self.edit("formalites.json", lambda d: d.pop())
        self.assertEqual(self.problems(), [])

    def test_required_formalities_come_from_the_trip(self):
        self.edit_trip(lambda t: t.update(required_formalities=["insurance", "tdac"]))
        p = self.problems()
        self.assertProblem(p, "tdac", "required formality missing")
        self.assertFalse(any("insurance" in x and "missing" in x for x in p))

    def test_required_formality_with_no_file(self):
        os.remove(os.path.join(self.res, "formalites.json"))
        self.edit_trip(lambda t: t.update(required_formalities=["esim"]))
        self.assertProblem(self.problems(), "esim", "missing")

    def test_duplicate_condition_and_numbers(self):
        def f(d):
            d.append(copy.deepcopy(d[0]))
            d[1]["condition"] = "visa-mars"
            d[2]["cout_home"] = None
        self.edit("formalites.json", f)
        p = self.problems()
        self.assertProblem(p, "insurance", "duplicate")
        self.assertProblem(p, "esim", "condition")
        self.assertProblem(p, "entry-a", "cout_home")


class Cli(Base):
    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = S.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_ok_exit_0(self):
        self.assertEqual(self.run_cli("--trip", self.dir)[0], 0)

    def test_problems_exit_1_one_per_line(self):
        self.edit("acces-logements.json", lambda d: d["porto-01"].update(aeroport="LIS"))
        code, out, err = self.run_cli("--trip", self.dir)
        self.assertEqual(code, 1)
        self.assertEqual(len(out.strip().splitlines()), 1)
        self.assertIn("1 problem", err)

    def test_bad_trip_dir(self):
        code, _o, err = self.run_cli("--trip", os.path.join(self.tmp, "nope"))
        self.assertEqual(code, 1)
        self.assertIn("trip.json", err)


if __name__ == "__main__":
    unittest.main()
